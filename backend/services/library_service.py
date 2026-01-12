"""library_service - SQLite-backed document storage with PDF parsing and page extraction."""

import base64
import hashlib
import json
import os
import sqlite3
import time
import uuid
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import Destination
from starlette.concurrency import run_in_threadpool

from models.schemas import DocumentInfo, MessageInfo, OutlineItem, SessionInfo

DEFAULT_RANGE_END = 7


def now_ms() -> int:
    """Current time in milliseconds since epoch."""
    return int(time.time() * 1000)


class LibraryService:
    def __init__(self, data_dir: Path | None = None) -> None:
        """Initialize storage paths and database schema."""
        base_dir = data_dir or Path(
            os.getenv(
                "READPILOT_DATA_DIR",
                Path(__file__).resolve().parents[1] / "storage",
            )
        )
        self.data_dir = base_dir
        self.library_dir = base_dir / "library"
        self.db_path = base_dir / "readpilot.db"
        self._ensure_storage()
        self._init_db()

    def _ensure_storage(self) -> None:
        """Create storage directories if missing."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.library_dir.mkdir(parents=True, exist_ok=True)

    def _get_conn(self) -> sqlite3.Connection:
        """Return a SQLite connection with row access by name."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        """Create tables and indexes if they don't exist."""
        with self._get_conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    doc_id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    title TEXT,
                    total_pages INTEGER NOT NULL,
                    file_size INTEGER NOT NULL,
                    outline_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_opened_at INTEGER NOT NULL,
                    last_page INTEGER NOT NULL,
                    range_start INTEGER NOT NULL,
                    range_end INTEGER NOT NULL,
                    last_session_id TEXT
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    doc_id TEXT NOT NULL,
                    title TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_doc_id ON sessions(doc_id);

                CREATE TABLE IF NOT EXISTS messages (
                    message_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    page_start INTEGER,
                    page_end INTEGER
                );

                CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
                """
            )

    def _file_path(self, doc_id: str) -> Path:
        """Map a document id to its on-disk PDF path."""
        return self.library_dir / f"{doc_id}.pdf"

    def _row_to_document(self, row: sqlite3.Row) -> DocumentInfo:
        """Convert a DB row into a DocumentInfo model."""
        outline_items = json.loads(row["outline_json"]) if row["outline_json"] else []
        outline = [OutlineItem(**item) for item in outline_items]
        return DocumentInfo(
            doc_id=row["doc_id"],
            filename=row["filename"],
            total_pages=row["total_pages"],
            title=row["title"],
            outline=outline,
            file_size=row["file_size"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            last_opened_at=row["last_opened_at"],
            last_page=row["last_page"],
            range_start=row["range_start"],
            range_end=row["range_end"],
            last_session_id=row["last_session_id"],
        )

    def _row_to_session(self, row: sqlite3.Row) -> SessionInfo:
        """Convert a DB row into a SessionInfo model."""
        return SessionInfo(
            session_id=row["session_id"],
            doc_id=row["doc_id"],
            title=row["title"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def _row_to_message(self, row: sqlite3.Row) -> MessageInfo:
        """Convert a DB row into a MessageInfo model."""
        return MessageInfo(
            message_id=row["message_id"],
            session_id=row["session_id"],
            role=row["role"],
            content=row["content"],
            created_at=row["created_at"],
            page_start=row["page_start"],
            page_end=row["page_end"],
        )

    def get_file_path(self, doc_id: str) -> Path | None:
        """Return the PDF path if it exists on disk."""
        path = self._file_path(doc_id)
        if not path.exists():
            return None
        return path

    def _import_sync(self, file_content: bytes, filename: str) -> DocumentInfo:
        """Import a PDF and upsert metadata; runs in a threadpool."""
        doc_id = hashlib.sha256(file_content).hexdigest()
        file_path = self._file_path(doc_id)
        now = now_ms()

        if not file_path.exists():
            file_path.write_bytes(file_content)

        with self._get_conn() as conn:
            existing = conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()

            if existing:
                # Update metadata and last-opened time for existing documents.
                conn.execute(
                    """
                    UPDATE documents
                    SET filename = ?, file_size = ?, updated_at = ?, last_opened_at = ?
                    WHERE doc_id = ?
                    """,
                    (filename, len(file_content), now, now, doc_id),
                )
                row = conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
                if row is None:
                    raise ValueError("Document not found after update")
                return self._row_to_document(row)

        # Parse PDF metadata and outline once to populate DB.
        reader = PdfReader(BytesIO(file_content))
        total_pages = len(reader.pages)
        metadata = reader.metadata or {}
        title = None
        if metadata:
            title = getattr(metadata, "title", None)
            if not title and hasattr(metadata, "get"):
                title = metadata.get("/Title") or metadata.get("Title")
        outline = self._extract_outline(reader)

        range_start = 1
        range_end = min(DEFAULT_RANGE_END, total_pages)

        outline_json = json.dumps([item.model_dump() for item in outline])
        record = DocumentInfo(
            doc_id=doc_id,
            filename=filename,
            total_pages=total_pages,
            title=title,
            outline=outline,
            file_size=len(file_content),
            created_at=now,
            updated_at=now,
            last_opened_at=now,
            last_page=1,
            range_start=range_start,
            range_end=range_end,
            last_session_id=None,
        )

        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO documents (
                    doc_id, filename, title, total_pages, file_size,
                    outline_json, created_at, updated_at, last_opened_at,
                    last_page, range_start, range_end, last_session_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.doc_id,
                    record.filename,
                    record.title,
                    record.total_pages,
                    record.file_size,
                    outline_json,
                    record.created_at,
                    record.updated_at,
                    record.last_opened_at,
                    record.last_page,
                    record.range_start,
                    record.range_end,
                    record.last_session_id,
                ),
            )

        return record

    async def import_pdf(self, file_content: bytes, filename: str) -> DocumentInfo:
        """Async wrapper for importing a PDF."""
        return await run_in_threadpool(self._import_sync, file_content, filename)

    def list_documents(self, limit: int = 20) -> list[DocumentInfo]:
        """Return recent documents ordered by last opened timestamp."""
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM documents ORDER BY last_opened_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._row_to_document(row) for row in rows]

    def get_document(self, doc_id: str) -> DocumentInfo | None:
        """Fetch a document by id."""
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_document(row)

    def update_document_state(
        self,
        doc_id: str,
        last_page: int | None = None,
        range_start: int | None = None,
        range_end: int | None = None,
        last_session_id: str | None = None,
    ) -> DocumentInfo | None:
        """Update last-opened state and selected range for a document."""
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
            if row is None:
                return None

            # Apply patch semantics: keep existing values when missing.
            next_last_page = last_page if last_page is not None else row["last_page"]
            next_range_start = range_start if range_start is not None else row["range_start"]
            next_range_end = range_end if range_end is not None else row["range_end"]
            next_last_session_id = last_session_id if last_session_id is not None else row["last_session_id"]
            now = now_ms()

            conn.execute(
                """
                UPDATE documents
                SET last_page = ?, range_start = ?, range_end = ?,
                    last_session_id = ?, updated_at = ?, last_opened_at = ?
                WHERE doc_id = ?
                """,
                (
                    next_last_page,
                    next_range_start,
                    next_range_end,
                    next_last_session_id,
                    now,
                    now,
                    doc_id,
                ),
            )
            updated = conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
        if updated is None:
            return None
        return self._row_to_document(updated)

    def create_session(self, doc_id: str, title: str | None = None) -> SessionInfo:
        """Create a new session and mark it as the document's last session."""
        session_id = uuid.uuid4().hex[:16]
        now = now_ms()
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO sessions (session_id, doc_id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, doc_id, title, now, now),
            )
            conn.execute(
                """
                UPDATE documents
                SET last_session_id = ?, updated_at = ?, last_opened_at = ?
                WHERE doc_id = ?
                """,
                (session_id, now, now, doc_id),
            )
            row = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
        if row is None:
            raise ValueError("Session not created")
        return self._row_to_session(row)

    def list_sessions(self, doc_id: str) -> list[SessionInfo]:
        """List sessions for a document, most recently updated first."""
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM sessions WHERE doc_id = ? ORDER BY updated_at DESC",
                (doc_id,),
            ).fetchall()
        return [self._row_to_session(row) for row in rows]

    def get_session(self, session_id: str) -> SessionInfo | None:
        """Fetch a session by id."""
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_session(row)

    def update_session_title(self, session_id: str, title: str | None) -> SessionInfo | None:
        """Update the display title of a session."""
        now = now_ms()
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?",
                (title, now, session_id),
            )
            updated = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
        if updated is None:
            return None
        return self._row_to_session(updated)

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> MessageInfo:
        """Persist a message and bump the session's updated time."""
        message_id = uuid.uuid4().hex[:16]
        now = now_ms()
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO messages
                (message_id, session_id, role, content, created_at, page_start, page_end)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (message_id, session_id, role, content, now, page_start, page_end),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
                (now, session_id),
            )
            row = conn.execute("SELECT * FROM messages WHERE message_id = ?", (message_id,)).fetchone()
        if row is None:
            raise ValueError("Message not saved")
        return self._row_to_message(row)

    def list_messages(self, session_id: str) -> list[MessageInfo]:
        """List messages in ascending time order."""
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        return [self._row_to_message(row) for row in rows]

    def clear_messages(self, session_id: str) -> None:
        """Delete all messages for a session."""
        with self._get_conn() as conn:
            conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
                (now_ms(), session_id),
            )

    def _extract_pages_sync(self, doc_id: str, start_page: int, end_page: int) -> bytes | None:
        """Extract a page range into a new PDF; runs in a threadpool."""
        file_path = self._file_path(doc_id)
        if not file_path.exists():
            return None

        with file_path.open("rb") as file_obj:
            reader = PdfReader(file_obj)
            total_pages = len(reader.pages)
            if total_pages == 0:
                return None
            # Convert 1-based page numbers into 0-based indices.
            from_page = min(total_pages - 1, max(0, start_page - 1))
            to_page = min(total_pages - 1, max(from_page, end_page - 1))
            writer = PdfWriter()
            writer.append(reader, pages=(from_page, to_page + 1))
            output = BytesIO()
            writer.write(output)
            return output.getvalue()

    def _extract_outline(self, reader: PdfReader) -> list[OutlineItem]:
        """Flatten outline entries with 1-based page numbers."""
        outline_items: list[OutlineItem] = []

        def walk(items: list[object], level: int) -> None:
            for item in items:
                if isinstance(item, list):
                    walk(item, level + 1)
                    continue
                if not isinstance(item, Destination):
                    continue
                page_number = reader.get_destination_page_number(item)
                if page_number is None:
                    continue
                title = item.title or "Untitled"
                outline_items.append(
                    OutlineItem(
                        level=level,
                        title=title,
                        page=page_number + 1,
                    )
                )

        try:
            outline = reader.outline
        except Exception:
            return []
        walk(outline, 1)
        return outline_items

    async def extract_pages(self, doc_id: str, start_page: int, end_page: int) -> bytes | None:
        """Async wrapper for extracting a page range."""
        return await run_in_threadpool(self._extract_pages_sync, doc_id, start_page, end_page)

    def _encode_base64(self, pdf_bytes: bytes) -> str:
        """Base64-encode PDF bytes for OpenAI-compatible file input."""
        return base64.b64encode(pdf_bytes).decode("utf-8")

    async def extract_pages_base64(self, doc_id: str, start_page: int, end_page: int) -> str | None:
        """Extract page range and return base64-encoded content."""
        pdf_bytes = await self.extract_pages(doc_id, start_page, end_page)
        if pdf_bytes is None:
            return None
        return await run_in_threadpool(self._encode_base64, pdf_bytes)

    def delete_document(self, doc_id: str) -> bool:
        """Delete a document and all related data (sessions, messages, file)."""
        with self._get_conn() as conn:
            # Check if document exists
            row = conn.execute("SELECT doc_id FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
            if not row:
                return False

            # Delete file
            file_path = self._file_path(doc_id)
            if file_path.exists():
                try:
                    file_path.unlink()
                except OSError as e:
                    print(f"Error deleting file {file_path}: {e}")

            # Delete DB records
            # Because we don't have CASCADE delete setup in schema (or foreign keys might be loose),
            # we should manually clean up to be safe.
            # 1. Get all sessions for this doc
            sessions = conn.execute("SELECT session_id FROM sessions WHERE doc_id = ?", (doc_id,)).fetchall()
            session_ids = [s["session_id"] for s in sessions]

            # 2. Delete messages for these sessions
            if session_ids:
                placeholders = ",".join(["?"] * len(session_ids))
                conn.execute(f"DELETE FROM messages WHERE session_id IN ({placeholders})", session_ids)

            # 3. Delete sessions
            conn.execute("DELETE FROM sessions WHERE doc_id = ?", (doc_id,))

            # 4. Delete document
            conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))

        return True

    def delete_session(self, session_id: str) -> bool:
        """Delete a session and its messages."""
        with self._get_conn() as conn:
            row = conn.execute("SELECT session_id, doc_id FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
            if not row:
                return False

            doc_id = row["doc_id"]

            # Delete messages
            conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))

            # Delete session
            conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))

            # Update document if this was the last session
            doc_row = conn.execute("SELECT last_session_id FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
            if doc_row and doc_row["last_session_id"] == session_id:
                # Find another session to set as last, or set to NULL
                recent_session = conn.execute(
                    "SELECT session_id FROM sessions WHERE doc_id = ? ORDER BY updated_at DESC LIMIT 1", (doc_id,)
                ).fetchone()
                new_last_id = recent_session["session_id"] if recent_session else None
                conn.execute("UPDATE documents SET last_session_id = ? WHERE doc_id = ?", (new_last_id, doc_id))

        return True


library_service = LibraryService()

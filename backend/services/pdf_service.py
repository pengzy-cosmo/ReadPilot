import base64
import uuid
from datetime import datetime, timezone

import pymupdf
from models.schemas import OutlineItem, PDFInfo
from starlette.concurrency import run_in_threadpool


class PDFService:
    """PDF file management and processing service."""

    def __init__(self):
        # Session-level in-memory cache: {pdf_id: (bytes, PDFInfo)}
        self._storage: dict[str, tuple[bytes, PDFInfo]] = {}

    def _upload_sync(self, file_content: bytes, filename: str) -> PDFInfo:
        """
        Upload and parse a PDF file.
        - Generate unique pdf_id
        - Extract metadata (page count, title)
        - Extract table of contents
        - Store in memory cache
        """
        pdf_id = str(uuid.uuid4())[:8]

        doc = pymupdf.open(stream=file_content, filetype="pdf")
        try:
            total_pages = doc.page_count
            metadata = doc.metadata
            title = metadata.get("title") if metadata else None

            # Extract outline/TOC
            toc = doc.get_toc()
            outline = [OutlineItem(level=level, title=item_title, page=page) for level, item_title, page in toc]

            info = PDFInfo(
                pdf_id=pdf_id,
                filename=filename,
                total_pages=total_pages,
                title=title or None,
                outline=outline,
                file_size=len(file_content),
                uploaded_at=datetime.now(timezone.utc),
            )

            self._storage[pdf_id] = (file_content, info)
            return info
        finally:
            doc.close()

    async def upload(self, file_content: bytes, filename: str) -> PDFInfo:
        """Upload and parse a PDF file without blocking the event loop."""
        return await run_in_threadpool(self._upload_sync, file_content, filename)

    def get_info(self, pdf_id: str) -> PDFInfo | None:
        """Get PDF metadata by ID."""
        if pdf_id not in self._storage:
            return None
        return self._storage[pdf_id][1]

    def delete(self, pdf_id: str) -> bool:
        """Delete PDF from storage."""
        if pdf_id not in self._storage:
            return False
        del self._storage[pdf_id]
        return True

    def get_pdf_bytes(self, pdf_id: str) -> bytes | None:
        """Get raw PDF bytes by ID."""
        if pdf_id not in self._storage:
            return None
        return self._storage[pdf_id][0]

    def _extract_pages_sync(self, pdf_id: str, start_page: int, end_page: int) -> bytes | None:
        """
        Extract specified page range and return new PDF bytes.
        - Page numbers are 1-indexed (user-friendly)
        - Returns None if pdf_id not found
        """
        if pdf_id not in self._storage:
            return None

        pdf_bytes = self._storage[pdf_id][0]
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")

        try:
            # Convert to 0-indexed for pymupdf
            from_page = start_page - 1
            to_page = end_page - 1

            # Clamp to valid range
            from_page = max(0, from_page)
            to_page = min(doc.page_count - 1, to_page)

            # Create new document with extracted pages
            output = pymupdf.open()
            output.insert_pdf(doc, from_page=from_page, to_page=to_page)

            # Get bytes
            result = output.tobytes()
            output.close()
            return result
        finally:
            doc.close()

    async def extract_pages(self, pdf_id: str, start_page: int, end_page: int) -> bytes | None:
        """Extract pages without blocking the event loop."""
        return await run_in_threadpool(self._extract_pages_sync, pdf_id, start_page, end_page)

    def _encode_base64_sync(self, pdf_bytes: bytes) -> str:
        return base64.b64encode(pdf_bytes).decode("utf-8")

    async def extract_pages_base64(self, pdf_id: str, start_page: int, end_page: int) -> str | None:
        """Extract pages and return Base64 encoded string."""
        pdf_bytes = await self.extract_pages(pdf_id, start_page, end_page)
        if pdf_bytes is None:
            return None
        return await run_in_threadpool(self._encode_base64_sync, pdf_bytes)

    def list_pdfs(self) -> list[PDFInfo]:
        """List all stored PDFs."""
        return [info for _, info in self._storage.values()]


# Global singleton instance
pdf_service = PDFService()

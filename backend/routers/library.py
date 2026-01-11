"""library - API endpoints for document import, listing, and PDF streaming with Range support."""

import os
from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse

from models.schemas import DocumentInfo, DocumentStateUpdate
from services.library_service import library_service

router = APIRouter()

# Stream PDFs in 1MB chunks to keep memory usage predictable.
CHUNK_SIZE = 1024 * 1024


def iter_file_range(path: Path, start: int, end: int) -> Iterator[bytes]:
    """Yield a byte range from a file for HTTP streaming."""
    with path.open("rb") as file:
        file.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = file.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def parse_range_header(range_header: str, file_size: int) -> tuple[int, int] | None:
    """Parse a single HTTP Range header into a valid byte range."""
    if not range_header.startswith("bytes="):
        return None

    range_spec = range_header.replace("bytes=", "", 1)
    if "," in range_spec:
        # Multiple ranges are not supported.
        return None

    start_str, end_str = range_spec.split("-", 1)
    try:
        if start_str == "":
            length = int(end_str)
            if length <= 0:
                return None
            start = max(0, file_size - length)
            end = file_size - 1
        else:
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1

        if start < 0 or end < start or start >= file_size:
            return None
        end = min(end, file_size - 1)
        return start, end
    except ValueError:
        return None


def build_file_headers(doc_id: str, content_length: int) -> dict[str, str]:
    """Build common response headers for PDF streaming."""
    return {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=31536000, immutable",
        "ETag": f'"{doc_id}"',
        "Content-Length": str(content_length),
    }


@router.post("/library/import", response_model=DocumentInfo)
async def import_document(file: UploadFile = File(...)):
    """Import a PDF into the library and return its metadata."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        return await library_service.import_pdf(content, file.filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to import PDF: {exc}") from exc


@router.get("/library", response_model=list[DocumentInfo])
async def list_documents(limit: int = Query(20, ge=1, le=100)):
    """List recent documents ordered by last opened time."""
    return library_service.list_documents(limit=limit)


@router.get("/library/{doc_id}", response_model=DocumentInfo)
async def get_document(doc_id: str):
    """Fetch document metadata by ID."""
    doc = library_service.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.patch("/library/{doc_id}/state", response_model=DocumentInfo)
async def update_document_state(doc_id: str, patch: DocumentStateUpdate):
    """Persist viewer state (page, range, session) for a document."""
    updated = library_service.update_document_state(
        doc_id,
        last_page=patch.last_page,
        range_start=patch.range_start,
        range_end=patch.range_end,
        last_session_id=patch.last_session_id,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return updated


@router.get("/library/{doc_id}/file")
async def get_document_file(doc_id: str, request: Request):
    """Stream PDF file, supporting HTTP Range requests."""
    file_path = library_service.get_file_path(doc_id)
    if file_path is None:
        raise HTTPException(status_code=404, detail="Document not found")

    file_size = os.path.getsize(file_path)
    etag = f'"{doc_id}"'
    range_header = request.headers.get("range")
    if range_header:
        byte_range = parse_range_header(range_header, file_size)
        if byte_range is None:
            # Invalid or unsupported range; respond per RFC with 416.
            return Response(
                status_code=416,
                headers={
                    "Content-Range": f"bytes */{file_size}",
                    "Accept-Ranges": "bytes",
                    "ETag": etag,
                },
            )
        start, end = byte_range
        headers = build_file_headers(doc_id, end - start + 1)
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        return StreamingResponse(
            iter_file_range(file_path, start, end),
            status_code=206,
            media_type="application/pdf",
            headers=headers,
        )

    if request.headers.get("if-none-match") == etag:
        # Client has a fresh cached copy.
        return Response(status_code=304, headers=build_file_headers(doc_id, 0))

    headers = build_file_headers(doc_id, file_size)
    return StreamingResponse(
        iter_file_range(file_path, 0, file_size - 1),
        media_type="application/pdf",
        headers=headers,
    )

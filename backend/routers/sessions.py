"""sessions - API endpoints for chat session and message management."""

from fastapi import APIRouter, HTTPException, Query

from models.schemas import (
    MessageInfo,
    SessionCreateRequest,
    SessionInfo,
    SessionUpdateRequest,
)
from services.library_service import library_service

router = APIRouter()


@router.post("/sessions", response_model=SessionInfo)
async def create_session(request: SessionCreateRequest):
    """Create a new chat session for a document."""
    doc = library_service.get_document(request.doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    session = library_service.create_session(request.doc_id, title=request.title)
    return session


@router.get("/sessions", response_model=list[SessionInfo])
async def list_sessions(doc_id: str = Query(...)):
    """List sessions for a specific document."""
    return library_service.list_sessions(doc_id)


@router.get("/sessions/{session_id}", response_model=SessionInfo)
async def get_session(session_id: str):
    """Fetch a session by ID."""
    session = library_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/sessions/{session_id}", response_model=SessionInfo)
async def update_session(session_id: str, patch: SessionUpdateRequest):
    """Rename a session."""
    updated = library_service.update_session_title(session_id, patch.title)
    if updated is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return updated


@router.get("/sessions/{session_id}/messages", response_model=list[MessageInfo])
async def list_messages(session_id: str):
    """List messages for a session in chronological order."""
    session = library_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return library_service.list_messages(session_id)


@router.delete("/sessions/{session_id}/messages")
async def clear_messages(session_id: str):
    """Delete all messages in a session."""
    session = library_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    library_service.clear_messages(session_id)
    return {"success": True}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session."""
    success = library_service.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}

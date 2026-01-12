"""schemas - Pydantic models for API requests, responses, and database entities."""

from enum import Enum

from pydantic import BaseModel, Field


class LLMProvider(str, Enum):
    """Supported LLM providers."""

    OPENAI = "openai"  # OpenAI compatible (default)
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"


# === Chat Models ===


class Message(BaseModel):
    """Chat history item for user/assistant messages."""

    role: str  # "user" or "assistant"
    content: str


class BookContext(BaseModel):
    """Optional document context injected into the system prompt."""

    title: str | None = None
    total_pages: int | None = None
    current_page: int | None = None
    selected_range: str | None = None  # e.g., "5-10"
    outline: str | None = None  # Table of contents as text
    overview: str | None = None  # User/AI generated overview
    highlights: list[str] | None = None  # User-selected text passages for focused context


class ChatRequest(BaseModel):
    """Payload for chat requests including page range and context."""

    doc_id: str
    session_id: str
    page_start: int = Field(..., ge=1)
    page_end: int = Field(..., ge=1)
    question: str
    history: list[Message] = []
    book_context: BookContext | None = None

    # API config
    provider: LLMProvider = LLMProvider.OPENAI
    api_key: str | None = None
    base_url: str | None = None  # Only used for OpenAI compatible
    model: str | None = None  # None = use provider's default model


# === Library Models ===


class OutlineItem(BaseModel):
    """Normalized TOC entry from PDF outline."""

    level: int
    title: str
    page: int


class DocumentInfo(BaseModel):
    """Library document metadata stored in SQLite."""

    doc_id: str
    filename: str
    total_pages: int
    title: str | None = None
    outline: list[OutlineItem] = []
    file_size: int
    created_at: int
    updated_at: int
    last_opened_at: int
    last_page: int
    range_start: int
    range_end: int
    last_session_id: str | None = None


class DocumentStateUpdate(BaseModel):
    """Partial update for viewer state persistence."""

    last_page: int | None = Field(None, ge=1)
    range_start: int | None = Field(None, ge=1)
    range_end: int | None = Field(None, ge=1)
    last_session_id: str | None = None


class SessionCreateRequest(BaseModel):
    """Create a new session for a document."""

    doc_id: str
    title: str | None = None


class SessionUpdateRequest(BaseModel):
    """Patch a session title."""

    title: str | None = None


class SessionInfo(BaseModel):
    """Session metadata."""

    session_id: str
    doc_id: str
    title: str | None = None
    created_at: int
    updated_at: int


class MessageInfo(BaseModel):
    """Stored message with optional page range metadata."""

    message_id: str
    session_id: str
    role: str
    content: str
    created_at: int
    page_start: int | None = None
    page_end: int | None = None

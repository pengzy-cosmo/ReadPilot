from pydantic import BaseModel, Field

# === Chat Models ===


class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class BookContext(BaseModel):
    title: str | None = None
    total_pages: int | None = None
    current_page: int | None = None
    selected_range: str | None = None  # e.g., "5-10"
    outline: str | None = None  # Table of contents as text
    overview: str | None = None  # User/AI generated overview


class ChatRequest(BaseModel):
    doc_id: str
    session_id: str
    page_start: int = Field(..., ge=1)
    page_end: int = Field(..., ge=1)
    question: str
    history: list[Message] = []
    book_context: BookContext | None = None

    # API config
    api_key: str | None = None
    base_url: str | None = None
    model: str = "gpt-5.2"


# === Library Models ===


class OutlineItem(BaseModel):
    level: int
    title: str
    page: int


class DocumentInfo(BaseModel):
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
    last_page: int | None = Field(None, ge=1)
    range_start: int | None = Field(None, ge=1)
    range_end: int | None = Field(None, ge=1)
    last_session_id: str | None = None


class SessionCreateRequest(BaseModel):
    doc_id: str
    title: str | None = None


class SessionUpdateRequest(BaseModel):
    title: str | None = None


class SessionInfo(BaseModel):
    session_id: str
    doc_id: str
    title: str | None = None
    created_at: int
    updated_at: int


class MessageInfo(BaseModel):
    message_id: str
    session_id: str
    role: str
    content: str
    created_at: int
    page_start: int | None = None
    page_end: int | None = None

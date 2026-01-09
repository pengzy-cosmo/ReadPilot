from datetime import datetime

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
    # New way (recommended)
    pdf_id: str | None = None
    page_start: int | None = Field(None, ge=1)
    page_end: int | None = Field(None, ge=1)

    # Legacy way (backwards compatible, deprecated)
    pdf_base64: str | None = None

    question: str
    history: list[Message] = []
    book_context: BookContext | None = None

    # API config
    api_key: str | None = None
    base_url: str | None = None
    model: str = "gpt-5.2"


# === PDF Models ===


class OutlineItem(BaseModel):
    level: int
    title: str
    page: int


class PDFInfo(BaseModel):
    pdf_id: str
    filename: str
    total_pages: int
    title: str | None = None
    outline: list[OutlineItem] = []
    file_size: int
    uploaded_at: datetime


class PDFUploadResponse(BaseModel):
    pdf_id: str
    filename: str
    total_pages: int
    title: str | None = None
    outline: list[OutlineItem] = []
    file_size: int

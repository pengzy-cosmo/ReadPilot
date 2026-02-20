"""test_schemas - Unit tests for Pydantic models."""

import pytest

from models.schemas import (
    BookContext,
    ChatRequest,
    DocumentInfo,
    DocumentStateUpdate,
    LLMProvider,
    Message,
    OutlineItem,
    SessionCreateRequest,
    SessionInfo,
    SessionUpdateRequest,
)


class TestLLMProvider:
    def test_provider_values(self):
        assert LLMProvider.OPENAI == "openai"
        assert LLMProvider.ANTHROPIC == "anthropic"
        assert LLMProvider.GEMINI == "gemini"


class TestMessage:
    def test_valid_message(self):
        msg = Message(role="user", content="Hello")
        assert msg.role == "user"
        assert msg.content == "Hello"

    def test_message_to_dict(self):
        msg = Message(role="assistant", content="Hi there")
        data = msg.model_dump()
        assert data == {"role": "assistant", "content": "Hi there"}


class TestBookContext:
    def test_empty_context(self):
        ctx = BookContext()
        assert ctx.title is None
        assert ctx.total_pages is None
        assert ctx.current_page is None
        assert ctx.selected_range is None
        assert ctx.outline is None
        assert ctx.overview is None
        assert ctx.highlights is None

    def test_full_context(self):
        ctx = BookContext(
            title="Test Document",
            total_pages=100,
            current_page=50,
            selected_range="45-55",
            outline="Table of contents",
            overview="A test document",
            highlights=["Important passage", "Another highlight"],
        )
        assert ctx.title == "Test Document"
        assert ctx.total_pages == 100
        assert ctx.current_page == 50
        assert ctx.selected_range == "45-55"
        assert ctx.outline == "Table of contents"
        assert ctx.overview == "A test document"
        assert ctx.highlights == ["Important passage", "Another highlight"]


class TestChatRequest:
    def test_valid_request(self):
        req = ChatRequest(
            doc_id="doc123",
            session_id="session456",
            page_start=1,
            page_end=10,
            question="What is this about?",
        )
        assert req.doc_id == "doc123"
        assert req.session_id == "session456"
        assert req.page_start == 1
        assert req.page_end == 10
        assert req.question == "What is this about?"
        assert req.history == []
        assert req.book_context is None
        assert req.provider == LLMProvider.OPENAI
        assert req.api_key is None
        assert req.base_url is None
        assert req.model is None

    def test_request_with_context(self):
        req = ChatRequest(
            doc_id="doc123",
            session_id="session456",
            page_start=5,
            page_end=15,
            question="Explain this",
            history=[Message(role="user", content="Previous question")],
            book_context=BookContext(title="Test Doc"),
            provider=LLMProvider.ANTHROPIC,
            api_key="test-key",
            model="claude-3",
        )
        assert len(req.history) == 1
        assert req.book_context.title == "Test Doc"
        assert req.provider == LLMProvider.ANTHROPIC
        assert req.api_key == "test-key"
        assert req.model == "claude-3"

    def test_page_validation(self):
        # Valid pages
        req = ChatRequest(
            doc_id="doc123",
            session_id="session456",
            page_start=1,
            page_end=1,
            question="Test",
        )
        assert req.page_start == 1
        assert req.page_end == 1


class TestOutlineItem:
    def test_outline_item(self):
        item = OutlineItem(level=1, title="Chapter 1", page=10)
        assert item.level == 1
        assert item.title == "Chapter 1"
        assert item.page == 10

    def test_nested_outline(self):
        items = [
            OutlineItem(level=1, title="Chapter 1", page=1),
            OutlineItem(level=2, title="Section 1.1", page=3),
            OutlineItem(level=1, title="Chapter 2", page=10),
        ]
        assert items[0].level == 1
        assert items[1].level == 2
        assert items[2].level == 1


class TestDocumentInfo:
    def test_minimal_document(self):
        doc = DocumentInfo(
            doc_id="abc123",
            filename="test.pdf",
            total_pages=10,
            file_size=1000,
            created_at=1234567890,
            updated_at=1234567890,
            last_opened_at=1234567890,
            last_page=1,
            range_start=1,
            range_end=7,
        )
        assert doc.doc_id == "abc123"
        assert doc.filename == "test.pdf"
        assert doc.total_pages == 10
        assert doc.outline == []
        assert doc.title is None

    def test_document_with_outline(self):
        doc = DocumentInfo(
            doc_id="abc123",
            filename="test.pdf",
            total_pages=100,
            title="Test Document",
            outline=[
                OutlineItem(level=1, title="Chapter 1", page=1),
                OutlineItem(level=2, title="Section 1.1", page=5),
            ],
            file_size=5000,
            created_at=1234567890,
            updated_at=1234567890,
            last_opened_at=1234567890,
            last_page=1,
            range_start=1,
            range_end=10,
        )
        assert doc.title == "Test Document"
        assert len(doc.outline) == 2
        assert doc.outline[0].title == "Chapter 1"


class TestDocumentStateUpdate:
    def test_empty_update(self):
        update = DocumentStateUpdate()
        assert update.last_page is None
        assert update.range_start is None
        assert update.range_end is None
        assert update.last_session_id is None

    def test_partial_update(self):
        update = DocumentStateUpdate(last_page=5)
        assert update.last_page == 5
        assert update.range_start is None

    def test_full_update(self):
        update = DocumentStateUpdate(
            last_page=10,
            range_start=5,
            range_end=15,
            last_session_id="session123",
        )
        assert update.last_page == 10
        assert update.range_start == 5
        assert update.range_end == 15
        assert update.last_session_id == "session123"


class TestSessionCreateRequest:
    def test_with_title(self):
        req = SessionCreateRequest(doc_id="doc123", title="My Session")
        assert req.doc_id == "doc123"
        assert req.title == "My Session"

    def test_without_title(self):
        req = SessionCreateRequest(doc_id="doc123")
        assert req.doc_id == "doc123"
        assert req.title is None


class TestSessionUpdateRequest:
    def test_update_title(self):
        req = SessionUpdateRequest(title="New Title")
        assert req.title == "New Title"

    def test_clear_title(self):
        req = SessionUpdateRequest(title=None)
        assert req.title is None


class TestSessionInfo:
    def test_session_info(self):
        session = SessionInfo(
            session_id="session123",
            doc_id="doc123",
            title="Test Session",
            created_at=1234567890,
            updated_at=1234567890,
        )
        assert session.session_id == "session123"
        assert session.doc_id == "doc123"
        assert session.title == "Test Session"


class TestSerialization:
    def test_message_serialization(self):
        msg = Message(role="user", content="Test")
        json_str = msg.model_dump_json()
        assert '"role":"user"' in json_str
        assert '"content":"Test"' in json_str

    def test_chat_request_serialization(self):
        req = ChatRequest(
            doc_id="doc123",
            session_id="session456",
            page_start=1,
            page_end=10,
            question="Test question",
        )
        data = req.model_dump()
        assert data["doc_id"] == "doc123"
        assert data["page_start"] == 1
        assert data["question"] == "Test question"

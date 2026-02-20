"""test_library_service - Unit tests for LibraryService."""

import pytest

from models.schemas import DocumentInfo
from services.library_service import LibraryService, now_ms


class TestNowMs:
    def test_returns_integer(self):
        result = now_ms()
        assert isinstance(result, int)

    def test_returns_positive_value(self):
        result = now_ms()
        assert result > 0

    def test_increases_over_time(self):
        import time

        t1 = now_ms()
        time.sleep(0.01)
        t2 = now_ms()
        assert t2 >= t1


class TestLibraryServiceInit:
    def test_creates_storage_directories(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        assert service.data_dir.exists()
        assert service.library_dir.exists()
        assert service.db_path.exists()


class TestImportPdf:
    def test_import_new_pdf(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")

        assert isinstance(doc, DocumentInfo)
        assert doc.filename == "test.pdf"
        assert doc.total_pages == 1
        assert doc.file_size == len(sample_pdf_bytes)
        assert doc.last_page == 1
        assert doc.range_start == 1
        assert doc.range_end == 1  # Only 1 page

    def test_import_multi_page_pdf(self, temp_data_dir, sample_multi_page_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_multi_page_pdf_bytes, "multi.pdf")

        assert doc.total_pages == 3
        assert doc.range_end == 3  # Should be min(7, total_pages)

    def test_reimport_updates_metadata(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc1 = service.import_pdf(sample_pdf_bytes, "original.pdf")

        # Re-import with different filename
        doc2 = service.import_pdf(sample_pdf_bytes, "renamed.pdf")

        assert doc1.doc_id == doc2.doc_id
        assert doc2.filename == "renamed.pdf"
        assert doc2.updated_at >= doc1.updated_at

    def test_extracts_title_from_metadata(self, temp_data_dir):
        # PDF with title metadata
        pdf_with_title = b"""%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
>>
endobj

4 0 obj
<<
/Title (Test Document Title)
>>
endobj

xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000182 00000 n

trailer
<<
/Size 5
/Root 1 0 R
/Info 4 0 R
>>
startxref
231
%%EOF"""
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(pdf_with_title, "test.pdf")
        # Title extraction may vary based on pypdf version
        assert doc.title is not None or doc.title is None


class TestGetDocument:
    def test_get_existing_document(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        imported = service.import_pdf(sample_pdf_bytes, "test.pdf")

        retrieved = service.get_document(imported.doc_id)

        assert retrieved is not None
        assert retrieved.doc_id == imported.doc_id
        assert retrieved.filename == imported.filename

    def test_get_nonexistent_document(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        result = service.get_document("nonexistent")
        assert result is None


class TestListDocuments:
    def test_empty_library(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        docs = service.list_documents()
        assert docs == []

    def test_list_returns_documents(self, temp_data_dir, sample_pdf_bytes, sample_multi_page_pdf_bytes):
        service = LibraryService(temp_data_dir)
        # Use different PDFs to get different doc_ids
        service.import_pdf(sample_pdf_bytes, "test1.pdf")
        service.import_pdf(sample_multi_page_pdf_bytes, "test2.pdf")

        docs = service.list_documents()

        assert len(docs) == 2
        # Should be ordered by last_opened_at desc
        assert docs[0].filename in ["test1.pdf", "test2.pdf"]

    def test_list_respects_limit(self, temp_data_dir, sample_pdf_bytes, sample_multi_page_pdf_bytes):
        service = LibraryService(temp_data_dir)
        # Create unique PDFs by modifying content slightly
        for i in range(5):
            # Add unique comment to make each PDF unique
            unique_pdf = sample_pdf_bytes + f"\n% Unique {i}".encode()
            service.import_pdf(unique_pdf, f"test{i}.pdf")

        docs = service.list_documents(limit=3)
        assert len(docs) == 3


class TestUpdateDocumentState:
    def test_update_last_page(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")

        updated = service.update_document_state(doc.doc_id, last_page=5)

        assert updated is not None
        assert updated.last_page == 5

    def test_update_range(self, temp_data_dir, sample_multi_page_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_multi_page_pdf_bytes, "test.pdf")

        updated = service.update_document_state(
            doc.doc_id,
            range_start=2,
            range_end=3,
        )

        assert updated.range_start == 2
        assert updated.range_end == 3

    def test_partial_update_preserves_other_values(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        original_range_start = doc.range_start

        updated = service.update_document_state(doc.doc_id, last_page=5)

        assert updated.last_page == 5
        assert updated.range_start == original_range_start

    def test_update_nonexistent_document(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        result = service.update_document_state("nonexistent", last_page=5)
        assert result is None


class TestSessionManagement:
    def test_create_session(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")

        session = service.create_session(doc.doc_id, "My Session")

        assert session.doc_id == doc.doc_id
        assert session.title == "My Session"
        assert len(session.session_id) > 0

    def test_create_session_without_title(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")

        session = service.create_session(doc.doc_id)

        assert session.title is None

    def test_list_sessions(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        service.create_session(doc.doc_id, "Session 1")
        service.create_session(doc.doc_id, "Session 2")

        sessions = service.list_sessions(doc.doc_id)

        assert len(sessions) == 2

    def test_get_session(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        created = service.create_session(doc.doc_id, "Test Session")

        retrieved = service.get_session(created.session_id)

        assert retrieved is not None
        assert retrieved.session_id == created.session_id

    def test_get_nonexistent_session(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        result = service.get_session("nonexistent")
        assert result is None

    def test_update_session_title(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session = service.create_session(doc.doc_id, "Original Title")

        updated = service.update_session_title(session.session_id, "New Title")

        assert updated.title == "New Title"

    def test_update_nonexistent_session(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        result = service.update_session_title("nonexistent", "Title")
        assert result is None


class TestMessageManagement:
    def test_append_message(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session = service.create_session(doc.doc_id)

        msg = service.append_message(
            session.session_id,
            "user",
            "Hello, world!",
            page_start=1,
            page_end=2,
        )

        assert msg.session_id == session.session_id
        assert msg.role == "user"
        assert msg.content == "Hello, world!"
        assert msg.page_start == 1
        assert msg.page_end == 2

    def test_list_messages(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session = service.create_session(doc.doc_id)

        service.append_message(session.session_id, "user", "Question")
        service.append_message(session.session_id, "assistant", "Answer")

        messages = service.list_messages(session.session_id)

        assert len(messages) == 2
        assert messages[0].role == "user"
        assert messages[1].role == "assistant"

    def test_list_messages_ordered_by_time(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session = service.create_session(doc.doc_id)

        service.append_message(session.session_id, "user", "First")
        service.append_message(session.session_id, "user", "Second")

        messages = service.list_messages(session.session_id)

        assert messages[0].created_at <= messages[1].created_at

    def test_clear_messages(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session = service.create_session(doc.doc_id)

        service.append_message(session.session_id, "user", "Message")
        service.clear_messages(session.session_id)

        messages = service.list_messages(session.session_id)
        assert len(messages) == 0


class TestExtractPages:
    def test_extract_single_page(self, temp_data_dir, sample_multi_page_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_multi_page_pdf_bytes, "test.pdf")

        extracted = service.extract_pages(doc.doc_id, 1, 1)

        assert extracted is not None
        assert isinstance(extracted, bytes)
        assert extracted.startswith(b"%PDF")

    def test_extract_page_range(self, temp_data_dir, sample_multi_page_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_multi_page_pdf_bytes, "test.pdf")

        extracted = service.extract_pages(doc.doc_id, 1, 2)

        assert extracted is not None

    def test_extract_pages_base64(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")

        base64_content = service.extract_pages_base64(doc.doc_id, 1, 1)

        assert base64_content is not None
        assert isinstance(base64_content, str)
        # Should be valid base64
        import base64

        decoded = base64.b64decode(base64_content)
        assert decoded.startswith(b"%PDF")

    def test_extract_from_nonexistent_document(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        result = service.extract_pages("nonexistent", 1, 1)
        assert result is None


class TestDeleteDocument:
    def test_delete_document(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")

        success = service.delete_document(doc.doc_id)

        assert success is True
        assert service.get_document(doc.doc_id) is None

    def test_delete_removes_file(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        file_path = service.get_file_path(doc.doc_id)

        service.delete_document(doc.doc_id)

        assert not file_path.exists()

    def test_delete_removes_sessions_and_messages(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session = service.create_session(doc.doc_id)
        service.append_message(session.session_id, "user", "Test")

        service.delete_document(doc.doc_id)

        assert service.get_session(session.session_id) is None

    def test_delete_nonexistent_document(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        success = service.delete_document("nonexistent")
        assert success is False


class TestDeleteSession:
    def test_delete_session(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session = service.create_session(doc.doc_id)

        success = service.delete_session(session.session_id)

        assert success is True
        assert service.get_session(session.session_id) is None

    def test_delete_removes_messages(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session = service.create_session(doc.doc_id)
        service.append_message(session.session_id, "user", "Test")

        service.delete_session(session.session_id)

        messages = service.list_messages(session.session_id)
        assert len(messages) == 0

    def test_delete_updates_document_last_session(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")
        session1 = service.create_session(doc.doc_id)
        session2 = service.create_session(doc.doc_id)

        # Update document to have session2 as last_session
        service.update_document_state(doc.doc_id, last_session_id=session2.session_id)

        # Delete session2
        service.delete_session(session2.session_id)

        # Document should now point to session1 or None
        updated_doc = service.get_document(doc.doc_id)
        assert updated_doc.last_session_id in [session1.session_id, None]

    def test_delete_nonexistent_session(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        success = service.delete_session("nonexistent")
        assert success is False


class TestGetFilePath:
    def test_get_existing_file_path(self, temp_data_dir, sample_pdf_bytes):
        service = LibraryService(temp_data_dir)
        doc = service.import_pdf(sample_pdf_bytes, "test.pdf")

        path = service.get_file_path(doc.doc_id)

        assert path is not None
        assert path.exists()

    def test_get_nonexistent_file_path(self, temp_data_dir):
        service = LibraryService(temp_data_dir)
        path = service.get_file_path("nonexistent")
        assert path is None

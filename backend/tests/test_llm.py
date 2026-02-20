"""test_llm - Unit tests for LLM service functions."""

from unittest.mock import MagicMock, patch

import pytest

from models.schemas import LLMProvider
from services.llm import (
    DEFAULT_MODELS,
    AuthError,
    LLMError,
    ModelError,
    PDFNotSupportedError,
    build_messages,
    build_system_prompt,
    get_api_key,
    get_base_url,
    get_model_name,
    parse_llm_error,
)


class TestDefaultModels:
    def test_default_models_defined(self):
        assert LLMProvider.OPENAI in DEFAULT_MODELS
        assert LLMProvider.ANTHROPIC in DEFAULT_MODELS
        assert LLMProvider.GEMINI in DEFAULT_MODELS


class TestBuildSystemPrompt:
    def test_base_prompt_included(self):
        prompt = build_system_prompt(None)
        assert "PDF reading assistant" in prompt
        assert "Guidelines:" in prompt

    def test_prompt_with_title(self):
        context = {"title": "Test Document"}
        prompt = build_system_prompt(context)
        assert "Title: Test Document" in prompt

    def test_prompt_with_total_pages(self):
        context = {"total_pages": 100}
        prompt = build_system_prompt(context)
        assert "Total Pages: 100" in prompt

    def test_prompt_with_outline(self):
        context = {"outline": "Chapter 1\nChapter 2"}
        prompt = build_system_prompt(context)
        assert "Table of Contents:" in prompt
        assert "Chapter 1" in prompt

    def test_prompt_with_overview(self):
        context = {"overview": "This is an overview"}
        prompt = build_system_prompt(context)
        assert "Document Overview:" in prompt
        assert "This is an overview" in prompt

    def test_full_context(self):
        context = {
            "title": "Test Doc",
            "total_pages": 50,
            "outline": "TOC",
            "overview": "Overview text",
        }
        prompt = build_system_prompt(context)
        assert "Title: Test Doc" in prompt
        assert "Total Pages: 50" in prompt
        assert "Table of Contents:" in prompt
        assert "Document Overview:" in prompt


class TestGetModelName:
    def test_openai_prefix(self):
        result = get_model_name(LLMProvider.OPENAI, "gpt-4")
        assert result == "openai/gpt-4"

    def test_anthropic_prefix(self):
        result = get_model_name(LLMProvider.ANTHROPIC, "claude-3")
        assert result == "anthropic/claude-3"

    def test_gemini_prefix(self):
        result = get_model_name(LLMProvider.GEMINI, "gemini-pro")
        assert result == "gemini/gemini-pro"

    def test_preserve_existing_prefix(self):
        # If model already has prefix, return as-is
        result = get_model_name(LLMProvider.OPENAI, "custom/model-name")
        assert result == "custom/model-name"


class TestGetApiKey:
    @patch.dict("os.environ", {"OPENAI_API_KEY": "test-openai-key"}, clear=True)
    def test_openai_from_env(self):
        result = get_api_key(LLMProvider.OPENAI, None)
        assert result == "test-openai-key"

    @patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-anthropic-key"}, clear=True)
    def test_anthropic_from_env(self):
        result = get_api_key(LLMProvider.ANTHROPIC, None)
        assert result == "test-anthropic-key"

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-gemini-key"}, clear=True)
    def test_gemini_from_env(self):
        result = get_api_key(LLMProvider.GEMINI, None)
        assert result == "test-gemini-key"

    @patch.dict("os.environ", {"GOOGLE_API_KEY": "test-google-key"}, clear=True)
    def test_gemini_fallback_to_google(self):
        result = get_api_key(LLMProvider.GEMINI, None)
        assert result == "test-google-key"

    def test_param_overrides_env(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "env-key"}, clear=True):
            result = get_api_key(LLMProvider.OPENAI, "param-key")
            assert result == "param-key"

    def test_no_key_returns_none(self):
        with patch.dict("os.environ", {}, clear=True):
            result = get_api_key(LLMProvider.OPENAI, None)
            assert result is None


class TestGetBaseUrl:
    @patch.dict("os.environ", {"OPENAI_BASE_URL": "https://custom.api.com"}, clear=True)
    def test_openai_from_env(self):
        result = get_base_url(LLMProvider.OPENAI, None)
        assert result == "https://custom.api.com"

    def test_openai_from_param(self):
        with patch.dict("os.environ", {}, clear=True):
            result = get_base_url(LLMProvider.OPENAI, "https://param.api.com")
            assert result == "https://param.api.com"

    def test_anthropic_returns_none(self):
        result = get_base_url(LLMProvider.ANTHROPIC, "https://custom.api.com")
        assert result is None

    def test_gemini_returns_none(self):
        result = get_base_url(LLMProvider.GEMINI, "https://custom.api.com")
        assert result is None


class TestParseLlmError:
    def test_pdf_not_supported_error(self):
        error = Exception("invalid value: `file` not supported")
        result = parse_llm_error(error, "test-model")
        assert isinstance(result, PDFNotSupportedError)
        assert "test-model" in str(result)
        assert "does not support direct PDF input" in str(result)

    def test_pdf_unsupported_patterns(self):
        patterns = [
            "invalid part type: file",
            "supported values are: `text`, `image_url`",
            "unsupported content type",
            "file type not supported",
            "pdf is not supported",
            "content type 'file' is not supported",
        ]
        for pattern in patterns:
            error = Exception(pattern)
            result = parse_llm_error(error, "model")
            assert isinstance(result, PDFNotSupportedError), f"Failed for pattern: {pattern}"

    def test_authentication_error(self):
        from litellm.exceptions import AuthenticationError

        error = AuthenticationError("Invalid API key", llm_provider="openai", model="gpt-4")
        result = parse_llm_error(error, "gpt-4")
        assert isinstance(result, AuthError)
        assert "authentication failed" in str(result).lower()

    def test_rate_limit_error(self):
        from litellm.exceptions import RateLimitError

        error = RateLimitError("Rate limit exceeded", llm_provider="openai", model="gpt-4")
        result = parse_llm_error(error, "gpt-4")
        assert isinstance(result, LLMError)
        assert "rate limit" in str(result).lower()

    def test_timeout_error(self):
        from litellm.exceptions import Timeout

        error = Timeout("Request timed out", llm_provider="openai", model="gpt-4")
        result = parse_llm_error(error, "gpt-4")
        assert isinstance(result, LLMError)
        assert "timed out" in str(result).lower()

    def test_connection_error(self):
        from litellm.exceptions import APIConnectionError

        error = APIConnectionError("Connection failed", llm_provider="openai", model="gpt-4")
        result = parse_llm_error(error, "gpt-4")
        assert isinstance(result, LLMError)
        assert "connect" in str(result).lower()

    def test_bad_request_error(self):
        from litellm.exceptions import BadRequestError

        error = BadRequestError("Invalid request", llm_provider="openai", model="gpt-4")
        result = parse_llm_error(error, "gpt-4")
        assert isinstance(result, ModelError)

    def test_generic_api_error(self):
        from litellm.exceptions import APIError

        error = APIError(500, "API error occurred", llm_provider="openai", model="gpt-4")
        result = parse_llm_error(error, "gpt-4")
        assert isinstance(result, LLMError)
        assert "api error" in str(result).lower()

    def test_unknown_error(self):
        error = Exception("Something unexpected happened")
        result = parse_llm_error(error, "model")
        assert isinstance(result, LLMError)
        assert "unexpected error" in str(result).lower()


class TestBuildMessages:
    def test_basic_message_structure(self):
        messages = build_messages("pdf_base64_content", "What is this?", None, None)

        # Should have system message and user message
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"

    def test_system_prompt_included(self):
        messages = build_messages("pdf", "Question", None, None)
        assert "PDF reading assistant" in messages[0]["content"]

    def test_pdf_attachment_in_user_message(self):
        messages = build_messages("base64_pdf", "Question", None, None)
        user_message = messages[1]

        assert isinstance(user_message["content"], list)
        # Check for PDF file attachment
        file_parts = [p for p in user_message["content"] if p.get("type") == "file"]
        assert len(file_parts) == 1
        assert file_parts[0]["file"]["file_data"].startswith("data:application/pdf;base64,")

    def test_question_in_user_message(self):
        messages = build_messages("pdf", "What is the main topic?", None, None)
        user_message = messages[1]

        text_parts = [p for p in user_message["content"] if p.get("type") == "text"]
        question_parts = [p for p in text_parts if p.get("text") == "What is the main topic?"]
        assert len(question_parts) == 1

    def test_history_included(self):
        history = [
            {"role": "user", "content": "Previous question"},
            {"role": "assistant", "content": "Previous answer"},
        ]
        messages = build_messages("pdf", "New question", history, None)

        assert len(messages) == 4  # system + 2 history + user
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "Previous question"
        assert messages[2]["role"] == "assistant"
        assert messages[2]["content"] == "Previous answer"

    def test_history_with_pydantic_models(self):
        from models.schemas import Message

        history = [
            Message(role="user", content="Question"),
            Message(role="assistant", content="Answer"),
        ]
        messages = build_messages("pdf", "New", history, None)

        assert messages[1]["role"] == "user"
        assert messages[2]["role"] == "assistant"

    def test_book_context_with_current_page(self):
        context = {"current_page": 50, "selected_range": "45-55"}
        messages = build_messages("pdf", "Question", None, context)

        user_message = messages[1]
        text_parts = [p for p in user_message["content"] if p.get("type") == "text"]
        context_text = [p for p in text_parts if "current_page" in str(p.get("text", ""))]
        assert len(context_text) > 0

    def test_book_context_with_highlights(self):
        context = {"highlights": ["Important text", "Another key point"]}
        messages = build_messages("pdf", "Question", None, context)

        user_message = messages[1]
        text_parts = [p for p in user_message["content"] if p.get("type") == "text"]
        highlight_texts = [p for p in text_parts if "highlight" in str(p.get("text", "")).lower()]
        assert len(highlight_texts) > 0

    def test_long_highlights_truncated(self):
        long_highlight = "x" * 3000
        context = {"highlights": [long_highlight]}
        messages = build_messages("pdf", "Question", None, context)

        user_message = messages[1]
        text_parts = [p for p in user_message["content"] if p.get("type") == "text"]
        # Find the highlight text
        for part in text_parts:
            text = part.get("text", "")
            if "Highlight 1" in text:
                assert "..." in text  # Should be truncated
                break

    def test_empty_highlights_ignored(self):
        context = {"highlights": []}
        messages = build_messages("pdf", "Question", None, context)

        user_message = messages[1]
        text_parts = [p for p in user_message["content"] if p.get("type") == "text"]
        # Should not have any highlight-related text
        for part in text_parts:
            assert "highlight" not in str(part.get("text", "")).lower()


class TestLLMErrorClasses:
    def test_llm_error_with_original(self):
        original = Exception("Original error")
        error = LLMError("User message", original)
        assert str(error) == "User message"
        assert error.original_error is original

    def test_llm_error_without_original(self):
        error = LLMError("Simple error")
        assert str(error) == "Simple error"
        assert error.original_error is None

    def test_pdf_not_supported_error(self):
        original = Exception("PDF not supported")
        error = PDFNotSupportedError("Model doesn't support PDFs", original)
        assert isinstance(error, LLMError)
        assert "PDF" in str(error)

    def test_auth_error(self):
        original = Exception("Auth failed")
        error = AuthError("Authentication failed", original)
        assert isinstance(error, LLMError)
        assert "authentication" in str(error).lower()

    def test_model_error(self):
        original = Exception("Model error")
        error = ModelError("Invalid model", original)
        assert isinstance(error, LLMError)
        assert "Invalid model" in str(error)

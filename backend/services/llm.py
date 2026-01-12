"""llm - Multi-provider LLM client using LiteLLM for streaming chat with PDF."""

import logging
import os
from collections.abc import AsyncIterator
from typing import Any

import litellm
from litellm.exceptions import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
    Timeout,
)

from models.schemas import LLMProvider

logger = logging.getLogger(__name__)

# Default models for each provider
DEFAULT_MODELS: dict[LLMProvider, str] = {
    LLMProvider.OPENAI: "gpt-5.2",
    LLMProvider.ANTHROPIC: "claude-sonnet-4-5",
    LLMProvider.GEMINI: "gemini-3-pro-preview",
}


class LLMError(Exception):
    """Base exception for LLM errors with user-friendly messages."""

    def __init__(self, message: str, original_error: Exception | None = None):
        super().__init__(message)
        self.original_error = original_error


class PDFNotSupportedError(LLMError):
    """Raised when the model does not support PDF input."""

    pass


class AuthError(LLMError):
    """Raised when API authentication fails."""

    pass


class ModelError(LLMError):
    """Raised when there's an issue with the model configuration."""

    pass


def build_system_prompt(book_context: dict | None) -> str:
    """Build system prompt with book context."""
    base_prompt = """You are a helpful PDF reading assistant. Your role is to help users understand and analyze the content of PDF documents they are reading.

Guidelines:
- Answer questions based on the provided PDF pages
- Be concise but thorough
- If the answer is not in the provided pages, say so and suggest which pages might contain the information
- Use markdown formatting for better readability
- When summarizing, highlight key points and main ideas
- When the user provides highlighted text passages, pay special attention to those excerpts as they indicate the user's focus of interest"""

    if not book_context:
        return base_prompt

    context_parts = [base_prompt, "\n\nCurrent Document Context:"]

    if book_context.get("title"):
        context_parts.append(f"- Title: {book_context['title']}")

    if book_context.get("total_pages"):
        context_parts.append(f"- Total Pages: {book_context['total_pages']}")

    if book_context.get("outline"):
        context_parts.append(f"\nTable of Contents:\n{book_context['outline']}")

    if book_context.get("overview"):
        context_parts.append(f"\nDocument Overview:\n{book_context['overview']}")

    return "\n".join(context_parts)


def get_model_name(provider: LLMProvider, model: str) -> str:
    """Build LiteLLM model identifier with provider prefix."""
    # If model already has prefix, return as-is
    if "/" in model:
        return model

    match provider:
        case LLMProvider.OPENAI:
            return f"openai/{model}"
        case LLMProvider.ANTHROPIC:
            return f"anthropic/{model}"
        case LLMProvider.GEMINI:
            return f"gemini/{model}"


def get_api_key(provider: LLMProvider, api_key: str | None) -> str | None:
    """Resolve API key from param or environment variable."""
    if api_key:
        return api_key

    match provider:
        case LLMProvider.OPENAI:
            return os.getenv("OPENAI_API_KEY")
        case LLMProvider.ANTHROPIC:
            return os.getenv("ANTHROPIC_API_KEY")
        case LLMProvider.GEMINI:
            return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")


def get_base_url(provider: LLMProvider, base_url: str | None) -> str | None:
    """Resolve base URL from param or environment variable (OpenAI only)."""
    if provider != LLMProvider.OPENAI:
        return None
    return base_url or os.getenv("OPENAI_BASE_URL")


def parse_llm_error(error: Exception, model: str) -> LLMError:
    """
    Parse LLM API errors into user-friendly messages.
    Detects PDF unsupported errors and other common issues.
    """
    error_msg = str(error).lower()

    # Detect PDF/file type not supported errors (be specific to avoid false positives)
    pdf_unsupported_patterns = [
        "invalid value: `file`",
        "invalid part type: file",
        "supported values are: `text`, `image_url`",
        "unsupported content type",
        "file type not supported",
        "pdf is not supported",
        "content type 'file' is not supported",
    ]
    if any(pattern in error_msg for pattern in pdf_unsupported_patterns):
        return PDFNotSupportedError(
            f"Model '{model}' does not support direct PDF input. Please use a model with native PDF support.",
            original_error=error,
        )

    # Authentication errors
    if isinstance(error, AuthenticationError):
        return AuthError(
            "API authentication failed. Please check your API key.",
            original_error=error,
        )

    # Rate limit errors
    if isinstance(error, RateLimitError):
        return LLMError(
            "API rate limit exceeded. Please wait and try again.",
            original_error=error,
        )

    # Timeout errors
    if isinstance(error, Timeout):
        return LLMError(
            "Request timed out. Please try again.",
            original_error=error,
        )

    # Connection errors
    if isinstance(error, APIConnectionError):
        return LLMError(
            "Failed to connect to API. Please check your network connection.",
            original_error=error,
        )

    # Bad request errors (other than PDF)
    if isinstance(error, BadRequestError):
        # Extract meaningful message from error
        return ModelError(
            f"Invalid request: {error}",
            original_error=error,
        )

    # Generic API errors
    if isinstance(error, APIError):
        return LLMError(
            f"API error: {error}",
            original_error=error,
        )

    # Unknown errors
    return LLMError(
        f"An unexpected error occurred: {error}",
        original_error=error,
    )


def build_messages(
    pdf_base64: str,
    question: str,
    history: list[dict] | None,
    book_context: dict | None,
) -> list[dict]:
    """Build messages array for the chat request."""
    messages: list[dict] = []

    # System message provides global behavior and document context.
    system_prompt = build_system_prompt(book_context)
    messages.append({"role": "system", "content": system_prompt})

    # Add conversation history (without PDF attachments for efficiency).
    if history:
        for msg in history:
            if hasattr(msg, "model_dump"):
                msg = msg.model_dump()
            messages.append({"role": msg["role"], "content": msg["content"]})

    # Build user context parts
    user_context_parts: list[str] = []
    if book_context:
        if book_context.get("current_page"):
            user_context_parts.append(f"current_page={book_context['current_page']}")
        if book_context.get("selected_range"):
            user_context_parts.append(f"selected_range={book_context['selected_range']}")

    context_text = None
    if user_context_parts:
        context_text = "Context: " + ", ".join(user_context_parts) + ". The attached PDF contains the selected pages."

    # Build highlighted text section for user message
    highlights_text = None
    if book_context:
        highlights = book_context.get("highlights")
        if highlights and len(highlights) > 0:
            highlight_parts = ["I've highlighted the following passages that are relevant to my question:"]
            for i, highlight in enumerate(highlights, 1):
                # Truncate very long highlights
                text = highlight[:2000] + "..." if len(highlight) > 2000 else highlight
                highlight_parts.append(f"\n[Highlight {i}]:\n{text}")
            highlights_text = "\n".join(highlight_parts)

    # Current user message with PDF attachment (LiteLLM-compatible file input).
    messages.append(
        {
            "role": "user",
            "content": [
                *([{"type": "text", "text": context_text}] if context_text else []),
                {
                    "type": "file",
                    "file": {
                        "filename": "pages.pdf",
                        "file_data": f"data:application/pdf;base64,{pdf_base64}",
                    },
                },
                *([{"type": "text", "text": highlights_text}] if highlights_text else []),
                {
                    "type": "text",
                    "text": question,
                },
            ],
        }
    )

    return messages


async def chat_with_pdf(
    pdf_base64: str,
    question: str,
    history: list[dict] | None = None,
    book_context: Any | None = None,
    provider: LLMProvider = LLMProvider.OPENAI,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> AsyncIterator[str]:
    """Stream chat response from LLM with PDF context."""
    # Resolve API key
    effective_api_key = get_api_key(provider, api_key)
    if not effective_api_key:
        raise AuthError(f"No API key provided for {provider.value}")

    # Use default model if not specified
    effective_model = model or DEFAULT_MODELS[provider]
    full_model = get_model_name(provider, effective_model)

    # Convert book_context to dict if it's a Pydantic model
    context_dict = None
    if book_context:
        if hasattr(book_context, "model_dump"):
            context_dict = book_context.model_dump()
        else:
            context_dict = book_context

    # Build messages
    messages = build_messages(pdf_base64, question, history, context_dict)

    try:
        # LiteLLM call - unified interface for all providers
        response = await litellm.acompletion(
            model=full_model,
            messages=messages,
            api_key=effective_api_key,
            api_base=get_base_url(provider, base_url),
            stream=True,
        )

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    except LLMError:
        # Re-raise our custom errors as-is
        raise
    except Exception as e:
        # Log the original error for debugging
        logger.exception("LLM API error")
        # Parse and raise user-friendly error
        raise parse_llm_error(e, effective_model) from e

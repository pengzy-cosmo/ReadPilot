"""llm - OpenAI-compatible LLM client for streaming chat with PDF file attachments."""

import os
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI


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


async def chat_with_pdf(
    pdf_base64: str,
    question: str,
    history: list[dict] | None = None,
    book_context: Any | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str = "gpt-5.2",
) -> AsyncIterator[str]:
    """Stream chat response from LLM with PDF context."""
    effective_api_key = api_key or os.getenv("OPENAI_API_KEY")
    if not effective_api_key:
        raise ValueError("No API key provided")

    effective_base_url = base_url or os.getenv("OPENAI_BASE_URL")

    # Async client compatible with OpenAI chat.completions streaming.
    client = AsyncOpenAI(
        api_key=effective_api_key,
        base_url=effective_base_url,
    )

    # Convert book_context to dict if it's a Pydantic model
    context_dict = None
    if book_context:
        if hasattr(book_context, "model_dump"):
            context_dict = book_context.model_dump()
        else:
            context_dict = book_context

    # Build messages array for the chat request.
    messages: list[dict] = []

    # System message provides global behavior and document context.
    system_prompt = build_system_prompt(context_dict)
    messages.append({"role": "system", "content": system_prompt})

    # Add conversation history (without PDF attachments for efficiency).
    if history:
        for msg in history:
            if hasattr(msg, "model_dump"):
                msg = msg.model_dump()
            messages.append({"role": msg["role"], "content": msg["content"]})

    # Current user message with PDF attachment (OpenAI-compatible file input).
    user_context_parts: list[str] = []
    if context_dict:
        if context_dict.get("current_page"):
            user_context_parts.append(f"current_page={context_dict['current_page']}")
        if context_dict.get("selected_range"):
            user_context_parts.append(f"selected_range={context_dict['selected_range']}")

    context_text = None
    if user_context_parts:
        context_text = "Context: " + ", ".join(user_context_parts) + ". The attached PDF contains the selected pages."

    # Build highlighted text section for user message
    highlights_text = None
    if context_dict:
        highlights = context_dict.get("highlights")
        if highlights and len(highlights) > 0:
            highlight_parts = ["I've highlighted the following passages that are relevant to my question:"]
            for i, highlight in enumerate(highlights, 1):
                # Truncate very long highlights
                text = highlight[:2000] + "..." if len(highlight) > 2000 else highlight
                highlight_parts.append(f"\n[Highlight {i}]:\n{text}")
            highlights_text = "\n".join(highlight_parts)

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

    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
    )

    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content

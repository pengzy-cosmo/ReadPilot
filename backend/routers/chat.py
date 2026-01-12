"""chat - API endpoint for streaming LLM chat with PDF context."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from models.schemas import ChatRequest
from services.library_service import library_service
from services.llm import LLMError, chat_with_pdf

router = APIRouter()


@router.post("/chat")
async def chat(request: ChatRequest):
    """Chat with PDF content using LLM."""
    try:
        if request.page_start > request.page_end:
            raise HTTPException(status_code=400, detail="page_start must be <= page_end")

        # Validate doc + session ownership early to avoid unnecessary work.
        doc = library_service.get_document(request.doc_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")

        session = library_service.get_session(request.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        if session.doc_id != request.doc_id:
            raise HTTPException(status_code=400, detail="Session does not belong to document")

        # Extract only the requested page range to keep prompt size manageable.
        pdf_base64 = await library_service.extract_pages_base64(
            request.doc_id,
            request.page_start,
            request.page_end,
        )
        if pdf_base64 is None:
            raise HTTPException(status_code=404, detail="Document not found")

        await run_in_threadpool(
            library_service.append_message,
            request.session_id,
            "user",
            request.question,
            request.page_start,
            request.page_end,
        )

        async def generate():
            # Accumulate streamed chunks to persist the full assistant reply.
            full_content = ""
            try:
                async for chunk in chat_with_pdf(
                    pdf_base64=pdf_base64,
                    question=request.question,
                    history=request.history,
                    book_context=request.book_context,
                    provider=request.provider,
                    api_key=request.api_key,
                    base_url=request.base_url,
                    model=request.model,
                ):
                    full_content += chunk
                    yield chunk
            except LLMError as e:
                # Yield error message as part of the stream so frontend can display it
                error_msg = f"\n\n**Error:** {e}"
                full_content += error_msg
                yield error_msg
            except Exception as e:
                # Catch any unexpected errors
                error_msg = f"\n\n**Error:** An unexpected error occurred: {e}"
                full_content += error_msg
                yield error_msg

            # Only save assistant message if we got content (even if it's an error)
            if full_content:
                await run_in_threadpool(
                    library_service.append_message,
                    request.session_id,
                    "assistant",
                    full_content,
                    request.page_start,
                    request.page_end,
                )

        return StreamingResponse(generate(), media_type="text/plain")
    except HTTPException:
        raise
    except LLMError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

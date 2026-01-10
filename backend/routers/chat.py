from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import ChatRequest
from services.library_service import library_service
from services.llm import chat_with_pdf
from starlette.concurrency import run_in_threadpool

router = APIRouter()


@router.post("/chat")
async def chat(request: ChatRequest):
    """Chat with PDF content using LLM."""
    try:
        if request.page_start > request.page_end:
            raise HTTPException(status_code=400, detail="page_start must be <= page_end")

        doc = library_service.get_document(request.doc_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")

        session = library_service.get_session(request.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        if session.doc_id != request.doc_id:
            raise HTTPException(status_code=400, detail="Session does not belong to document")

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
            full_content = ""
            async for chunk in chat_with_pdf(
                pdf_base64=pdf_base64,
                question=request.question,
                history=request.history,
                book_context=request.book_context,
                api_key=request.api_key,
                base_url=request.base_url,
                model=request.model,
            ):
                full_content += chunk
                yield chunk
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

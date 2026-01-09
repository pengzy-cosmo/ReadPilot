from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import ChatRequest
from services.llm import chat_with_pdf
from services.pdf_service import pdf_service

router = APIRouter()


@router.post("/chat")
async def chat(request: ChatRequest):
    """Chat with PDF content using LLM."""
    try:
        # Determine PDF bytes source
        pdf_base64: str | None = None

        if request.pdf_id:
            # New way: get PDF from storage and extract pages
            if request.page_start is None or request.page_end is None:
                raise HTTPException(
                    status_code=400,
                    detail="page_start and page_end are required when using pdf_id",
                )

            pdf_base64 = await pdf_service.extract_pages_base64(
                request.pdf_id,
                request.page_start,
                request.page_end,
            )
            if pdf_base64 is None:
                raise HTTPException(status_code=404, detail="PDF not found")

        elif request.pdf_base64:
            # Legacy way: use provided base64 directly (deprecated)
            pdf_base64 = request.pdf_base64

        else:
            raise HTTPException(status_code=400, detail="Either pdf_id or pdf_base64 is required")

        async def generate():
            async for chunk in chat_with_pdf(
                pdf_base64=pdf_base64,
                question=request.question,
                history=request.history,
                book_context=request.book_context,
                api_key=request.api_key,
                base_url=request.base_url,
                model=request.model,
            ):
                yield chunk

        return StreamingResponse(generate(), media_type="text/plain")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

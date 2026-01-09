from fastapi import APIRouter, File, HTTPException, UploadFile
from models.schemas import PDFInfo, PDFUploadResponse
from services.pdf_service import pdf_service

router = APIRouter()


@router.post("/pdf/upload", response_model=PDFUploadResponse)
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a PDF file and get metadata."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        info = await pdf_service.upload(content, file.filename)
        return PDFUploadResponse(
            pdf_id=info.pdf_id,
            filename=info.filename,
            total_pages=info.total_pages,
            title=info.title,
            outline=info.outline,
            file_size=info.file_size,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process PDF: {e}") from e


@router.get("/pdf/{pdf_id}/info", response_model=PDFInfo)
async def get_pdf_info(pdf_id: str):
    """Get PDF metadata by ID."""
    info = pdf_service.get_info(pdf_id)
    if info is None:
        raise HTTPException(status_code=404, detail="PDF not found")
    return info


@router.delete("/pdf/{pdf_id}")
async def delete_pdf(pdf_id: str):
    """Delete a PDF from storage."""
    success = pdf_service.delete(pdf_id)
    if not success:
        raise HTTPException(status_code=404, detail="PDF not found")
    return {"success": True}


@router.get("/pdf/list", response_model=list[PDFInfo])
async def list_pdfs():
    """List all uploaded PDFs."""
    return pdf_service.list_pdfs()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import chat, pdf

app = FastAPI(title="ReadPilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(pdf.router, prefix="/api")


@app.get("/health")
async def health_check():
    return {"status": "ok"}

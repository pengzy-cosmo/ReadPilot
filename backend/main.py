import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import chat, library, sessions

app = FastAPI(title="ReadPilot API")


def load_allowed_origins() -> list[str]:
    raw = os.getenv("READPILOT_ALLOWED_ORIGINS", "")
    if raw:
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173"]


allow_any_origin = os.getenv("READPILOT_ALLOW_ANY_ORIGIN", "").lower() in (
    "1",
    "true",
    "yes",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_any_origin else load_allowed_origins(),
    allow_credentials=False if allow_any_origin else True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Accept-Ranges", "Content-Range", "Content-Length", "ETag"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(library.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")


@app.get("/health")
async def health_check():
    return {"status": "ok"}

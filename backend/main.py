from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import chat, library, sessions

app = FastAPI(title="ReadPilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
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

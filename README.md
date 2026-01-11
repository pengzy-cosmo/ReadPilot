# ReadPilot

LLM-assisted PDF reader that provides context-aware document interaction by automatically selecting relevant pages based on your current view.

## Features

- **Context-Aware Chat**: Automatically uses pages around the current viewport as LLM context.
- **Large PDF Support**: Smooth navigation and reading for large documents.
- **Integrated Sidebar**: Chat with the document directly while reading.

## Quick Start

### Using Just

```bash
just install
just dev
```

### Using Docker

```bash
docker compose up --build
```

Open <http://localhost:5173> in your browser.

Optional environment variables (set in `.env` or your shell):

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (optional)
- `VITE_API_URL` (optional, defaults to `http://localhost:8000`)

### Manual Setup

#### Backend (Python/uv)

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000
```

#### Frontend (Node.js)

```bash
cd frontend
npm install
npm run dev
```

- API: <http://localhost:8000>
- Web: <http://localhost:5173>

## Configuration

Settings can be managed via the **API Settings** in the UI or environment variables in `backend/.env`:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (optional)
- `MODEL_NAME` (default: gpt-5.2)

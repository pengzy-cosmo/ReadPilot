# ReadPilot

AI agent development guide for this codebase.

## Project Overview

LLM-assisted PDF reader with intelligent context management. Users read PDFs, select pages/text, and chat with LLM about content. Supports multiple LLM providers (OpenAI, Anthropic, Gemini) via LiteLLM with native PDF input support.

## Development Commands

### Frontend (React + Vite)

```bash
cd frontend
npm install          # Install dependencies
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production build
npm run lint:fix     # Biome auto-fix
npm test             # Run unit tests (Vitest)
npm run test:watch   # Run tests in watch mode
```

### Backend (Python + FastAPI + uv)

```bash
cd backend
uv sync              # Install dependencies
uv sync --extra test # Install with test dependencies
uv run uvicorn main:app --reload --port 8000  # Dev server
uv run pytest        # Run unit tests
uv run pytest --cov  # Run tests with coverage
```

## Architecture Overview

### Core Components

| Component              | File                     | Purpose                                                |
| ---------------------- | ------------------------ | ------------------------------------------------------ |
| **App**                | `App.tsx`                | Document/session orchestration, state management       |
| **PdfViewer**          | `PdfViewer.tsx`          | PDF rendering, navigation, context selection           |
| **PdfToolbar**         | `PdfToolbar.tsx`         | Floating controls (nav, zoom, range, search, settings) |
| **PdfSidebar**         | `PdfSidebar.tsx`         | Outline tree, thumbnails                               |
| **TextSelectionPopup** | `TextSelectionPopup.tsx` | Text selection with Add/Explain actions                |
| **ChatPanel**          | `ChatPanel.tsx`          | Streaming markdown chat UI                             |
| **useChat**            | `useChat.ts`             | Chat API, streaming, BookContext                       |
| **ApiSettings**        | `ApiSettings.tsx`        | Provider selection & API key management                |

### Data Flow

1. **Import**: PDF → `/api/library/import` → disk + SQLite metadata
2. **Open**: Fetch metadata + stream file → render with react-pdf
3. **Session**: Create/load → `/api/sessions` → chat history in SQLite
4. **Chat**: `/api/chat` with `{doc_id, session_id, page_start, page_end, highlights}` → backend extracts pages with pypdf → streams LLM response via LiteLLM
5. **State sync**: Viewer updates → PATCH `/api/library/{doc_id}/state`

## Key Features

### Dual-Layer Context System

The system provides LLM with two distinct context layers:

1. **Page Range Context** (background)
   - Auto-follow window (default ±3 pages around current page)
   - Manual range selection via toolbar inputs
   - Section selection (brain icon on outline items)
   - Sent as PDF file attachments to LLM (native PDF support required)

2. **Highlights Context** (focus)
   - User-selected text snippets via TextSelectionPopup
   - Displayed as pills above chat input
   - Sent in user message content (not system prompt)
   - Auto-cleared after message send
   - Max 5 fragments, 2000 chars each

### Multi-Provider LLM Support

- **Unified Interface**: Backend uses `litellm` to normalize OpenAI/Anthropic/Gemini APIs
- **PDF Support**: Direct PDF file attachments for supported models (e.g. gpt-4o, claude-sonnet, gemini-pro)
- **Settings**: Per-provider API key storage in frontend (`localStorage`)
- **Error Handling**: Friendly errors for unsupported models or incorrect API keys

### PDF Viewer

- **Rendering**: `react-pdf` + `react-virtuoso` (virtualized)
- **Toolbar**: Navigation, zoom, AI range inputs, search, settings
- **Sidebar**: Outline tree + thumbnails, Shift-click ranges
- **Section selection**: Brain icon → auto-range from heading to next same/higher level
- **Search**: Full-text from current page, per-hit highlighting
- **Assets**: PDF.js worker + wasm/cmaps from CDN

### Chat System

- **Lightweight**: Only sends doc_id + session_id + range + highlights
- **History**: Previous messages sent with each request
- **BookContext**: `{title, totalPages, currentPage, selectedRange, outline, overview, highlights}`
- **Rendering**: react-markdown + KaTeX for LaTeX math
- **Streaming**: Real-time chunks with typing indicator

### Backend Services

**library_service.py**:

- On-disk: `backend/storage/library/{doc_id}.pdf`
- SQLite: documents, sessions, messages, state
- pypdf: outline/metadata parsing and page extraction as base64

**llm.py**:

- LiteLLM integration for multi-provider support
- Error handling hierarchy (`LLMError`, `PDFNotSupportedError`)
- System prompt: PDF assistant role + guidelines
- Native PDF file input handling

## API Reference

### POST /api/chat

Stream LLM response for PDF content.

```typescript
// Request
{
  doc_id: string;
  session_id: string;
  page_start: number;
  page_end: number;
  question: string;
  history?: Message[];
  book_context?: {
    title?: string;
    total_pages?: number;
    current_page?: number;
    selected_range?: string;
    outline?: string;
    overview?: string;
    highlights?: string[];  // User-selected text snippets
  };
  provider: "openai" | "anthropic" | "gemini";
  api_key?: string;
  base_url?: string;
  model?: string;  // If null, uses provider default
}

// Response: text/plain stream
```

### Other Endpoints

- `POST /api/library/import` - Upload PDF, get metadata
- `GET /api/library/{doc_id}` - Get document metadata
- `GET /api/library/{doc_id}/file` - Stream PDF with Range support
- `PATCH /api/library/{doc_id}/state` - Save last page/range/session
- `GET /api/library` - List recent documents
- `POST /api/sessions` - Create session
- `GET /api/sessions?doc_id=` - List sessions
- `GET /api/sessions/{session_id}/messages` - Get messages
- `DELETE /api/sessions/{session_id}/messages` - Clear messages

## File Structure

### Frontend (`frontend/src/`)

```
components/
├── PdfViewer.tsx         - Core viewer state + orchestration
├── PdfToolbar.tsx        - Floating toolbar
├── PdfSidebar.tsx        - Outline + thumbnails
├── TextSelectionPopup.tsx - Text selection popup (Add/Explain)
├── ChatPanel.tsx         - Chat UI + markdown rendering
├── Header.tsx            - Top bar
├── Layout.tsx            - App shell
├── UploadZone.tsx        - Drag & drop uploader
├── BookshelfModal.tsx    - Library modal
├── SessionListModal.tsx  - Sessions modal
└── ApiSettings.tsx       - API config modal (Providers & Keys)

hooks/
├── useChat.ts            - Chat API + streaming
```

### Backend (`backend/`)

```
models/
└── schemas.py            - Pydantic models (ChatRequest, LLMProvider)

routers/
├── library.py            - Document endpoints
├── sessions.py           - Session endpoints
└── chat.py               - Chat endpoint

services/
├── library_service.py    - PDF storage + SQLite
└── llm.py                - LiteLLM client & error handling
```

## Tech Stack

**Frontend**:

- React 19 + TypeScript + Vite
- react-pdf + react-virtuoso
- react-resizable-panels
- react-markdown + KaTeX
- Tailwind CSS v4 + shadcn/ui
- Biome (lint/format)

**Backend**:

- Python 3.13 + FastAPI
- pypdf (PDF processing)
- SQLite (storage)
- LiteLLM (Multi-provider LLM interface)
- Pydantic v2
- uv (dependency management)
- Ruff (lint/format)

## Environment Variables

**Backend**:

- `READPILOT_DATA_DIR` - Storage root (default: `backend/storage`)
- `READPILOT_ALLOWED_ORIGINS` - CORS origins (comma-separated)
- `READPILOT_ALLOW_ANY_ORIGIN` - Allow any origin (set to `true`)
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `GEMINI_API_KEY` - Gemini API key
- `OPENAI_BASE_URL` - Custom compatible endpoint

**Frontend** (Vite):

- `VITE_API_URL` - Backend URL (default: `http://localhost:8000`)

## Code Conventions

### File Headers

Every file includes a one-line purpose comment:

**Frontend (TSX/TS)**:

```typescript
/** ComponentName - Brief description. */
```

**Backend (Python)**:

```python
"""module_name - Brief description."""
```

### Important Patterns

**Text Selection Flow**:

1. User selects text in PDF → mouseup event
2. TextSelectionPopup appears with Add/Explain buttons
3. Add: `App.handleAddSelection` → update `selectedTexts` state → show as pills
4. Explain: `App.handleExplainSelection` → construct question → send immediately
5. After send: `selectedTexts` auto-cleared

**Highlights in LLM Context**:

- NOT in system prompt (too dynamic)
- Formatted in user message content: `"[User Highlights]\n> text1\n> text2"`
- LLM sees them as part of the question context

**State Management**:

- App.tsx: doc/session/page/range/highlights state
- PdfViewer: local UI state (zoom, search, sidebar)
- ChatPanel: input/messages display (no state ownership)

## Pre-commit Hooks

Both repos use pre-commit:

- Frontend: Biome check + format
- Backend: Ruff lint + format
- Trailing whitespace, EOF fixes

Run manually:

```bash
git add . && git commit -m "message"
# Hooks auto-run and may modify files
# Re-add if modified, then commit succeeds
```

## Testing

### Frontend Tests (Vitest)

**Run tests:**

```bash
cd frontend
npm test             # Run all tests once
npm run test:watch   # Run in watch mode during development
```

**Test structure:**

- Tests co-located with source files: `src/lib/utils.test.ts`
- Test utilities in `src/test/setup.ts`
- Uses Vitest + @testing-library/react + jsdom
- Mock external dependencies (fetch, browser APIs)

**Adding new tests:**

```typescript
// src/lib/myModule.test.ts
import { describe, expect, it, vi } from 'vitest'
import { myFunction } from './myModule'

describe('myFunction', () => {
  it('should do something', () => {
    expect(myFunction('input')).toBe('output')
  })
})
```

### Backend Tests (pytest)

**Run tests:**

```bash
cd backend
uv run pytest              # Run all tests
uv run pytest -v           # Verbose output
uv run pytest --cov        # With coverage report
uv run pytest tests/test_schemas.py  # Run specific file
```

**Test structure:**

- Tests in `backend/tests/` directory
- Fixtures in `conftest.py` (temp directories, sample PDFs)
- Uses pytest-asyncio for async tests
- Tests use temporary directories to avoid side effects

**Adding new tests:**

```python
# tests/test_my_module.py
import pytest
from services.my_module import my_function

class TestMyFunction:
    def test_basic_case(self):
        assert my_function("input") == "output"

    def test_edge_case(self, temp_data_dir):  # Use fixtures
        result = my_function(temp_data_dir)
        assert result is not None
```

### Test Coverage Areas

**Core business logic:**

- `utils.ts` - cn(), sanitizeAriaLabel(), preprocessLaTeX()
- `api.ts` - API client functions, error handling
- `schemas.py` - Pydantic model validation
- `library_service.py` - CRUD operations, page extraction
- `llm.py` - Message building, error parsing, prompt construction

**Integration points:**

- Text selection → highlights display → send → auto-clear
- Page range changes → context updates
- Session switching → history persistence
- Provider switching → API key persistence

**Validation commands:**

```bash
# Frontend build validation
cd frontend && npm run build

# Backend import validation
cd backend && uv run python -c "from services import llm"

# Run all tests
cd frontend && npm test
cd backend && uv run pytest
```

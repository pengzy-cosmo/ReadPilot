# ReadPilot

ReadPilot is an AI-assisted PDF reading tool designed to act as a companion for focused reading. Unlike standard chat-with-PDF tools that ingest the entire document at once, ReadPilot implements a "context window" that follows your reading progress. It automatically selects the pages around your current view to provide relevant, grounded answers from the LLM.

## Core Concepts

- **Context Awareness**: The system tracks your current page and maintains a sliding window of context (e.g., current page ± 3 pages).
- **On-Demand Processing**: Pages are extracted and processed only when needed, ensuring efficiency and relevance.
- **Focused Q&A**: User queries are answered based specifically on the currently selected page range, reducing hallucinations and improving precision.

## Tech Stack

- **Backend**: Python (FastAPI), PyMuPDF (PDF processing), OpenAI API (LLM integration).
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, react-pdf / pdfjs-dist.

## Quick Start

### Backend Setup

1. Navigate to the backend directory:

   ```bash
   cd backend
   ```

2. Install dependencies:

   ```bash
   uv sync
   ```

3. Start the API server:

   ```bash
   uv run uvicorn main:app --reload --port 8000
   ```

The API will be available at <http://localhost:8000>.

### Frontend Setup

1. Navigate to the frontend directory:

   ```bash
   cd frontend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

Open your browser at <http://localhost:5173>.

## Configuration

### Environment Variables (Backend)

You can configure the backend using environment variables or a `.env` file:

- `OPENAI_API_KEY`: Your API key for the LLM provider.
- `OPENAI_BASE_URL`: Custom API endpoint URL (optional).

### User Settings (Frontend)

Click the "API Settings" button in the application to configure:

- **API Key**: Overrides the backend environment variable if set.
- **Base URL**: Custom endpoint URL.
- **Model**: The LLM model to use. Defaults to `gpt-5.2`.

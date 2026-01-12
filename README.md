# ReadPilot

**ReadPilot** is a self-hosted PDF reader that integrates LLM capabilities directly into your reading workflow.

Unlike generic chat-with-PDF tools, ReadPilot **automatically syncs the chat context with your current viewport**. As you scroll, the AI "reads" along with you, allowing for precise questions without manual context management.

## Quick Start (Docker)

Requires [Docker Compose](https://docs.docker.com/compose/install/).

1. **Configure Environment**

   Copy the example config and set your OpenAI API key (or compatible provider):

   ```bash
   cp .env.example .env
   # Edit .env to set OPENAI_API_KEY=sk-...
   ```

2. **Run**

   ```bash
   docker compose up --build
   ```

3. **Open Browser**
   - App: <http://localhost:5173>
   - Settings: Click the gear icon in the app to configure models or base URLs.

> Data is persisted in the `readpilot_data` Docker volume.

## Local Development

### Backend (Python)

Requires Python 3.13+ and [uv](https://github.com/astral-sh/uv).

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000
```

### Frontend (React)

Requires Node.js 20+.

```bash
cd frontend
npm install
npm run dev
```

## Configuration

| Variable             | Description                               | Default                     |
| -------------------- | ----------------------------------------- | --------------------------- |
| `OPENAI_API_KEY`     | API Key for LLM service                   | -                           |
| `OPENAI_BASE_URL`    | Custom endpoint (e.g. for LocalAI/Ollama) | `https://api.openai.com/v1` |
| `READPILOT_DATA_DIR` | PDF & Metadata storage path               | `./storage`                 |

## License

MIT

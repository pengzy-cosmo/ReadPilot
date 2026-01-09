[parallel]
dev: backend-dev frontend-dev

backend-dev:
  cd backend && uv run uvicorn main:app --reload --port 8000

frontend-dev:
  cd frontend && npm run dev

install:
  cd backend && uv sync
  cd frontend && npm install

lint:
  cd frontend && npm run lint

build:
  cd frontend && npm run build

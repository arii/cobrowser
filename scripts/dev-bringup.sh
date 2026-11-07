#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
fi

echo "1. Starting Steel Co-Browsing Container (:3000 Live UI, :9223 CDP)..."
docker compose -f docker/docker-compose.cobrowse.yml up -d

echo "2. Launching FastAPI Orchestrator (:8000), Fetch.ai uAgent (:8001), and Next.js Live Canvas (:3001)..."
pnpm concurrently \
  --names "API,UAGENT,WEB" \
  -c "cyan,magenta,green" \
  "pnpm dev:api" \
  "pnpm dev:uagent" \
  "pnpm dev:web"

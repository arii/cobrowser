#!/usr/bin/env bash
# Start (or refresh) the local Chromium sidecar. The CDP forwarder is baked
# into the image and supervised by the container entrypoint, so nothing needs
# reinstalling after recreates or restarts; this script only ensures the
# sidecar is up and its gateway answers.
set -euo pipefail

cd "$(dirname "$0")/.."
docker compose -f docker/docker-compose.cobrowse.yml up -d --build chromium
for _ in $(seq 1 30); do
  if curl -s -m 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -s -m 8 http://127.0.0.1:9222/json/version | head -c 120
echo
echo "Chromium CDP is up."

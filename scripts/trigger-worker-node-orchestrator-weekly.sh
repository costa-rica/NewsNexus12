#!/usr/bin/env bash
set -euo pipefail

WORKER_NODE_URL="${WORKER_NODE_URL:-http://127.0.0.1:8003}"

exec /usr/bin/curl \
  --fail-with-body \
  --show-error \
  --silent \
  --max-time 30 \
  --retry 2 \
  --retry-delay 5 \
  --header 'Content-Type: application/json' \
  --request POST \
  --data '{"mode":"weekly","aiApproverEnabled":true,"semanticScorerEnabled":true}' \
  "${WORKER_NODE_URL}/orchestrator/start"

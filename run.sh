#!/usr/bin/env bash
# Starts the app. Keys come from either:
#  - a gitignored local env file (teammates: NVIDIA_API_KEY=...), or
#  - Doppler project jedi-pack (Paul). The optional OpenRouter fallback is fetched on its own so the
#    other secrets in that project never enter this process.
set -euo pipefail
cd "$(dirname "$0")"
LOCAL=".env.local"
if [ -f "$LOCAL" ]; then
  set -a; . "./$LOCAL"; set +a
  exec node src/server.mjs
fi
OR=$(doppler secrets get OPENROUTER_API_KEY --project "${OR_PROJECT:-infra}" --config prd --plain 2>/dev/null || true)
exec env OPENROUTER_API_KEY="$OR" doppler run --project jedi-pack --config prd -- node src/server.mjs

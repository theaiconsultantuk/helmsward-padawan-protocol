#!/usr/bin/env bash
# Starts the app with keys read from Doppler at run time (never written to disk or printed).
# NVIDIA/TMDB come from project jedi-pack. The optional OpenRouter fallback is fetched on its own,
# so the other 80+ secrets in that project never enter this process.
set -euo pipefail
cd "$(dirname "$0")"
OR=$(doppler secrets get OPENROUTER_API_KEY --project "${OR_PROJECT:-infra}" --config prd --plain 2>/dev/null || true)
exec env OPENROUTER_API_KEY="$OR" doppler run --project jedi-pack --config prd -- node src/server.mjs

#!/usr/bin/env bash
# Stream inbox/data/synthetic into the Zetaris driver container as uid 1001 (never root, never docker cp). Idempotent.
set -euo pipefail
SRC=/opt/glitch/workspaces/open-agent-hackathon-2026--inbox-build/inbox/data/synthetic
DEST=/home/zetaris/customer-data/shared/jedi-pack
C=zetaris-driver-1
docker exec -u 1001 "$C" mkdir -p "$DEST"
tar -C "$SRC" -cf - . | docker exec -i -u 1001 "$C" tar -xf - -C "$DEST"
printf 'files in %s: ' "$DEST"
docker exec -u 1001 "$C" find "$DEST" -type f | wc -l

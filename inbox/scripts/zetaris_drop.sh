#!/usr/bin/env bash
# Stream inbox/data/synthetic into the Zetaris driver container as uid 1001 (never root, never docker cp). Idempotent.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../data/synthetic" && pwd)"
DEST="${DEST:-/home/zetaris/customer-data/shared/jedi-pack}"
C="${CONTAINER:-zetaris-driver-1}"
docker exec -u 1001 "$C" mkdir -p "$DEST"
tar -C "$SRC" -cf - . | docker exec -i -u 1001 "$C" tar -xf - -C "$DEST"
printf 'files in %s: ' "$DEST"
docker exec -u 1001 "$C" find "$DEST" -type f | wc -l
# the runtime folder is not under data/synthetic: stream the header-only intake.csv the same way (table intake_runtime)
# SKIP_RUNTIME=1 leaves the container's intake_runtime alone (a republish from a branch must not overwrite live runs)
if [ "${SKIP_RUNTIME:-}" = "1" ]; then
  echo "SKIP_RUNTIME=1: skipped streaming data/runtime/intake.csv (intake_runtime left as it is)"
  exit 0
fi
RT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/runtime"
docker exec -u 1001 "$C" mkdir -p "$DEST/runtime"
[ -f "$RT/intake.csv" ] && docker exec -i -u 1001 "$C" sh -c "cat > '$DEST/runtime/intake.csv'" < "$RT/intake.csv"
exit 0

#!/usr/bin/env bash
# thor-tunnels.sh up|status|down: ssh control-socket tunnel from this VM to Nightshift on Thor.
# Nightshift listens on Thor's 127.0.0.1:8088 only, so it needs a forward.
# OpenJev is reachable from the VM directly (OPENJEV_BASE_URL), so it needs NO forward;
# set WITH_OPENJEV=1 to also forward 8080 (for a Mac judge later).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SOCK="$(dirname "$HERE")/.tunnel.sock"
PORT=8088
FWD=(-L "${PORT}:127.0.0.1:${PORT}")
[ "${WITH_OPENJEV:-0}" = "1" ] && FWD+=(-L "8080:127.0.0.1:8080")

alive() { ssh -S "$SOCK" -O check thor >/dev/null 2>&1; }

case "${1:-}" in
  up)
    if alive; then echo "already up ($SOCK)"; exit 0; fi
    rm -f "$SOCK"
    if ssh -M -S "$SOCK" -f -N -o ExitOnForwardFailure=yes -o BatchMode=yes "${FWD[@]}" thor; then
      echo "tunnel up: 127.0.0.1:${PORT} -> thor:${PORT}"; exit 0
    fi
    echo "tunnel failed to start" >&2; exit 1 ;;
  status)
    if ! alive; then echo "tunnel down" >&2; exit 1; fi
    code="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "http://127.0.0.1:${PORT}/v1/models" || true)"
    case "$code" in
      401|403) echo "tunnel up, auth required (HTTP $code)"; exit 0 ;;
      200) echo "tunnel up, models answered without a token (HTTP 200)"; exit 0 ;;
      *) echo "tunnel socket alive but 127.0.0.1:${PORT} answered HTTP ${code:-none}" >&2; exit 2 ;;
    esac ;;
  down)
    if alive; then ssh -S "$SOCK" -O exit thor >/dev/null 2>&1; echo "tunnel closed"; else rm -f "$SOCK"; echo "tunnel was not up"; fi
    exit 0 ;;
  *) echo "usage: $0 up|status|down" >&2; exit 64 ;;
esac

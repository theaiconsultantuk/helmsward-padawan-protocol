#!/usr/bin/env bash
# Clean-clone proof for the Jedi Pack inbox: clone, docker build, run all nine input examples twice (1-3 threads, 4-9 free-text scenarios).
#   LIVE leg:   host networking + the working copy's inbox/.env (Zetaris, Nightshift tunnel, OpenJev sit on the VM's loopback/LAN).
#   SAMPLE leg: --network none, SAMPLE_MODE=true, examples run FROM INSIDE the container with `node src/cli.mjs run --example N`.
# Writes inbox/judging/clean-clone-run.md. Exit 0 only when all six runs succeeded.
# Environment:
#   CLONE_SOURCE=<url-or-path>  clone this instead of the working copy's repo root
#   CLONE_BRANCH=<branch>       branch to clone (default: the working copy's current branch)
#   CLEAN_PORT=<port>           live-leg port (default 8811)
#   SKIP_CLONE=1                no clone: build from the working copy's inbox/ (tests uncommitted files; the md says so)
# The live-leg client waits 360 s per run: the loop's own whole-run cap is 300 s and a run that hits it still answers (an honest
# capped escalation), so the client must outlive the cap or a slow Nemotron day shows as HTTP 000 (seen 23 Oct 13:15 on example 1).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
INBOX="$ROOT/inbox"
OUT="$INBOX/judging/clean-clone-run.md"
IMAGE=oah-inbox
PORT="${CLEAN_PORT:-8811}"
TMP="$(mktemp -d)"
CIDS=()
FAILS=0

cleanup() {
  local c
  for c in "${CIDS[@]:-}"; do if [ -n "$c" ]; then docker rm -f "$c" >/dev/null 2>&1 || true; fi; done
  rm -rf "$TMP"
}
trap cleanup EXIT

[ -f "$INBOX/.env" ] || { echo "missing $INBOX/.env (needed for the live leg)" >&2; exit 2; }

# --- source and build ---------------------------------------------------------------------------
if [ "${SKIP_CLONE:-0}" = "1" ]; then
  CONTEXT="$INBOX"
  SOURCE_NOTE="SKIP_CLONE=1: built from the working copy $INBOX (uncommitted files included; this is not a clean-clone proof)"
  COMMIT="$(git -C "$ROOT" rev-parse --short HEAD) (working copy)"
else
  SRC="${CLONE_SOURCE:-$ROOT}"
  BRANCH="${CLONE_BRANCH:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
  git clone --quiet --branch "$BRANCH" "$SRC" "$TMP/clone"
  CONTEXT="$TMP/clone/inbox"
  SOURCE_NOTE="git clone --branch $BRANCH $SRC (fresh clone, committed files only)"
  COMMIT="$(git -C "$TMP/clone" rev-parse --short HEAD)"
fi
BUILD_LOG="$TMP/build.log"
docker build -t "$IMAGE" "$CONTEXT" >"$BUILD_LOG" 2>&1 || { tail -20 "$BUILD_LOG" >&2; echo "docker build failed" >&2; exit 1; }
ENV_COUNT="$(docker run --rm --entrypoint ls "$IMAGE" -la /app | grep -c '\.env$' || true)"
[ "$ENV_COUNT" = "0" ] || { echo "image contains a .env file" >&2; FAILS=$((FAILS+1)); }

# --- helpers ------------------------------------------------------------------------------------
expected_decision() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).output.decision)' "$INBOX/output_examples/example_$1.json"; }
LIVE_ROWS="$TMP/live.rows"; SAMPLE_ROWS="$TMP/sample.rows"; : >"$LIVE_ROWS"; : >"$SAMPLE_ROWS"

# --- LIVE leg -----------------------------------------------------------------------------------
LIVE_CMD="docker run -d --network host --env-file $INBOX/.env -e HOST=127.0.0.1 -e PORT=$PORT $IMAGE"
LIVE_CID="$(docker run -d --network host --env-file "$INBOX/.env" -e HOST=127.0.0.1 -e PORT="$PORT" "$IMAGE")"
CIDS+=("$LIVE_CID")
up=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then up=1; break; fi
  sleep 1
done
if [ "$up" != "1" ]; then echo "live container never served /health" >&2; docker logs "$LIVE_CID" 2>&1 | tail -10 >&2; fi
for n in 1 2 3 4 5 6 7 8 9; do
  want="$(expected_decision "$n")"
  body="$TMP/live_body_$n.json"; resp="$TMP/live_resp_$n.json"
  # the shipped examples carry no mode, so posted to a live service they run live; only the run id is renamed
  node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); b.run_id="clean-live-"+process.argv[2]; console.log(JSON.stringify(b))' "$INBOX/input_examples/example_$n.json" "$n" >"$body"
  code=000
  if [ "$up" = "1" ]; then
    code="$(curl -s --max-time 360 -o "$resp" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data @"$body" "http://127.0.0.1:$PORT/run" || echo 000)"
  fi
  rid="-"; status="-"; decision="-"; model="-"
  if [ -s "$resp" ]; then
    read -r rid status decision < <(node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((r.run_id||"-"),(r.status||"-"),(r.output&&r.output.decision||"-"))}catch{console.log("- - -")}' "$resp")
    curl -s --max-time 30 "http://127.0.0.1:$PORT/runs/$rid/trace" >"$TMP/live_trace_$n.json" || true
    model="$(node -e 'try{const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const m=[...new Set(t.filter(l=>l.step==="nvidia.model"&&l.model).map(l=>l.model))];console.log(m.join(", ")||"-")}catch{console.log("-")}' "$TMP/live_trace_$n.json")"
  fi
  ok=FAIL
  if [ "$code" = "200" ] && [ "$status" = "success" ] && [ "$decision" = "$want" ]; then ok=ok; else FAILS=$((FAILS+1)); fi
  echo "| $n | $rid | $code | $status | $decision | $want | $model | $ok |" >>"$LIVE_ROWS"
done
docker rm -f "$LIVE_CID" >/dev/null 2>&1 || true

# --- SAMPLE leg ---------------------------------------------------------------------------------
SAMPLE_CMD="docker run -d --network none -e SAMPLE_MODE=true $IMAGE"
SAMPLE_CID="$(docker run -d --network none -e SAMPLE_MODE=true "$IMAGE")"
CIDS+=("$SAMPLE_CID")
sleep 2
for n in 1 2 3 4 5 6 7 8 9; do
  want="$(expected_decision "$n")"
  out="$TMP/sample_out_$n.json"
  rc=0; docker exec "$SAMPLE_CID" node src/cli.mjs run --example "$n" >"$out" 2>"$TMP/sample_err_$n.txt" || rc=$?
  rid="-"; status="-"; decision="-"; model="-"
  if [ -s "$out" ]; then
    read -r rid status decision model < <(node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((r.run_id||"-"),(r.status||"-"),(r.output&&r.output.decision||"-"),(r.output&&r.output.draft&&r.output.draft.model||"-"))}catch{console.log("- - - -")}' "$out")
  fi
  ok=FAIL
  if [ "$rc" = "0" ] && [ "$status" = "success" ] && [ "$decision" = "$want" ]; then ok=ok; else FAILS=$((FAILS+1)); fi
  echo "| $n | $rid | $rc | $status | $decision | $want | $model | $ok |" >>"$SAMPLE_ROWS"
done
docker rm -f "$SAMPLE_CID" >/dev/null 2>&1 || true

# --- report -------------------------------------------------------------------------------------
STAMP="$(date '+%Y-%m-%d %H:%M %Z')"
VERDICT=PASS; [ "$FAILS" -eq 0 ] || VERDICT=FAIL
mkdir -p "$INBOX/judging"
{
  cat <<MD
---
title: Clean-clone run
description: A build of the repo into the oah-inbox Docker image, run on the nine input examples live and the same nine in sample mode with no network.
date: $(date +%F)
tags: [judging, docker, clean-clone, sample-mode]
---

# Clean-clone run

Result: **$VERDICT** ($STAMP). Script: \`inbox/scripts/clean_clone_test.sh\`.

- Source: $SOURCE_NOTE
- Commit: $COMMIT
- Build: \`docker build -t $IMAGE <context>/inbox\` (Dockerfile: node:22-slim, no npm step)
- Image \`.env\` check: \`docker run --rm --entrypoint ls $IMAGE -la /app | grep -c '\.env\$'\` printed **$ENV_COUNT** (\`.env.example\` may be present)

## Live leg

Command: \`$LIVE_CMD\` (host networking because Zetaris, the Nightshift tunnel and OpenJev listen on the VM's loopback and LAN; the .env comes from the working copy, never from the clone).
Each \`input_examples/example_N.json\` is POSTed to \`/run\` as shipped (only the run id is renamed); the model is the \`nvidia.model\` line of \`GET /runs/<id>/trace\`.

| Example | run_id | HTTP | status | decision | expected | model | result |
|---|---|---|---|---|---|---|---|
MD
  cat "$LIVE_ROWS"
  cat <<MD

## Sample leg

Command: \`$SAMPLE_CMD\`, then \`docker exec <id> node src/cli.mjs run --example N\` inside the container (exit code in the third column).

| Example | run_id | exit | status | decision | expected | draft model | result |
|---|---|---|---|---|---|---|---|
MD
  cat "$SAMPLE_ROWS"
  cat <<MD

Both containers are removed on exit and the temp directory is deleted. Failures counted: $FAILS.
MD
} >"$OUT"

echo "wrote $OUT ($VERDICT, $FAILS failure(s))"
[ "$FAILS" -eq 0 ]

#!/usr/bin/env bash
# One-command clean deploy.
#   bash scripts/clean_deploy.sh          sample mode: bundled data, no key, no network
#   bash scripts/clean_deploy.sh --live   the judge's own Zetaris: publish data, register, verify, doctor, start
#   bash scripts/clean_deploy.sh --stop   stop the server this script started
#   bash scripts/clean_deploy.sh --check-running   is our server up on $PORT in the mode CLEAN_DEPLOY_EXPECT_MODE (sample|live, default sample)?
# Idempotent. Never prints a secret value (set +x; .env is parsed for key NAMES only). Never creates or fetches a key.
set +x
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INBOX="$(cd "$HERE/.." && pwd)"
RUN="$INBOX/data/runtime"
PIDF="$RUN/clean_deploy.pid"
LOGF="$RUN/clean_deploy.log"
STEPLOG="$RUN/clean_deploy.step.log"
MODE="sample"
case "${1:-}" in
  "") ;;
  --live) MODE="live" ;;
  --stop) MODE="stop" ;;
  --check-running) MODE="check" ;;
  *) echo "usage: bash scripts/clean_deploy.sh [--live|--stop|--check-running]" >&2; exit 2 ;;
esac
mkdir -p "$RUN"

pid_alive() { [ -f "$PIDF" ] && p="$(cat "$PIDF" 2>/dev/null)" && [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

if [ "$MODE" = stop ]; then
  if pid_alive; then
    p="$(cat "$PIDF")"
    kill "$p" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do kill -0 "$p" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
    rm -f "$PIDF"
    echo "stopped server pid $p"
  else
    rm -f "$PIDF"
    echo "no server of this script is running"
  fi
  exit 0
fi

export PORT="${PORT:-8000}"
URL="http://127.0.0.1:${PORT}/"
TOTAL=3; [ "$MODE" = live ] && TOTAL=9
N=0
fail() { echo "FAIL $1"; exit 1; }
step() { N=$((N + 1)); printf 'step %s/%s: %s … ' "$N" "$TOTAL" "$1"; }
ok() { echo "ok${1:+ ($1)}"; }
# run a command quietly; its output goes to a log, never the screen (a command could echo a value)
quiet() { "$@" >"$STEPLOG" 2>&1; }

env_has() { # key is set and non-empty in inbox/.env; the value is never printed
  grep -Eq "^[[:space:]]*${1}=[^[:space:]]+" "$INBOX/.env" 2>/dev/null
}

# running_mode: prints "sample" or "live" from /health on our port; non-zero when /health does not answer
running_mode() {
  local body
  body="$(curl -fs --max-time 3 "${URL}health" 2>/dev/null)" || return 1
  case "$body" in
    *'"sample_mode":true'*) echo sample ;;
    *'"sample_mode":false'*) echo live ;;
    *) return 1 ;;
  esac
}

# check_existing <want sample|live>: 0 = our process, right mode (reuse); 1 = nothing of ours (start); exits FAIL on a mismatch
check_existing() {
  local want="$1" p have
  [ -f "$PIDF" ] || return 1
  if ! pid_alive; then rm -f "$PIDF"; return 1; fi
  p="$(cat "$PIDF")"
  have="$(running_mode)" || fail "pid $p from $PIDF is alive but /health does not answer on port $PORT (other port or not ours); run: bash scripts/clean_deploy.sh --stop first"
  [ "$have" = "$want" ] || fail "server pid $p on port $PORT is in $have mode, you asked for $want; run: bash scripts/clean_deploy.sh --stop first"
  return 0
}

start_server() { # $1 = SAMPLE_MODE value
  local want=live; [ "$1" = true ] && want=sample
  if check_existing "$want"; then ok "already running, pid $(cat "$PIDF"), $want mode"; return 0; fi
  ( cd "$INBOX" || exit 1; SAMPLE_MODE="$1" nohup node src/server.mjs >"$LOGF" 2>&1 </dev/null & echo $! >"$PIDF" )
  for _ in $(seq 1 40); do
    if curl -fs "${URL}health" >/dev/null 2>&1; then ok "pid $(cat "$PIDF")"; return 0; fi
    pid_alive || break
    sleep 0.25
  done
  pid_alive && kill "$(cat "$PIDF")" 2>/dev/null
  rm -f "$PIDF"
  fail "no /health within 10 s; read $LOGF (is port $PORT taken? set PORT=<free port>)"
}

if [ "$MODE" = check ]; then
  command -v curl >/dev/null 2>&1 || fail "curl not found"
  case "${CLEAN_DEPLOY_EXPECT_MODE:-sample}" in sample|live) ;; *) fail "CLEAN_DEPLOY_EXPECT_MODE must be sample or live" ;; esac
  check_existing "${CLEAN_DEPLOY_EXPECT_MODE:-sample}" || fail "no server of this script is running"
  echo "ok running pid $(cat "$PIDF"), ${CLEAN_DEPLOY_EXPECT_MODE:-sample} mode"
  exit 0
fi

step "Node 22 or newer"
command -v node >/dev/null 2>&1 || fail "node not found; install Node 22+"
NV="$(node -v | sed 's/^v//; s/\..*//')"
[ "${NV:-0}" -ge 22 ] 2>/dev/null || fail "Node $(node -v) is too old; install Node 22+"
ok "$(node -v)"

if [ "$MODE" = sample ]; then
  step "start the server in sample mode"
  start_server true
  step "open it"
  command -v curl >/dev/null 2>&1 || fail "curl not found"
  ok
  echo "$URL"
  echo "sample mode: no key, no network needed. Stop with: bash scripts/clean_deploy.sh --stop"
  exit 0
fi

# ---- live ----
step "inbox/.env has the Zetaris keys"
[ -f "$INBOX/.env" ] || fail "create inbox/.env: cp .env.example .env, then fill in your own Zetaris values (this script never creates a key)"
MISSING=""
for k in ZETARIS_REST_URL ZETARIS_ORG_ID ZETARIS_API_KEY; do env_has "$k" || MISSING="$MISSING $k"; done
[ -z "$MISSING" ] || fail "missing in inbox/.env:$MISSING (create your Zetaris key in Zetaris, put it in .env)"
OPT=""
for k in METERLESS_BASE_URL METERLESS_RUNTIME_TOKEN NIGHTSHIFT_ROUTE_PRIMARY; do env_has "$k" || OPT="$OPT $k"; done
if [ -n "$OPT" ]; then ok "NIGHTSHIFT optional, not set:$OPT (Nightshift runs on Mac or Windows only; those calls fall back or skip)"; else ok; fi

ZC="${ZETARIS_CONTAINER:-zetaris-driver-1}"
step "Zetaris driver container $ZC is running"
command -v docker >/dev/null 2>&1 || fail "docker not found; Zetaris publishing needs the docker CLI on the host that runs Zetaris"
docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$ZC" || fail "container $ZC not running; start Zetaris or set ZETARIS_CONTAINER=<name>"
ok

step "publish data/synthetic into the container"
quiet env CONTAINER="$ZC" bash "$HERE/zetaris_drop.sh" || fail "scripts/zetaris_drop.sh failed; see $STEPLOG"
ok

# expected row counts, taken BEFORE registering (register_sources.mjs writes live counts back into sources.json)
EXPECT="$RUN/clean_deploy.expect.json"
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const o={};for(const x of s.sources)if(!/^runtime\//.test(x.path))o[x.table]=x.rows;
require("fs").writeFileSync(process.argv[2],JSON.stringify(o));' "$INBOX/data/sources.json" "$EXPECT" || { echo "cannot read data/sources.json"; exit 1; }

step "register the Zetaris sources"
quiet node "$HERE/register_sources.mjs" --apply || fail "register_sources.mjs failed; see $STEPLOG"
ok

step "register the unified semantic layer"
quiet node "$HERE/register_usl.mjs" --apply || fail "register_usl.mjs failed; see $STEPLOG"
ok

step "every table's row count equals data/sources.json"
node -e '
const fs=require("fs");
const want=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const got=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const have={};for(const e of got)if(e.table)have[e.table]=e;
const bad=[];
for(const [t,n] of Object.entries(want)){const e=have[t];
  if(!e||!e.ok)bad.push(t+" not registered");
  else if(e.rows!==n)bad.push(t+" "+e.rows+" rows, expected "+n);}
if(bad.length){console.log(bad.join("; "));process.exit(1);}
console.log(Object.keys(want).length+" tables match");' "$EXPECT" "$HERE/register_result.json" >"$STEPLOG" 2>&1 \
  || fail "$(cat "$STEPLOG"); re-run: node scripts/register_sources.mjs --apply --refresh"
ok "$(cat "$STEPLOG")"

step "doctor"
# the doctor entry point is read from package.json (scripts.doctor) and run with node directly: no package-manager step
DOC="$(node -e 'const c=(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).scripts||{}).doctor||"";process.stdout.write(c)' "$INBOX/package.json")"
case "$DOC" in
  "node "[A-Za-z0-9_./-]*) ;;
  *) fail "package.json scripts.doctor is not a plain node command: $DOC" ;;
esac
# shellcheck disable=SC2086
quiet env -C "$INBOX" $DOC || fail "doctor reported a problem; see $STEPLOG (run it by hand in inbox/: $DOC)"
ok

step "start the server (live)"
start_server false
echo "$URL"
echo "live: Zetaris published and registered. Stop with: bash scripts/clean_deploy.sh --stop"

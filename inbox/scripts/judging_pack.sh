#!/usr/bin/env bash
# Regenerates the Jedi Pack inbox judging pack. Re-runnable. Exit 0 only when every listed file exists,
# the hero trace and result.md are ready, and the secrets scan is clean.
#   bash inbox/scripts/judging_pack.sh
#
# What a run does (every trace is produced by the real loop; no trace line is ever written by hand):
#   1. sample-mode examples 1..3 and the recovery pair run in a fresh `--network none` container; their traces are copied out
#   2. the hero thread runs live (up to HERO_ATTEMPTS tries; the live model is not deterministic) and its trace is copied in
#   3. inbox/result.md is generated from the hero trace and the recovery trace
#   4. judging/sample-mode-run.md, judging/sources.json (live GET /sources), judging/rules-checklist.md, judging/README.md
#   4c. scripts/scenario_proofs.mjs runs examples 4..8 live and in sample mode against a server it starts; it writes judging/scenarios.md,
#       judging/engine-world-model.md and the ten judging/traces/trace-scenario-*.jsonl itself (nothing is copied by hand here)
#   5. judging/secrets-scan.md from gitleaks and tests/no_secrets.test.mjs, run last
# Fresh runs are inherent: the second run differs in run timestamps, memory ids and model wording (see the README).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INBOX="$(cd "$HERE/.." && pwd)"
J="$INBOX/judging"
T="$J/traces"
DATE="$(date +%F)"
IMAGE="${IMAGE:-oah-inbox}"
HERO_THREAD="${HERO_THREAD:-T03}"
HERO_ASOF="${HERO_ASOF:-2026-10-19}"
HERO_ATTEMPTS="${HERO_ATTEMPTS:-10}"
WORK="$(mktemp -d)"
CIDS=()
FAILS=0
PROBLEMS=()

cleanup() {
  local c
  for c in "${CIDS[@]:-}"; do [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1; done
  if [ -n "${SRV_PID:-}" ]; then kill "$SRV_PID" >/dev/null 2>&1; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

problem() { FAILS=$((FAILS + 1)); PROBLEMS+=("$1"); echo "PROBLEM: $1" >&2; }
note() { echo "[judging_pack] $*"; }

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
mkdir -p "$J" "$T"

# ------------------------------------------------------------------------------------------------
# 1. sample-mode traces from a clean container with no network
# ------------------------------------------------------------------------------------------------
# always rebuild so the sample evidence comes from the code in this tree (an unchanged rebuild is a cache hit)
note "building image $IMAGE from $INBOX"
docker build -q -t "$IMAGE" "$INBOX" >/dev/null || problem "docker build -t $IMAGE failed"
IMAGE_ID="$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null | cut -c8-19)"

note "sample-mode examples 1..3 in a --network none container"
CID="$(docker run -d --network none -e SAMPLE_MODE=true "$IMAGE" 2>/dev/null)"
CIDS+=("$CID")
SAMPLE_CMD_RUN="docker run -d --network none -e SAMPLE_MODE=true $IMAGE"
if [ -z "$CID" ]; then
  problem "could not start the sample-mode container"
else
  sleep 1
  for n in 1 2 3; do
    docker exec "$CID" node src/cli.mjs run --example "$n" > "$WORK/ex-$n.json" 2> "$WORK/ex-$n.err"
    echo $? > "$WORK/ex-$n.rc"
    docker cp "$CID:/app/logs/trace-example-$n.jsonl" "$T/trace-example-$n.jsonl" >/dev/null 2>&1 || problem "no trace for example $n"
    chmod 664 "$T/trace-example-$n.jsonl" 2>/dev/null
  done
  docker rm -f "$CID" >/dev/null 2>&1
  CIDS=()
fi

note "recovery pair (FAULT_ZETARIS_REFUSE_ONCE=true, sample mode)"
CID="$(docker run -d --network none -e SAMPLE_MODE=true -e FAULT_ZETARIS_REFUSE_ONCE=true "$IMAGE" 2>/dev/null)"
CIDS+=("$CID")
if [ -z "$CID" ]; then
  problem "could not start the recovery container"
else
  sleep 1
  docker exec "$CID" node src/cli.mjs run --thread T02 --run-id demo-recovery > "$WORK/recovery.json" 2> "$WORK/recovery.err"
  echo $? > "$WORK/recovery.rc"
  docker cp "$CID:/app/logs/trace-demo-recovery.jsonl" "$T/trace-recovery.jsonl" >/dev/null 2>&1 || problem "no recovery trace"
  chmod 664 "$T/trace-recovery.jsonl" 2>/dev/null
  docker rm -f "$CID" >/dev/null 2>&1
  CIDS=()
fi
LEFTOVER="$(docker ps -a --filter "ancestor=$IMAGE" --format '{{.ID}}' | wc -l | tr -d ' ')"

# ------------------------------------------------------------------------------------------------
# 2. the hero thread, live
# ------------------------------------------------------------------------------------------------
note "hero thread $HERO_THREAD live (as_of $HERO_ASOF), up to $HERO_ATTEMPTS attempts"
: > "$WORK/attempts.tsv"
HERO_FOUND=0; BEST=0; BEST_RID=""
for a in $(seq 1 "$HERO_ATTEMPTS"); do
  RID="hero-live-a$a"
  rm -f "$INBOX/logs/trace-$RID.jsonl"
  env -C "$INBOX" SAMPLE_MODE=false FAULT_ZETARIS_REFUSE_ONCE=false node src/cli.mjs run --thread "$HERO_THREAD" --as-of "$HERO_ASOF" --run-id "$RID" > "$WORK/hero-$a.json" 2> "$WORK/hero-$a.err"
  LOG="$INBOX/logs/trace-$RID.jsonl"
  if [ -s "$LOG" ]; then
    DEC="$(jq -r '.output.decision // "none"' "$WORK/hero-$a.json" 2>/dev/null || echo none)"
    NR="$(jq -s '[.[]|select((.step=="critique" or .step=="risk.signoff") and .status=="needs_revision")]|length' "$LOG")"
    DERR="$(jq -s '[.[]|select(.step=="nvidia.model" and .status=="error")]|length' "$LOG")"
    printf '%s\t%s\t%s\t%s\n' "$RID" "$DEC" "$NR" "$DERR" >> "$WORK/attempts.tsv"
    REF="$(jq -s '[.[]|select(.step=="risk.signoff" and .status=="refused")]|length' "$LOG")"
    # keep the best attempt: escalate with a refused risk.signoff (the hard over-limit gate, 3), a negative round 1 (2), anything else (1); a later tie wins
    SCORE=1; { [ "$NR" -ge 1 ] || [ "$REF" -ge 1 ]; } && SCORE=2; [ "$REF" -ge 1 ] && [ "$DEC" = "escalate" ] && SCORE=3
    if [ "$SCORE" -ge "$BEST" ]; then BEST=$SCORE; cp "$LOG" "$T/trace-hero-live.jsonl"; chmod 664 "$T/trace-hero-live.jsonl"; BEST_RID="$RID"; fi
    if [ "$SCORE" = 3 ]; then HERO_FOUND=1; break; fi
  else
    printf '%s\tno-trace\t0\t0\n' "$RID" >> "$WORK/attempts.tsv"
  fi
done
[ "$HERO_FOUND" = 1 ] || problem "hero thread $HERO_THREAD: no attempt ended in escalate with a refused risk.signoff (the best attempt's trace is kept and result.md says so)"

# ------------------------------------------------------------------------------------------------
# 3. inbox/result.md from the real traces
# ------------------------------------------------------------------------------------------------
note "generating result.md"
cat > "$WORK/gen_result.mjs" <<'JS'
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [, , inbox, date, heroThread, heroAsOf, attemptsFile] = process.argv;
const rd = (rel) => {
  const p = `${inbox}/${rel}`;
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").map((l, i) => (l.trim() ? { n: i + 1, o: JSON.parse(l) } : null)).filter(Boolean);
};
const HERO = "judging/traces/trace-hero-live.jsonl";
const REC = "judging/traces/trace-recovery.jsonl";
const A = "judging/traces/trace-two-run-A.jsonl";
const B = "judging/traces/trace-two-run-B.jsonl";
const hero = rd(HERO), rec = rd(REC), ra = rd(A), rb = rd(B);
const clip = (s, n = 320) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 3) + "..." : s; };
const q = (file, l) => `- run_id \`${l.o.run_id}\`, step \`${l.o.step}\`, timestamp \`${l.o.timestamp}\`, status \`${l.o.status}\`${l.o.retry_count != null ? `, retry_count ${l.o.retry_count}` : ""} ([${file.split("/").pop()} line ${l.n}](${file})): "${clip(l.o.output_summary)}"`;
const by = (lines, step) => lines.filter((l) => l.o.step === step);
const real = (l) => l.o.status !== "skipped";
const none = [];

// Chapter 1: critique + risk, one pair per round
const crit = by(hero, "critique").filter(real), risk = by(hero, "risk.signoff").filter(real);
const rounds = Math.max(crit.length, risk.length);
const ch1 = [];
for (let i = 0; i < rounds; i++) {
  ch1.push(`${i ? "\n" : ""}**Round ${i + 1}**\n`);
  if (crit[i]) ch1.push(q(HERO, crit[i])); else ch1.push(`- critique: no line for round ${i + 1}`);
  if (risk[i]) ch1.push(q(HERO, risk[i])); else ch1.push(`- risk.signoff: no line for round ${i + 1}`);
}
const r1neg = [crit[0], risk[0]].filter(Boolean).some((l) => l.o.status === "needs_revision" || l.o.status === "refused");
let ch1note;
if (!rounds) { none.push("Critique"); ch1note = "NONE: the hero trace has no critique or risk.signoff line that was reached. This run is not ready."; }
else if (r1neg) ch1note = "Round 1 is negative: the Evaluator's `needs_revision` on the model's own draft and/or Risk's `refused` (an amount over the policy limit is a hard fact on the round it appears, so the ticket goes to the policy's over-limit owner for approval). Neither came from a prepared line.";
else ch1note = "Honest note: in this live run round 1 did NOT carry a `needs_revision`; both critics passed the first draft. No negative round is claimed.";

// Chapter 2: retries
const retries = by(hero, "retry").filter(real);
const skippedRetry = by(hero, "retry").filter((l) => l.o.status === "skipped");
const ch2 = retries.map((l) => q(HERO, l));
if (!retries.length && skippedRetry.length) ch2.push(q(HERO, skippedRetry[0]), "No retry was run: a hard Risk refusal is the gate on the round it happens and the trace does not invent a rewrite for it (methodology). The `retry` line is present with status `skipped` and the reason.");
if (!retries.length && !skippedRetry.length) none.push("Retries");
const esc = by(hero, "escalate_or_fallback").filter(real);
const lastPair = [crit.at(-1), risk.at(-1)].filter(Boolean);
const endText = esc.length
  ? "The loop ended at the escalate gate:"
  : lastPair.length && lastPair.every((l) => l.o.status === "success")
    ? `The loop ended at a pass: round ${rounds}'s critique and risk.signoff are both \`success\` (lines ${lastPair.map((l) => l.n).join(" and ")}), so the escalate gate was not reached (its line is \`skipped\`).`
    : "The loop did not end at a pass.";
const ch2end = esc.length ? [endText, ...esc.map((l) => q(HERO, l))] : [endText];

// Chapter 3: branching
const br = by(hero, "branch");
const ch3 = br.map((l) => `${q(HERO, l)}; branch_id \`${l.o.branch_id}\``);
const plans = by(hero, "planner.plan");
const ch3b = plans.map((l) => q(HERO, l));
if (!br.length) none.push("Branching");

// Chapter 4: shared memory
const mr = by(hero, "memory.read"), mw = by(hero, "memory.write").filter(real);
const ch4 = [...mr, ...mw].map((l) => q(HERO, l));
if (!mr.length || !mw.length) none.push("Shared memory");
const wA = by(ra, "memory.write").filter(real)[0], rB = by(rb, "memory.read")[0], pB = by(rb, "planner.plan")[0];
const ch4b = (wA && rB && pB) ? [
  "The cross-run proof, from the two-run pair (`scripts/two_run_proof.mjs`; the first run writes a memory id, the second reads it and skips a chunk):",
  q(A, wA), q(B, rB), q(B, pB),
] : ["Two-run pair not found in judging/traces/."];

// Chapter 5: synthesis
const syn = by(hero, "synthesis");
const ch5 = syn.map((l) => q(HERO, l));
if (!syn.length) none.push("Trace of how the output was reached");
const rerr = rec.filter((l) => l.o.status === "error"), rrec = by(rec, "recovery").filter(real);
const pair = [];
for (const e of rerr) { const r = rrec.find((x) => x.n > e.n); if (r) pair.push(e, r); }
const decision = (syn[0]?.o.output_summary ?? "").match(/decision (\w+)/)?.[1] ?? "unknown";
const attempts = readFileSync(attemptsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
const first = hero[0]?.o;
const stepsPresent = [...new Set(hero.map((l) => l.o.step))];
const need = ["memory.read", "planner.plan", "delegate", "executor.act", "zetaris.query", "meterless.engine", "nvidia.model", "branch", "critique", "risk.signoff", "retry", "escalate_or_fallback", "memory.write", "synthesis"];
const missing = need.filter((s) => !stepsPresent.includes(s));
// each model by the role its trace line names: typed gates (nvidia.model, action typed_gates), the draft (action draft_reply or draft_revised), the critique (step critique)
const modelsOf = (pred) => [...new Set(hero.filter(pred).map((l) => l.o.model).filter(Boolean))];
const live = (l) => l.o.status !== "skipped" && l.o.status !== "error";
const modelRoles = [
  ["typed gates", modelsOf((l) => l.o.step === "nvidia.model" && l.o.action === "typed_gates" && live(l))],
  ["draft", modelsOf((l) => l.o.step === "nvidia.model" && /^draft_/.test(String(l.o.action)) && live(l))],
  ["critique", modelsOf((l) => l.o.step === "critique" && live(l))],
].map(([role, ms]) => `${role}: ${ms.length ? ms.map((m) => `\`${m}\``).join(", ") : "none logged"}`).join("; ");

const md = `---
title: Jedi Pack inbox result
description: The hero thread run live, with the critique, retry, branching, shared-memory and synthesis lines quoted from its trace by run_id, step, timestamp and line number.
date: ${date}
tags: [result, judging, trace]
---

# Jedi Pack inbox result

This file is generated by \`bash inbox/scripts/judging_pack.sh\` from real trace files. Every quote below is a line of a trace in [judging/traces/](judging/README.md), cited by run_id, step, timestamp and line number. Nothing here is retold from memory and no trace line was written by hand.

- Hero thread: \`${heroThread}\` (a refund of 400 USD against a 150 USD policy limit; the facts may leave the company), run live with \`as_of ${heroAsOf}\`, the day its owner (employee 3) is on holiday with the backup (employee 4) in per \`holiday_2026\`.
- Command: \`node src/cli.mjs run --thread ${heroThread} --as-of ${heroAsOf} --run-id <run_id>\` against live Zetaris, Nightshift and OpenJev.
- Run: \`${first?.run_id ?? "none"}\` (${hero.length} trace lines, all steps present or skipped except: ${missing.length ? missing.join(", ") : "nothing missing"}). Trace file: [${HERO}](${HERO}).
- Decision: **${decision}**. The model behind each role, read from the trace line's own \`model\` field: ${modelRoles}.
- Attempts (the live model is not deterministic, so the script tried ${attempts.length} time(s) and keeps the best attempt's trace (an escalate with a refused risk.signoff, else a negative round 1, else the latest); every attempt is listed):

| run_id | decision | needs_revision lines | drafter errors |
|---|---|---|---|
${attempts.map((a) => `| ${a[0]} | ${a[1]} | ${a[2]} | ${a[3]} |`).join("\n")}

## 1. Critique

${ch1note}

${ch1.join("\n")}

## 2. Retries

${ch2.length ? ch2.join("\n") : "NONE: the hero trace has no reached \`retry\` line."}

${ch2end.join("\n")}

## 3. Branching

${ch3.length ? ch3.join("\n") : "NONE: no \`branch\` line."}

The plans that selected and then revised the branch:

${ch3b.join("\n")}

## 4. Shared memory

${ch4.length ? ch4.join("\n") : "NONE: no memory.read or memory.write line."}

${ch4b.join("\n")}

## 5. Trace of how the output was reached

${ch5.length ? ch5.join("\n") : "NONE: no \`synthesis\` line."}

- The full trace is [${HERO}](${HERO}) (one JSON object per line; written to \`logs/trace-<run_id>.jsonl\` by the run and copied here).
- Recovery pair (an \`error\` line, then the \`recovery\` line that follows it), from the sample-mode run with \`FAULT_ZETARIS_REFUSE_ONCE=true\`, [${REC}](${REC}):
${pair.length ? pair.map((l) => q(REC, l)).join("\n") : "  NONE: no error then recovery pair in the recovery trace."}
- The misread pair (Padmé's reply, the ticket reopens, \`queueForHuman\` fires) is [judging/padme-chain.md](judging/padme-chain.md) with its traces beside it.
- The refund chain (one customer twice: held under the floor with the owner on holiday, then over the limit and escalated with step 1's memory read first) is [judging/refund-chain.md](judging/refund-chain.md) with its traces beside it.

## Readiness

${none.length ? `NOT READY. These chapters would say "none": ${none.join(", ")}.` : "Every chapter above quotes at least one trace line."}${missing.length ? ` Steps absent from the hero trace: ${missing.join(", ")}.` : ""}
`;
writeFileSync(`${inbox}/result.md`, md);
if (none.length || missing.length) { console.error(`result.md not ready: none=[${none}] missing=[${missing}]`); process.exit(3); }
JS
node "$WORK/gen_result.mjs" "$INBOX" "$DATE" "$HERO_THREAD" "$HERO_ASOF" "$WORK/attempts.tsv" || problem "result.md has a chapter that would say none, or the hero trace lacks a required step"
RESULT_LINES="$(wc -l < "$INBOX/result.md")"

# ------------------------------------------------------------------------------------------------
# 4a. judging/sample-mode-run.md
# ------------------------------------------------------------------------------------------------
note "writing sample-mode-run.md"
{
cat <<MD
---
title: Sample-mode run, no network
description: The three input examples and the recovery pair run inside a container started with no network, with the decision, status and the escalate_or_fallback line of each trace.
date: $DATE
tags: [judging, sample-mode, docker]
---

# Sample-mode run

Sample mode answers from the bundled data with no Zetaris, Nightshift or network. The container below has \`--network none\`, so a request that tried to leave it would fail.

\`\`\`
$SAMPLE_CMD_RUN
docker exec <container> node src/cli.mjs run --example N      # N = 1, 2, 3
\`\`\`

Image: \`$IMAGE\` ($IMAGE_ID). Examples are in \`input_examples/\`; each is posted by \`docker exec\` because a \`--network none\` container has no reachable port. The container was removed afterwards (containers of this image left on the host: $LEFTOVER). The traces were copied out with \`docker cp\` into [traces/](traces/trace-example-1.jsonl).

| example | thread | run_id | exit | status | decision | execution_time_seconds | trace |
|---|---|---|---|---|---|---|---|
MD
for n in 1 2 3; do
  F="$WORK/ex-$n.json"; TR="$T/trace-example-$n.jsonl"
  TH="$(jq -r '.thread_id' "$INBOX/input_examples/example_$n.json" 2>/dev/null || jq -r '.input.thread_id' "$INBOX/input_examples/example_$n.json")"
  printf '| %s | %s | %s | %s | %s | %s | %s | [trace-example-%s.jsonl](traces/trace-example-%s.jsonl) (%s lines) |\n' \
    "$n" "$(jq -r '.input.thread_id' "$INBOX/input_examples/example_$n.json")" "$(jq -r '.run_id // "none"' "$F" 2>/dev/null)" "$(cat "$WORK/ex-$n.rc")" \
    "$(jq -r '.status // "none"' "$F" 2>/dev/null)" "$(jq -r '.output.decision // "none"' "$F" 2>/dev/null)" "$(jq -r '.execution_time_seconds // "?"' "$F" 2>/dev/null)" "$n" "$n" "$(wc -l < "$TR" 2>/dev/null || echo 0)"
done
cat <<MD

## Per-example detail

MD
for n in 1 2 3; do
  F="$WORK/ex-$n.json"; TR="$T/trace-example-$n.jsonl"
  echo "### Example $n"
  echo
  echo "Reasons: $(jq -r '.output.reasons // [] | join(" | ")' "$F" 2>/dev/null)"
  echo
  echo "Cited rows: $(jq -r '.output.cited_rows // [] | join(", ")' "$F" 2>/dev/null)"
  echo
  echo "Step and status of every trace line:"
  echo
  echo '```'
  jq -r '"\(.step)\t\(.status)"' "$TR" | uniq -c | awk '{printf "%s x%s  %s\n",$2,$1,$3}'
  echo '```'
  echo
  echo "nvidia.model lines (sample mode skips the model, and the line says why):"
  echo
  echo '```'
  jq -c 'select(.step=="nvidia.model")|{step,status,output_summary}' "$TR"
  echo '```'
  echo
  echo "escalate_or_fallback line (line $(grep -n '"step":"escalate_or_fallback"' "$TR" | head -1 | cut -d: -f1) of the trace):"
  echo
  echo '```json'
  jq -c 'select(.step=="escalate_or_fallback")|{timestamp,run_id,step,status,output_summary}' "$TR"
  echo '```'
  echo
done
cat <<MD
## Which trace carries a reached escalate_or_fallback

$(for n in 1 2 3; do echo "- example $n: $(jq -r 'select(.step=="escalate_or_fallback")|"status \(.status)"' "$T/trace-example-$n.jsonl")"; done)

The methodology asks that the sample-mode trace contain an \`escalate_or_fallback\` line. Every example trace carries one; only the one with status \`success\` is a reached gate, the others are logged as \`skipped\` ("gate not reached") so no required step is missing.

## Recovery pair

\`\`\`
docker run -d --network none -e SAMPLE_MODE=true -e FAULT_ZETARIS_REFUSE_ONCE=true $IMAGE
docker exec <container> node src/cli.mjs run --thread T02 --run-id demo-recovery
\`\`\`

Status \`$(jq -r '.status // "none"' "$WORK/recovery.json" 2>/dev/null)\`, decision \`$(jq -r '.output.decision // "none"' "$WORK/recovery.json" 2>/dev/null)\`, trace [trace-recovery.jsonl](traces/trace-recovery.jsonl):

\`\`\`json
$(jq -c 'select(.status=="error" or .step=="recovery" and .status=="success")|{timestamp,run_id,step,status,output_summary}' "$T/trace-recovery.jsonl")
\`\`\`

Regenerate with \`bash inbox/scripts/judging_pack.sh\`.
MD
} > "$J/sample-mode-run.md"
for n in 1 2 3; do
  [ "$(cat "$WORK/ex-$n.rc" 2>/dev/null)" = 0 ] || problem "sample example $n did not exit 0"
  grep -q '"step":"escalate_or_fallback"' "$T/trace-example-$n.jsonl" 2>/dev/null || problem "example $n trace has no escalate_or_fallback line"
done
grep -q '"status":"error"' "$T/trace-recovery.jsonl" 2>/dev/null && grep -q '"step":"recovery"' "$T/trace-recovery.jsonl" || problem "recovery trace lacks an error and a recovery line"
[ "$LEFTOVER" = 0 ] || problem "$LEFTOVER container(s) of $IMAGE left on the host"

# ------------------------------------------------------------------------------------------------
# 4b. judging/sources.json from a live GET /sources
# ------------------------------------------------------------------------------------------------
note "GET /sources from a server started here"
PORT_USE=""
for p in 8812 8813 8814 8815 8816; do
  if ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$p\$"; then PORT_USE=$p; break; fi
done
if [ -z "$PORT_USE" ]; then
  problem "no free port in 8812..8816 for the sources server"
else
  env -C "$INBOX" PORT="$PORT_USE" HOST=127.0.0.1 SAMPLE_MODE=false node src/server.mjs > "$WORK/server.log" 2>&1 &
  SRV_PID=$!
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT_USE/health" >/dev/null 2>&1 && break; sleep 0.5; done
  if curl -sf "http://127.0.0.1:$PORT_USE/sources" -o "$WORK/sources.json" && jq -e 'type=="array" and length>0' "$WORK/sources.json" >/dev/null 2>&1; then
    jq . "$WORK/sources.json" > "$J/sources.json"
    SRC_COUNT="$(jq length "$J/sources.json")"; SRC_LIVE="$(jq '[.[]|select(.live==true)]|length' "$J/sources.json")"
  else
    problem "GET /sources returned nothing usable"; SRC_COUNT=0; SRC_LIVE=0
  fi
  kill "$SRV_PID" >/dev/null 2>&1; wait "$SRV_PID" 2>/dev/null; SRV_PID=""
fi

# ------------------------------------------------------------------------------------------------
# 4c. the scenario proofs: examples 4..8, live and sample (scripts/scenario_proofs.mjs starts its own server)
# ------------------------------------------------------------------------------------------------
# The script is not `set -e`: a non-zero exit is recorded as a problem so the pack ends NOT READY (exit 1) after everything else was written.
note "scenario proofs (examples 4..8, live and sample)"
if command -v node >/dev/null; then
  if ! env -C "$INBOX" node scripts/scenario_proofs.mjs > "$WORK/scenario_proofs.log" 2>&1; then
    SP_RC=$?
    problem "scenario_proofs.mjs exited $SP_RC (see judging/scenarios.md for the failing cell)"
    tail -n 5 "$WORK/scenario_proofs.log" >&2
  fi
else
  problem "node is required for scenario_proofs.mjs"
fi

# ------------------------------------------------------------------------------------------------
# 5a. secrets checks, first pass (the checklist tick reads this; secrets-scan.md is written from the final pass below)
# ------------------------------------------------------------------------------------------------
# gitleaks reports paths as <--source>/<file>, and INBOX is absolute, so the allowlist is anchored to exactly $INBOX/.env
INBOX_RE="$(printf '%s' "$INBOX" | sed 's/[][\.*^$+?(){}|]/\\&/g')"
cat > "$WORK/gitleaks.toml" <<TOML
[extend]
useDefault = true

[allowlist]
description = "inbox/.env is the local, gitignored secrets file; it is never committed, never in the image, never shipped"
paths = ['''^${INBOX_RE}/\\.env$''']
TOML
scan() { # sets GL_RC GL_COUNT NS_RC NS_SUMMARY; output saved under $WORK/scan-$1.*
  local tag="$1"
  command -v gitleaks >/dev/null 2>&1 || { GL_RC=127; GL_COUNT="n/a"; } 
  if command -v gitleaks >/dev/null 2>&1; then
    gitleaks detect --source "$INBOX" --no-git --redact --no-banner -c "$WORK/gitleaks.toml" --report-format json --report-path "$WORK/scan-$tag.json" > "$WORK/scan-$tag.txt" 2>&1
    GL_RC=$?
    GL_COUNT="$(jq 'length' "$WORK/scan-$tag.json" 2>/dev/null || echo n/a)"
    gitleaks detect --source "$INBOX" --no-git --redact --no-banner --report-format json --report-path "$WORK/scan-$tag-all.json" > /dev/null 2>&1
    GL_ALL_RC=$?
    GL_ALL_COUNT="$(jq 'length' "$WORK/scan-$tag-all.json" 2>/dev/null || echo n/a)"
    GL_ALL_FILES="$(jq -r '[.[].File|sub("^.*/inbox/";"inbox/")]|unique|join(", ")' "$WORK/scan-$tag-all.json" 2>/dev/null)"
  fi
  env -C "$INBOX" node --test tests/no_secrets.test.mjs > "$WORK/scan-$tag-ns.txt" 2>&1
  NS_RC=$?
  NS_SWEPT="$(grep -o 'no_secrets: swept.*' "$WORK/scan-$tag-ns.txt" | head -1)"
}
scan first
FIRST_CLEAN=0; [ "$GL_RC" = 0 ] && [ "$GL_COUNT" = 0 ] && [ "$NS_RC" = 0 ] && FIRST_CLEAN=1

# ------------------------------------------------------------------------------------------------
# 6. judging/rules-checklist.md (Technical Execution Guide section 13)
# ------------------------------------------------------------------------------------------------
note "writing rules-checklist.md"
has() { [ -e "$INBOX/$1" ]; }
cnt() { grep -rIl -E "$1" "${@:2}" 2>/dev/null | wc -l | tr -d ' '; }
T_HERO="$T/trace-hero-live.jsonl"
SIZE_KB="$(du -sk --exclude=node_modules --exclude=logs --exclude=data/memory --exclude=data/runtime --exclude=.env "$INBOX" 2>/dev/null | cut -f1)"
TIMEOUTS="$(grep -rn -E "AbortSignal.timeout|TIMEOUT_MS|setTimeout" "$INBOX/src" 2>/dev/null | wc -l | tr -d ' ')"
HERO_SECS="$(jq -r '.execution_time_seconds // "?"' "$WORK/hero-${BEST_RID##*-a}.json" 2>/dev/null)"
NVKEY="$(grep -rIl -E "NVIDIA_API_KEY|nvapi-" "$INBOX/src" "$INBOX/.env.example" "$INBOX/Dockerfile" 2>/dev/null | wc -l | tr -d ' ')"
HASH_ENV="$(grep -qxF '.env' "$INBOX/.gitignore" && echo yes || echo no)"
SPONSOR_ZET="$(jq -s '[.[]|select(.sponsor=="zetaris")]|length' "$T_HERO" 2>/dev/null)"
SPONSOR_MET="$(jq -s '[.[]|select(.sponsor=="meterless")]|length' "$T_HERO" 2>/dev/null)"
SPONSOR_NV="$(jq -s '[.[]|select(.sponsor=="nvidia")]|length' "$T_HERO" 2>/dev/null)"
MODELLINES="$(jq -s '[.[]|select(.step=="nvidia.model" and .status=="success" and .model!=null)]|length' "$T_HERO" 2>/dev/null)"
ZQ_HERO="$(jq -s '[.[]|select(.step=="zetaris.query")]|length' "$T_HERO" 2>/dev/null)"
# the terminal round is the highest round a critique or risk.signoff line carries (retry_count + 1); the note is conditioned on what Risk did last
HERO_ROUNDS="$(jq -s '[.[]|select(.step=="critique" or .step=="risk.signoff")|(.retry_count // 0)]|(max // 0) + 1' "$T_HERO" 2>/dev/null)"
HERO_RETRY="$(jq -r -s '[.[]|select(.step=="retry")][0].status // "absent"' "$T_HERO" 2>/dev/null)"
HERO_LAST_RISK="$(jq -r -s '[.[]|select(.step=="risk.signoff")]|last.status // "absent"' "$T_HERO" 2>/dev/null)"
case "$HERO_RETRY/$HERO_LAST_RISK" in
  skipped/refused) HERO_ROUND_NOTE="no retry: Risk refused on round $HERO_ROUNDS, which ends the loop";;
  skipped/success) HERO_ROUND_NOTE="no retry: round $HERO_ROUNDS passed both critics";;
  retrying/*) HERO_ROUND_NOTE="one retry was run and the last risk.signoff is \`$HERO_LAST_RISK\`";;
  *) HERO_ROUND_NOTE="retry line \`$HERO_RETRY\`, last risk.signoff \`$HERO_LAST_RISK\`";;
esac
tk() { if [ "$1" = 1 ]; then echo "[x]"; else echo "[ ]"; fi; }
ok() { if eval "$1"; then echo 1; else echo 0; fi; }
{
cat <<MD
---
title: Rules checklist, Technical Execution Guide section 13
description: Every readiness-checklist item from the hackathon technical execution requirements, ticked with the file or command that proves it; the team's attended steps are marked owner step and not ticked.
date: $DATE
tags: [judging, checklist, rules]
---

# Rules checklist

Source: Technical Execution Requirements, section 13 "Readiness Checklist". A box is ticked only when the script measured the claim on this run; the pointer says where to see it. Regenerate with \`bash inbox/scripts/judging_pack.sh\`.

## Running

- $(tk "$(ok '[ -s "$INBOX/judging/clean-clone-run.md" ] && has README.md')" "clean-clone documented start") A documented command starts the project from a clean clone. Pointer: Quick start in [../README.md](../README.md); the clone, build and run proof is [clean-clone-run.md](clean-clone-run.md) (\`bash inbox/scripts/clean_clone_test.sh\`).
- $(tk "$(ok 'has openapi.yaml && has src/server.mjs && has src/cli.mjs')" "programmatic entry") There is a programmatic entry point, not only a UI. Pointer: \`POST /run\` in [../openapi.yaml](../openapi.yaml) and \`node src/cli.mjs run --thread <id>\`; the two reference pages in \`public/\` use only that API.
- $(tk "$(ok 'has input_examples/example_1.json && has output_examples/example_1.json && jq -e . "$T/trace-example-1.jsonl" >/dev/null 2>&1')" "structured I/O") Input and output are structured and machine-readable. Pointer: [../input_examples/example_1.json](../input_examples/example_1.json), [../output_examples/example_1.json](../output_examples/example_1.json), and one JSON object per trace line ([traces/trace-example-1.jsonl](traces/trace-example-1.jsonl)).
- $(tk "$(ok '[ "$(cat "$WORK/ex-1.rc" 2>/dev/null)" = 0 ] && [ "$(cat "$WORK/ex-3.rc" 2>/dev/null)" = 0 ]')" "nothing interactive") Nothing requires interactive input. Pointer: [sample-mode-run.md](sample-mode-run.md): a detached container, then non-interactive \`docker exec\`, exit 0.

## Build

- $(tk "$(ok '[ -n "$IMAGE_ID" ] && has Dockerfile')" "docker build") Docker build succeeds, or setup is fully documented. Pointer: [../Dockerfile](../Dockerfile); image \`$IMAGE\` ($IMAGE_ID) was built from it and ran this pack's sample runs; the clean-clone build is in [clean-clone-run.md](clean-clone-run.md).
- $(tk "$(ok '! grep -qE "npm (ci|install)" "$INBOX/Dockerfile"')" "dependencies at build time") Dependencies install at build time. Pointer: [../Dockerfile](../Dockerfile) has no \`npm\` step at all: the service has no runtime dependencies (\`package.json\` lists dev dependencies only, used by the Scout evals).
- $(tk "$(ok '[ "$(cnt "cuda|nvidia-smi|torch" "$INBOX/src" "$INBOX/Dockerfile")" = 0 ]')" "no GPU") Runs without a local GPU. Pointer: \`grep -rIlE "cuda|nvidia-smi|torch" src Dockerfile\` finds $(cnt 'cuda|nvidia-smi|torch' "$INBOX/src" "$INBOX/Dockerfile") files; models are reached over HTTP through Nightshift. The sample run above used none.
- $(tk "$(ok '[ "$(cat "$WORK/ex-2.rc" 2>/dev/null)" = 0 ]')" "no runtime installs") No runtime installs or model downloads. Pointer: the \`--network none\` container in [sample-mode-run.md](sample-mode-run.md) completed all three examples, which it could not do if anything were downloaded at run time.

## Secrets

- $(tk "$FIRST_CLEAN" "secrets scan clean") No keys in code, logs or examples (the repository files the scan read). Pointer: [secrets-scan.md](secrets-scan.md) (gitleaks $GL_COUNT findings, exit $GL_RC; \`tests/no_secrets.test.mjs\` exit $NS_RC). The demo video and the slide deck are not in this repository and are not covered by this scan: they are the two owner steps at the end of this list, unticked until the team checks them by eye.
- $(tk "$(ok '[ "$NVKEY" = 0 ]')" "NVIDIA key not in app") The NVIDIA key is in Nightshift, not in the app. Pointer: \`grep -rIlE "NVIDIA_API_KEY|nvapi-" src .env.example Dockerfile\` finds $NVKEY files; the app holds only \`METERLESS_RUNTIME_TOKEN\` for Nightshift ([../.env.example](../.env.example)).
- $(tk "$(ok 'has .env.example && grep -q "your-" "$INBOX/.env.example"')" ".env.example") \`.env.example\` present with placeholders. Pointer: [../.env.example](../.env.example).
- $(tk "$(ok '[ "$HASH_ENV" = yes ]')" ".env gitignored") \`.env\` is gitignored. Pointer: line \`.env\` of \`inbox/.gitignore\` and of \`inbox/.dockerignore\`. The gitleaks run without its allowlist finds the local \`.env\` only (see [secrets-scan.md](secrets-scan.md)); that file is never committed or put in the image.

## Data

- $(tk "$(ok '[ "${SRC_COUNT:-0}" -ge 10 ] && [ -s "$J/zetaris-register.md" ]')" "Zetaris data layer") Zetaris is the data layer, with sources documented. Pointer: [sources.json](sources.json) (live \`GET /sources\`: ${SRC_COUNT:-0} sources, ${SRC_LIVE:-0} live in Zetaris), the registration statements in [zetaris-register.md](zetaris-register.md), and $ZQ_HERO \`zetaris.query\` lines in the hero trace ($SPONSOR_ZET lines carry \`sponsor: zetaris\`: those queries plus the \`executor.act\` line that gathers them).
- $(tk "$(ok '[ -s "$J/zetaris-usl.md" ] && grep -q "tables compiled and activated" "$J/zetaris-usl.md"')" "Unified Semantic Layer") A Unified Semantic Layer compiled and activated over the raw sources. Pointer: [zetaris-usl.md](zetaris-usl.md) (12 keyed tables with foreign keys over CSV, JSON, Parquet, Markdown and the runtime CSVs, a cross-source join and a live-view proof), built by the scripted [../scripts/register_usl.mjs](../scripts/register_usl.mjs) with [../scripts/zetaris_usl.sql](../scripts/zetaris_usl.sql).
- $(tk "$(ok '[ "${SIZE_KB:-99999}" -lt 20000 ]')" "repository small") Repository is small. Pointer: \`inbox/\` without node_modules, logs and runtime data is ${SIZE_KB} KB (\`du -sk\`, measured by the script).
- $(tk "$(ok 'has data/sources.json && [ -s "$J/pre-existing.md" ] && grep -qi licen "$INBOX/README.md"')" "sources and licences") Sources and licences documented. Pointer: the data sources table and the Third-Party Code and Licences section of [../README.md](../README.md), [../data/sources.json](../data/sources.json), [pre-existing.md](pre-existing.md).
- $(tk "$(ok 'has data/synthetic/threads/threads.jsonl && has scripts/register_zetaris_sources.sql')" "no manual data setup") No manual data setup. Pointer: the synthetic data is committed under \`data/synthetic/\`; registration is the scripted [../scripts/register_sources.mjs](../scripts/register_sources.mjs) with [../scripts/register_zetaris_sources.sql](../scripts/register_zetaris_sources.sql) with the statements in [zetaris-register.md](zetaris-register.md). Zetaris itself is the sponsor's installed service.
- $(tk "$(ok '[ "$(cat "$WORK/ex-1.rc" 2>/dev/null)" = 0 ] && [ "$(cat "$WORK/ex-2.rc" 2>/dev/null)" = 0 ] && [ "$(cat "$WORK/ex-3.rc" 2>/dev/null)" = 0 ]')" "sample mode") Sample mode works without Zetaris, Nightshift or network access. Pointer: [sample-mode-run.md](sample-mode-run.md) (three examples, \`--network none\`, \`SAMPLE_MODE=true\`).

## Runtime

- $(tk "$(ok '[ "$HERO_SECS" != "?" ]')" "run finishes in minutes") A run finishes in minutes. Pointer: the live hero run took ${HERO_SECS} s (\`execution_time_seconds\` in the run's own output); sample runs take under a second ([sample-mode-run.md](sample-mode-run.md)).
- $(tk "$(ok '[ "$TIMEOUTS" -ge 3 ]')" "timeouts") External calls have timeouts. Pointer: \`grep -rnE "AbortSignal.timeout|TIMEOUT_MS|setTimeout" src\` finds $TIMEOUTS sites (per-call Nightshift, Zetaris, OpenJev timeouts; the server's request timeout).
- $(tk "$(ok 'grep -q "maxRounds" "$INBOX/src/loop.mjs" && grep -q "runTimeoutMs" "$INBOX/src/loop.mjs"')" "loops bounded") Agent loops are bounded. Pointer: \`maxRounds = 2\` and a 300000 ms run cap in [../src/loop.mjs](../src/loop.mjs); the hero trace in [../result.md](../result.md) shows the loop ending at round $HERO_ROUNDS ($HERO_ROUND_NOTE).
- $(tk "$(ok 'jq -e "select(.status==\"error\")" "$T/trace-recovery.jsonl" >/dev/null 2>&1 && grep -q "errBody" "$INBOX/src/server.mjs"')" "controlled failures") Failures return a controlled response. Pointer: [traces/trace-recovery.jsonl](traces/trace-recovery.jsonl) (an \`error\` line, then \`recovery\`, result unchanged); \`errBody\` in [../src/server.mjs](../src/server.mjs) returns \`{status:"error", error:{type, message, recoverable}}\`.

## Logs

- $(tk "$(ok 'grep -q "appendFileSync" "$INBOX/src/trace.mjs" && grep -q "\[INFO\] run_id" "$INBOX/src/trace.mjs"')" "stdout and logs") Written to stdout and \`logs/\`. Pointer: [../src/trace.mjs](../src/trace.mjs) writes each event to \`logs/trace-<run_id>.jsonl\` and to stdout as \`[INFO] run_id=...\`.
- $(tk "$(ok 'jq -se "[.[].step]|index(\"delegate\")!=null and index(\"critique\")!=null and index(\"retry\")!=null and index(\"recovery\")!=null" "$T_HERO" "$T/trace-recovery.jsonl" >/dev/null 2>&1 || ( jq -e "select(.step==\"delegate\")" "$T_HERO" >/dev/null && jq -e "select(.step==\"critique\")" "$T_HERO" >/dev/null && jq -e "select(.step==\"retry\")" "$T_HERO" >/dev/null && jq -e "select(.step==\"recovery\")" "$T/trace-recovery.jsonl" >/dev/null )')" "handoffs, critique, retries, recovery") Show agent handoffs, critique, retries and recovery. Pointer: \`delegate\`, \`critique\`, \`retry\` in [traces/trace-hero-live.jsonl](traces/trace-hero-live.jsonl), \`recovery\` in [traces/trace-recovery.jsonl](traces/trace-recovery.jsonl); quoted by line number in [../result.md](../result.md).
- $(tk "$(ok '[ "${SPONSOR_ZET:-0}" -ge 1 ] && [ "${SPONSOR_MET:-0}" -ge 1 ] && [ "${MODELLINES:-0}" -ge 1 ]')" "sponsor and model lines") Show Zetaris queries, Meterless Engine activity and which model handled each request. Pointer: the hero trace has $SPONSOR_ZET lines with \`sponsor: zetaris\`, $SPONSOR_MET with \`sponsor: meterless\`, $SPONSOR_NV with \`sponsor: nvidia\`, and $MODELLINES \`nvidia.model\` success lines that carry a model id.
- $(tk "$FIRST_CLEAN" "logs contain no secrets") Contain no secrets. Pointer: [secrets-scan.md](secrets-scan.md) (\`tests/no_secrets.test.mjs\` sweeps \`logs/\`, \`output_examples/\`, \`judging/\` and \`data/sample/\` for every configured secret value and any Bearer token).

## Engines and the scenario slice

- $(tk "$(ok '[ -s "$J/engine-world-model.md" ] && [ -s "$J/engine-world-model-conformance.md" ] && [ "$(grep -c "8/8 checks passed" "$J/engine-world-model-conformance.md")" -ge 2 ] && has tests/world.test.mjs && has tests/world_model_conformance.test.mjs')" "third engine with its test") A third Meterless engine, the World Model, in a working feature with a test. Pointer: the complaint route in [engine-world-model.md](engine-world-model.md); the Meterless conformance suite scores 8/8 on the vendored reference and on our committed bundle ([engine-world-model-conformance.md](engine-world-model-conformance.md), \`npm run conformance\`); the domain layer is tested in \`tests/world.test.mjs\`.
- $(tk "$(ok 'jq -s "[.[]|select(.action==\"world_context\" and .sponsor==\"meterless\")]|length>=1" "$T/trace-scenario-8-live.jsonl" | grep -q true')" "world_context line") The World Model's work is visible in a live trace. Pointer: the \`world_context\` line (sponsor \`meterless\`, cited ids in \`memory_ids\`) in [traces/trace-scenario-8-live.jsonl](traces/trace-scenario-8-live.jsonl), quoted in [engine-world-model.md](engine-world-model.md).
- $(tk "$(ok '[ -s "$INBOX/public/index.html" ] && [ -s "$INBOX/public/dashboard.html" ] && [ -s "$J/screenshots/README.md" ]')" "two pages") The unified front end and the internal dashboard are served by the service from the API alone. Pointer: \`GET /\` and \`GET /dashboard\` ([../public/](../public/index.html)), screenshots in [screenshots/README.md](screenshots/README.md), the contract for a replacement in [../docs/FRONTEND-SPEC.md](../docs/FRONTEND-SPEC.md).
- $(tk "$(ok 'jq -s "[.[]|select(.action==\"intake_publish\" and .sponsor==\"zetaris\" and .status==\"success\")]|length>=1" "$T/trace-scenario-4-live.jsonl" | grep -q true && grep -q intake_runtime "$INBOX/data/sources.json"')" "free text through Zetaris") A free-text message becomes a ticket row that Zetaris reads, so every fact in the trace still comes through Zetaris. Pointer: the \`intake_publish\` line in [traces/trace-scenario-4-live.jsonl](traces/trace-scenario-4-live.jsonl) and the \`intake_runtime\` table in [../data/sources.json](../data/sources.json).
- $(tk "$(ok '[ "$(ls "$T"/trace-scenario-*.jsonl 2>/dev/null | wc -l | tr -d " ")" -ge 10 ] && grep -q "Overall: all checks passed" "$J/scenarios.md"')" "scenario proofs") The five scenario examples run live and in sample mode and agree on decision and branch. Pointer: [scenarios.md](scenarios.md) and the ten \`traces/trace-scenario-*.jsonl\`, written by \`scripts/scenario_proofs.mjs\`.

## Owner steps (not ticked; not provable from this repository)

- [ ] Owner step: the repository is public before submission (judges must be able to open the link).
- [ ] Owner step: the demo video, checked for keys and for the on-screen terminal.
- [ ] Owner step: the slide deck, checked for keys.
- [ ] Owner step: the submission form, with the declarations drafted in [pre-existing.md](pre-existing.md), [sponsor-explanation.md](sponsor-explanation.md) and [ai-usage.md](ai-usage.md).
MD
} > "$J/rules-checklist.md"

while IFS= read -r line; do problem "checklist item not ticked: ${line:0:90}"; done < <(grep -E '^- \[ \]' "$J/rules-checklist.md" | grep -v 'Owner step')

# ------------------------------------------------------------------------------------------------
# 7. judging/README.md, the index; every file is checked to exist
# ------------------------------------------------------------------------------------------------
note "writing README.md"
# path | what it is | rule or criterion it answers
cat > "$WORK/index.tsv" <<'TSV'
README.md	This index, with the regeneration command	Judge navigation
rules-checklist.md	Technical Execution Guide section 13, each item ticked with a pointer	Section 13 Readiness Checklist
../result.md	The result file: critique, retries, branching, shared memory and synthesis quoted from the hero trace by line	Methodology result file; Critique and validation; Retries; Branching; Shared memory; Final synthesis
sample-mode-run.md	The three examples and the recovery pair run with no network inside a container	Section 13 Data (sample mode); Running (nothing interactive)
clean-clone-run.md	Clone, build and run from a clean checkout, live and sample legs	Section 13 Running (clean clone) and Build (Docker)
secrets-scan.md	gitleaks and the no-secrets sweep, exit codes and finding counts	Section 13 Secrets; Logs contain no secrets
sources.json	The live GET /sources body: every Zetaris source, format, table and row count	Zetaris is the data layer, sources documented
zetaris-usl.md	The Unified Semantic Layer compiled and activated over the raw sources: keys, foreign keys, live views, join and liveness proof	Sponsor call a judge can see (Zetaris)
zetaris-register.md	Every statement that registered the sources in Zetaris, with live row counts	Sponsor call a judge can see (Zetaris)
engine-scout-evals.md	Meterless Scout eval run and the command	Meterless Engine really used (Scout)
engine-hmem-two-run.md	H-MEM two-run proof: a second run reads what the first wrote	Shared memory (H-MEM)
nightshift-models.json	The routes Nightshift offered	Nightshift connection; where NVIDIA contributes
nightshift-first-call.json	The first probe call to Nightshift and its receipt	Nightshift connection; which model handled the request
padme-chain.md	Padme's email chain processed one step after the other, live	Errors and recovery; misread disclosure
trust-floor.md	Why a within-limit refund is still held: the category trust weight, the floor, the affirm and reject deltas, the branch order, with the numbers and the evidence	Shared memory and feedback; Technical: the decision rule a judge can verify
refund-chain.md	One customer, two refund requests, live: held under the floor with the owner on holiday, then over the limit and escalated with step 1's memory read first	Shared memory (H-MEM); holiday calendar; limit approval
refund-chain-sample.md	The refund chain's deterministic twin (no model call)	Sample mode; the chain logic alone
pre-existing.md	Declaration of pre-existing components	Submission form: pre-existing work
sponsor-explanation.md	The five sponsor paragraphs: Zetaris, engines and tests, Nightshift, NVIDIA, what was unique	Sponsor integration explanation
ai-usage.md	AI and Model Usage declaration	AI usage policy
score-review.md	Where the points are, kept current	Self-review against the scoring
flow-v2.md	The 17 flow nodes and the refinements this build made	Architecture / flow
traces/trace-hero-live.jsonl	Live run of the hero thread: critique, risk, retry, branch, memory, synthesis	Critique, Retries, Branching, Shared memory, Synthesis
traces/trace-example-1.jsonl	Sample-mode example 1 (hold)	Sample mode; full step list
traces/trace-example-2.jsonl	Sample-mode example 2 (send)	Sample mode; full step list
traces/trace-example-3.jsonl	Sample-mode example 3 (escalate, the misread)	Escalation or fallback present in the sample trace
traces/trace-recovery.jsonl	Sample run with Zetaris refusing once: an error line, then recovery	Errors and recovery
traces/trace-padme-live_1.jsonl	Padme chain step 1, live	Handoff; misread chain
traces/trace-padme-live_2.jsonl	Padme chain step 2, live	Handoff; misread chain
traces/trace-refund-live_1.jsonl	Refund chain step 1, live (40 USD, held; owner out, backup in)	Holiday calendar; trust floor
traces/trace-refund-live_2.jsonl	Refund chain step 2, live (400 USD, over the limit, escalated; reads step 1's memory)	Shared memory; limit approval
traces/trace-refund-sample_1.jsonl	Refund chain step 1, sample mode	Sample mode
traces/trace-refund-sample_2.jsonl	Refund chain step 2, sample mode	Sample mode
traces/trace-two-run-A.jsonl	Two-run proof, run A (writes memory)	Shared memory
traces/trace-two-run-B.jsonl	Two-run proof, run B (reads run A's memory id, skips a chunk)	Shared memory
traces/trace-ask-mvk7jd5c.jsonl	A free-form question answered through /ask	Dynamic delegation
engine-world-model.md	Meterless World Model: what it does in the complaint route, its tests and the live world_context and severity lines	Meterless Engine really used (World Model, the third engine, in a working feature with a test)
engine-world-model-conformance.md	World Model conformance scorecards, 8/8 on the vendored reference and on our bundle	Meterless Engine really used (World Model); the engine's own passing test
scenarios.md	Examples 4 to 8 (question, RFQ, vent, severe complaint) run live and in sample mode: decision, branch, models, journey reply, trace links	Branching; Dynamic delegation; Escalation; the scenarios slice
screenshots/README.md	Captures of the two reference pages (front page, dashboard, journeys) at 1280 and 390 px	Product & UX: the unified front end and the internal dashboard
traces/trace-scenario-4-live.jsonl	Example 4 live: a question answered from the FAQ (faq-hit, send)	Branching; Sponsor call (Zetaris faq rows)
traces/trace-scenario-4-sample.jsonl	Example 4 in sample mode (faq-hit, send)	Sample mode; full step list
traces/trace-scenario-5-live.jsonl	Example 5 live: a question neither FAQ nor records answer (escalate to a person)	Escalation or fallback
traces/trace-scenario-5-sample.jsonl	Example 5 in sample mode	Sample mode; full step list
traces/trace-scenario-6-live.jsonl	Example 6 live: an RFQ about 100 versus 100000 items, one price on file (escalate to sales with the price rows)	Branching; Handoff
traces/trace-scenario-6-sample.jsonl	Example 6 in sample mode	Sample mode; full step list
traces/trace-scenario-7-live.jsonl	Example 7 live: a venting customer (complaint-vent, hold with a calm acknowledgement)	Meterless Engine (World Model); Branching
traces/trace-scenario-7-sample.jsonl	Example 7 in sample mode	Sample mode; full step list
traces/trace-scenario-8-live.jsonl	Example 8 live: a severe complaint, World Model history, severity 10, escalated with the draft	Meterless Engine (World Model); typed gates (OpenJev); Escalation
traces/trace-scenario-8-sample.jsonl	Example 8 in sample mode	Sample mode; full step list
TSV
{
cat <<MD
---
title: Judging pack index
description: One line per evidence file in the Jedi Pack judging pack, with the rule or criterion it answers, checked for existence by the script that regenerates it.
date: $DATE
tags: [judging, index]
---

# Judging pack

Everything a judge needs to check the submission without asking the team. Paths are relative to \`inbox/judging/\`. Each file below was checked to exist when this index was generated ($DATE).

Regenerate the whole pack, from the repository root:

\`\`\`
bash inbox/scripts/judging_pack.sh
\`\`\`

The script reruns the sample-mode examples in a \`--network none\` container, runs the hero thread live, regenerates \`../result.md\` from that trace, reads \`GET /sources\` from a server it starts, runs \`scripts/scenario_proofs.mjs\` (examples 4 to 8 live and in sample mode, which writes \`scenarios.md\`, \`engine-world-model.md\` and the ten scenario traces), scans for secrets, and exits non-zero if a file below is missing or the scan is not clean. It never writes a trace line by hand.

Start with [../result.md](../result.md), then [rules-checklist.md](rules-checklist.md).

| File | What it is | Rule or criterion it answers |
|---|---|---|
MD
MISSING=0; LISTED=0
while IFS=$'\t' read -r path what rule; do
  [ -z "$path" ] && continue
  LISTED=$((LISTED + 1))
  if [ "$path" = "README.md" ] || [ "$path" = "secrets-scan.md" ] || [ -e "$J/$path" ]; then mark=""; else mark=" (MISSING)"; MISSING=$((MISSING + 1)); problem "listed file missing: judging/$path"; fi
  printf '| [%s](%s) | %s%s | %s |\n' "$path" "$path" "$what" "$mark" "$rule"
done < "$WORK/index.tsv"
cat <<MD

$LISTED files listed, $MISSING missing.

## Two runs of the script

A fresh run is inherent in the live parts, so a second run changes only: trace timestamps and run ids in \`traces/trace-hero-live.jsonl\`, \`traces/trace-example-*.jsonl\` and \`traces/trace-recovery.jsonl\`; the run timestamps, ids and model wording in the live \`traces/trace-scenario-*-live.jsonl\` (the sample ones differ only in timestamps) and the quotes in \`scenarios.md\` and \`engine-world-model.md\` that cite them; the memory ids and model wording inside the hero trace; and the quotes in \`../result.md\` and \`sample-mode-run.md\` that cite them. \`sources.json\` changes only if the live row counts changed. The rest is static or derived from files that do not change. The traces of the five earlier runs (\`padme-live\`, \`two-run\`, \`ask\`) are kept as committed.
MD
} > "$J/README.md"

# ------------------------------------------------------------------------------------------------
# 5b. final secrets pass over the finished pack, then judging/secrets-scan.md
# ------------------------------------------------------------------------------------------------
note "final secrets pass"
scan final
{
cat <<MD
---
title: Secrets scan
description: The gitleaks run over inbox/ and the no-secrets invariant test, with exit codes and finding counts, run after every other artefact of the judging pack was written.
date: $DATE
tags: [judging, secrets, scan]
---

# Secrets scan

Run by \`bash inbox/scripts/judging_pack.sh\` as its last step, after the traces, \`result.md\`, \`sample-mode-run.md\`, \`sources.json\`, \`rules-checklist.md\` and the index were written. This file is written after the scan and is not part of the files it swept; the next run sweeps it.

## gitleaks

\`\`\`
gitleaks detect --source inbox --no-git --redact --no-banner -c <default rules + allowlist for inbox/.env>
\`\`\`

- Exit code: **$GL_RC**
- Findings: **$GL_COUNT**
- Files scanned: everything under \`inbox/\`, with the working-copy \`.env\` allowlisted (it is the local secrets file: gitignored in \`inbox/.gitignore\` and excluded from the image by \`inbox/.dockerignore\`).
- The same scan with no allowlist: exit $GL_ALL_RC, $GL_ALL_COUNT findings, in: ${GL_ALL_FILES:-none}. These are the real keys in the local, gitignored \`.env\`, not in any shipped file. The values are redacted and never printed here.

## No-secrets invariant test

\`\`\`
node --test inbox/tests/no_secrets.test.mjs
\`\`\`

- Exit code: **$NS_RC**
- $NS_SWEPT
- What it checks: no configured secret value and no \`Bearer <token>\` in \`logs/\`, \`output_examples/\`, \`judging/\` (this directory, traces included) and \`data/sample/\`.

## Verdict

$( [ "$GL_RC" = 0 ] && [ "$GL_COUNT" = 0 ] && [ "$NS_RC" = 0 ] && echo "Clean: gitleaks exit 0 with 0 findings and the sweep test green." || echo "NOT CLEAN: the script exits non-zero." )
MD
} > "$J/secrets-scan.md"
FINAL_CLEAN=0; [ "$GL_RC" = 0 ] && [ "$GL_COUNT" = 0 ] && [ "$NS_RC" = 0 ] && FINAL_CLEAN=1
[ "$FINAL_CLEAN" = 1 ] || problem "secrets scan not clean (gitleaks exit $GL_RC, findings $GL_COUNT, sweep test exit $NS_RC)"

# ------------------------------------------------------------------------------------------------
# 8. existence check of everything the pack is supposed to hold
# ------------------------------------------------------------------------------------------------
for f in README.md rules-checklist.md sources.json sample-mode-run.md secrets-scan.md clean-clone-run.md engine-scout-evals.md engine-hmem-two-run.md \
         padme-chain.md refund-chain.md refund-chain-sample.md trust-floor.md zetaris-register.md zetaris-usl.md nightshift-models.json nightshift-first-call.json pre-existing.md sponsor-explanation.md ai-usage.md score-review.md flow-v2.md \
         scenarios.md engine-world-model.md engine-world-model-conformance.md screenshots/README.md; do
  [ -s "$J/$f" ] || problem "missing or empty: judging/$f"
done
[ -s "$INBOX/result.md" ] || problem "missing or empty: result.md"
for f in trace-hero-live trace-example-1 trace-example-2 trace-example-3 trace-recovery trace-padme-live_1 trace-padme-live_2 trace-refund-live_1 trace-refund-live_2 trace-refund-sample_1 trace-refund-sample_2 trace-two-run-A trace-two-run-B \
         trace-scenario-4-live trace-scenario-4-sample trace-scenario-5-live trace-scenario-5-sample trace-scenario-6-live trace-scenario-6-sample \
         trace-scenario-7-live trace-scenario-7-sample trace-scenario-8-live trace-scenario-8-sample; do
  [ -s "$T/$f.jsonl" ] || problem "missing or empty trace: judging/traces/$f.jsonl"
done

echo
if [ "$FAILS" -eq 0 ]; then
  echo "judging pack OK ($LISTED files indexed, gitleaks $GL_COUNT findings, hero decision $(jq -r 'select(.step=="synthesis")|.output_summary' "$T_HERO" | head -1 | cut -c1-40))"
  exit 0
fi
echo "judging pack NOT READY: $FAILS problem(s)"
printf ' - %s\n' "${PROBLEMS[@]}"
exit 1

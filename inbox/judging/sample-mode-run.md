---
title: Sample-mode run, no network
description: The three input examples and the recovery pair run inside a container started with no network, with the decision, status and the escalate_or_fallback line of each trace.
date: 2026-10-23
tags: [judging, sample-mode, docker]
---

# Sample-mode run

Sample mode answers from the bundled data with no Zetaris, Nightshift or network. The container below has `--network none`, so a request that tried to leave it would fail.

```
docker run -d --network none -e SAMPLE_MODE=true oah-inbox
docker exec <container> node src/cli.mjs run --example N      # N = 1, 2, 3
```

Image: `oah-inbox` (abb2a7c587cc). Examples are in `input_examples/`; each is posted by `docker exec` because a `--network none` container has no reachable port. The container was removed afterwards (containers of this image left on the host: 0). The traces were copied out with `docker cp` into [traces/](traces/trace-example-1.jsonl).

| example | thread | run_id | exit | status | decision | execution_time_seconds | trace |
|---|---|---|---|---|---|---|---|
| 1 | T02 | example-1 | 0 | success | hold | 0.015 | [trace-example-1.jsonl](traces/trace-example-1.jsonl) (25 lines) |
| 2 | T18 | example-2 | 0 | success | send | 0.019 | [trace-example-2.jsonl](traces/trace-example-2.jsonl) (27 lines) |
| 3 | T01 | example-3 | 0 | success | escalate | 0.019 | [trace-example-3.jsonl](traces/trace-example-3.jsonl) (26 lines) |

## Per-example detail

### Example 1

Reasons: refund weight 0.55 is under the floor 0.8; owner 15 out, backup 16 in. Both critics passed; the reply waits for backup 16 with the draft attached

Cited rows: threads_parquet:T02, policy:refund, holiday_2026:15@2026-10-22, holiday_2026:16@2026-10-22, employees:15, employees:16, trust_ledger:refund, wiki_what_may_leave

Step and status of every trace line:

```
memory.read x1  success
planner.plan x1  success
delegate x1  success
zetaris.query x10  success
executor.act x1  success
meterless.engine x1  success
branch x1  success
nvidia.model x2  skipped
critique x1  success
risk.signoff x1  success
retry x1  skipped
escalate_or_fallback x1  skipped
memory.write x1  success
recovery x1  skipped
synthesis x1  success
```

nvidia.model lines (sample mode skips the model, and the line says why):

```
{"step":"nvidia.model","status":"skipped","output_summary":"sample mode, OpenJev not called; code rules: is_follow_up 0.1; category refund (0.5); urgency 2; tone 2; asks_for_money 0.9"}
{"step":"nvidia.model","status":"skipped","output_summary":"sample mode: rules drafter, no model call"}
```

escalate_or_fallback line (line 22 of the trace):

```json
{"timestamp":"2026-10-23T11:16:58Z","run_id":"example-1","step":"escalate_or_fallback","status":"skipped","output_summary":"gate not reached"}
```

### Example 2

Reasons: both critics passed on round 1; weight 0.84 meets the floor 0.8, within the limit, someone is available

Cited rows: threads_parquet:T18, policy:refund, responsibility:fallback, holiday_2026:15@2026-10-22, holiday_2026:16@2026-10-22, employees:15, employees:16, trust_ledger:appreciation, wiki_what_may_leave

Step and status of every trace line:

```
memory.read x1  success
planner.plan x1  success
delegate x1  success
zetaris.query x12  success
executor.act x1  success
meterless.engine x1  success
branch x1  success
nvidia.model x2  skipped
critique x1  success
risk.signoff x1  success
retry x1  skipped
escalate_or_fallback x1  skipped
memory.write x1  success
recovery x1  skipped
synthesis x1  success
```

nvidia.model lines (sample mode skips the model, and the line says why):

```
{"step":"nvidia.model","status":"skipped","output_summary":"sample mode, OpenJev not called; code rules: is_follow_up 0.1; category question (0.5); urgency 2; tone 2; asks_for_money 0.1"}
{"step":"nvidia.model","status":"skipped","output_summary":"sample mode: rules drafter, no model call"}
```

escalate_or_fallback line (line 24 of the trace):

```json
{"timestamp":"2026-10-23T11:16:58Z","run_id":"example-2","step":"escalate_or_fallback","status":"skipped","output_summary":"gate not reached"}
```

### Example 3

Reasons: misread: the customer says the reply "refund" misread the ask; You misunderstood me. I did not ask for my money back. The saber arrived cracked and I asked you to replace it. Your reply says a refund is

Cited rows: threads_parquet:T01, policy:refund, holiday_2026:8@2026-10-22, holiday_2026:9@2026-10-22, employees:8, employees:9, wiki_what_may_leave

Step and status of every trace line:

```
memory.read x1  success
planner.plan x1  success
delegate x1  success
zetaris.query x11  success
executor.act x1  success
meterless.engine x1  success
branch x1  success
nvidia.model x2  skipped
critique x1  needs_revision
risk.signoff x1  refused
retry x1  skipped
escalate_or_fallback x1  success
memory.write x1  success
recovery x1  skipped
synthesis x1  success
```

nvidia.model lines (sample mode skips the model, and the line says why):

```
{"step":"nvidia.model","status":"skipped","output_summary":"sample mode, OpenJev not called; code rules: is_follow_up 0.9; category refund (0.5); urgency 2; tone 2; asks_for_money 0.9"}
{"step":"nvidia.model","status":"skipped","output_summary":"gate not reached"}
```

escalate_or_fallback line (line 23 of the trace):

```json
{"timestamp":"2026-10-23T11:16:58Z","run_id":"example-3","step":"escalate_or_fallback","status":"success","output_summary":"escalated to owner 8 / backup 9; both critiques stored in /app/data/memory/queue/T01.json"}
```

## Which trace carries a reached escalate_or_fallback

- example 1: status skipped
- example 2: status skipped
- example 3: status success

The methodology asks that the sample-mode trace contain an `escalate_or_fallback` line. Every example trace carries one; only the one with status `success` is a reached gate, the others are logged as `skipped` ("gate not reached") so no required step is missing.

## Recovery pair

```
docker run -d --network none -e SAMPLE_MODE=true -e FAULT_ZETARIS_REFUSE_ONCE=true oah-inbox
docker exec <container> node src/cli.mjs run --thread T02 --run-id demo-recovery
```

Status `success`, decision `hold`, trace [trace-recovery.jsonl](traces/trace-recovery.jsonl):

```json
{"timestamp":"2026-10-23T11:17:00Z","run_id":"demo-recovery","step":"zetaris.query","status":"error","output_summary":"UpstreamRefused: zetaris: connection failed (ECONNREFUSED)"}
{"timestamp":"2026-10-23T11:17:00Z","run_id":"demo-recovery","step":"recovery","status":"success","output_summary":"Zetaris refused once; answered from the cached rows"}
```

Regenerate with `bash inbox/scripts/judging_pack.sh`.

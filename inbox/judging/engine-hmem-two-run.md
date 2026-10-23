---
title: H-MEM two-run proof
description: Two runs of ticket T02 on one empty memory folder; the second run reads the memory the first wrote and its plan says it reused that context.
date: 2026-10-23
tags: [judging, meterless, hmem]
---

# H-MEM two-run proof

Command: `node inbox/scripts/two_run_proof.mjs` (runs `two-run-A` and `two-run-B`, thread `T02`, fresh empty memory folder `data/memory/two-run/`).

- Run time (Europe/Brussels): 2026-10-23 04:17:44
- Mode: live (Zetaris, OpenJev, Nightshift)
- Model ids seen: `openjev-0.1 (openjev-0.1)`, `nvidia/nemotron-3.5-lightning-30b-a3b`
- Run A took 66 s, run B 49.9 s. Decisions: A `hold`, B `hold`.
- Checks: PASS A memory.read is cold; PASS A memory.write wrote an id; PASS B memory.read lists an id from A's memory.write; PASS B planner.plan says it reused the recalled context; PASS B lines carry memory_ids citing A's id; PASS both decisions are hold

## The four lines

### A memory.read (cold)

- file line: 1 of `judging/traces/trace-two-run-A.jsonl`
- `run_id`: two-run-A
- `step`: memory.read
- `timestamp`: 2026-10-23T02:15:49Z
- `output_summary`: empty (cold first run)
- `memory_ids`: []

### A memory.write

- file line: 35 of `judging/traces/trace-two-run-A.jsonl`
- `run_id`: two-run-A
- `step`: memory.write
- `timestamp`: 2026-10-23T02:16:54Z
- `output_summary`: wrote mem-1 from two-run-A
- `memory_ids`: ["mem-1"]
- written id: `mem-1`

### B memory.read (the same id comes back)

- file line: 1 of `judging/traces/trace-two-run-B.jsonl`
- `run_id`: two-run-B
- `step`: memory.read
- `timestamp`: 2026-10-23T02:16:55Z
- `output_summary`: 1 memories: mem-1 (T02 hold: Lira Venn refund. refund weight 0.55 is under the floor 0.8;)
- `memory_ids`: ["mem-1"]

### B planner.plan (reuses the recalled context)

- file line: 2 of `judging/traces/trace-two-run-B.jsonl`
- `run_id`: two-run-B
- `step`: planner.plan
- `timestamp`: 2026-10-23T02:16:55Z
- `output_summary`: branches: reply-now vs hold-or-escalate; selected hold-or-escalate (under-floor: refund weight 0.55 is under the floor 0.8; owner 15 out, backup 16 in; memory consulted). memory ids: mem-1. Memory mem-1 recalls this customer from an earlier run: the planner reused its decision context and re-read the rows through Zetaris (amount 40 vs limit 150)
- `memory_ids`: ["mem-1"]

## What it shows

Run B read memory `mem-1`, which run A wrote, and its plan says it reused that context; the rows were re-read through Zetaris and the amount re-checked, which is what the code does.

Honest note: H-MEM here uses lexical retrieval (no embedder). The facts rows are still re-read from Zetaris in one call; what the memory saves is the planner re-deriving them.

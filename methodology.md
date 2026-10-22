---
title: "Methodology"
description: "This is the method for the one round. It is not the product. Clocks, files, and gates stay in READ_FIRST.md. Safety stays in AGENTS.md."
date: "2026-10-22"
tags: [methodology, track-3]
---

# Methodology

This is the method for the one round. It is not the product.
Clocks, files, and gates stay in `READ_FIRST.md`. Safety stays in `AGENTS.md`.
Current proposal, until the group keeps or drops it: `kristof/jedi-pack-inbox.md` (Track 3, Reasoning Architecture).

Engines on disk: `/Users/McEinh/code/meterless` at commit `1742dec`.
Model calls go through Nightshift when the hotspot is up (`http://127.0.0.1:8088/v1`). An agent does not install an app, sign up, or create a key. Kristof does that himself.

The build window opened Thu 22 Oct 2026 00:00 UTC. Product code is allowed. Secrets are not.

## Where the pieces sit

| Piece | Where it sits |
|---|---|
| H-MEM | `remember`, `ask`, `audit`. Every run reads memory before it plans, and writes what the next run can cite. |
| Scout Intent | In front of every action. Classifies the request, checks risk, and signs the execution contract. Nothing else runs until that contract exists. |
| World Model | Shared state of the ticket, the claim, and the work. Every step reads it and writes back. |
| Markovian | Long work is chunks with a short carryover. Chunk zero is seeded from H-MEM. The chunk writes what it learned back to H-MEM. A second run of the same task finishes in fewer chunks. |
| Nightshift | The model route for NVIDIA Nemotron. Sample mode still logs the call with `status: skipped` and the reason. |
| Gaia | Web workspace on this Mac. The product uses the World Model engine. It does not import the Gaia app. |
| Relay | The operator loop: describe, plan, stop before anything consequential, verify, then replay a saved method with no model call. The Windows app is not a judge dependency. |
| Swarm | Not in the first build. A claim row in world state is what later workers would use. |
| IMPLEMENT | Prompt-library group. Cursor builds an engine from its spec. Done when the conformance checks pass. Not a runtime agent. |
| POWER | Prompt-library group. Nightshift is the model provider. Draft and evaluator calls go through it. |
| HARDEN | Prompt-library group. Scout's injection guard on untrusted input, before the reply loop. The trust ledger is the weight table that audit ships. |

The five prompt-library groups are Ideate, Implement, Combine, Harden, and Power (`docs/agent-ready/prompt-library.md` in `/Users/McEinh/code/meterless`, full set at meterless.ai/engines.html). They are Meterless concepts. They are not extra engines beside H-MEM, World Model, Markovian, and Scout.

A Meterless run has used the stack when each of these has happened once, and each has a log line:

1. Scout signs the contract, or refuses the request.
2. H-MEM is asked before the first chunk.
3. World Model holds the task state the chunks read.
4. Markovian finishes the chunks and writes back to H-MEM.
5. A second run of the same task uses that memory and takes fewer chunks.
6. `audit` shows the memory ids.
7. The trace file contains those ids.

## Who builds

`PLANNER`, `IDEATOR`, `RISK`, and `EVALUATOR` do not build the product.
`EXECUTOR-1`, `EXECUTOR-2`, and `EXECUTOR-3` build. Swarm runs those three drafts. Do not spawn them by hand.
There is no safety-net builder in this round.

## What judges score from the log

Sources, current copy: `inputdocs/023-technical-execution-requirements.md` section 8, `inputdocs/024-submission-requirements.md` sections 3.3 and 8, `inputdocs/063-weak-submission-examples.md`, `inputdocs/065-strong-submission-examples.md`, and the Check and Hand-in sections of `READ_FIRST.md`.

A judge should be able to reconstruct the run from `logs/` without asking the team. The demo video, the slide deck, and `result.md` cite these lines. They do not retell the run from memory.

Write every event twice:

- one JSON object per line in `logs/trace-<run_id>.jsonl`
- the same event on stdout, as `[INFO] run_id=<run_id> <agent_name> <action>: <output_summary>`

The API response includes `trace_id`, `log_file`, and `execution_time_seconds`.

### Line shape

Official fields stay. The extra fields are how a check finds the judge steps.

```json
{
  "timestamp": "2026-10-22T03:16:00Z",
  "run_id": "demo-001",
  "trace_id": "demo-001",
  "step": "critique",
  "agent_name": "Evaluator",
  "action": "critique_draft",
  "input_summary": "Draft cites policy row 4 and holiday row 18.",
  "output_summary": "Fail. The draft promises a refund above the limit in policy row 4.",
  "target_agent": "Planner",
  "confidence": 0.41,
  "retry_count": 1,
  "status": "needs_revision",
  "branch_id": "over-limit",
  "memory_ids": ["mem-14"],
  "sponsor": "zetaris"
}
```

`step` is one of the ids in the table below. `sponsor` is `zetaris`, `meterless`, `nvidia`, or omitted. `memory_ids` is an array of ids a later line can cite. Summaries stay short. A line never contains a key, a token, or a secret. Mask any that appear, including inside a model error.

`status` is `success`, `needs_revision`, `retrying`, `error`, `incomplete`, `skipped`, or `refused`.

### Required steps

The trace the demo cites contains every row except `recovery`. The submitted set also contains one `recovery` line, in that trace or in a second trace the result file names. A missing row means the run is unfinished.

| `step` | What the line shows | Judge requirement |
|---|---|---|
| `memory.read` | Ids asked from H-MEM before planning. An empty list is allowed only on a cold first run, and the summary says empty. | Shared memory. Handoff chapters can cite the ids. |
| `planner.plan` | At least two branches, and which one the situation selects. | Planner. Dynamic delegation. Not a fixed pipeline. |
| `delegate` | `target_agent` chosen from the branch. | Handoff. Specialised roles. |
| `executor.act` | A tool result: row ids, counts, or an error. The executor does not invent facts. | Executor did the work. |
| `zetaris.query` | Sources, the question the SQL answered, and the row ids returned. `sponsor` is `zetaris`. | Sponsor call a judge can see. |
| `meterless.engine` | Which engine, and the contract id or memory id it produced. `sponsor` is `meterless`. | Meterless has a real role. |
| `nvidia.model` | Model id and purpose, draft or critique. In sample mode, `status` is `skipped` and the summary says why. `sponsor` is `nvidia`. | Where NVIDIA contributes. No key. |
| `branch` | `branch_id` and why this branch, not another. | Branching. |
| `critique` | Evaluator, item 15. Pass or fail, and one sentence the planner can apply. One line per round. | Critique and validation. |
| `risk.signoff` | Risk, item 17. Scout's risk check, the policy gate in the guard. Sign-off or refusal on the same draft, and one sentence. One line per round. Code, not a model call. | Risk before an autonomous send. |
| `retry` | A negative round that has not hit the gate. `retry_count` is higher than the previous round. The summary names what both critics said and what the next draft must change. | Retries. The loop is still running. |
| `escalate_or_fallback` | The escalate gate, item 18. H-MEM `queueForHuman`. Two negative rounds, or a hard fact Risk cannot rewrite. The summary names the ticket file that now holds both critiques. | Escalation or fallback. |
| `memory.write` | Ids written, and the `run_id` they came from. | Shared memory a second run can read. |
| `synthesis` | The decision, the cited row ids, and `log_file`. | Final synthesis. The trace of how the output was reached. |
| `recovery` | The line after a `status` of `error` or `incomplete`. It says what happened next, and its own `status` is `success`. The Jedi Pack samples are two pairs, both `error` then `recovery`: `demo-recovery` is Zetaris refusing port 8888 once, then the fixture rows; `demo-misread` is Padmé's reply that the agent promised a refund she did not ask for, then the ticket reopens and `queueForHuman` fires. | Errors and recovery. |

Order in the demo trace:

1. `memory.read`
2. `planner.plan`
3. `delegate`
4. `executor.act` and `zetaris.query`
5. `meterless.engine` for the contract or the memory
6. `branch`
7. `nvidia.model` for the draft, unless sample mode skips it
8. `critique` and `risk.signoff` on that draft. At least one of them has `status` `needs_revision`. That is negative round 1.
9. `retry`, then a second `planner.plan` and a revised draft
10. `critique` and `risk.signoff` again. Both `success` means the loop exited as correct. If either fails, that is negative round 2: `escalate_or_fallback`, and the line names the ticket file that stores both feedbacks. No third draft.
11. `memory.write`
12. `synthesis`

That order is the reply loop. It runs until both critics pass on the same round, or until the escalate gate at 2 negative rounds. A line that only says the run finished does not count. A hard Risk refusal (amount over the policy row, a fact that may not leave, owner and backup both out) is the gate on the round it happens. The trace does not invent a rewrite for it.

The second submitted run reads a `memory_id` the first run wrote, and its `planner.plan` summary says which chunk it skipped. That is the shared-memory proof.

### Result file

`EVALUATOR` writes `result.md` in this order, each chapter quoting `run_id`, `step`, and `timestamp` from the log:

1. Critique, from `critique` and `risk.signoff`, one pair per round
2. Retries, from `retry`, ending at a pass or at the escalate gate
3. Branching, from `branch`
4. Shared memory, from `memory.read` and `memory.write`
5. Trace of how the output was reached, from `synthesis` and the path `logs/trace-<run_id>.jsonl`

A chapter is ready when those lines exist. A chapter that would say "none" means the run is not ready to hand in. Point-losers in `READ_FIRST.md` section 7 are the absence of these lines.

### Submission checklist this log supports

From `inputdocs/024-submission-requirements.md`:

- Logs show how the agent reached its output.
- At least three sample inputs in `input_examples/` and matching outputs in `output_examples/`, each with its `log_file`.
- `SAMPLE_MODE=true` runs with no network and still writes the trace, including `nvidia.model` as `skipped` and `escalate_or_fallback` for the sample path.
- Sponsor explanation names Zetaris, Meterless, Cursor, and NVIDIA. Cursor is how the project was built. It is not a runtime log line. The other three are the `sponsor` values above.
- No key in the log, the video, or the deck.

## Reference commands

From `/Users/McEinh/code/meterless`. These are the repo's first steps, not the assignment.

```bash
npx tsx examples/memory-compounding-research/index.ts
npx degit meterless/meterless/templates/agentathon-starter my-agent
cd my-agent && npm install && npm run setup
npx tsx notebook.ts seed
npx tsx notebook.ts ask "what did we decide about storage"
```

Then add Scout Intent and Markovian on top of that starter, then World Model. Keep the H-MEM wiring. The conformance suite for each engine is the bar. Do not scaffold that starter into this folder as the product.

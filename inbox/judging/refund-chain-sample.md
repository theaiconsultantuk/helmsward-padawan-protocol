---
title: Refund chain, one customer twice (sample)
description: Cass Holm asks for a refund under the limit while the owner is on holiday, then for one over the limit; the second step reads the first step's memory before it is escalated for approval.
date: 2026-10-23
tags: [judging, demo, hmem, holiday]
---

# Refund chain, one customer twice (sample)

Command: `node inbox/scripts/refund_chain.mjs --sample` (run `refund-sample`, steps `refund-sample_1` and `refund-sample_2`, own memory folder `data/memory/chains/refund-sample`).

**Outcome: the chain behaves as the storyboard tells it.** Checks: step 1 held under the floor yes; step 1's owner out and backup in yes; step 2 over the limit, escalated for an amount approval yes; step 2 read step 1's memory yes.

## The two steps

Customer: Cass Holm (`cass.holm@example.com`), channel `contact-form`, scenario declared `refund`.

| | Step 1 | Step 2 |
|---|---|---|
| message | I would like a refund of 40 USD for order JP-1187. The case arrived damaged. | I want a refund of 400 USD for order JP-1190. The case never arrived. |
| as_of (holidays read for this day) | 2026-10-22 | 2026-10-27 |
| branch | under-floor | over-limit |
| branch line, why | refund weight 0.55 is under the floor 0.8; owner 15 out, backup 16 in | amount 400 USD is over the 150 USD policy limit |
| employees read (Zetaris) | 1 rows: employees:15; 1 rows: employees:16 | 1 rows: employees:3; 1 rows: employees:4 |
| decision | hold | escalate |
| risk.signoff | success: Signed off. | refused: Refused: amount 400 USD is over the 150 USD limit: needs approval by Caleb Orth (policy over-limit owner) |
| escalate_or_fallback | skipped: gate not reached | success: escalated to Caleb Orth (employee 3) for approval of 400 USD over the 150 USD limit; the draft is attached for approval; draft and both critiques stored in /opt/glitch/workspaces/open-agent-hackathon-2026--scenarios/inbox/data/memory/chains/refund-sample/queue |
| approval | none | 400 USD over the 150 USD limit, approver Caleb Orth (employee 3) |
| draft promises | `{"refund_amount":null,"replacement":false,"other":null}` | `{"refund_amount":null,"replacement":false,"other":null}` |
| memory read | none | mem-1 |
| memory.read line | empty (cold first run) | 1 memories: mem-1 (F83 hold: Cass Holm refund. refund weight 0.55 is under the floor 0.8;) |
| memory written | mem-1 | mem-2, mem-3 |

Memory ids carried from step 1 into step 2: mem-1.

Model ids used (non-skipped lines): sample/rules.

## What a judge sees here

- A refund never goes out on its own: the refund category's trust weight (0.55) is under the floor (0.8), so step 1 is held for a person even though 40 USD is under the limit. The weight is not the amount: it is the category's earned trust, +0.05 per affirmed decision and -0.05 per rejected one; five affirms take refund to the floor. The rule, the branch order and the numbers: [trust-floor.md](trust-floor.md).
- The holiday calendar is read from Zetaris for the day of the message: on 22 Oct the under-limit owner is out and the backup is in; the branch line names both.
- Over the limit, the draft is refused by Risk and the ticket goes to the policy's over-limit approver with the draft attached; nothing is sent.
- The second step reads the first step's H-MEM memory before planning, so the approver's context names the earlier request. The memory carries the loop's decision, not a human verdict: a human affirms or rejects a decision through `POST /feedback`, which moves the category's trust weight in the Zetaris decisions table.

## Traces side by side (step, status, model)

| line | refund-sample_1 | refund-sample_2 |
|---|---|---|
| 1 | memory.read success | memory.read success |
| 2 | planner.plan success | planner.plan success |
| 3 | delegate success | delegate success |
| 4 | zetaris.query success | zetaris.query success |
| 5 | zetaris.query success | zetaris.query success |
| 6 | zetaris.query success | zetaris.query success |
| 7 | zetaris.query success | zetaris.query success |
| 8 | zetaris.query success | zetaris.query success |
| 9 | zetaris.query success | zetaris.query success |
| 10 | zetaris.query success | zetaris.query success |
| 11 | zetaris.query success | zetaris.query success |
| 12 | zetaris.query success | zetaris.query success |
| 13 | executor.act success | executor.act success |
| 14 | meterless.engine success | meterless.engine success |
| 15 | branch success | branch success |
| 16 | nvidia.model skipped [sample/rules] | nvidia.model skipped [sample/rules] |
| 17 | nvidia.model skipped [sample/rules] | nvidia.model skipped [sample/rules] |
| 18 | critique success [sample/rules] | critique success [sample/rules] |
| 19 | risk.signoff success | risk.signoff refused |
| 20 | retry skipped | retry skipped |
| 21 | escalate_or_fallback skipped | escalate_or_fallback success |
| 22 | memory.write success | memory.write success |
| 23 | recovery skipped | recovery skipped |
| 24 | synthesis success | synthesis success |

## Honesty

This run is the sample twin: the deterministic rules drafter stands in for the model, so it proves the chain logic (floor, holiday, limit, memory), not the model's behaviour.

Traces: `judging/traces/trace-refund-sample_1.jsonl` and `judging/traces/trace-refund-sample_2.jsonl` (copied from `logs/` as the loop wrote them).

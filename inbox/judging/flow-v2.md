---
title: Flow v2
description: Kristof's 17 flow nodes mapped to the trace steps and code of the Jedi Pack inbox, with the three refinements this build made.
date: 2026-10-23
tags: [judging, flow, architecture]
---

# Flow v2

The design is Kristof's flow ([../../kristof/flow.html](../../kristof/flow.html)): 17 nodes. The code logs 15 trace step ids ([../../methodology.md](../../methodology.md)). Several nodes share a step id, and two have no step of their own. The flow is the design; the trace is what ran.

| # | Flow node | Trace step id(s) | Code |
|---|---|---|---|
| 1 | Intake (email, form, Trustpilot) | none. The caller names a `thread_id` (or `POST /run`); the contact-form submissions are also readable as the REST source `GET /intake`. | `src/server.mjs`, `src/cli.mjs` |
| 2 | Scout guard | `meterless.engine` (status `refused` on a risk block); on `/ask` also `synthesis` with status `refused` | `src/engines/scout/policy.mjs`, `src/loop.mjs`, `src/ask.mjs` |
| 3 | Ticket | `executor.act` (the thread and its cited rows) | `src/queries.mjs`, `src/loop.mjs` |
| 4 | Classify (thank-you or follow-up) | `branch` (ids `thank-you`, `follow-up`, `misread`, `duplicate`), after the typed gates line | `decideBranch` in `src/loop.mjs` |
| 5 | Close (pure thank-you) | `branch` `thank-you`, then `memory.write` and `synthesis`; no draft | `src/loop.mjs` |
| 6 | H-MEM read | `memory.read`, and `planner.plan` / `delegate` using what it returned | `src/engines/hmem/index.mjs`, `src/loop.mjs` |
| 7 | Scout contract | `meterless.engine` (contract verified before any model call) | `src/engines/scout/contract.mjs`, `src/loop.mjs` |
| 8 | Zetaris (holiday, policy, backup) | `zetaris.query`, `executor.act` | `src/queries.mjs`, `src/adapters/zetaris.mjs` |
| 9 | Trust floor | `branch` (id `under-floor` or `send-ok`) | `trustFloor` in `src/gates.mjs` |
| 10 | Draft (NVIDIA through Nightshift) | `nvidia.model` (`draft_reply`, `draft_revised`) | `src/adapters/nightshift.mjs`, `src/prompts.mjs`, `src/loop.mjs` |
| 11 | Evaluator | `critique` | `src/loop.mjs`, `src/prompts.mjs` |
| 12 | Risk | `risk.signoff` | `hardRisk` in `src/gates.mjs`, `src/loop.mjs` |
| 13 | Send or hold | `branch`; `risk.signoff` and `synthesis` carry the outcome. The service does not send mail. | `src/loop.mjs` |
| 14 | Escalate gate | `escalate_or_fallback`; `retry` before it on round 1, except an amount over the policy limit: Risk refuses on round 1, `retry` is skipped, and the ticket escalates to the policy's over-limit owner for approval with the draft attached | `src/loop.mjs`, `src/engines/hmem/index.mjs` (queue file) |
| 15 | Trace | every step; the file `logs/trace-<run_id>.jsonl` | `src/trace.mjs` |
| 16 | H-MEM write | `memory.write` | `src/engines/hmem/index.mjs`, `src/loop.mjs` |
| 17 | Dashboard | none in `inbox/`. The API is the interface: `GET /counters` (a live Zetaris `GROUP BY`), `GET /runs/<id>/trace`. The page is the team's. | `src/server.mjs`, `src/decisions.mjs` |

Steps a branch does not reach are still logged with status `skipped`.

## Three refinements this build made

1. **The typed-gates node.** Between the Scout contract and the branch, NVIDIA DiffusionGemma through OpenJev answers five typed questions (follow-up, category, urgency, tone, asks for money), each with a confidence. OpenJev is called directly, beside Nightshift. If it is down or answers badly, code rules answer with confidence 0.5 and the `nvidia.model` line says `gate_source: rules`. Code: `src/gates.mjs`, `src/adapters/openjev.mjs`.
2. **The /ask branch.** A plain-words question is answered from the same Zetaris facts: Scout guards first (an injection is refused with no query and no model call), the intent picks named query templates, and Nightshift phrases the answer from the rows only. Code: `src/ask.mjs`; trace: [traces/trace-ask-mvk7jd5c.jsonl](traces/trace-ask-mvk7jd5c.jsonl).
3. **The local-lane fallback.** For a draft the order is: the Nemotron route through Nightshift; Nightshift's `meterless/local` route when the primary fails; the direct local lane (LM Link, not through Nightshift) only when Nightshift itself is unreachable, disclosed by a `retry` line and no sponsor tag; then sample rules. Code: `src/adapters/nightshift.mjs`. The recorded proof of this fallback (CP7) is pending; see [score-review.md](score-review.md).

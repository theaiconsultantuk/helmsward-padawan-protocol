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
| 1 | Intake (email, form, Trustpilot) | none for a thread. The caller names a `thread_id` (or `POST /run`); the contact-form submissions are also readable as the REST source `GET /intake`. A free-text `message` becomes ticket `F<n>` first: `zetaris.query` (action `intake_publish`). | `src/server.mjs`, `src/cli.mjs`, `src/intake.mjs` |
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
| 17 | Dashboard | none (a page is not a trace step). The API is the interface: `GET /counters` (a live Zetaris `GROUP BY`), `GET /runs/<id>/trace`, `GET /runs/<id>/journey`, `GET /queue`. The reference pages `GET /` and `GET /dashboard` use only these; the team's own page can replace either. | `src/server.mjs`, `src/decisions.mjs`, `src/journey.mjs`, `public/` |

Steps a branch does not reach are still logged with status `skipped`.

## The scenario routes

The scenario slice adds one resolver and eight branch ids to nodes 4, 9 to 14. They are taken after the typed gates, in `src/scenarios.mjs`, and each rides on the existing step ids. Branch ids are what the `branch` line (step `branch`) carries.

| Node or line | Trace step id (action) | Branch ids and what it does | Code |
|---|---|---|---|
| Resolver | `planner.plan` (`route_scenario`: "scenario X (declared, scout, gates, faq, unrouted or none) → branch") | a declared `scenario` wins; otherwise Scout decides, then the typed gates (category at confidence 0.6 or above, live only), then an FAQ match; free text that fits nothing defaults to `customer-service` | `resolveScenario` in `src/scenarios.mjs`, `src/loop.mjs` |
| FAQ | `branch` (`faq-hit`), then `risk.signoff` | `faq-hit`: the FAQ row text is the reply and sends; `nvidia.model` and `critique` are `skipped` | `matchFaq` |
| Question from the records | `branch` | `question-records`: no FAQ match, the Zetaris records answer; drafted and held for the question owner. `question-unanswered`: neither; escalate to a person with a recommendation | `probeQuestion`, `actQuestion` |
| RFQ | `branch` (`rfq`), `executor.act` (price rows) | `rfq`: escalate to sales (employee 6, backup 14) with the product price rows attached and a template acknowledgement; no quote to the customer | `probeRfq`, `actRfq` |
| World Model | `meterless.engine` (`world_context`, sponsor `meterless`) | the customer's and product's history with provenance ids in `memory_ids`; on error a `recovery` line and the read goes on by text alone | `src/engines/world-model/world.mjs` |
| Reader | `nvidia.model` (`read_complaint`) | Nemotron through Nightshift: venting, or genuine. Falls to the sample twin if Nightshift is down | `probeComplaint` |
| Severity | `nvidia.model` (`severity_gate`, `gate_source` openjev or rules) | OpenJev, ten levels 1 to 10 (it accepts at most ten), severity = round(score) + 1. `complaint-severe` at 9 or above: escalate with the draft. `complaint-genuine` and `complaint-vent`: hold, differing in the recommendation and the draft | `probeComplaint`, `actComplaint` |
| Recommender | `nvidia.model` (`recommend`) | `customer-service`: a recommendation built from the candidates, the FAQ and the wiki pages, and a draft with `[[blank: …]]` markers; Risk-refused drafts are withheld and the ticket still holds for Support (employee 7, backup 15) | `probeCustomerService`, `actCustomerService` |

## The free-text road

A `POST /run` with a `message` appends the ticket row to the intake file first and publishes it to Zetaris (`intake_publish`), so every fact in the trace still comes through Zetaris. Scout and the typed gates then run silently: their lines are buffered and written at their usual positions, so the trace keeps the canonical order (memory, plan, facts, Scout, branch, gates). That buffering is disclosed, as the facts' is. If the publish fails (no docker inside the container) the row is read from the local file, the citation says `(local)` and the run goes on.

## Three refinements this build made

1. **The typed-gates node.** Between the Scout contract and the branch, NVIDIA DiffusionGemma through OpenJev answers five typed questions (follow-up, category, urgency, tone, asks for money), each with a confidence. OpenJev is called directly, beside Nightshift. If it is down or answers badly, code rules answer with confidence 0.5 and the `nvidia.model` line says `gate_source: rules`. Code: `src/gates.mjs`, `src/adapters/openjev.mjs`.
2. **The /ask branch.** A plain-words question is answered from the same Zetaris facts: Scout guards first (an injection is refused with no query and no model call), the intent picks named query templates, and Nightshift phrases the answer from the rows only. Code: `src/ask.mjs`; trace: [traces/trace-ask-mvk7jd5c.jsonl](traces/trace-ask-mvk7jd5c.jsonl).
3. **The local-lane fallback.** For a draft the order is: the Nemotron route through Nightshift; Nightshift's `meterless/local` route when the primary fails; the direct local lane (LM Link, not through Nightshift) only when Nightshift itself is unreachable, disclosed by a `retry` line and no sponsor tag; then sample rules. Code: `src/adapters/nightshift.mjs`. The recorded proof of this fallback (CP7) is pending; see [score-review.md](score-review.md).

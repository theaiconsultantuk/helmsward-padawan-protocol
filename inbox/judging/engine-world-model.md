---
title: Meterless World Model engine
description: What the Meterless World Model does in the Jedi Pack inbox, the complaint route it powers, its tests and the live trace with the world_context line.
date: 2026-10-25
tags: [judging, meterless, world-model]
---

# Meterless World Model in the Jedi Pack inbox

## What it does in the product

The engine is Meterless `engines/world-model` (Apache-2.0), committed as a built bundle under `src/engines/world-model/`. The product builds one World Model per process from three Zetaris-backed templates (`world_threads`, `products`, `reviews`), in memory by default. It holds the customer and product history behind a complaint:

- entities keyed by stable id: a customer by email, a product by product id, so the same person under two spellings is one entity
- thread and mention contexts: the earlier threads a customer sent and the products a message mentions
- count facts: earlier threads, earlier complaints, whether a complaint was public, complaints per product
- a provenance id on every context, so each statement the route reads can be traced to the row it came from (a write without provenance is rejected, which the conformance runner checks)

## The feature it powers: the complaint route

A message declared or classified as a complaint makes the loop ask the World Model for the customer's and product's history. That context (one `world_context` trace line, sponsor `meterless`, with the cited ids in `memory_ids`) feeds two reads. Nemotron reads the complaint with the record and decides whether the customer is venting or has a genuine complaint. OpenJev then scores the severity. A repeat customer with a severe text escalates to the complaint owner with the draft attached, and the reply never goes out on its own. A mild complaint from a new customer gets a calm acknowledgement held for the owner.

## Tests

Real run, 2026-10-25 00:50:41 (Europe/Brussels): `node --test` on the four files.

| File | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `tests/world.test.mjs` | 10 | 10 | 0 | 0 |
| `tests/world_model_bundle.test.mjs` | 1 | 1 | 0 | 0 |
| `tests/world_model_conformance.test.mjs` | 1 | 1 | 0 | 0 |
| `tests/complaint_route.test.mjs` | 6 | 6 | 0 | 0 |

Combined run: 18 tests, 18 pass, 0 fail, 0 skipped, exit 0. The bundle and conformance tests skip themselves when esbuild or tsx is not on disk (the clean-clone image), and say so.

## Conformance

The Meterless conformance runner scores 8/8 on the reference TypeScript and 8/8 on our committed bundle. The scorecards are in [engine-world-model-conformance.md](engine-world-model-conformance.md).

## Trace: example 8, sample (the live leg was skipped: no live config)

Trace: `judging/traces/trace-scenario-8-sample.jsonl`. Input: Tilda Moss (`tilda.moss@example.com`) writes about the second saber whose hilt split and cut her son, a public review and a lawyer. Shown run decision `escalate`, branch `complaint-legal`; sample decision `escalate`, branch `complaint-legal`.

The `world_context` line, verbatim:

```json
{"timestamp":"2026-10-24T22:50:41.643Z","duration_ms":1,"elapsed_ms":7,"run_id":"scenario-8-sample","trace_id":"scenario-8-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of tilda.moss@example.com and no product","output_summary":"250 entities, 228 relationships; customer customer:email:tilda.moss@example.com: 3 earlier threads, 0 complaints, public no; product none: 0 complaints; ids: customer:email:tilda.moss@example.com,thread:jedi:T11,thread:jedi:T24,thread:jedi:T14,fact_7f40a4af1de84630,fact_5cd1152f7c761dab","status":"success","branch_id":"complaint-legal","memory_ids":["customer:email:tilda.moss@example.com","thread:jedi:T11","thread:jedi:T24","thread:jedi:T14","fact_7f40a4af1de84630","fact_5cd1152f7c761dab"],"sponsor":"meterless"}
```

Its `memory_ids`: `["customer:email:tilda.moss@example.com","thread:jedi:T11","thread:jedi:T24","thread:jedi:T14","fact_7f40a4af1de84630","fact_5cd1152f7c761dab"]`.

## OpenJev severity: ten levels

The severity gate asks OpenJev one `score` question with ten levels (1 to 10), because OpenJev accepts at most ten score levels. The score is an expected index, so severity = round(score) + 1. Escalation is at 9 or above. The `severity_gate` line from example 8 (live when configured, else sample); its `output_summary` carries the integer, the raw float, the confidence and the source:

```json
{"timestamp":"2026-10-24T22:50:41.643Z","duration_ms":1,"elapsed_ms":7,"run_id":"scenario-8-sample","trace_id":"scenario-8-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F5","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 10 (10 legal or safety), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-legal","sponsor":"nvidia","gate_source":"rules"}
```

Reading: `sample mode, OpenJev not called; severity by code rules (sample.severity): severity 10 (10 legal or safety), raw n/a, confidence 0.5, source rules`.

See also [scenarios.md](scenarios.md) for examples 4 to 8 and 10 to 23 live and in sample mode.

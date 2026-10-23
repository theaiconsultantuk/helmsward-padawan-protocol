---
title: Sponsor technology explanation
description: The text for the submission form's sponsor explanation, in the form's order (Zetaris, Meterless, NVIDIA, what was unique).
date: 2026-10-23
tags: [judging, sponsors, zetaris, meterless, nvidia]
---

# Sponsor technology explanation

Paragraphs in the order the form asks for them (Zetaris; Meterless engines and Nightshift; NVIDIA; what was unique). Every fact below is in the code or in a file under `inbox/judging/`.

## Zetaris

Zetaris is the only way the agent reads company facts. All data is synthetic. Fifteen file sources in six formats (CSV, XML, Markdown, JSON, Parquet, text) are registered as `JEDI_PACK.<table>`, together with the runtime `decisions` table (one row per completed run) and a REST source (`intake_live`, the contact-form submissions the service serves at `GET /intake`): 17 entries in [data/sources.json](../data/sources.json), measured in [zetaris-register.md](zetaris-register.md). The loop reads the thread, policy, owner, holiday, backup, trust weight and a duplicate check through named SQL templates in `src/queries.mjs`, with whitelisted parameters; customer text never reaches SQL. `/counters` is a live `GROUP BY` over the decisions table. Without Zetaris the agent cannot decide: there is no other source of the owner, the holiday, the refund limit or the trust weight. Sample mode answers from rows cached from the same tables, and says so in the trace.

## Meterless Engines and Nightshift

Two engines are implemented in `src/engines/`, both our own code following the Meterless specs.

- Scout Intent classifies the message, checks for injection, redacts PII and issues an HMAC-signed execution contract that the loop verifies before any model call; a blocked message escalates without a model call. Test: the Scout eval harness (copied from Meterless, Apache-2.0) exits 0 on the 32-example v1 set, run on 23 Oct 2026. That set is a smoke test, not a benchmark. Report: [engine-scout-evals.md](engine-scout-evals.md). Unit tests: `scout_contract`, `scout_inbox`.
- H-MEM stores one sourced memory per run and reads memories before planning. Test: the two-run proof, where run B's `planner.plan` names the chunk it skipped because run A wrote it: [engine-hmem-two-run.md](engine-hmem-two-run.md). Retrieval is lexical; no embedder is used.

Nightshift is the primary provider. The app calls `POST {METERLESS_BASE_URL}/chat/completions` (the OpenAI-style endpoint) with the `meterless-app` header and a runtime token, on a pinned route, `nvidia/nemotron-3.5-lightning-30b-a3b`. The model that answered is read from the response body and logged on every call, so the trace shows what handled the request, not what was asked for. `npm run doctor` sends one request to the primary route and warns when Nightshift answered from a local lane. Caveat: Nightshift chooses the lane, and on our first probe every route, including the Nemotron ones, was answered by its local Llama-3.2-1B lane ([nightshift-first-call.json](nightshift-first-call.json)), so we claim Nemotron only for the runs whose traces say so.

## NVIDIA

Nemotron 3.5 Lightning, through Nightshift, drafts the reply, plays the evaluator that critiques the draft, and phrases `/ask` answers from rows. Traces whose `nvidia.model` lines carry that model id: [trace-ask-mvk7jd5c](traces/trace-ask-mvk7jd5c.jsonl), [trace-padme-live_1](traces/trace-padme-live_1.jsonl), [trace-padme-live_2](traces/trace-padme-live_2.jsonl), [trace-two-run-A](traces/trace-two-run-A.jsonl), [trace-two-run-B](traces/trace-two-run-B.jsonl). NVIDIA DiffusionGemma, served through OpenJev, answers five typed questions per message (follow-up, category, urgency, tone, asks for money). It is called directly, beside Nightshift, not through it. If OpenJev is down the code rules answer and the trace line says `gate_source: rules`.

## What was unique

- The trust floor is a number from Zetaris (the category weight) that the user moves: each affirm or reject on `POST /feedback` is stored in Zetaris as a delta of 0.05 on the decision row, and the loop moves that category's weight by 0.05 per affirm or reject when it reads the ledger.
- The signed execution contract is verified before any model call, so a blocked message costs no model call.
- Typed gates with a confidence per answer (OpenJev) sit beside a generative drafter (Nemotron); code rules take over if the gates fail.
- Six file formats and one REST source are read as one set of tables through Zetaris.
- Customer text never reaches SQL: only whitelisted template parameters do.

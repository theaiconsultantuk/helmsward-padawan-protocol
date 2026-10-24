---
title: Sponsor technology explanation
description: The text for the submission form's sponsor explanation, in the form's order (Zetaris, Meterless, NVIDIA, what was unique).
date: 2026-10-23
tags: [judging, sponsors, zetaris, meterless, nvidia]
---

# Sponsor technology explanation

Paragraphs in the order the form asks for them (Zetaris; Meterless engines and Nightshift; NVIDIA; what was unique). Every fact below is in the code or in a file under `inbox/judging/`.

## Zetaris

Zetaris holds two layers here. `JEDI_PACK` is the raw layer: 28 sources in seven formats (including a REST source), registered as filestore tables and read through one SQL surface. On top of it sits the Unified Semantic Layer `lightning.metastore.jedi_pack.jedi_pack` (Zetaris's own sense, the setup guide's glossary: "a consistent business view of data that spans several systems"), compiled from typed DDL with primary and foreign keys; the compile response records both, and its data-quality annotation slots are empty in this build) and activated as live views over the raw Parquet, JSON, CSV and Markdown sources, so a change in a source shows in the layer at once. The agent's scenario routes (FAQ, price list, responsibility, holidays, the free-text intake read-back) and the World Model build read the USL tables `employee`, `customer`, `ticket`, `product`, `policy`, `responsibility`, `faq`, `holiday`, `intake`, `review`, `decision`, `wiki_page`, `hierarchy`, `client`, `sales_order`, `shipping_rule`, `bulk_tier`, `bom_part` and `channel`; the legacy thread facts (the 24 authored threads, policy by topic, employee, trust weight, wiki, duplicates, the decisions ledger) still read the raw `JEDI_PACK` tables, which we disclose rather than hide. Details and the live proof: [zetaris-usl.md](zetaris-usl.md). All data is synthetic. One `CREATE LIGHTNING DATABASE JEDI_PACK`, then one `CREATE LIGHTNING FILESTORE TABLE` per source with its own `FORMAT`: 25 synthetic file sources in six formats (CSV, XML, Markdown, JSON, Parquet, text), two tables the service writes itself at runtime (`decisions`, one row per completed run with the human's affirm or reject; `intake_runtime`, every free-text message a customer types, published into Zetaris before the loop reads it back), and a REST source (`intake_live`, the contact-form submissions the service serves at `GET /intake`): 28 entries in [data/sources.json](../data/sources.json), measured in [zetaris-register.md](zetaris-register.md). We wrote no adapter, no ETL and no mapping layer: the thread (Parquet and JSON), the policy (CSV), the owner and the holiday (CSV), the trust weight (CSV), the wiki pages (Markdown), the FAQ and the price list (CSV), the reviews (JSON), the automation matrix (XML), the escalation notes (text) and the customer's own message (the runtime CSV) are read by the same named SQL templates in `src/queries.mjs`, with whitelisted parameters; customer text never reaches SQL. `/counters` is a live `GROUP BY` over the decisions table. Without Zetaris the agent cannot decide: there is no other source of the owner, the holiday, the refund limit, the trust weight or the price. Sample mode answers from rows cached from the same tables, and says so in the trace.

Kristof Kennes, who registered the layer: "Implementing the USL was so easy that I just became an instant fan of Zetaris. I've never seen multiple data sources just slot together without me having to intervene or build adapters or map semantics. Slick."

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
- Two Zetaris layers: the raw `JEDI_PACK` and, on top, the Unified Semantic Layer `lightning.metastore.jedi_pack.jedi_pack` (typed DDL with keys, live views) that the scenario routes read: six file formats, two runtime tables the service writes back and one REST source, read as one set of tables with no adapter, ETL or mapping layer of ours.
- Customer text never reaches SQL: only whitelisted template parameters do.

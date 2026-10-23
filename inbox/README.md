---
title: Jedi Pack Inbox
description: A customer-support inbox agent that decides, critiques and escalates with a full trace. Open Agent Hackathon 2026, Track 3 Reasoning Architecture.
date: 2026-10-23
tags: [hackathon, inbox, zetaris, meterless, nvidia]
---

# Jedi Pack Inbox

## The pitch and the track

A customer-support inbox agent that reads a ticket, decides (send, hold, escalate or close), has a second reader and a policy check challenge the draft, and writes every step to a trace a judge can read.

Track: Open Agent Hackathon 2026, Track 3 "Reasoning Architecture". The company, its staff and its customers are fictional ("Jedi Pack Inc"); all data is synthetic.

## The user and the problem

The user is a support lead at a small company. Tickets arrive by email, contact form and Trustpilot. Some are safe to answer, some need a person, and a wrong reply (a refund the customer did not ask for, an amount above the limit, a fact that may not leave the company) costs trust.

The agent does not send mail. It returns a decision, a draft when one is allowed, the policy rows it relied on, and a trace. When it is not sure, it queues the ticket for the named owner or backup.

## Quick start

Needs Node 22 or newer (`engines` in `package.json`). The service has no runtime dependencies; `npm ci` installs only dev tools (tsx, yaml).

```bash
cp .env.example .env      # then fill in the placeholders you need
npm ci
npm start                 # node src/server.mjs
```

Run these from the `inbox/` folder. Without keys, run on bundled data with no network:

```bash
SAMPLE_MODE=true npm start
```

Port: `PORT` defaults to `8000` and `HOST` to `127.0.0.1`. On the dev VM `.env` sets `8810` because `8000` is taken there. The Dockerfile (`node:22-slim`) binds `0.0.0.0:8000`. `.env` is gitignored; never commit it.

Other commands: `npm test`, `npm run evals`, `npm run doctor` (checks Zetaris, Nightshift, OpenJev and the optional local lane), `npm run cli -- run --thread T02`.

## API

The contract is `openapi.yaml` (also served at `GET /openapi.yaml`). JSON everywhere, CORS open (`*`), no credentials.

**Base URL.** `http://127.0.0.1:8000` by default; `PORT` moves it (`8810` on the dev VM) and `HOST` defaults to `127.0.0.1`. Start it with `node src/server.mjs`. `SAMPLE_MODE=true` answers from cached rows with no network (counters then come from the local decisions file); `"options": {"sample_mode": true}` on a `/run` forces it for one call.

```bash
B=http://127.0.0.1:8810
curl -s $B/health
curl -s $B/sources                      # every source: name, format, table, rows, live
curl -s $B/intake                       # the contact-form submissions (the REST source Zetaris reads)
curl -s -X POST $B/run -H 'Content-Type: application/json' -d '{"run_id":"demo-1","input":{"thread_id":"T02"}}'
curl -s -X POST $B/ask -H 'Content-Type: application/json' -d '{"question":"Can I get a refund on my lightsaber?"}'
curl -s $B/runs/demo-1                  # the stored result
curl -s $B/runs/demo-1/trace            # the trace link: one JSON object per step
curl -s -X POST $B/feedback -H 'Content-Type: application/json' -d '{"run_id":"demo-1","verdict":"affirm","note":"good call"}'
curl -s $B/counters                     # {send, hold, escalate, close, queued, affirmed, rejected}
curl -s $B/openapi.yaml
```

Every result carries a `trace_id` and a `log_file`; `GET /runs/<run_id>/trace` returns that file as a JSON array (works for `/ask` run ids too). Results are kept for the last 200 runs, so a restart forgets them.

**Feedback and the trust ledger.** Every completed `/run` writes a row to `data/runtime/decisions.csv`, which is copied into Zetaris and read as `JEDI_PACK.decisions`; `POST /feedback` sets that row's verdict and delta (affirm +0.05, reject -0.05) and refreshes the table, so `/counters` is a live Zetaris `GROUP BY`. Each affirm or reject for a category moves that category's trust weight by the same 0.05 when the loop reads it (`trustFloor`'s `ledgerAdjust`). A sample-mode run on a live server (`options.sample_mode: true`) is not counted: it writes no row and triggers no publish.

## Architecture

The design is Kristof's 17-node flow ([kristof/flow.html](../kristof/flow.html)). The code logs it as 15 trace step ids ([methodology.md](../methodology.md) is the spec for them).

The 17 nodes, in flow order: Intake (email, form, Trustpilot) -> Scout guard -> Ticket -> Classify (thank-you or follow-up) -> Close (pure thank-you) -> H-MEM read -> Scout contract -> Zetaris (holiday, policy, backup) -> Trust floor -> Draft (NVIDIA through Nightshift) -> Evaluator -> Risk -> Send or hold -> Escalate gate -> Trace -> H-MEM write -> Dashboard.

Not every node is a separate piece of code here. Intake is the `thread_id` the caller names; there is no dashboard page in `inbox/` (the API and the traces are the interface). The flow file is the design; the trace is what ran.

**Decision loop (`src/loop.mjs`).** One ticket in, one decision out:

1. `memory.read`: ask H-MEM for earlier facts about this customer.
2. `planner.plan` and `delegate`: choose reply-now or hold-or-escalate.
3. `executor.act` and `zetaris.query`: read the facts (thread, policy, owner, holiday, trust weight) through named query templates.
4. `meterless.engine`: Scout classifies the message and issues a signed execution contract. The contract is verified before any model call. A blocked message stops here and escalates.
5. Typed gates (OpenJev) and `branch`: pick a branch (under-floor, over-limit, owner-out, send-ok, thank-you, misread, data-block, follow-up, duplicate, public-channel). An amount over the policy limit (`over-limit`) is a hard fact: Risk refuses on round 1, there is no retry, and the ticket escalates to the policy's over-limit owner (the backup if the owner is out) for approval, with the draft and both critiques attached.
6. `nvidia.model`: the drafter writes a reply as JSON.
7. `critique` (a model) and `risk.signoff` (code) read the draft.
8. If either fails on round 1: `retry`, a revised plan, one redraft with both critiques. That is the only retry.
9. Two negative rounds, or a hard fact Risk cannot rewrite: `escalate_or_fallback` queues the ticket for a human with both critiques stored. No third draft.
10. `memory.write` stores one factual memory; `synthesis` ends the trace. `recovery` lines follow any `error` line.

Steps a branch does not reach are still logged with status `skipped`.

**The /ask loop (`src/ask.mjs`).** A plain-words question answered only from Zetaris rows: Scout guards first (an injection attempt is refused, with no query and no model call); the intent picks named query templates (never text-to-SQL); Nightshift phrases the answer from the rows only; in sample mode the answer is built from the rows by a template.

```
ticket
  |
  v
memory.read -> planner.plan -> delegate -> executor.act (Zetaris rows)
  |
  v
Scout: signed contract (blocked? -> escalate, no model call)
  |
  v
typed gates (OpenJev, or code rules) -> branch
  |
  +-- thank-you / follow-up / duplicate / data-block / misread --> close, hold or escalate, no draft
  |
  +-- public-channel ------------------------------------------> escalate
  |
  +-- over-limit: draft, critique, Risk REFUSES (amount needs approval), no retry
  |       --> escalate to the policy's over-limit owner (backup if out) with the draft and both critiques attached
  |
  +-- reply branches:
        draft (Nemotron via Nightshift) -> critique + risk.signoff
           | both pass ------------------------------> send, or hold for a person
           | fail, round 1 --> retry --> redraft (with both critiques)
                                          | both pass --> send / hold
                                          | fail ------> escalate (queue file, both critiques)
  |
  v
memory.write -> synthesis -> trace
```

## Engines

### Scout Intent (Meterless)

What: a rule-based intent engine with a policy guard. It scores a message against an intent registry (word and word-pair overlap), takes the winner's share of matched weight as confidence (below 0.40 the answer is `GENERAL`), checks for injection and redacts PII, and issues an HMAC-signed execution contract (`SCOUT_SECRET`) that the loop verifies before it calls any model.

Where: `src/engines/scout/` (`index.mjs`, `policy.mjs`, `contract.mjs`, `intents.inbox.json`).

Two registries exist and they are different files:

- The harness's own registry, `engines/scout-evals/fixtures/intents.json` (13 intents), is what the eval harness loads.
- The inbox registry, `src/engines/scout/intents.inbox.json` (7 intents: GENERAL, refund.request, replacement.request, order.question, complaint, appreciation, follow_up), is what the running service loads. Its examples are paraphrased from the authored synthetic threads.

Run the evals (Node 22; install the harness's dev tools first):

```bash
npm --prefix engines/scout-evals ci
npm run evals
```

Result of the run on 23 Oct 2026: PASS, exit code 0, corpus v1, 32 examples (15 intent-labelled, 10 injection, 3 multi-intent, 4 edge cases per the harness README). This is a 32-example smoke set, not a benchmark. A perfect score on it shows the engine clears the Meterless v1 floors; it does not show general accuracy. Full report and command: [judging/engine-scout-evals.md](judging/engine-scout-evals.md).

### H-MEM (Meterless)

What: a small memory store. Each run reads memories before planning and writes one after. Memories carry a source (a record with no source is rejected), a type, tags, entities and a confidence; retrieval scores overlap, tags, entity, layer and a 7-day recency half-life. Escalated tickets are written to `data/memory/queue/<thread_id>.json` with both critiques.

Where: `src/engines/hmem/index.mjs`. State is `data/memory/state.json` and `data/memory/ledger.jsonl`.

Choices to know about:

- No embedder. The `sem` score is lexical overlap (Jaccard) between the query and the memory. This is the deliberate local-first choice: nothing leaves the machine to retrieve a memory.
- Deviation from the Meterless reference: `query()` persists `accessCount` and `lastAccessed`; the reference does not.

Proof that a second run reads what the first wrote: [judging/engine-hmem-two-run.md](judging/engine-hmem-two-run.md) (ticket T02, runs `two-run-A` and `two-run-B`; B's `planner.plan` names the chunk it skipped). Its honest note applies: the facts rows are still re-read from Zetaris in one call; what the memory saves is the planner re-deriving them.

## Providers

**Nightshift (Meterless) is the primary provider** for the draft, the critique and `/ask`. The app calls `POST {METERLESS_BASE_URL}/chat/completions` with the primary route `NIGHTSHIFT_ROUTE_PRIMARY`, pinned to `nvidia/nemotron-3.5-lightning-30b-a3b`. Nightshift lists NVIDIA Nemotron routes next to its own `meterless/*` routes ([judging/nightshift-models.json](judging/nightshift-models.json)).

**Which model handled a request.** The route is not enough. Nightshift chooses the lane, so each call logs the model that answered: the `model` field of the `nvidia.model` line comes from the response body (`body.model`), with response headers as a fallback (`handledModel()` in `src/adapters/nightshift.mjs`).

**The honest state.**

- On the first probe (one tiny chat per candidate route, [judging/nightshift-first-call.json](judging/nightshift-first-call.json)), every probed route, including the Nemotron ones, was answered by `webllm/Llama-3.2-1B-Instruct-q4f16_1-MLC`, Nightshift's local lane.
- Later, three live runs were served by `nvidia/nemotron-3.5-lightning-30b-a3b` through Nightshift. The `model` field of each `nvidia.model` draft line in these files says so:
  - [trace-ask-mvk7jd5c](judging/traces/trace-ask-mvk7jd5c.jsonl) (an `/ask` run),
  - [trace-padme-live_1](judging/traces/trace-padme-live_1.jsonl) and [trace-padme-live_2](judging/traces/trace-padme-live_2.jsonl),
  - [trace-two-run-A](judging/traces/trace-two-run-A.jsonl) and [trace-two-run-B](judging/traces/trace-two-run-B.jsonl).
  The critique lines in padme-live_2 and the two two-run traces carry the same model id.
- Nightshift's lane choice is its own. `npm run doctor` sends one request to the primary route, reports the model that answered, and warns when Nightshift answered from a local lane. We make no claim that every future request is served by Nemotron.

**OpenJev (typed gates).** NVIDIA DiffusionGemma, served on Thor, answers five typed questions about each message (follow-up, category, urgency, tone, asks for money). It is called directly (`OPENJEV_BASE_URL`), beside Nightshift; it is not routed through Nightshift. When OpenJev is down or answers badly, the code gates take over with confidence 0.5 and the trace line says `gate_source: rules` instead of `openjev`. In the traces its model shows as `openjev-0.1 (openjev-0.1)`.

**Fallback order for a draft:**

1. The Nemotron lane through Nightshift (`NIGHTSHIFT_ROUTE_PRIMARY`).
2. Nightshift `meterless/local` (`NIGHTSHIFT_ROUTE_FALLBACK`), tried when the primary fails with a recoverable error. A `retry` line records it.
3. The direct local lane (`LOCAL_LANE_*`): einh's Bionic server on Thor, reached through LM Link. It does not go through Nightshift. It fires only when Nightshift itself is unreachable (connection refused or timeout), never on a Nightshift HTTP error. A draft served there is neither NVIDIA nor Meterless, and its trace line carries no sponsor tag. An empty `LOCAL_LANE_BASE_URL` disables it.
4. Sample rules (`SAMPLE_MODE=true`): no model call.

## Data sources

All data is synthetic, generated by `scripts/gen_company.py`, licence "synthetic, CC0". Zetaris reads it as `JEDI_PACK.<table>`. The measured register is [judging/zetaris-register.md](judging/zetaris-register.md); the machine-readable list is [data/sources.json](data/sources.json).

15 file sources in 6 formats, plus the runtime `decisions` table and the `intake_live` REST source: 17 entries in `data/sources.json`.

| name (Zetaris table) | format | live rows |
|---|---|---|
| employees | CSV | 200 |
| holiday_2026 | CSV | 1251 |
| responsibility | CSV | 5 |
| policy | CSV | 1 |
| categories | CSV | 5 |
| trust_ledger | CSV | 5 |
| automation_matrix | XML | 5 |
| wiki_refund_policy | MARKDOWN | 1 (one row per file) |
| wiki_replacement_policy | MARKDOWN | 1 (one row per file) |
| wiki_what_may_leave | MARKDOWN | 1 (one row per file) |
| threads_json | JSON | 100 |
| threads_parquet | PARQUET | 100 |
| contact_form_submissions | JSON | 41 |
| trustpilot_reviews | JSON | 19 |
| escalation_notes | TEXT | 1 (one row per file) |
| decisions (runtime) | CSV | 0 at registration; one row per completed `/run` |
| intake_live (REST) | REST, JSON | 41 |

The register records `intake_live` as read at query time, not cached: with the service stopped or bound to `127.0.0.1`, a query on it fails (HTTP 400). Start the service with `HOST=0.0.0.0` for Zetaris to reach it.

Registering the sources:

- `bash scripts/zetaris_drop.sh` copies `data/synthetic` into the Zetaris driver container.
- `node scripts/register_sources.mjs --apply` creates the tables (options `--refresh` and `--only a,b` exist).
- `scripts/register_zetaris_sources.sql` holds the same statements as SQL.
- `src/decisions.mjs` publishes `data/runtime/decisions.csv` after each run and each feedback.

All SQL comes from named templates in `src/queries.mjs` with whitelisted parameters (a thread id must match `T<n>`, a category must be one of five). Customer text never reaches SQL.

## Sample mode

`SAMPLE_MODE=true` (or `"options": {"sample_mode": true}` on one `/run`) answers with no network:

- Zetaris queries are answered from cached rows in `data/sample/` (exported from the live tables).
- The typed gates come from code rules (`gate_source: rules`).
- The drafter and the critic are rules; their trace lines have model `sample/rules` and status `skipped`.
- `/ask` builds its answer from the rows by template.
- `NO_NETWORK=1` makes every `fetch` fail; `tests/sample_mode.test.mjs` uses it to prove no call is made.
- `FAULT_ZETARIS_REFUSE_ONCE=true` makes the first Zetaris call hit a real refused connection and shows the error line, then the recovery line, then the cached rows.

The sample path decides all 24 authored threads to their authored outcome (`tests/loop_grid.test.mjs`).

The three `input_examples/` carry no mode. Posted to a live service they run live (Zetaris, Nightshift, OpenJev); with `SAMPLE_MODE=true` the same files run on the cache. `output_examples/` were produced with `SAMPLE_MODE=true`, so they are exact for a sample run; a live run gives the same decision and cited rows with a model-written draft.

## Logs and traces

Every event is one JSON line in `logs/trace-<run_id>.jsonl` and the same event on stdout as `[INFO] run_id=<run_id> <agent_name> <action>: <output_summary>`.

Required fields: `timestamp`, `run_id`, `trace_id`, `step`, `agent_name`, `action`, `input_summary`, `output_summary`, `status`. Optional: `target_agent`, `model`, `confidence`, `retry_count`, `branch_id`, `memory_ids`, `sponsor` (`zetaris`, `meterless` or `nvidia`), `gate_source`.

`step` is one of 15 ids: memory.read, planner.plan, delegate, executor.act, zetaris.query, meterless.engine, nvidia.model, branch, critique, risk.signoff, retry, escalate_or_fallback, memory.write, synthesis, recovery. `status` is one of 7: success, needs_revision, retrying, error, incomplete, skipped, refused. An unknown step or status throws.

Masking (`src/trace.mjs`), applied to every string before it is written, in this order:

1. any configured secret value (a value of 8+ characters from a key ending `_KEY`, `_TOKEN` or `_SECRET`) becomes `[masked]`;
2. `Bearer <token>` becomes `Bearer [masked]`;
3. `sk-` followed by 8+ token characters becomes `[masked]`;
4. any run of 40+ characters from `[A-Za-z0-9+/=_-]` becomes `[masked]`, except a path-shaped run (contains `/` or is followed by a file extension) or a 64-character lowercase hex contract signature.

Committed traces for judges are in [judging/traces/](judging/traces/trace-two-run-A.jsonl); `logs/*.jsonl` is gitignored.

## Tests

`npm test` runs `node --test tests/*.test.mjs`. The files:

- `trace_shape`: step and status vocabularies, required fields, masking.
- `queries`: template whitelist, injection rejected before any fetch, deterministic SQL.
- `adapters`, `openjev`: error classes, Zetaris/Nightshift/OpenJev request shapes, retry and fallback.
- `gates`: typed gates, rules fallback when OpenJev fails.
- `scout_contract`, `scout_inbox`: contract sign, verify and tamper; injection blocked; T01 is a follow-up.
- `hmem_two_run`: cold then warm memory, byte-identical repeat runs, a record needs a source.
- `loop_core`, `loop_grid`: step order, branch precedence, all 24 authored threads in sample mode, the two recovery pairs.
- `padme_chain`: the T01 chain, both the misread and the correct outcome.
- `ask`: refund question, injection refused, unknown topic.
- `api`: the HTTP routes in sample mode.
- `sample_mode`, `sample_cache`: no network, cached rows match live.
- `no_secrets`: no secret value or Bearer token in any shipped or log artefact.

Other checks: `bash scripts/check.sh` (syntax check of every source file), `npm run evals` (Scout harness), `npm run doctor` (live providers), `node scripts/check_links.mjs README.md` (relative links in this file). Run `npm test` for the current count.

## AI and Model Usage

Models (through Meterless Nightshift):

- `nvidia/nemotron-3.5-lightning-30b-a3b` (the pinned primary route) drafts the reply, plays the evaluator that critiques the draft, and phrases `/ask` answers from rows. The model that actually answered is logged per request (see Providers).
- No embedding model is used. H-MEM retrieval is lexical.
- Typed gates: NVIDIA DiffusionGemma through OpenJev, called directly, not through Nightshift.

Agent frameworks: none. The service has zero runtime dependencies (Node standard library only).

Sponsor technology:

- Zetaris: serves all company data (15 file sources, the runtime decisions table, the REST intake). The agent queries it through whitelisted templates; `/counters` is a live `GROUP BY`.
- Meterless Engines: Scout Intent (intent, injection guard, signed contract, risk) and H-MEM (shared memory), both implemented in `src/engines/`. Tests: `scout_contract`, `scout_inbox`, `hmem_two_run`, and the Scout eval harness.
- Meterless Nightshift: the primary AI provider, over its OpenAI-style chat endpoint with a runtime token.
- NVIDIA: Nemotron lanes through Nightshift for drafting and critique; DiffusionGemma (OpenJev) for typed gates.

Development tools:

- AI coding tool: Claude Code through Glitch (Anthropic), orchestrated in Orca. No coding tool was pointed at Nightshift.
- All generated code was reviewed and tested by the team.

Sample mode:

- `SAMPLE_MODE=true` runs on cached sample data with no calls to Zetaris, Nightshift or other services.

## Third-Party Code and Licences

- Meterless Scout Intent eval harness, copied into `engines/scout-evals/`: Apache-2.0, from github.com/Meterless/Meterless at commit `1742dec`. See [engines/scout-evals/NOTICE-SOURCE.md](engines/scout-evals/NOTICE-SOURCE.md) and the `LICENSE` beside it.
- Meterless Scout and H-MEM reference specs: our `src/engines/` code is our own implementation that follows them; it is not a copy.
- tsx: MIT (dev dependency). yaml: ISC (dev dependency). esbuild: MIT (transitive, via tsx). Versions are in `package-lock.json`.
- pyarrow: Apache-2.0, used only by `scripts/gen_company.py` to generate the Parquet file; not needed to run the service.
- OpenJev: Apache-2.0 (its `LICENSE` file on the serving machine is the Apache License, Version 2.0, January 2004; the file is not copied into this repo).
- The gates model, NVIDIA DiffusionGemma 26B A4B it NVFP4. Model card fetched 23 Oct 2026 from https://huggingface.co/nvidia/diffusiongemma-26B-A4B-it-NVFP4. The card's front matter reads `license: apache-2.0` (`license_link: https://ai.google.dev/gemma/apache_2`), its "License/Terms of Use" section reads `SPDX-License-Identifier: Apache-2.0`, and its governing-terms line reads, verbatim: "Governing Terms: Apache 2.0, Gemma Terms of Use and Gemma Prohibited Use Policy" (links: https://ai.google.dev/gemma/terms and https://ai.google.dev/gemma/prohibited_use_policy). So the weights are Apache-2.0 and the Gemma Terms of Use and Prohibited Use Policy also govern their use; the card wins over any shorter wording elsewhere in this repo.

## Limitations

- Retrieval is lexical (Scout word overlap, H-MEM Jaccard). It will miss paraphrases an embedder would catch.
- All data is synthetic and small (100 threads, 200 employees).
- The Scout evals are a 32-example v1 smoke set, not a benchmark.
- Nightshift must run on a Mac or Windows PC. Here it is reached through an SSH tunnel to Thor (`scripts/thor-tunnels.sh`).
- The handled model is reported as Nightshift's response says. Nightshift can serve a request from a local lane even when a Nemotron route is requested (the first probe did); `doctor` reports and warns.
- The model's text is judged by another model call and by code rules; there is no human grading in the loop.
- The API is unauthenticated, CORS is open, and it binds to loopback by default. Do not expose it as is.
- Results of the last 200 runs are kept in memory; a restart forgets them.
- There is no dashboard UI in `inbox/`.
- Publishing decisions to Zetaris needs the `docker` CLI on the host where the service runs, because it shells out to `docker exec zetaris-driver-1`; inside the shipped container there is no docker, so feedback is recorded in the container's `data/runtime/decisions.csv` and `/feedback` answers `published: false`.
- `/counters` on a live server always queries Zetaris and has no local fallback: when the table has not been published, or Zetaris answers the query with a BadResponse (HTTP 4xx or 5xx), it answers zeros; other failures surface as an error response. Only a sample-mode server counts from the local file.

## Disclosures

The demo-misread sample starts from an authored earlier reply in the synthetic data (threads.jsonl, T01) that promised a refund the customer did not ask for; the agent's live work in the sample is reading her follow-up, detecting the misread, withdrawing the promise and escalating. The earlier reply was not generated by the agent.

The same chain processed live, one step after the other, is in [judging/padme-chain.md](judging/padme-chain.md). In that live run the model's first draft promised the replacement she asked for, so there was no misread to detect.

## Pre-existing components

- Paul's Star Wars gift finder at the repo root (`src/`, `data/`, `prompts/`, `run.sh`): a practice build from before the challenge was announced. `inbox/` does not use it.
- Kristof's data pack (`kristof/data`), committed on 22 Oct inside the build window. The synthetic data in `inbox/data/synthetic` is generated by `scripts/gen_company.py`; its first 24 thread lines are byte-identical to `kristof/data/threads/threads.jsonl` (per the Zetaris register).
- Meterless specs and the Scout eval harness, open source (see Third-Party Code and Licences).

## Judging pack

The evidence files are indexed in [judging/README.md](judging/README.md) (being regenerated; this list names only files that exist now):

- [judging/engine-scout-evals.md](judging/engine-scout-evals.md): Scout eval run.
- [judging/engine-hmem-two-run.md](judging/engine-hmem-two-run.md): H-MEM two-run proof.
- [judging/padme-chain.md](judging/padme-chain.md): the T01 chain, run live.
- [judging/zetaris-register.md](judging/zetaris-register.md): every source registered, with row counts.
- [judging/nightshift-models.json](judging/nightshift-models.json) and [judging/nightshift-first-call.json](judging/nightshift-first-call.json): Nightshift routes and the first probe.
- [judging/traces/](judging/traces/trace-padme-live_1.jsonl): the five committed traces.

---
title: Jedi Pack Inbox
description: A customer-support inbox agent that decides, critiques and escalates with a full trace. Open Agent Hackathon 2026, Track 3 Reasoning Architecture.
date: 2026-10-23
tags: [hackathon, inbox, zetaris, meterless, nvidia]
---

# Jedi Pack Inbox

## The pitch and the track

A customer-support inbox agent that reads a ticket, decides (send, hold, escalate or close), has a second reader and a policy check challenge the draft, and writes every step to a trace a judge can read.

Track: Open Agent Hackathon 2026, Track 3 "Reasoning Architecture". The company, its staff and its customers are fictional ("Jedi Pack Inc"); all data is synthetic. Farstrand Supply Co. is the storefront, Helmsward the dispatch desk, Jedi Pack the team and the agent; the business is an off-world delivery contractor.

## The user and the problem

The user is a support lead at a small company. Tickets arrive by email, contact form and Trustpilot. Some are safe to answer, some need a person, and a wrong reply (a refund the customer did not ask for, an amount above the limit, a fact that may not leave the company) costs trust.

The agent does not send mail. It returns a decision, a draft when one is allowed, the policy rows it relied on, and a trace. When it is not sure, it queues the ticket for the named owner or backup.

## Quick start

### Clean deploy

Needs Node 22 or newer (`engines` in `package.json`). The service has no runtime dependencies, so there is no install step: `npm ci` is for the dev tools (tsx, yaml) behind `npm test` only. One script does the whole deploy, from the repository root:

```bash
bash inbox/scripts/clean_deploy.sh          # sample mode: bundled data, no key, no network; open http://127.0.0.1:8000/
bash inbox/scripts/clean_deploy.sh --stop   # stop the server the script started
bash inbox/scripts/clean_deploy.sh --live   # your own Zetaris: publish, register, verify, doctor, start
```

Sample mode starts the one process that serves the front end at `/`, the dashboard at `/dashboard` and the API, waits for `/health` and prints the URL. It is idempotent (a second run reuses the server it started) and `PORT=<free port>` moves it.

`--live` needs `inbox/.env` (`cp .env.example .env`, then fill in your own `ZETARIS_REST_URL`, `ZETARIS_ORG_ID` and `ZETARIS_API_KEY`; you create the Zetaris key yourself, the script never creates or fetches one). `NIGHTSHIFT_*` and `METERLESS_*` are optional, and Nightshift runs on Mac and Windows only. It prints one line per step and stops at the first failure with the fix:

1. Node 22 or newer
2. `inbox/.env` holds the Zetaris keys (names missing keys, never a value)
3. the Zetaris driver container is running (`ZETARIS_CONTAINER`, default `zetaris-driver-1`)
4. `scripts/zetaris_drop.sh` copies `data/synthetic` into the container (`SKIP_RUNTIME=1` leaves the runtime intake table alone)
5. `node scripts/register_sources.mjs --apply` creates the tables (options `--refresh` and `--only a,b` exist; `scripts/register_zetaris_sources.sql` holds the same statements)
6. `node scripts/register_usl.mjs --apply` builds the unified semantic layer
7. each table's row count equals `data/sources.json`
8. the doctor (`node src/cli.mjs doctor`, read from `package.json`; no npm)
9. the server starts with `SAMPLE_MODE=false`

A variable on the command line wins over `.env`. `npm test` skips the live Zetaris tests, and says why, unless `.env` points at a Zetaris that answers.

Port: `PORT` defaults to `8000` and `HOST` to `127.0.0.1`. On the dev VM `.env` sets `8810` because `8000` is taken there. `.env` is gitignored; never commit it.

### Docker

The image is `node:22-slim` plus this folder; nothing is installed at build time and nothing after start. Build and run from `inbox/`:

```bash
docker build -t jedi-pack-inbox .

# with your Zetaris and Nightshift settings (fill in .env from .env.example first; the example ships SAMPLE_MODE=true, so set it false there or override it here)
docker run --rm -p 8000:8000 --env-file .env -e SAMPLE_MODE=false jedi-pack-inbox

# without credentials, Zetaris and Nightshift stopped: the whole loop on bundled data
docker run --rm -p 8000:8000 -e SAMPLE_MODE=true jedi-pack-inbox

curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/run -H 'Content-Type: application/json' -d @input_examples/example_1.json
```

Inside the container the server binds `0.0.0.0:8000` even when `.env` says `HOST=127.0.0.1` (the Dockerfile sets `JEDI_IN_CONTAINER=1`; the start-up line says when it ignored `HOST`), so `-p` reaches it. The marker alone does this: `JEDI_IN_CONTAINER=1` exported before a native `npm start` also turns a loopback `HOST` into `0.0.0.0`, so set it only in a container.

Reaching Zetaris and Nightshift from inside the container: `localhost` there is the container itself.

- Docker Desktop (Mac, Windows): point `ZETARIS_REST_URL` and `METERLESS_BASE_URL` at `host.docker.internal` instead of `127.0.0.1`.
- Linux, bridge network: add `--add-host=host.docker.internal:host-gateway` and use that name in the URLs. That only resolves the name; the host service must also listen on an address the bridge can reach (`0.0.0.0`, or the `docker0` address), not on `127.0.0.1` alone.
- Linux, simplest: `--network host` with the URLs left at `127.0.0.1`, and no `-p` (the container shares the host's ports, so the app is on `http://127.0.0.1:8000` directly).

The container has no `docker` CLI, so the two Zetaris publishes fall back to local files and say `published: false` (Limitations).

Other commands: `npm test`, `npm run evals`, `npm run doctor` (checks Zetaris, Nightshift, OpenJev and the optional local lane), `npm run cli -- run --thread T02`.

## API

The contract is `openapi.yaml` (also served at `GET /openapi.yaml`). JSON everywhere, CORS open (`*`), no credentials by default (`API_TOKEN` unset); a shared instance that sets `API_TOKEN` protects the four POST routes, see below.

**Base URL.** `http://127.0.0.1:8000` by default; `PORT` moves it (`8810` on the dev VM) and `HOST` defaults to `127.0.0.1`. Start it with `node src/server.mjs`. `SAMPLE_MODE=true` answers from cached rows with no network (counters then come from the local decisions file); `"options": {"sample_mode": true}` on a `/run` forces it for one call.

**Reaching a shared instance.** A clean run needs no key (Quick start). The team's shared instance is https://jedi.blastworks.ai, and from hand-in it runs open: no token, so a judge opens `https://jedi.blastworks.ai/shop/contact.html` and submits straight away. That instance is not a sample: every submit runs the real agent, calls live models and writes into a shared inbox. During the build it ran with a shared demo key (the `API_TOKEN` mechanism below), which the team removed for judging. When an instance runs with `API_TOKEN` set, the four POST routes (`/run`, `/ask`, `/feedback`, `/runs/{id}/send`) need the header `Authorization: Bearer <token>`; every GET, the two pages and `/health` stay open. CORS allows any origin and that header, so a front end on another host can call it directly. The shipped pages take `?token=<token>` once and keep it in the browser. Unset (the default, and the judges' clean clone) means no token anywhere.

```bash
B=http://127.0.0.1:8000
curl -s $B/health
curl -s $B/sources                      # every source: name, format, table, rows, live
curl -s $B/intake                       # the contact-form submissions (the REST source Zetaris reads)
curl -s -X POST $B/run -H 'Content-Type: application/json' -d '{"run_id":"demo-1","input":{"thread_id":"T02"}}'
# the same run_id a second time answers 409 Conflict ("run_id already used"): pick a new one, or leave run_id out and one is made
curl -s -X POST $B/run -H 'Content-Type: application/json' -d '{"input":{"message":"How long does shipping take?","from":"a@example.com","channel":"chat","as_of":"2026-10-20"}}'
curl -s -X POST $B/ask -H 'Content-Type: application/json' -d '{"question":"Can I get a refund on my lightsaber?"}'
curl -s $B/runs/demo-1                  # the stored result
curl -s $B/runs/demo-1/trace            # the trace link: one JSON object per step
curl -s -X POST $B/feedback -H 'Content-Type: application/json' -d '{"run_id":"demo-1","verdict":"affirm","note":"good call"}'
curl -s $B/counters                     # {send, hold, escalate, close, queued, affirmed, rejected}
curl -s $B/openapi.yaml
```

**The message road.** `POST /run` also takes a free-text message: `{"input": {"message": "How long does shipping take?", "from": "a@example.com", "channel": "chat", "scenario": "question", "as_of": "2026-10-20"}}`. `scenario` is `refund | question | rfq | complaint | free_text` (absent means `free_text`, and the loop resolves it from the message). `as_of` pins the date the facts are read as of, which is how the demos stay repeatable. The message becomes a ticket `F<n>` that Zetaris can read.

**Runs, journeys and the queue.** `GET /runs?limit=50` lists the stored runs newest first; `GET /runs/<run_id>/journey` returns how the information travelled (one node per trace step, what each step consulted and what the reply kept, and what reached a human); `GET /queue` lists what is waiting for a person.

**The pages.** The service serves a storefront and an internal dashboard, driven only by the API above.
`GET /` redirects to the storefront (Home, Shop, FAQ and Contact under `/shop/`).
The contact page, `/shop/contact.html`, is the front end: CONTACT US, the 14 scenarios, the demo flow "How a person sees it" and the "Under the hood" drawer, and its SEND button writes the ticket's queue file and marks it handled or follow up.
`GET /inbox` is the reference form, and `GET /dashboard` is the internal dashboard (counters, the queue of escalated tickets with their drafts, recent runs, affirm and reject).
Their scripts, stylesheets and `demo-scenarios.json` come from `GET /static/{name}`, a closed list of names.
Screenshots are in [judging/screenshots/README.md](judging/screenshots/README.md).

`GET /faq` returns the FAQ rows (public columns only) for the storefront FAQ page.

`POST /runs/{id}/send` records that a person sent the stored reply, writes the ticket's queue file and sets the journey status to handled or follow up; a second send answers 409.

**The 14 judge scenarios.** `GET /demo/scenarios`, `GET /demo/client` and `GET /faq` serve the demo data; every new field, the status lifecycle and the scenario table are in [docs/API-CONTRACT-judge-scenarios.md](docs/API-CONTRACT-judge-scenarios.md).

**For the front end.** `docs/FRONTEND-SPEC.md` ([docs/FRONTEND-SPEC.md](docs/FRONTEND-SPEC.md)) says what each endpoint returns, how the journey is derived and what a replacement page must keep; `openapi.yaml` is the contract.

Every result carries a `trace_id` and a `log_file`; `GET /runs/<run_id>/trace` returns that file as a JSON array (works for `/ask` run ids too). Results are kept for the last 200 runs, so a restart forgets them.

**Feedback and the trust ledger** (the full rule, with the numbers, is [judging/trust-floor.md](judging/trust-floor.md)). Every completed `/run` writes a row to `data/runtime/decisions.csv`, which is copied into Zetaris and read as `JEDI_PACK.decisions`; `POST /feedback` sets that row's verdict and delta (affirm +0.05, reject -0.05) and refreshes the table, so `/counters` is a live Zetaris `GROUP BY`. Each affirm or reject for a category moves that category's trust weight by the same 0.05 when the loop reads it (`trustFloor`'s `ledgerAdjust`). A sample-mode run on a live server (`options.sample_mode: true`) is not counted: it writes no row and triggers no publish.

## Architecture

The design is Kristof's 17-node flow ([kristof/flow.html](../kristof/flow.html)). The code logs it as 15 trace step ids ([methodology.md](../methodology.md) is the spec for them).

The 17 nodes, in flow order: Intake (email, form, Trustpilot) -> Scout guard -> Ticket -> Classify (thank-you or follow-up) -> Close (pure thank-you) -> H-MEM read -> Scout contract -> Zetaris (holiday, policy, backup) -> Trust floor -> Draft (NVIDIA through Nightshift) -> Evaluator -> Risk -> Send or hold -> Escalate gate -> Trace -> H-MEM write -> Dashboard.

Not every node is a separate piece of code here. Intake is the `thread_id` the caller names, or a free-text `message` that becomes a ticket row first; the dashboard node is the reference page at `GET /dashboard` (the API and the traces stay the interface). The flow file is the design; the trace is what ran.

**Decision loop (`src/loop.mjs`).** One ticket in, one decision out:

1. `memory.read`: ask H-MEM for earlier facts about this customer.
2. `planner.plan` and `delegate`: choose reply-now or hold-or-escalate.
3. `executor.act` and `zetaris.query`: read the facts the scenario needs (the ticket, who owns the topic, the owner's holiday row, the backup's only when the owner is out, the contact desk only when both are out; the policy limit only for a refund) through named query templates; a scenario's own route may read its own records on top (the FAQ, a wiki page). A stored thread keeps the full read and also reads the contact desk when nobody is in.
4. `meterless.engine`: Scout classifies the message and issues a signed execution contract. The contract is verified before any model call. A blocked message stops here and escalates.
5. Typed gates (OpenJev) and `branch`: pick a branch (under-floor, over-limit, owner-out, send-ok, thank-you, misread, data-block, follow-up, duplicate, public-channel). An amount over the policy limit (`over-limit`) is a hard fact: Risk refuses on round 1, there is no retry, and the ticket escalates to the policy's over-limit owner (the backup if the owner is out) for approval, with the draft and both critiques attached.
6. `nvidia.model`: the drafter writes a reply as JSON.
7. `critique` (a model), the refund read (a model, non-refund drafts only) and `risk.signoff` (code) read the draft.
8. If either fails on round 1: `retry`, a revised plan, one redraft with both critiques. That is the only retry.
9. Two negative rounds, or a hard fact Risk cannot rewrite: `escalate_or_fallback` queues the ticket for a human with both critiques stored. No third draft.
10. Refunds are mentioned only on refund requests (the `refund` category); questions may quote policy. On any other message a draft that promises money (its promises fields) is refused by Risk; a draft that names a refund in its words (read with the cited row ids removed and accents, emphasis and hyphens normalised) is refused too, except on a question whose own text asks about refunds (a refund word not negated in the three words before it), which may quote the policy. The Evaluator and the drafter are told the same rule; a refused draft is rewritten on the retry, else the ticket is held or escalated. Risk's word test is the guarantee, the Evaluator the second reader, and the refund Reader (below, under Providers) a third that reads meaning and can only add a reason. The approval limit is a refund-category rule.
11. `memory.write` stores one factual memory; `synthesis` ends the trace. `recovery` lines follow any `error` line.

Steps a branch does not reach are still logged with status `skipped`.

**Scenario routes (`src/scenarios.mjs`).** After the typed gates, a reply branch can be taken over by a scenario handler, a `{probe, act}` pair that borrows the loop's toolbox. A resolver picks the scenario (a declared `scenario` wins; otherwise Scout, the FAQ and the gates decide) and the `branch` line then carries one of these ids:

- `faq-hit`: the FAQ row text is the reply and sends automatically (the FAQ text is canonical; Risk still signs it). The returns-and-refund FAQ names refunds, which Risk allows because the question itself asks about them (rule 10).
- `question-records`: no FAQ match, but the Zetaris records answer it; the answer is drafted and held for the question owner. A question that asks about refunds (the refund limit, say) may quote the policy; a question about anything else whose draft names a refund is refused and rewritten.
- `question-unanswered`: neither; the ticket escalates to a person with a recommendation.
- `rfq`: a request for quote escalates to sales with the product price rows attached and a short acknowledgement, written by a code template, for the person to send. No price is quoted to the customer.
- `complaint-severe`, `complaint-genuine`, `complaint-vent`: the complaint route (see World Model below). Severity 9 or above escalates with the draft attached; genuine holds with the handling note; vent holds with a calm acknowledgement.
- `customer-service`: free text that matches nothing defaults to Support with a recommendation and a draft with `[[blank: …]]` markers for the person to fill.

**The free-text road.** `POST /run` with a `message` appends the ticket row (`F<n>`) to `data/runtime/intake.csv` first, publishes it to Zetaris as `JEDI_PACK.intake_runtime` (an `intake_publish` line), then runs Scout and the gates silently so the scenario is known before the facts are read; the canonical step order follows. The ticket's facts are therefore read back through Zetaris like any thread's. These pre-run reads are buffered and written at their usual positions, as the facts are.

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
        draft (Nemotron via Nightshift) -> critique + refund read + risk.signoff
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

### World Model (Meterless)

What: the Meterless World Model engine, a store of entities, relationships and count facts with a provenance id on every write. The product builds one per process from Zetaris rows (`world_threads`, `products`, `reviews`), in memory unless `WORLD_MODEL_DIR` is set.

Where: vendored verbatim from the Meterless repository at commit `1742dec` (Apache-2.0) into `engines/world-model/` ([engines/world-model/NOTICE-SOURCE.md](engines/world-model/NOTICE-SOURCE.md)), and bundled once with esbuild 0.28.2 into `src/engines/world-model/index.mjs`, because Node 22 cannot load the reference's TypeScript at run time. `tests/world_model_bundle.test.mjs` checks the committed bundle against a fresh build. There is no deviation in the engine; our domain layer is `src/engines/world-model/world.mjs` (ingest from Zetaris rows and the complaint context builder).

The feature it powers: the complaint route. For a complaint, the loop asks the World Model for the history of the customer and the product, each statement carrying its provenance id (one `world_context` trace line, sponsor `meterless`, ids in `memory_ids`). That context feeds the Nemotron read (`read_complaint`: venting, or a genuine complaint that must be handled to save face) and the OpenJev severity (`severity_gate`).

Conformance: `npm run conformance` scores our bundle 8/8 and `npm run conformance:reference` scores the vendored TypeScript 8/8. Scorecards: [judging/engine-world-model-conformance.md](judging/engine-world-model-conformance.md); the feature, its tests and a live trace: [judging/engine-world-model.md](judging/engine-world-model.md).

## Providers

**Nightshift (Meterless) is the primary provider** for the draft, the critique, the refund reader and `/ask`. The app calls `POST {METERLESS_BASE_URL}/chat/completions` with the primary route `NIGHTSHIFT_ROUTE_PRIMARY`, pinned to `nvidia/nemotron-3.5-lightning-30b-a3b`. Nightshift lists NVIDIA Nemotron routes next to its own `meterless/*` routes ([judging/nightshift-models.json](judging/nightshift-models.json)).

**Which model handled a request.** The route is not enough. Nightshift chooses the lane, so each call logs the model that answered: the `model` field of the `nvidia.model` line comes from the response body (`body.model`), with response headers as a fallback (`handledModel()` in `src/adapters/nightshift.mjs`).

**The refund Reader.** On a non-refund draft that the word test passed, a second model read runs beside the Evaluator (`readRefund` in `src/refund_reader.mjs`). It reads meaning, in any wording or language: a credit, a voucher, a waived cost or a hint of money back that the word list does not contain. The demo data is English; the language reach is a safety net that costs nothing, not a demo feature. It answers three questions: does the draft mention money back, does it promise it to this customer, and did the customer ask about refunds. Code turns the answers into a verdict. The Reader can only tighten Risk: it adds a reason, so the round counts as negative and the draft is rewritten once; it never removes one. The call takes the same road as the draft and the critique: the primary route, then the fallback route, then the optional local lane (`LOCAL_LANE_BASE_URL`, a model that is neither NVIDIA nor Meterless; its line carries no `sponsor` and names the lane's model). Only when that whole road fails, or the answer is not valid JSON, does the word test stand alone, and the trace then carries an `error` line and a `recovery` line. `REFUND_READER=false` turns the call off and logs a `skipped` line. In sample mode a phrase list stands in (status `skipped`, model `sample/rules`); that list is not the guarantee. The `nvidia.model` line with action `read_refund` carries the `model` that answered, so the route is not taken for the model. The hero thread is a refund request, so the Reader does not run on it.

**The honest state.**

- On the first probe (one tiny chat per candidate route, [judging/nightshift-first-call.json](judging/nightshift-first-call.json)), every probed route, including the Nemotron ones, was answered by `webllm/Llama-3.2-1B-Instruct-q4f16_1-MLC`, Nightshift's local lane.
- Later, three live runs were served by `nvidia/nemotron-3.5-lightning-30b-a3b` through Nightshift. The `model` field of each `nvidia.model` draft line in these files says so:
  - [trace-ask-mvk7jd5c](judging/traces/trace-ask-mvk7jd5c.jsonl) (an `/ask` run),
  - [trace-padme-live_1](judging/traces/trace-padme-live_1.jsonl) and [trace-padme-live_2](judging/traces/trace-padme-live_2.jsonl),
  - [trace-two-run-A](judging/traces/trace-two-run-A.jsonl) and [trace-two-run-B](judging/traces/trace-two-run-B.jsonl).
  The critique lines in padme-live_2 and the two two-run traces carry the same model id.
- Nightshift's lane choice is its own. `npm run doctor` sends one request to the primary route, reports the model that answered, and warns when Nightshift answered from a local lane. We make no claim that every future request is served by Nemotron.

**OpenJev (typed gates).** NVIDIA DiffusionGemma, served on Thor, answers five typed questions about each message (follow-up, category, urgency, tone, asks for money). It is called directly (`OPENJEV_BASE_URL`), beside Nightshift; it is not routed through Nightshift. When OpenJev is down or answers badly, the code gates take over with confidence 0.5 and the trace line says `gate_source: rules` instead of `openjev`. In the traces its model shows as `openjev-0.1 (openjev-0.1)`.

**Severity (complaints).** The complaint route asks OpenJev one more typed question, the severity of the complaint. OpenJev accepts at most ten score levels, so the question has ten levels labelled 1 to 10 and severity = round(score) + 1; 9 or above escalates. When OpenJev is down, rules score it (`gate_source: rules`) and the branch still decides.

**Fallback order for a draft:**

1. The Nemotron lane through Nightshift (`NIGHTSHIFT_ROUTE_PRIMARY`). A call that hangs past `NIGHTSHIFT_TIMEOUT_MS` (120 s) or comes back 5xx is tried once more on the same lane (a `retry` line, action `retry_primary`); measured 23 Oct, the example 8 critique answers in 40 to 80 s on some tries and hangs on others. An unknown model or a refused connection is not retried there.
2. Nightshift `meterless/local` (`NIGHTSHIFT_ROUTE_FALLBACK`), tried when the primary fails with a recoverable error. A `retry` line records it.
3. The direct local lane (`LOCAL_LANE_*`): einh's Bionic server on Thor, reached through LM Link. It does not go through Nightshift. It fires only when Nightshift itself is unreachable (connection refused or timeout), never on a Nightshift HTTP error. A draft served there is neither NVIDIA nor Meterless, and its trace line carries no sponsor tag. An empty `LOCAL_LANE_BASE_URL` disables it.
4. Sample rules (`SAMPLE_MODE=true`): no model call.

## Data sources

Zetaris holds two layers. `JEDI_PACK` is the raw layer: one Lightning database over every source the company has (28 sources, seven formats including REST), each registered as a filestore table in its own format, read through one SQL surface. On top of it the Unified Semantic Layer `lightning.metastore.jedi_pack.jedi_pack` is compiled from typed DDL with primary and foreign keys and read as live views. The scenario routes, the free-text intake read-back and the World Model build read the USL tables (`employee`, `customer`, `ticket`, `product`, `policy`, `responsibility`, `faq`, `holiday`, `intake`, `review`, `decision` and `wiki_page`); the legacy thread facts still read the raw tables. We wrote no adapter, no ETL and no mapping layer; the service even writes two tables back into the raw layer at runtime (`decisions` and `intake_runtime`). See [judging/zetaris-usl.md](judging/zetaris-usl.md).

All data is synthetic, generated by `scripts/gen_company.py`, licence "synthetic, CC0". Zetaris reads it as `JEDI_PACK.<table>`. The measured register is [judging/zetaris-register.md](judging/zetaris-register.md); the machine-readable list is [data/sources.json](data/sources.json).

25 file sources in 6 formats (seven new this build: `companyhierarchy`, `customers`, `orders`, `shipping_rules`, `bulk_pricing`, `bom`, `channels`), plus the runtime `decisions` and `intake_runtime` tables and the `intake_live` REST source: 28 entries in `data/sources.json`.

| name (Zetaris table) | format | live rows |
|---|---|---|
| employees | CSV | 207 |
| holiday_2026 | CSV | 1263 |
| responsibility | CSV | 12 |
| policy | CSV | 2 |
| categories | CSV | 5 |
| trust_ledger | CSV | 12 |
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
| products | CSV | 50 (50 catalogue rows, FS skus, one `unit_price` in GC per product, plus `material` and `specs`) |
| faq | CSV | 18 |
| contacts | CSV | 1 |
| intake_runtime (runtime) | CSV | 0 at registration; one row per free-text message, written by the service |
| companyhierarchy | CSV | 207 |
| customers | CSV | 58 |
| orders | CSV | 82 |
| shipping_rules | CSV | 12 |
| bulk_pricing | CSV | 3 |
| bom | CSV | 149 |
| channels | CSV | 4 |

### Unified Semantic Layer

- **Built by** `node scripts/register_usl.mjs --apply` (typed DDL with primary and foreign keys; the compile response records both, its data-quality annotation slots are empty in this build, compiled and activated in Zetaris).
- **Contains** `employee`, `customer`, `ticket`, `product`, `policy`, `responsibility`, `faq`, `holiday`, `intake`, `review`, `decision` and `wiki_page`, all live views over the raw sources, so a change in a source shows at once.
- **Read by** the query templates `faq`, `products`, `product_price`, `responsibility`, `holidays`, `world_threads`, `reviews` and `intake_thread` (their trace line says "via the USL"); `tests/usl_drift.test.mjs` asserts each returns the same rows as the raw table.
- **Not read by** the legacy thread road (`thread`, `policy`, `employee`, `holiday`, `trust`, `wiki`, `thread_fingerprints`, `ledger_adjust`, `table_count`, the counters), which stays on the raw `JEDI_PACK` tables so the 24 authored threads behave exactly as before.
- **Raw on both roads:** the `contact` template reads the raw `JEDI_PACK.contacts` table (the default contact desk, row `contacts:default`) for messages and stored threads alike; no USL view reads it.

`products` carries the price rows an RFQ attaches, and `faq` the answers a question is matched against (a hit cites `faq:Q01`). `intake_runtime` holds the free-text tickets the service writes; it is published into Zetaris on each run, registered with `escape` and `multiLine` so a message with quotes or line breaks round-trips.

The register records `intake_live` as read at query time, not cached: with the service stopped or bound to `127.0.0.1`, a query on it fails (HTTP 400). Start the service with `HOST=0.0.0.0` for Zetaris to reach it.

Registering the sources: `bash inbox/scripts/clean_deploy.sh --live` runs the publish and both register scripts in order (see Clean deploy under Quick start).

- `src/decisions.mjs` publishes `data/runtime/decisions.csv` after each run and each feedback; `src/intake.mjs` publishes `data/runtime/intake.csv` the same way.

All SQL comes from named templates in `src/queries.mjs` with whitelisted parameters (a thread id must match `T<n>`, a category must be one of five). Customer text never reaches SQL.

## Sample mode

`SAMPLE_MODE=true` (or `"options": {"sample_mode": true}` on one `/run`) answers with no network:

- Zetaris queries are answered from cached rows in `data/sample/` (exported from the live tables).
- The typed gates come from code rules (`gate_source: rules`).
- The drafter and the critic are rules; their trace lines have model `sample/rules` and status `skipped`.
- `/ask` builds its answer from the rows by template.
- The scenario routes have rule twins in `src/adapters/sample.mjs`: `complaintRead` (venting or genuine), `severity` (a keyword and context score, 1 to 10), `recommendation` (the customer-service recommendation and its draft with blanks), `acknowledgement` (the RFQ template) and `frame` (the greeting and sign-off). They make no model call.
- Routing in sample mode rests on Scout and the FAQ: the sample gates answer category at confidence 0.5, which is too low to route on, so a free-text message reaches its scenario through Scout's intent or an FAQ match, or falls to customer service. Severity in sample mode is rules.
- `NO_NETWORK=1` makes every `fetch` fail; `tests/sample_mode.test.mjs` uses it to prove no call is made.
- `FAULT_ZETARIS_REFUSE_ONCE=true` makes the first Zetaris call hit a real refused connection and shows the error line, then the recovery line, then the cached rows.

The sample path decides all 24 authored threads to their authored outcome (`tests/loop_grid.test.mjs`) and the scenario grid (`tests/scenarios_grid.test.mjs`).

The nine `input_examples/` carry no mode (examples 4 to 9 are the scenarios: FAQ hit, unanswered question, RFQ, vent, severe complaint, address change). Posted to a live service they run live (Zetaris, Nightshift, OpenJev); with `SAMPLE_MODE=true` the same files run on the cache. `output_examples/` were produced with `SAMPLE_MODE=true`, so they are exact for a sample run; a live run gives the same decision and cited rows with a model-written draft.

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

`npm test` runs `node scripts/test.mjs`, which runs `node --test tests/*.test.mjs` with one private temp folder (removed afterwards); `node --test tests/<file>.test.mjs` still works directly. The files:

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
- `world`, `world_model_bundle`, `world_model_conformance`, `complaint`, `complaint_route`: the World Model domain layer, the bundle against a fresh build, the conformance runner on our bundle, the complaint read, severity and branch.
- `faq_match`, `rfq`, `customer_service`, `intake`, `scenarios_grid`, `reply_loop`: the FAQ match, the RFQ route, the customer-service default, the intake table, the scenario grid.
- `journey`, `spec_endpoints`, `pages`: the journey derivation, the list and journey endpoints, the pages.
- `no_secrets`: no secret value or Bearer token in any shipped or log artefact.

Other checks: `bash scripts/check.sh` (syntax check of every source file), `npm run evals` (Scout harness), `npm run doctor` (live providers), `node scripts/check_links.mjs README.md` (relative links in this file). Run `npm test` for the current count.

## AI and Model Usage

Models (through Meterless Nightshift):

- `nvidia/nemotron-3.5-lightning-30b-a3b` (the pinned primary route) drafts the reply, plays the evaluator that critiques the draft, and phrases `/ask` answers from rows. The model that actually answered is logged per request (see Providers).
- No embedding model is used. H-MEM retrieval is lexical.
- Typed gates: NVIDIA DiffusionGemma through OpenJev, called directly, not through Nightshift.

Agent frameworks: none. The service has zero runtime dependencies (Node standard library only).

Sponsor technology:

- Zetaris: serves all company data (25 file sources, the runtime decisions and intake tables, the REST intake) as the raw `JEDI_PACK` layer plus a Unified Semantic Layer of live views over it that the scenario routes read. The agent queries it through whitelisted templates; `/counters` is a live `GROUP BY`.
- Meterless Engines: Scout Intent (intent, injection guard, signed contract, risk) and H-MEM (shared memory), both implemented in `src/engines/`, and the World Model, vendored and bundled (see Engines). Tests: `scout_contract`, `scout_inbox`, `hmem_two_run`, the Scout eval harness, `world` and the World Model conformance suite (8/8).
- Meterless Nightshift: the primary AI provider, over its OpenAI-style chat endpoint with a runtime token.
- NVIDIA: Nemotron lanes through Nightshift for drafting, critique and the complaint read; DiffusionGemma (OpenJev) for typed gates and the complaint severity.

Development tools:

- AI coding tool: Claude Code through Glitch (Anthropic), orchestrated in Orca. No coding tool was pointed at Nightshift.
- All generated code was reviewed and tested by the team.

Sample mode:

- `SAMPLE_MODE=true` runs on cached sample data with no calls to Zetaris, Nightshift or other services.

## Third-Party Code and Licences

- Meterless Scout Intent eval harness, copied into `engines/scout-evals/`: Apache-2.0, from github.com/Meterless/Meterless at commit `1742dec`. See [engines/scout-evals/NOTICE-SOURCE.md](engines/scout-evals/NOTICE-SOURCE.md) and the `LICENSE` beside it.
- Meterless World Model engine, copied into `engines/world-model/` and bundled into `src/engines/world-model/index.mjs`: Apache-2.0, from github.com/Meterless/Meterless at commit `1742dec`. See [engines/world-model/NOTICE-SOURCE.md](engines/world-model/NOTICE-SOURCE.md) and the `LICENSE` beside it. The bundle is the reference built with esbuild; nothing in the engine is changed.
- Meterless Scout and H-MEM reference specs: our `src/engines/` code is our own implementation that follows them; it is not a copy.
- tsx: MIT (dev dependency). yaml: ISC (dev dependency). esbuild: MIT (a pinned dev dependency, 0.28.2, used once to bundle the World Model). Versions are in `package-lock.json`.
- pyarrow: Apache-2.0, used only by `scripts/gen_company.py` to generate the Parquet file; not needed to run the service.
- OpenJev: Apache-2.0 (its `LICENSE` file on the serving machine is the Apache License, Version 2.0, January 2004; the file is not copied into this repo).
- The gates model, NVIDIA DiffusionGemma 26B A4B it NVFP4. Model card fetched 23 Oct 2026 from https://huggingface.co/nvidia/diffusiongemma-26B-A4B-it-NVFP4. The card's front matter reads `license: apache-2.0` (`license_link: https://ai.google.dev/gemma/apache_2`), its "License/Terms of Use" section reads `SPDX-License-Identifier: Apache-2.0`, and its governing-terms line reads, verbatim: "Governing Terms: Apache 2.0, Gemma Terms of Use and Gemma Prohibited Use Policy" (links: https://ai.google.dev/gemma/terms and https://ai.google.dev/gemma/prohibited_use_policy). So the weights are Apache-2.0 and the Gemma Terms of Use and Prohibited Use Policy also govern their use; the card wins over any shorter wording elsewhere in this repo.

## Limitations

- Retrieval is lexical (Scout word overlap, H-MEM Jaccard). It will miss paraphrases an embedder would catch.
- All data is synthetic and small (100 threads, 207 employees).
- The Scout evals are a 32-example v1 smoke set, not a benchmark.
- Nightshift must run on a Mac or Windows PC. Here it is reached through an SSH tunnel to Thor (`scripts/thor-tunnels.sh`).
- The handled model is reported as Nightshift's response says. Nightshift can serve a request from a local lane even when a Nemotron route is requested (the first probe did); `doctor` reports and warns.
- The model's text is judged by another model call and by code rules; there is no human grading in the loop.
- With `API_TOKEN` unset the API is unauthenticated, CORS is open, and it binds to loopback by default. Do not expose it as is; a shared instance sets `API_TOKEN` (the hosted one does).
- Results of the last 200 runs are kept in memory; a restart forgets them.
- The storefront pages (`/shop/`), the reference form (`GET /inbox`) and the dashboard (`GET /dashboard`) are reference pages and, like the API's reads, open; their write calls carry the token when the instance has one.
- Severity is a model read on ten levels (OpenJev accepts at most ten score levels), mapped to 1 to 10; escalation is at 9 or above. A different cut-off is a one-line change.
- The synthetic company has no purchasing team, so an RFQ goes to sales (employee 6, backup 14) and every surface says "sales quotes".
- A free-text ticket carries no authored `may_leave` flag, so the intake facts set it true and Risk guards the draft through restricted terms and the amount limit only.
- Intake publish needs the same `docker` CLI as the decisions publish; inside the shipped container it falls back to the local `data/runtime/intake.csv`, the citation says `(local)` and the `intake_publish` line says `published: false`.
- Sample mode answers a per-employee holiday read for any date in the data (derived from the cached holiday table when no exact entry exists).
- The price list holds one price per product and no volume tiers, so the honest answer to "what is the difference between 100 and 100000" is one unit price and sales to quote.
- Publishing decisions to Zetaris needs the `docker` CLI on the host where the service runs, because it shells out to `docker exec zetaris-driver-1`; inside the shipped container there is no docker, so feedback is recorded in the container's `data/runtime/decisions.csv` and `/feedback` answers `published: false`.
- `/counters` on a live server always queries Zetaris and has no local fallback: when the table has not been published, or Zetaris answers the query with a BadResponse (HTTP 4xx or 5xx), it answers zeros; other failures surface as an error response. Only a sample-mode server counts from the local file.

## Disclosures

The demo-misread sample starts from an authored earlier reply in the synthetic data (threads.jsonl, T01) that promised a refund the customer did not ask for; the agent's live work in the sample is reading her follow-up, detecting the misread, withdrawing the promise and escalating. The earlier reply was not generated by the agent.

The same chain processed live, one step after the other, is in [judging/padme-chain.md](judging/padme-chain.md). In that live run the model's first draft promised the replacement she asked for, so there was no misread to detect.

The demo scenarios (`input_examples/` 4 to 9 and the demo buttons on the front page) are authored inputs; their outcomes are the agent's. The RFQ acknowledgement and the FAQ answer are code templates and the trace says so (`template/acknowledgement`, and no model call on `faq-hit`).

## Pre-existing components

- Paul's Star Wars gift finder at the repo root (`src/`, `data/`, `prompts/`, `run.sh`): a practice build from before the challenge was announced. `inbox/` does not use it.
- Kristof's data pack (`kristof/data`), committed on 22 Oct inside the build window. The synthetic data in `inbox/data/synthetic` is generated by `scripts/gen_company.py`; its first 24 thread lines are byte-identical to `kristof/data/threads/threads.jsonl` (per the Zetaris register).
- Meterless specs and the Scout eval harness, open source (see Third-Party Code and Licences).

## Judging pack

The evidence files are indexed in [judging/README.md](judging/README.md), regenerated by `bash scripts/judging_pack.sh`; start with [result.md](result.md) and [judging/rules-checklist.md](judging/rules-checklist.md). The main files:

- [judging/engine-scout-evals.md](judging/engine-scout-evals.md): Scout eval run.
- [judging/engine-hmem-two-run.md](judging/engine-hmem-two-run.md): H-MEM two-run proof.
- [judging/engine-world-model.md](judging/engine-world-model.md) and [judging/engine-world-model-conformance.md](judging/engine-world-model-conformance.md): the World Model feature, its tests and the 8/8 scorecards.
- [judging/scenarios.md](judging/scenarios.md): examples 4 to 8 run live and in sample mode, with their traces.
- [judging/padme-chain.md](judging/padme-chain.md): the T01 chain, run live.
- [judging/refund-chain.md](judging/refund-chain.md): one customer, two refund requests, run live (`node inbox/scripts/refund_chain.mjs`; `--sample` writes the deterministic twin): 40 GC held under the trust floor with the owner on holiday and the backup named, then 400 GC over the limit, escalated for approval after H-MEM read step 1's memory.
- [judging/zetaris-register.md](judging/zetaris-register.md): every source registered, with row counts.
- [judging/nightshift-models.json](judging/nightshift-models.json) and [judging/nightshift-first-call.json](judging/nightshift-first-call.json): Nightshift routes and the first probe.
- [judging/traces/](judging/traces/trace-padme-live_1.jsonl): the five committed traces.

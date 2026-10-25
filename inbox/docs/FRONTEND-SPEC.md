---
title: Front-end spec for Jocke
description: What the Jedi Pack inbox service offers a front end - the endpoints, the journey shape, the two views, the demo scenarios and what a replacement page must keep.
date: 2026-10-23
tags: [hackathon, inbox, frontend, api, spec]
---

# Front-end spec for Jocke

The contract is [openapi.yaml](../openapi.yaml) plus this page.
Where they disagree, `openapi.yaml` wins and this page is the bug.
All examples below come from sample-mode runs (see [example 4](../output_examples/example_4.json), [example 6](../output_examples/example_6.json), [example 8](../output_examples/example_8.json)) or from `openapi.yaml`.

## 1. What the service is and where it runs

A customer-support inbox agent: one ticket in, a decision out (`send`, `hold`, `escalate` or `close`), every step traced.
It runs on loopback by default: `http://127.0.0.1:8000`; `PORT` moves it (8810 on the dev VM), `HOST` defaults to `127.0.0.1`.
CORS follows `CORS_ORIGIN` (unset or `*`: `Access-Control-Allow-Origin: *`; a fixed origin adds `Vary: Origin`; invalid settings send no allow-origin header), and a shared instance may set `API_TOKEN`; then `POST /run`, `/ask`, `/feedback` and `/runs/{id}/send` need `Authorization: Bearer <token>`, while every GET, the pages and `/health` stay open.
JSON everywhere.
The reference pages read their API base from `<meta name="api-base" content="">`; an empty value means the same origin.
Your page should do the same: `fetch(base + "/run", ...)`.

## 1b. The hosted instance: https://jedi.blastworks.ai

The team shares one hosted instance at https://jedi.blastworks.ai. It is live from 23 Oct 2026 until 7 Nov 2026 00:00 UTC (Kristof, 25 Oct).
The pages are static files served from netcup (`X-Served-By: prodsites-netcup`). The API runs on the dev VM. Both answer on the same origin, so keep the `api-base` meta empty.
The pages are whatever `inbox/public/` holds on `main`. They follow `main` within about a minute of a merge, once the deploy key is in place; until then a seed of the 23 Oct `main` is served.
The API follows `main` within about two minutes. It has its own release timer and rolls back if the health check fails.
Static files only: there is no build step on the server. Commit the built output if you use a bundler.
`/static/<name>` maps to `public/<name>`, and `/dashboard` maps to `public/dashboard.html`. The hosted instance serves any file under `inbox/public/`. The reference server in a clean clone serves only its closed list (`app.js`, `dashboard.js`, `style.css`, `demo-scenarios.json`).
Hidden files (any path segment starting with `.`) are 404 on the hosted instance.
A new API route needs its line in the netcup proxy list. Ask Kristof.
The hosted instance runs without `API_TOKEN`, so the write calls need no token there. When an instance does set it (section 1), the token is handed over directly, never committed; a page takes `?token=` once and then strips it from the address bar after reading it.
Cloudflare's edge returns a gateway error after about 100 s with no response, while the run completes server-side. Generate your own `run_id` before `POST /run` (section 2 allows it) and, after any gateway error, poll `GET /runs/{id}` with that id.
On your own machine, run `SAMPLE_MODE=true npm start`, or point the `api-base` meta at the hosted host.

## 1c. Open demo POST contract (25 Oct 2026)

Every POST must send `Content-Type: application/json` (parameters such as `charset=utf-8` are allowed); other media types receive 415 `UnsupportedMediaType` with `unsupported media type: application/json required`.
Method (405) and bearer (401) checks come first.
The hosted CORS setting is `CORS_ORIGIN=https://jedi.blastworks.ai`; a clean clone leaves it unset (`*`), and same-origin pages work with either setting.

- At most 2 live runs across `/run` and `/ask` may be in flight; another receives 503 `Busy`, `recoverable: true`, with `busy: 2 live runs in flight (cap 2); retry later`.
  Show that message and let the visitor retry or switch to Simulated; sample runs never consume a live slot, and disconnecting does not release a live slot before the run ends.
- At 5,000 intake rows, new message runs receive 503 `IntakeFull`, `recoverable: false`, with `intake full: 5000 rows (cap); message runs refused`.
  Message runs are then closed, including Simulated runs; stored-thread runs and `/ask` still work.
- An optional non-empty `name` must contain a letter and use letters (including Unicode letters and combining marks), spaces, hyphens or apostrophes only, within 200 characters.
  Invalid characters or spaces alone receive 400 `BadRequest` with `name: only letters, space, - and ' allowed`.
- Generated `GET /demo/client` emails now have a random six-character base-36 suffix: `<given><family>.<suffix>@email.com` in lower case.
  Scenarios s04 and s10 retain their fixed customers.

## 2. The endpoints the front end uses

`POST /run`

Runs the loop on one ticket and returns the result (also kept for `GET /runs/{id}`). Every result adds `provider: { mode: "live" | "sample", primary_used: true | false | null, fallback_reason: string | null, calls: number }` and optionally `decision_early` (the same object as progress). `primary_used` is null with no Nightshift calls, true only when all calls answered on primary with a Nemotron model, false if any fell back, failed, or answered with a non-Nemotron or unknown model. `fallback_reason` is the first non-null reason prefixed with its step, for example `critique: primary failed (BadResponse HTTP 503); answered by meterless/local`. Sample mode reports nulls and zero calls.
Two input shapes, one `input` object:

```json
{ "run_id": "demo-1", "input": { "thread_id": "T02" } }
{ "run_id": "demo-msg", "input": { "message": "How long does shipping take?", "from": "a@example.com", "name": "Rey Kanata", "channel": "chat", "scenario": "question", "as_of": "2026-10-20" } }
```

- Stored thread: `thread_id` (unknown ids are 404), optional `as_of`.
- Message: `message` (1 to 4000 chars), `from` (email or name), `channel` (`email | contact-form | chat | trustpilot`), optional `scenario`, `name`, `subject`, `as_of`.
- A message run's facts gather reads only the rows its scenario needs: the owner's holiday first, the backup's holiday and record only when the owner is out, the contact desk only when nobody is in, and the policy limit only for a refund. A vent cites no policy row.
- A scenario's own route may read its own records on top of that (the FAQ, a wiki page, and for a question that names refunds the refund policy); those reads are in the trace too.
- A draft that promises a refund on a ticket with no policy limit behind it is never signed off, and outside the refund category a draft that promises money is not signed off by Risk, nor one that names a refund in its words, unless the message is a question that itself asks about refunds (the returns-and-refund FAQ, the refund limit), which may quote the policy (a word test on the reply and its promises; the Evaluator is told the same rule): rewritten on the retry, else held or escalated.
- `scenario` is one of `refund | question | rfq | complaint | free_text`; absent means `free_text` (the loop works it out and says how in `resolved_how`).
- `as_of` is `YYYY-MM-DD` and fixes the date the facts are read as of (holidays, who is in); the demos pin `2026-10-20`. Absent means today.
- `run_id` is optional (`^[A-Za-z0-9._-]{1,80}$`); a reused one answers 409.
- `options.sample_mode: true` forces cached rows for one call.
- A message run gets a ticket id `F<n>` in `input.thread_id` and takes `/feedback` like any other.

Response 200, trimmed from [example 4](../output_examples/example_4.json):

```json
{ "run_id": "example-4", "status": "success",
  "output": { "decision": "send", "reasons": ["FAQ Q01 answers it; ..."], "cited_rows": ["intake_runtime:F1 (local)", "faq:Q01"],
              "draft": { "text": "Hello,\n\nShipping time depends on your region ...", "promises": { "refund_amount": null, "replacement": false, "other": null }, "model": "faq/canonical" } },
  "scenario": "question", "resolved_how": "scout", "branch_id": "faq-hit",
  "input": { "kind": "message", "thread_id": "F1", "text": "How long does shipping take?", "from": "a@example.com", "name": null, "channel": "chat", "received_at": "2026-10-23T05:19:01.591Z", "as_of": "2026-10-20" },
  "trace_id": "example-4", "log_file": "logs/trace-example-4.jsonl", "execution_time_seconds": 0.017 }
```

A 400 (bad field) and a 409 (reused `run_id`) carry the structured error of section 8:

```json
{ "run_id": "demo-1", "status": "error", "error": { "type": "Conflict", "message": "run_id demo-1 was already used", "recoverable": false }, "trace_id": null, "execution_time_seconds": 0 }
```

`GET /runs/{id}`

The stored result exactly as `POST /run` (or `/ask`) returned it; 404 when unknown. The last 200 are kept, a restart forgets them.

`GET /runs/{id}/trace`

The trace as a JSON array, one object per step, in order; 404 when unknown.

```json
{ "timestamp": "2026-10-23T00:10:42Z", "run_id": "demo-1", "trace_id": "demo-1", "step": "memory.read", "agent_name": "Memory", "action": "memory_read", "input_summary": "Lira Venn refund T02", "output_summary": "4 memories: mem-7 (...)", "status": "success" }
```

Optional fields a line may carry: `target_agent`, `model`, `confidence`, `retry_count`, `branch_id`, `memory_ids`, `sponsor`, `gate_source`, `ran_s`, `seen_s`, and on a Zetaris query `detail` (the rows in words; section 3).

`GET /runs/{id}/journey`

The run as a journey a person can read (section 3); 404 when the run or its trace file is gone.

`wall_ms` is the run's total wall time from the stable trace start through final decision synthesis (also on the run result); null on older journeys. Paul: use `wall_ms` for contact.js “run took” and hood.js “The run took … in all”, rather than summing nodes. Node `duration_ms` now measures its own operation, excluding overlap already attributed to an earlier written measured node; the duplicate Scout SQL node carries **0**, with the query's time on the Executor node. Bookkeeping nodes without a measured operation carry 0. Memory reads measure only H-MEM work, excluding earlier facts/gates/buffer waits. Older stored traces keep their historical durations.

`GET /runs/{id}/progress`

Live progress, open like every GET. **Front end: built by the teammate Paul assigns.**

```json
{
  "run_id": "demo-s03",
  "state": "running",
  "mode": "live",
  "elapsed_s": 23.4,
  "working": [
    { "agent": "Drafter", "label": "Drafter writing", "engine": "Nemotron", "since_s": 12.1 }
  ],
  "steps": [
    { "step": "memory.read", "agent": "Memory", "label": "Memory read", "tech": "H-MEM", "status": "success", "seconds": 0.01, "ran_s": 2.0, "seen_s": 2.0 },
    { "step": "branch", "agent": "Planner", "label": "Branch", "tech": "rules", "status": "success", "seconds": 0, "ran_s": 2.1, "seen_s": 2.1 }
  ],
  "decision_early": { "decision": "escalate", "branch_id": "over-limit", "why": "amount 400 GC is over the 150 GC policy limit", "draft_pending": true, "at_s": 2.1, "seen_s": 2.1 },
  "decision": null,
  "status": null,
  "provider": { "primary_used": null, "fallback_reason": null }
}
```

- `state`: `running` | `done`. `mode`: `live` | `sample` | `null` (null for runs stored before `provider` existed).
- `working`: the provider calls in flight right now, oldest first; empty when none (or done). The critic and the refund reader run side by side, so two entries is normal.
- `steps`: every trace line written so far, in trace order, as `{ step, agent, label, tech, status, seconds, ran_s, seen_s }` with `label = labelFor(line.step, line)`, `tech = techOf(line)`, `agent = line.agent_name`, `seconds = round(duration_ms / 1000, 2)`. The buffered early lines (facts, gates) appear in one burst when the run reaches `executor.act`; until then `working` shows them live.
- Each step adds `ran_s` (completion since trace start) and `seen_s` (arrival at `board.line` since board start), rounded to 0.1 s and retained on stored progress reads; their difference exposes buffered delivery waits. Older lines without timing fall back to elapsed time (0 when unknown).
- `decision_early.seen_s` is null on runs stored before the field existed.
- `decision_early.seen_s` records arrival since board start, rounded to 0.1 s, beside `at_s` (decision since trace start).
- `decision_early`: `null` until the branch decides; then set once and never changed. Only for a fixed branch (table below). `draft_pending: true` means the final result may still attach a draft.
- `decision`, `status`: `null` while running; the result's `output.decision` and `status` once done.
- `provider`: the result's `primary_used` and `fallback_reason`, so far.

Working labels and engines:

| Wrapped call | `agent` | `label` | `engine` |
|---|---|---|---|
| drafter, purpose `draft` | Drafter | Drafter writing | see engine rule |
| drafter, purpose `complaint_read` | Drafter | Reading the complaint | engine rule |
| drafter, purpose `recommendation` | Drafter | Writing the recommendation | engine rule |
| critic | Evaluator | Evaluator checking the draft | engine rule |
| reader | RefundReader | Refund read | engine rule |
| typed gates | Gates | Typed gates | OpenJev |
| severity gate | Severity | Severity gate | OpenJev |
| facts read | Executor | Facts from Zetaris | Zetaris |
| duplicate check | Executor | Duplicate check | Zetaris |
| trust ledger | Executor | Trust ledger | Zetaris |
| intake publish | Executor | Saving the message to Zetaris | Zetaris |

Wiki, FAQ, product and complaint-context lookups may briefly have no working entry.

Nightshift work begins with engine `Nemotron` when the primary route names Nemotron (or is unset), otherwise `Nightshift (<route>)`. A fallback changes that entry to `Nightshift (<fallback route>)` or `local lane`. Sample gates use `sample rules` and sample drafter/critic work is inline, without a working entry.

Early-decision timing: over-limit decides after the typed-gates call (OpenJev, live a few seconds); the complaint branches decide after the complaint read (a Nemotron call) and the severity gate, so s09's early decision comes after one model call, not at 2 s.

| `branch_id` | decision | `draft_pending` |
|---|---|---|
| `over-limit`, only when someone is available to approve | escalate | true |
| `complaint-severe` | escalate | true |
| `complaint-legal` | escalate | true (the courtesy reply template) |
| `fact-block` | escalate | false |
| `misread` | escalate | false |
| `data-block` | hold | false |
| `follow-up` | hold | false |
| `duplicate` | close | false |
| `thank-you` | close | false |
| anything else | `null` (no early decision) | — |

The early decision follows the completed branch step. `why` is limited to 200 characters. It equals the final decision; a pending draft can still be attached.

Poll every 1.5 s after posting with your own `run_id`, also after a 502/504/524. A 404 in the first 5 s means not started; keep polling. A later 404 means unknown or lost after a service restart: show the existing “open it later” message. `done` → load the journey. Stored ask ids return 404 “progress exists for /run runs only”; a stored run whose trace is missing has `steps: []`.

Show `working[0].label · working[0].engine · since_s` as the live line and `steps` as the done list. The moment `decision_early` arrives, show its decision and, when `draft_pending`, “the draft is still being written”. It is fixed once; `at_s` records when it was decided. Done `elapsed_s` is frozen and matches the stored result. In-flight progress is lost on service restart; finished progress is recovered from stored results and traces.

`GET /runs?limit=`

The stored runs and asks, newest first; `limit` 1 to 200, default 50; a bad `limit` is 400.

```json
{ "run_id": "ex-rfq", "kind": "run", "scenario": "rfq", "decision": "escalate", "thread_id": "F2", "branch_id": "rfq", "execution_time_seconds": 0.013, "at": "2026-10-23T05:17:41.691Z" }
```

`GET /queue`

What is waiting for a human, newest first (queue files plus runs that ended on `hold` with a draft); `[]` when empty.

```json
{ "ticket_id": "F2", "file": "F2.json", "category": "rfq", "decision_reason": "rfq: one unit price (189 GC), no volume tiers. Sales to quote.", "owner": { "employee_id": 6, "name": "Tomas Keller" }, "has_draft": true, "critiques": [], "mtime": "2026-10-23T05:17:41.690Z" }
```

`POST /runs/{id}/send`

Records that the reply on a held or escalated run went out. Body (optional): `{ "by": "Tomas Keller", "text": "..." }` (`by` up to 120 characters; `text` 1 to 4000, absent means the run's own draft).
Needs the bearer token when `API_TOKEN` is set, like the other POST routes.
Status rule: `hold` gives `handled`; `escalate` with `queued_for.approval` gives `handled`; `escalate` without an approval gives `follow_up`.
It writes the ticket's queue file under `data/memory/queue/`.
Returns `{ "run_id": "demo-1", "ticket_id": "F2", "status": "follow_up", "sent": { "run_id": "demo-1", "by": "Tomas Keller", "at": "...", "body": "...", "status": "follow_up", "ticket_id": "F2" }, "queue_file": "data/memory/queue/F2.json" }`.
400 when the run is not a hold or escalation, has no draft and no `text`, has no ticket id, or `text` is too long; 401 on a bad token; 404 on an unknown run; 405 for any other method; 409 when the run was already sent.

`GET /counters`

`{ "send": 0, "hold": 1, "escalate": 0, "close": 0, "queued": 0, "affirmed": 1, "rejected": 0 }` (`queued` is the escalate count).

`POST /feedback`

Affirms or rejects a decision: body `{ "run_id": "demo-1", "verdict": "affirm", "note": "good call" }` (`verdict` is `affirm | reject`).
Returns the decision row, for example `{ "run_id": "demo-1", "thread_id": "T02", "category": "refund", "decision": "hold", "verdict": "affirm", "delta": 0.05, "published": true }`.
400 on a bad verdict, 404 on an unknown run.

**Build B routing additions (25 October 2026).** `resolved_how: amount` means an over-limit GC refund was re-routed to the amount approver because its order was unknown or missing. `branch_id: thanks-request` holds an appreciation carrying a request, with a draft for a person. Existing branch and scenario display fields carry both additions; no page change is needed. Fixed-decision reply lines identify `source: template`; the typed gates and complaint reads still run. A held refund draft that promises money is replaced by the acknowledgement template without a model retry.

`POST /ask`

A question about policy, owners or a customer: body `{ "question": "Can I get a refund on my lightsaber?", "customer": "optional email or name" }`.
Returns `{ "run_id": "ask_...", "answer": "The refund limit is 150 GC: ...", "intent": "refund.request", "cited_rows": ["policy:refund"], "model": "sample/rules", "confidence": 0.294, "trace_id": "ask_..." }`.
A blocked question carries a `refused` object instead of an answer.

`GET /faq`

The FAQ rows: `[{ "faq_id": "Q11", "question": "Do you offer gift wrapping?", "answer": "...", "keywords": "gift wrap wrapping present" }]`, ordered by `faq_id`.
The internal `source` column is never returned.
Open on a token instance: the token applies to POST only.

`GET /demo/scenarios`

The 14 judge demo scenarios (the content of `public/demo-scenarios.json`): `{ id: "s01".."s14", label, scenario, reason (Refund|Question|Quote|Complaint|Other|Review|Email), channel, name, email, message, as_of, expected, client: "random" | "seeded-second-refund" }`.
`scenario` is what to POST as `input.scenario`; `expected` is `{ decision, branch, owner_id, team, auto_reply, status, draft, memory_note?, cc? }`.
The full table, as built, is in [API-CONTRACT-judge-scenarios.md](API-CONTRACT-judge-scenarios.md).

`GET /demo/client?scenario=s01`

A GENERATED client on every call, so a repeated demo never meets a prior refund: `{ "name": "Emeric Kettleby", "email": "emerickettleby@email.com", "generated": true }` (a fictional given and family name from two fixed lists of 40, lower-case `<given><family>@email.com`).
With `scenario=s04` it returns the seeded customer whose earlier refunds are on record: `{ "customer_id": "C002", "name": "Lira Venn", "email": "liravenn@email.com", "generated": false, "seeded_prior_refund": true }`.
Sent with `Cache-Control: no-store`; an unknown scenario id answers 400.

`GET /inbox`

The reference form (html), the page `GET /` used to be.

`GET /shop`

A 302 to `/shop/index.html`.

`GET /shop/{path}`

The storefront static files.
Closed extension list: `.html .css .js .json .svg .webp .png .jpg .woff2 .glb .mp4 .ico`; anything else, or any traversal, is a 404.

Also available, not needed by a front end:

`GET /health`

Adds `primary` (a cached probe, never a model call):

```json
{"mode":"live","reachable":true,"probe":"online","nemotron_listed":true,"checked_at":"2026-10-26T14:02:11.000Z","last_primary_answer_at":"2026-10-26T14:01:40.000Z","last_fallback_at":null,"last_fallback_reason":null,"fallback_in_use":false}
```

`reachable` means the gateway lists a Meterless route; `nemotron_listed` separately says whether it lists Nemotron. The probe is cached for 60 s, single-flight. The first request waits at most 2 s, then returns null probe fields while it finishes; later requests return cached data immediately. Sample mode never probes: `mode: "sample"`, all probe/time/reason fields null, `fallback_in_use: false`. Live results update the last-primary or last-fallback times; sample-forced runs do not. `fallback_in_use` is true if the probe is offline/unauthorized or the last fallback is newer than the last primary answer. Existing `ok` remains true even if the probe fails.

Liveness and mode: `{ "ok": true, "sample_mode": true, "version": "0.1.0", "uptime_s": 12 }`.

`GET /sources`

The registered data sources with row counts.

`GET /intake`

The contact-form submissions the REST source reads.

`GET /openapi.yaml`

The contract.

## 3. The journey shape

`GET /runs/{id}/journey` is derived from the stored result and the trace file.
No model call; every field is derived from the stored result and the trace lines.
Trimmed from `openapi.yaml`:

```json
{ "run_id": "ex-rfq", "scenario": "rfq", "resolved_how": "declared", "decision": "escalate",
  "input": { "kind": "message", "thread_id": "F2", "text": "Incoming RFQ for price difference ...", "from": "buyer@example.com", "name": null, "channel": "chat", "received_at": "...", "as_of": "2026-10-20" },
  "nodes": [ { "n": 1, "step": "memory.read", "agent": "Memory", "label": "Memory read", "route": "empty (cold first run)", "detail": null, "consulted": [], "retained": [], "reached_human": false, "status": "success", "model": null, "timestamp": "..." } ],
  "human": { "input": "...", "path": ["Memory read", "Plan", "Branch: rfq", "Hand-off", "Reply"],
             "reply": { "kind": "escalation", "text": "Hello,\n\nThank you, ...", "to": { "employee_id": 6, "name": "Tomas Keller", "role": "rfq owner" }, "attachments": ["products:FS-B01"], "blanks": [], "recommendation": "..." } },
  "reached_human": { "who": { "employee_id": 6, "name": "Tomas Keller" }, "what": ["the draft", "both critiques", "products:FS-B01"], "queue_file": "queue/F2.json" } }
```

The judge-scenarios build adds these fields, here and on `GET /runs/{id}` (`output`, `output.queued_for`).
Top level of the journey and of `output`: `team`, `team_label` (display name, fiction), `topic_label`, `cc[]` and `also[]` (`{ id, name, role, email }`, empty arrays when none), `status` (`open` | `handled` | `follow_up`), `auto_reply` (boolean), `memory_note` (H-MEM's sentence or `null`), `channel_label`, `trusted_to_send` (boolean, the trust-floor yes or no), `courtesy_reply` (true only on the legal route).
Each node gains `duration_ms` (since the previous line, 0 for the first), `tech` (`Zetaris` | `Meterless (Scout contract)` | `Meterless (World Model)` | `Nightshift (<model>)` | `OpenJev (<model>)` | `H-MEM` | `rules` | `not run`; see the contract page) and `returned` (Zetaris: the rows that hit, `[{ id, table, key, detail }]`; a model: its reply text; else `null`).
Trace lines carry `duration_ms` and `elapsed_ms` (since the run's first line) and millisecond timestamps.
Money is in GC (Galactic Credits): `amount`, `policy_limit`, `limit`, `unit_price`, `total`; SKUs are `FS-...`.
A quote rides `queued_for.attachments.quote`: `{ sku, quantity, tier, unit_price, discount_pct, total, currency: "GC", parts: [{ part_id, part_name, needed, stock, short }] }`.
The storefront build adds `sent` (null until a reply is sent; then `{ by, at, body, status, ticket_id, queue_file }`) and `ticket_status` to the journey, and `status` and `sent_at` (both nullable) to each `GET /queue` row.
A send overrides the journey `status`: once `POST /runs/{id}/send` succeeds, `status` is `handled` or `follow_up` by the rule in section 2, whatever the run said before.
Full field meanings and the status lifecycle: [API-CONTRACT-judge-scenarios.md](API-CONTRACT-judge-scenarios.md).

The derivation, in plain words:

- One node per trace line, in file order. A skipped step stays in the list with `route: "not reached: <what it would have read>"` and `status: "skipped"`.
- `consulted` is the ids that step looked at: the memory ids, the rows a Zetaris query returned, the ids on the World Model line.
- `retained` is the part of `consulted` that survived into the answer: it appears in the cited rows, in the memory written, in the draft text, or in what was attached for the human.
- `reached_human` is true on the hand-off step when it succeeded or was incomplete, and on the final reply step when the decision is `hold`. `reached_human` at the top level is `null` when nobody got anything.
- `human.reply.to` carries `email` and `employee_id: null` (its `name` is the desk label) when owner and backup are both out and the run was routed to the default contact desk. The page shows the desk label where it shows a name; the email is in `to.email`. `queued_for` keeps `owner_id` and `backup_id` and adds `fallback_contact` (`email`, `label`, `cited`), with `role` set to `default contact`.
- `model` is the model id when the step used one, else `null`. `label` is the plain-words name; `route` is what the step decided.
- `detail` is the rows in words when a Zetaris query read a record a person would want to see, else `null`: an employee as `Soren Adey · Support Agent · Support`, a policy as its limit and owners, a topic as its owner and backup. The same step's `route` keeps the count and the row ids. When the query ran for a reason the caller named, that reason sits in the trace line's `input_summary` after the parameters (`the employee record {"employee_id":15} · owner for refund: under the refund limit 150 (policy:refund)`).
- The function never throws: a missing piece is `null`.

Closed enums:

- `human.reply.kind`: `auto_reply` (decision `send`) | `draft_for_human` (decision `hold` with a draft) | `escalation` | `answer` (an `/ask` run) | `none` (`close`, or a `hold` with no draft).
- `resolved_how`: `declared | thread | scout | gates | faq | none | unrouted | amount` (how the scenario was decided).
- `input.kind`: `thread | message | ask`.

## 4. The two views

Left, titled **"How a person sees it"** (Kristof's wording; keep it): reads `human`.
On the storefront this is the contact page (`/shop/contact.html`), the member-facing front end: the customer submits the form there and reads the thread; the reference form at `/inbox` shows the same view.

- Input: `human.input` (or `input.text`, with `input.from` and `input.name`).
- Path: `human.path`, one chip per entry, in order.
- Reply: `human.reply.text`, with its out from `human.reply.kind`:
  - `auto_reply`: sent to the customer as is.
  - `draft_for_human`: a draft waiting for `to.name` (`to.role`) with `attachments` listed.
  - `escalation`: who got it (`to`) and what they got (`reached_human.what`, the attachments, the recommendation).
  - `none`: say plainly that nothing was sent.
- Blanks in the reply text are highlighted (section 6).

Right, **"Under the hood"**: reads `nodes`, one card per node.

- Header: `n`, `label`, and `step` / `agent` in small type.
- Body: `route`.
- Two chip lists: `consulted` (looked at) and `retained` (kept in the answer), visibly distinct.
- A human marker when `reached_human` is true.
- The `model` id when present.

Hovering a node highlights its entry in the path on the left (match by label and order, not by text alone: two nodes can share a label). The two sides scroll together.

## 5. Demo scenarios

Examples 4 to 9; every one pins `as_of: "2026-10-20"`, channel `chat`, so the answers do not drift with the calendar.
The inputs are in `input_examples/`, the results in `output_examples/`.
Each demo is `{label, scenario, name, email, message, as_of}`; the buttons only fill the form, nothing runs until Submit.

| # | Label | Scenario | Message | Expected |
|---|-------|----------|---------|----------|
| 4 | FAQ hit | absent (free text) | "How long does shipping take?" | `send`, branch `faq-hit`, the FAQ answer verbatim, `resolved_how: scout` |
| 5 | Not in the records | question | "Do you have a shop in Antwerp I can visit on Saturday?" | `escalate`, branch `question-unanswered`, to the question owner |
| 6 | RFQ price difference | rfq | "Incoming RFQ for price difference between ordering 100000 items and 100 (we only have 1 price ..." | `escalate` to Tomas Keller (sales, employee 6), acknowledgement draft, no quote to the customer |
| 7 | Complaint, just venting | complaint | "the box was dented, I am annoyed, just so you know" (Rey Kanata) | `hold`, branch `complaint-vent`, calm draft for the complaint owner |
| 8 | Complaint, severe | complaint | "This is the second training saber ... hilt split open ... I am talking to a lawyer ..." (Tilda Moss) | `escalate`, branch `complaint-legal` (it names a lawyer; it was `complaint-severe` before the legal route), severity 10, courtesy draft attached |
| 9 | Free text to customer service | absent (free text) | "Hi, I bought something from you last month for my nephew and now I need to change the delivery address, can you help?" | `hold`, branch `customer-service`, a recommendation and a draft with blanks |

Examples 4 to 9 are the original six reference-page scenarios.
The shipped `demo-scenarios.json` is now the 14 judge scenarios (s01 to s14, served by `GET /demo/scenarios`; their messages are `input_examples/example_10.json` to `example_23.json`), and the table is in [API-CONTRACT-judge-scenarios.md](API-CONTRACT-judge-scenarios.md).
If an output differs from a row here, the output file wins.

## 6. The blanks convention

Where a draft needs something the data cannot supply, it says so in the text: `[[blank: the new delivery address]]`.
Code never fills a blank and the model is forbidden to invent order numbers, dates, amounts or names.
`human.reply.blanks` lists them; the draft in the run result carries `draft.blanks` as `[{ "id": "...", "what": "..." }]` when it has any.
Highlight each `[[blank: what]]` in the text (a yellow marker showing only `what`) so the person knows what to fill before sending. Render it as text, never HTML.

## 7. The scenario picker

"Why are you contacting us?" is a radio group; the label maps to the `scenario` value:

| Label | Value |
|-------|-------|
| Refund | `refund` |
| A question | `question` |
| Request for quote | `rfq` |
| A complaint | `complaint` |
| Something else | `free_text` |

Sending `free_text`, or leaving `scenario` out, lets the service decide from the message.

## 8. Errors and the long request

Every error body has one shape, with an HTTP status of 400, 404, 409 or 5xx:

```json
{ "run_id": null, "status": "error", "error": { "type": "BadRequest", "message": "verdict must be affirm or reject", "recoverable": false }, "trace_id": null, "execution_time_seconds": 0.001 }
```

Show `error.message` as text. `type` is a name such as `BadRequest`, `NotFound`, `Conflict`; `recoverable: true` means trying again may work.
A run can also return 200 with `status: "error"`: check `status`, not only the HTTP code.

A live `POST /run` goes through real models and can take minutes (sample mode answers in milliseconds).
So: show the run id and elapsed seconds while it is in flight, disable Submit until it ends, never double-submit, and do not time out earlier than the server does.
Generate the `run_id` yourself and poll `GET /runs/{id}/progress` every 1.5 s while waiting, including after 502/504/524. `/trace`, `/journey` and `/runs/{id}` answer 404 until the run ends. A 404 on `/progress` in the first 5 s means not started; later it means lost or unknown. On `done`, load the journey. A retry with the same id is a 409, so use a fresh id for a deliberate re-run.

**Honest banner (front end: built by the teammate Paul assigns).** When `/health` `primary.fallback_in_use` is true, show “Nemotron is not answering right now: live runs use a fallback model”. For a run with `provider.primary_used === false`, show “Not every step ran on Nemotron: <fallback_reason>”, using the reason as text. It names the step, so a fallback critique is not described as a fallback draft.

## 9. The reference pages and what a replacement must keep

The service serves the storefront, the reference form and the dashboard, which have landed.
The storefront pages are `/shop/index.html`, `/shop/shop.html`, `/shop/product.html`, `/shop/faq.html` and `/shop/contact.html`.

`GET /`

A redirect page to the storefront (`/shop/index.html`).

`GET /inbox`

The reference form: picker, name, email, message, demo buttons, the two views.

`GET /dashboard`

Counters, the queue with drafts, recent runs (each linking to `/shop/contact.html?run=<id>`), affirm and reject buttons.

`GET /static/{name}`

Their script, stylesheet and `demo-scenarios.json`, from a closed list of names.

They are driven only by the API above: no private endpoint, no server-side rendering.
That is deliberate: the team's own front end can replace any of them.

A replacement must keep:

- The same endpoints and shapes (this page and `openapi.yaml`); the service does not change for it.
- CORS: the service sends `Access-Control-Allow-Origin: *`; keep calling it cross-origin, or serve your page from the same origin.
- The `api-base` meta, so the page can be pointed at another host without a rebuild.
- Model text (drafts, recommendations, reasons) rendered as text, never as HTML.
- On the contact page, the two-view layout and the title "How a person sees it".
- One in-flight `/run` at a time, with the run id and elapsed seconds shown.
- Static files only (no build step on the server; commit built output if you use a bundler).

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
CORS is open (`Access-Control-Allow-Origin: *`) and a shared instance may set `API_TOKEN`; then `POST /run`, `/ask` and `/feedback` need `Authorization: Bearer <token>`, while every GET, the pages and `/health` stay open.
JSON everywhere.
The reference pages read their API base from `<meta name="api-base" content="">`; an empty value means the same origin.
Your page should do the same: `fetch(base + "/run", ...)`.

## 1b. The hosted instance: https://jedi.blastworks.ai

The team shares one hosted instance at https://jedi.blastworks.ai. It is live from 23 Oct 2026 and goes down on 29 Oct 2026.
The pages are static files served from netcup (`X-Served-By: prodsites-netcup`). The API runs on the dev VM. Both answer on the same origin, so keep the `api-base` meta empty.
The pages are whatever `inbox/public/` holds on `main`. They follow `main` within about a minute of a merge, once the deploy key is in place; until then a seed of the 23 Oct `main` is served.
The API follows `main` within about two minutes. It has its own release timer and rolls back if the health check fails.
Static files only: there is no build step on the server. Commit the built output if you use a bundler.
`/static/<name>` maps to `public/<name>`, and `/dashboard` maps to `public/dashboard.html`. The hosted instance serves any file under `inbox/public/`. The reference server in a clean clone serves only its closed list (`app.js`, `dashboard.js`, `style.css`, `demo-scenarios.json`).
Hidden files (any path segment starting with `.`) are 404 on the hosted instance.
A new API route needs its line in the netcup proxy list. Ask Kristof.
The write calls need the bearer token (section 1). It is handed over directly, never committed. A page takes `?token=` once and then strips it from the address bar after reading it.
Cloudflare's edge returns a gateway error after about 100 s with no response, while the run completes server-side. Generate your own `run_id` before `POST /run` (section 2 allows it) and, after any gateway error, poll `GET /runs/{id}` with that id.
On your own machine, run `SAMPLE_MODE=true npm start`, or point the `api-base` meta at the hosted host.

## 2. The endpoints the front end uses

`POST /run`

Runs the loop on one ticket and returns the result (also kept for `GET /runs/{id}`).
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

Optional fields a line may carry: `target_agent`, `model`, `confidence`, `retry_count`, `branch_id`, `memory_ids`, `sponsor`, `gate_source`, and on a Zetaris query `detail` (the rows in words; section 3).

`GET /runs/{id}/journey`

The run as a journey a person can read (section 3); 404 when the run or its trace file is gone.

`GET /runs?limit=`

The stored runs and asks, newest first; `limit` 1 to 200, default 50; a bad `limit` is 400.

```json
{ "run_id": "ex-rfq", "kind": "run", "scenario": "rfq", "decision": "escalate", "thread_id": "F2", "branch_id": "rfq", "execution_time_seconds": 0.013, "at": "2026-10-23T05:17:41.691Z" }
```

`GET /queue`

What is waiting for a human, newest first (queue files plus runs that ended on `hold` with a draft); `[]` when empty.

```json
{ "ticket_id": "F2", "file": "F2.json", "category": "rfq", "decision_reason": "rfq: one unit price (189 USD), no volume tiers. Sales to quote.", "owner": { "employee_id": 6, "name": "Tomas Keller" }, "has_draft": true, "critiques": [], "mtime": "2026-10-23T05:17:41.690Z" }
```

`GET /counters`

`{ "send": 0, "hold": 1, "escalate": 0, "close": 0, "queued": 0, "affirmed": 1, "rejected": 0 }` (`queued` is the escalate count).

`POST /feedback`

Affirms or rejects a decision: body `{ "run_id": "demo-1", "verdict": "affirm", "note": "good call" }` (`verdict` is `affirm | reject`).
Returns the decision row, for example `{ "run_id": "demo-1", "thread_id": "T02", "category": "refund", "decision": "hold", "verdict": "affirm", "delta": 0.05, "published": true }`.
400 on a bad verdict, 404 on an unknown run.

`POST /ask`

A question about policy, owners or a customer: body `{ "question": "Can I get a refund on my lightsaber?", "customer": "optional email or name" }`.
Returns `{ "run_id": "ask_...", "answer": "The refund limit is 150 USD: ...", "intent": "refund.request", "cited_rows": ["policy:refund"], "model": "sample/rules", "confidence": 0.294, "trace_id": "ask_..." }`.
A blocked question carries a `refused` object instead of an answer.

Also available, not needed by a front end:

`GET /health`

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
             "reply": { "kind": "escalation", "text": "Hello,\n\nThank you, ...", "to": { "employee_id": 6, "name": "Tomas Keller", "role": "rfq owner" }, "attachments": ["products:P01"], "blanks": [], "recommendation": "..." } },
  "reached_human": { "who": { "employee_id": 6, "name": "Tomas Keller" }, "what": ["the draft", "both critiques", "products:P01"], "queue_file": "data/memory/queue/F2.json" } }
```

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
- `resolved_how`: `declared | thread | scout | gates | faq | none | unrouted` (how the scenario was decided).
- `input.kind`: `thread | message | ask`.

## 4. The two views

Left, titled **"How a person sees it"** (Kristof's wording; keep it): reads `human`.

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
| 8 | Complaint, severe | complaint | "This is the second training saber ... hilt split open ... I am talking to a lawyer ..." (Tilda Moss) | `escalate`, branch `complaint-severe`, severity 10, draft attached |
| 9 | Free text to customer service | absent (free text) | "Hi, I bought something from you last month for my nephew and now I need to change the delivery address, can you help?" | `hold`, branch `customer-service`, a recommendation and a draft with blanks |

The shipped `demo-scenarios.json` (reference page) is the machine-readable copy of this table.
Example 9 is built in the same checkpoint as this page: if its output differs from this row, the output file wins.

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
Generate the `run_id` yourself if you want to poll `GET /runs/{id}/trace` for progress while waiting; a retry with the same id is a 409, so use a fresh id for a deliberate re-run.

## 9. The reference pages and what a replacement must keep

The service serves two reference pages, which have landed:

`GET /`

The unified front end: picker, name, email, message, demo buttons, the two views.

`GET /dashboard`

Counters, the queue with drafts, recent runs (each linking to `/?run=<id>`), affirm and reject buttons.

`GET /static/{name}`

Their script, stylesheet and `demo-scenarios.json`, from a closed list of names.

They are driven only by the API above: no private endpoint, no server-side rendering.
That is deliberate: the team's own front end can replace either one, or both.

A replacement must keep:

- The same endpoints and shapes (this page and `openapi.yaml`); the service does not change for it.
- CORS: the service sends `Access-Control-Allow-Origin: *`; keep calling it cross-origin, or serve your page from the same origin.
- The `api-base` meta, so the page can be pointed at another host without a rebuild.
- Model text (drafts, recommendations, reasons) rendered as text, never as HTML.
- The two-view layout and the title "How a person sees it".
- One in-flight `/run` at a time, with the run id and elapsed seconds shown.
- Static files only (no build step on the server; commit built output if you use a bundler).

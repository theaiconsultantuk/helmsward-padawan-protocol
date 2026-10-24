# API contract for the 14 judge scenarios (Plan 1 to Plan 2)

One page for whoever builds the pages. It states what the API returns for the 14 demo scenarios, as built in sample mode, and what every new field means.
The machine-readable copies are `public/demo-scenarios.json` (served by `GET /demo/scenarios`) and `openapi.yaml`. If this page and a run's output differ, the output wins and this page is a bug.

## Calls a page makes

| Call | Returns |
|---|---|
| `GET /demo/scenarios` | the 14 entries: `{ id, label, scenario, reason, channel, name, email, message, as_of, expected, client }` |
| `GET /demo/client?scenario=<id>` | a GENERATED client `{ name, email, generated: true }`, no-store; `s04` returns the seeded customer `{ customer_id, name, email, generated: false, seeded_prior_refund: true }`; `s10` returns the owner of order JP-1001, Cass Holm: `{ customer_id, name, email: "cass.holm@example.com", generated: false, order_owner: true, order_id }` |
| `GET /faq` | `[{ faq_id, question, answer, keywords }]`, no `source` |
| `POST /run` | body `{ run_id?, input: { message, from, name, channel, scenario, as_of } }` (the shape of `input_examples/example_10.json` to `example_23.json`) |
| `GET /runs/{id}/journey` | the journey with the new fields below |

The token (`API_TOKEN`) applies to POST only; the three GETs above are open.
`scenario` in an entry is the declared scenario to POST. The five values are `refund`, `question`, `rfq`, `complaint`, `free_text`. A refund must be declared: left undeclared, a message that names a product is read as a product question.
`reason` is the picker label: Refund, Question, Quote, Complaint, Other, Review (s13, channel `trustpilot`), Email (s14, channel `email`).
`name`/`email` in an entry are a fallback client. Call `GET /demo/client` for each run so a repeated demo never meets a prior refund; use the entry's `as_of` so a judge's machine date changes nothing.

## The 14 scenarios, as built

Owner is `output.owner` (`{ employee_id, name, role, team, team_label }`), set on every decision: the person a hold or escalate waits on (the backup when the owner is out, the approver over the limit), and for an auto reply the default owner of the team it was sent on behalf of.
`cc` lists employee ids in copy. `trusted_to_send` is shown because it is not what decides an auto reply (see below).

| # | Scenario (reason, channel) | Message | as_of | Branch | Decision | Owner (team) | cc | Draft | auto_reply | status | memory_note | trusted_to_send |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s01 | Refund within the limit, approver in (Refund, contact-form) | "I would like a refund of 80 GC for my Drift Boot Wraps, they are too small for my son." | 2026-10-25 | `under-floor` | hold | 15 (Support) | none | yes | no | open | none | false |
| s02 | Refund, approver out (Refund, contact-form) | same message | 2026-10-27 | `under-floor` | hold | 27 (Support; the reason names 15 out) | none | yes | no | open | none | false |
| s03 | Refund over the limit (Refund, contact-form) | "I would like a refund of 400 GC for my Sovereign Arc Duellist, the blade will not ignite." | 2026-10-25 | `over-limit` | escalate | 40 (Sales head); the CEO 201 when 40 is out | none | yes, approval attached | no | open | none | false |
| s04 | Second refund, seeded client Lira Venn (Refund, contact-form) | "I would like another refund, 60 GC, for the strap on my Drift Boot Wraps." | 2026-10-25 | `under-floor` | hold | 15 (Support) | none | yes | no | open | "Second Refund Request from this client (2 earlier: T02, T06)." | false |
| s05 | Product question, answered (Question, contact-form) | "What is the primary material used in the Sovereign Arc Duellist?" | 2026-10-25 | `product-hit` | send | 5 (Product), sent on behalf of Product | none | the answer | yes | handled | none | false |
| s06 | Product question, not in the row (Question, chat) | "Is the Wayfarer Long Cloak waterproof?" | 2026-10-25 | `product-unanswered` | hold | 5 (Product) | none | no | no | open | none | false |
| s07 | Bulk quote, 25 units (Quote, email) | "Hello, could you send us a quote for 25 Vanta Arc Trainers for our academy? Thank you." | 2026-10-25 | `rfq-quote` | hold | 6 (Sales) | none | the quote, with parts | no | open | none | false |
| s08 | Mild injury complaint (Complaint, email) | "This is unacceptable: the hot emitter of my Vanta Arc Trainer gave my son a small burn." | 2026-10-25 | `complaint-genuine` | hold | 15 (Support) | none | yes | no | open | none | false |
| s09 | Legal threat (Complaint, email) | "The Strand Emitter Hilt split open in my hands and I have spoken to my lawyer. If I do not hear from you I will sue." | 2026-10-25 | `complaint-legal` | escalate | 15 (Support), also 203 (Legal counsel) | 7 (Head of Support), 202 (Head of Legal) | courtesy draft, `courtesy_reply: true` | no | open | none | false |
| s10 | Delivery to a suspended planet (Other, contact-form) | "Where is my order JP-1001? It was meant to arrive weeks ago." | 2026-10-25 | `delivery-suspended` | send | 15 (Support), sent on behalf of Support | none | the rule's note | yes | handled | none | true |
| s11 | Other, FAQ hit (Other, chat) | "Do you offer gift wrapping?" | 2026-10-25 | `faq-hit` | send | 15 (Support), sent on behalf of Support | none | the FAQ answer | yes | handled | none | false |
| s12 | Other, no answer on record (Other, chat) | "Can I book the Coruscant store for a private birthday party?" | 2026-10-25 | `other-unanswered` | hold | 15 (Support) | none | no | no | open | none | false |
| s13 | Trustpilot complaint (Review, trustpilot) | "The Drift Boot Wraps arrived scuffed and I am disappointed. Posting my honest review here." | 2026-10-25 | `complaint-genuine` | hold | 15 (Support) | none | yes | no | open | none | false |
| s14 | Direct email to info@ (Email, email) | "Hi, my package arrived with a dented box." | 2026-10-25 | `complaint-vent` | hold | 15 (Support) | none | yes | no | open | none | false |

Differences from the planning table, so a card does not wait for them:
- s14 takes `complaint-vent` (a mild dented-parcel complaint), not `customer-service`. The route is still a Support draft.
- s07 is 25 units. The 50-unit quote that goes over the quote limit (`rfq-quote-over-limit`, escalate to 40, the CEO 201 when 40 is out) and the quote with a part out of stock (`rfq-quote-stock`) are grid cells, not demo entries.
- `trusted_to_send` is false on a reply composed from rows (s05, s11) and the reply still sends, see below.
- A plain hold (`under-floor`, s01, s02, s04) carries `output.queued_for` with the person it waits for: `owner_id`, `backup_id`, the names, `team`, `team_label` and `queued_for.owner` (the same object as `output.owner`: 15 on s01 and s04, 27 on s02 where the owner is out and the backup holds it). It writes no queue file, so `queued_for.queue_file` is absent.
- Team and team_label always come from one employee row: s11 (FAQ auto reply, owner 15 Support) reads `team: "Support"`, `team_label: "Helpful Hands Hangar"`, never Product's "Gizmo Forge".

## New fields

They appear on `GET /runs/{id}` as `output.<field>` and in `output.queued_for` where the run queues for a person, and at the top level of `GET /runs/{id}/journey`.

| Field | Type | Meaning | Example |
|---|---|---|---|
| `team` | string | the team that owns the ticket, or the team an auto reply is sent on behalf of | `"Support"` |
| `team_label` | string | the team's display name (fiction, label only; team names and decision values do not change) | `"Helpful Hands Hangar"` |
| `topic_label` | string | the topic's display name | `"Department of Giving It Back"` |
| `channel_label` | string | the channel's display name | `"Direct email"`, `"Contact form"` |
| `cc` | `[{ id, name, role, email }]` | people in copy; the heads on a legal route, else `[]` | `[{ "id": 7, "name": "Mei-Ling Zhao", "role": "Head of Support", "email": "mei-ling.zhao@jedipack.com" }]` |
| `also` | `[{ id, name, role, email }]` | others the ticket is also routed to; Legal counsel on a legal route, else `[]` | `[{ "id": 203, "name": "Mara Quillfeather", "role": "Legal Counsel", "email": "mara.quillfeather@jedipack.com" }]` |
| `status` | `open` / `handled` / `follow_up` | see the lifecycle | `"open"` |
| `auto_reply` | boolean | true only when the draft was sent (decision `send`); a hold or escalate is never an auto reply | `true` |
| `memory_note` | string or null | H-MEM's note; on a repeat refund it is einh's sentence | `"Second Refund Request from this client (2 earlier: T02, T06)."` |
| `trusted_to_send` | boolean | the trust-floor yes or no | `false` |
| `courtesy_reply` | boolean | present and true only on the legal route (`complaint-legal`): the draft is a courtesy reply | `true` |
| `owner` | `{ employee_id, name, role, team, team_label }` | the person the ticket is with, on every decision; also in `queued_for.owner` when the run queues | `{ "employee_id": 15, "name": "Soren Adey", "role": "Support Agent", "team": "Support", "team_label": "Helpful Hands Hangar" }` |
| `backup_team` | string or null | the backup's team, read only when the owner is out or the route names one | `"Support"` |
| `duration_ms` | integer | on a journey node and a trace line: milliseconds since the previous line of the same run, 0 for the first | `3` |
| `elapsed_ms` | integer | on a trace line: milliseconds since the run's first line | `41` |
| `tech` | string | on a journey node: what did the step | `"Zetaris"` |
| `returned` | see below | on a journey node: what the step handed back | see below |

A quote is `output.queued_for.attachments.quote`:

```json
{ "sku": "FS-B01", "quantity": 25, "tier": "squad", "unit_price": 170.1, "discount_pct": 10, "total": 4252.5, "currency": "GC",
  "parts": [ { "part_id": "PT-0001", "part_name": "Humming emitter coil (Mk 1)", "needed": 25, "stock": 2232, "short": false },
             { "part_id": "PT-0002", "part_name": "Smug status LED (Mk 2)", "needed": 50, "stock": 1070, "short": false } ] }
```

A part with `short: true` holds the quote for Sales (`rfq-quote-stock`).
All money is GC (Galactic Credits). Field names are `amount`, `policy_limit`, `limit`, `unit_price`, `total`; SKUs are `FS-...`, parts `PT-....`

## The status lifecycle

- `open` is set at routing for every hold and escalate.
- `handled` is set at routing for an auto reply (decision `send`, `auto_reply: true`): nobody has to act.
- Plan 2's `POST /runs/{id}/send` sets the final status when a person sends the draft: `handled`, or `follow_up` when the run carries `courtesy_reply: true` (s09: the courtesy reply goes out now, Legal still reviews).
- Plan 1 persists nothing new: the status is a field of the run result and the queue entry; the send endpoint owns the write.

## `trusted_to_send`

The trust floor is the yes or no on whether the draft cleared the floor (a weight of 0.80). It does not decide an auto reply. A reply composed from rows (the FAQ answer, the product-row answer, the shipping rule's note) sends because the text IS the row, and `trusted_to_send` can be false on it: s11 and s05 send with `false`, s10 sends with `true`. Show the field as the trust-floor result, never as "may send".

## Which decisions send

A decision `send` needs a non-empty draft and a channel whose `channels.csv` row does not say `autonomous_reply` false (one function, `sendEligible` in `src/loop.mjs`, used by every send path). Two kinds of run send:
- The automatic replies composed from rows (branches `product-hit`, `delivery-*`, `faq-hit`, or a handler that sets `auto_reply: true`): decision `send`, `auto_reply: true`.
- The legacy `send-ok` branch (an appreciation thank-you whose weight meets the floor, within the limit, someone available): decision `send` with `auto_reply: false`, because the loop only sets `auto_reply` for the automatic replies above. A person still sends it from the card. T19 (contact-form) is the example.

No run sends on a channel whose row says `autonomous_reply` false (today only `trustpilot`). A send there becomes a `hold` for the owner with the draft kept, `auto_reply: false`, status `open`, and a reason that cites `channels:<channel>`: "replies on this channel are sent by a person". T18 (a Trustpilot appreciation that clears the floor) is the example: it holds with its thank-you drafted for Support.

## What `returned` holds, per `tech`

`tech` is one of `Zetaris`, `Meterless (Scout contract)`, `Meterless (World Model)`, `Nightshift (<model>)`, `OpenJev (<model>)`, `H-MEM`, `rules` or `not run`, read only from the line's own step, agent, sponsor, model and gate_source; `unknown` only when a line records none of them.
Nemotron and every other model the Drafter, Evaluator, Readers and Recommender call is `Nightshift (<model>)`; `OpenJev (<model>)` is only the OpenJev typed gate (gate_source `openjev`); the Scout contract and the World Model are Meterless engine steps with no model call; Risk's sign-off and every sample/rules line is `rules`; a skipped step is `not run`.
_Fixed 24 Oct before the merge: the first cut labelled every non-sample model OpenJev and every Meterless line Nightshift (from the HACKATHON orchestrator's review, msg-1945); a test pins each label on a real live trace._

- `Zetaris`: the rows that HIT, not the scanned count: `[{ "id": "employees:15", "table": "employees", "key": "15", "detail": "Soren Adey · Support Agent · Support" }]`; `[]` when the query matched nothing (the FAQ node's `returned` is exactly the hit row).
- `Nightshift (<model>)` and `OpenJev (<model>)`: the model's reply text as the trace recorded it.
- `H-MEM`, `Meterless (…)`, `rules`, `not run`: `null` (the node's own summary carries what it did).

## Files and who owns them

- Plan 1 (this build) owns the content of `public/demo-scenarios.json`, `input_examples/example_10.json` to `example_23.json`, `openapi.yaml`, `docs/FRONTEND-SPEC.md`, this page and the three GETs in `src/server.mjs`.
- Plan 2 owns `public/shop/**`, `public/app.js`, `public/index.html`, `public/style.css` and the send endpoint (`POST /runs/{id}/send`) in `src/server.mjs`.
- Plan 2 may add fields to `demo-scenarios.json` additively after this lands (for example `group`, `subject`, `to` for s14 and `review { rating, title }` for s13); it never keeps a second copy of the file.

## Open items

- A plain hold (`under-floor`) is not written to `GET /queue` (no queue file). Its journey names the person: `reached_human.who` and `human.reply.to` are the owner, and `reached_human.queue_file` is absent.
- A message listing two or more amounts in one currency with no word "total" is read as their sum (Paul's H17, "90 + 90 + 90"); "I paid 90 GC, refund the 90 GC" would read as 180.

## Wave-1 wording and trace changes

- `output.queued_for.queue_file` (`POST /run`, `GET /runs/:id`) and the journey's `reached_human.queue_file` are `queue/<thread_id>.json`, relative to the memory dir, never the server's absolute path. It is `null` when the queue write failed and absent on a plain hold.
- The `escalate_or_fallback` trace text says `stored in queue/F12.json`.
- A free-text intake draft says `You wrote about "<whole first sentence>".`, or `Thank you for your message.` when there is no sentence to quote.
- A derived free-text subject ends with "…" when the message is longer than 60 characters.
- `zetaris.query` trace lines now carry `detail` on trust, channel, wiki, holiday, prior refunds, the duplicate check, the ledger, products, the FAQ, the order, the shipping rule and more.
- `memory.read` excerpts end with "…" when they were cut.
- The fixture step tokens (`tests/fixtures/scenario_shapes.json`) for s05, s06 and s11 no longer expect a skipped typed-gates line before `planner.plan`: that line is `skipped` in sample mode and `success` on a live run, so both modes carry the same tokens. A token ending in ":" (s13, s14) matches any branch id.

## Routing changes (builder A1)

- **Order ownership.** Only the order's customer gets the delivery answer. s10 must be sent by the order's owner (JP-1001 is C003 Cass Holm, `cass.holm@example.com`), so its demo `client` value is `seeded-order-owner`. Anyone else who quotes an order id takes the new branch `delivery-not-owner`: hold, status `open`, `auto_reply` false, no draft, team Support, owner 15. The reason reads "order JP-xxxx does not belong to the sender; a person checks it, nothing about the order is sent. Held for Support, no draft", and nothing about the order (status, address, planet) leaves in the response or the trace text. This replaces the earlier open item that delivery replies went to anyone quoting a real order id.
- **`other-unanswered`** is also reached by a resolved free-text question that names no product and has no FAQ hit; its reason reads "...names no product; checked ...". A question that is declared `scenario: question` and finds nothing stays `question-unanswered` (escalate to the Product owner 5).
- **`complaint-genuine`** is reachable at severity 9 to 10 when the customer calls the injury mild (s08); the recommendation then starts "safety report, <injury> (self-described as mild)".

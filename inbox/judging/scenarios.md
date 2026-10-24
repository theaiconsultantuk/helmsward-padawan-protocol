---
title: Scenario proofs
description: Examples 4 to 8 and 10 to 23 (the 14 demo scenarios) run live and in sample mode with the traces, the models, the World Model line and the journey reply for each.
date: 2026-10-25
tags: [judging, scenarios]
---

# Scenario proofs

Command: `node inbox/scripts/scenario_proofs.mjs` (starts its own server from `src/server.mjs` with the real `.env`; `B=<url>` uses an existing one). Run time (Europe/Brussels): 2026-10-25 00:08:02.

Each example runs through `POST /run`: live (`options.sample_mode: false`) and sample (`options.sample_mode: true`). The traces are copied from `GET /runs/<id>/trace` as the service wrote them; the script writes no trace line. Both traces must contain the fixture's `step:status:branch_id` subsequence for the cell. Overall: all checks passed.

Live legs: skipped (no live config), so this page shows the sample legs; the live legs run against the live service after the merge (CP6).

| Example | Cell | Live | Sample | Subsequence live / sample |
|---|---|---|---|---|
| 4 | question-hit | skipped (no live config) | send / faq-hit | skipped / ok |
| 5 | question-unanswered | skipped (no live config) | escalate / question-unanswered | skipped / ok |
| 6 | rfq-no-product | skipped (no live config) | escalate / rfq | skipped / ok |
| 7 | complaint-vent | skipped (no live config) | hold / complaint-vent | skipped / ok |
| 8 | s09-legal-threat | skipped (no live config) | escalate / complaint-legal | skipped / ok |
| 10 | s01-refund-in-limit | skipped (no live config) | hold / under-floor | skipped / ok |
| 11 | s02-refund-approver-out | skipped (no live config) | hold / under-floor | skipped / ok |
| 12 | s03-refund-over-limit | skipped (no live config) | escalate / over-limit | skipped / ok |
| 13 | s04-second-refund | skipped (no live config) | hold / under-floor | skipped / ok |
| 14 | s05-product-hit | skipped (no live config) | send / product-hit | skipped / ok |
| 15 | s06-product-unanswered | skipped (no live config) | hold / product-unanswered | skipped / ok |
| 16 | s07-bulk-quote | skipped (no live config) | hold / rfq-quote | skipped / ok |
| 17 | s08-mild-injury | skipped (no live config) | hold / complaint-genuine | skipped / ok |
| 18 | s09-legal-threat | skipped (no live config) | escalate / complaint-legal | skipped / ok |
| 19 | s10-delivery-suspended | skipped (no live config) | send / delivery-suspended | skipped / ok |
| 20 | s11-other-faq-hit | skipped (no live config) | send / faq-hit | skipped / ok |
| 21 | s12-other-unanswered | skipped (no live config) | hold / other-unanswered | skipped / ok |
| 22 | s13-trustpilot-complaint | skipped (no live config) | hold / complaint-genuine | skipped / ok |
| 23 | s14-direct-email-complaint | skipped (no live config) | hold / complaint-vent | skipped / ok |

## Example 4: question-hit

Input (`input_examples/example_4.json`):

- message: `How long does shipping take?`
- from: `a@example.com`
- channel: `chat`; scenario: `(not declared)`; as_of: `2026-10-20`

Checked against: fixture cell `question-hit`: `zetaris.query:success:`, `meterless.engine:success:`, `branch:success:faq-hit`, `nvidia.model:skipped:faq-hit`, `critique:skipped:faq-hit`, `risk.signoff:success:faq-hit`, `memory.write:success:faq-hit`, `synthesis:success:faq-hit`.

### Live (`scenario-4-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-4-sample`)

- decision: `send`; scenario `question`; resolved `scout`; branch `faq-hit`; 0 s
- branch line, why: FAQ Q01 matches (score 1.00, shared: long, shipping, take); FAQ text is canonical, the floor gates model drafts
- journey human.reply: kind `auto_reply`, to `null`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello, Shipping time depends on your region and the product. Your order confirmation shows the estimate for your address, and customer service can tell you where your order is. Best regards, Jedi Pack`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `true`; status `handled`; memory_note `none`
- trace: `judging/traces/trace-scenario-4-sample.jsonl` (26 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 5: question-unanswered

Input (`input_examples/example_5.json`):

- message: `Do you have a shop in Antwerp I can visit on Saturday?`
- from: `a@example.com`
- channel: `chat`; scenario: `question`; as_of: `2026-10-20`

Checked against: fixture cell `question-unanswered`: `branch:success:question-unanswered`, `critique:skipped:question-unanswered`, `risk.signoff:skipped:question-unanswered`, `escalate_or_fallback:success:question-unanswered`, `memory.write:success:question-unanswered`, `synthesis:success:question-unanswered`.

### Live (`scenario-5-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-5-sample`)

- decision: `escalate`; scenario `question`; resolved `declared`; branch `question-unanswered`; 0 s
- branch line, why: no FAQ match and no record shares two words with the question; checked the FAQ (18 rows), 1 wiki page(s)
- journey human.reply: kind `escalation`, to `{"employee_id":5,"name":"Priya Raman","role":"question owner"}`, attachments none, recommendation `not in the FAQ or the records; checked: the FAQ (18 rows), 1 wiki page(s)`
- reply text (first 200 chars): `(no text)`
- owner `5 Priya Raman (Product)`; cc `[]`; auto_reply `false`; status `open`; memory_note `H-MEM recalls 1 earlier decision(s) for this client.`
- trace: `judging/traces/trace-scenario-5-sample.jsonl` (27 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 6: rfq-no-product

Input (`input_examples/example_6.json`):

- message: `Incoming RFQ for price difference between ordering 100000 items and 100 (we only have 1 price, so I would like to see how our flow responds`
- from: `einh@example.com`
- channel: `chat`; scenario: `rfq`; as_of: `2026-10-20`

Checked against: fixture cell `rfq-no-product`: `branch:success:rfq`, `risk.signoff:success:rfq`, `escalate_or_fallback:success:rfq`, `memory.write:success:rfq`, `synthesis:success:rfq`.

### Live (`scenario-6-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-6-sample`)

- decision: `escalate`; scenario `rfq`; resolved `declared`; branch `rfq`; 0 s
- branch line, why: request for a quote: no product matched, quantities 100000, 100; sales quotes, prices attached
- journey human.reply: kind `escalation`, to `{"employee_id":6,"name":"Tomas Keller","role":"rfq owner"}`, attachments none, recommendation `Quantities asked: 100000 and 100; no product in the records matches; sales to identify.`
- reply text (first 200 chars): `Hello, Thank you, your request for a quote is with our sales team, who will come back to you with the price for 100000 and 100. Best regards, Jedi Pack Support team`
- owner `6 Tomas Keller (Sales)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-6-sample.jsonl` (27 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 7: complaint-vent

Input (`input_examples/example_7.json`):

- message: `the box was dented, I am annoyed, just so you know`
- from: `new.customer@example.com` (Rey Kanata)
- channel: `chat`; scenario: `complaint`; as_of: `2026-10-20`

Checked against: fixture cell `complaint-vent`: `branch:success:complaint-vent`, `critique:success:complaint-vent`, `risk.signoff:success:complaint-vent`, `escalate_or_fallback:skipped:complaint-vent`, `synthesis:success:complaint-vent`.

### Live (`scenario-7-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-7-sample`)

- decision: `hold`; scenario `complaint`; resolved `declared`; branch `complaint-vent`; 0.1 s
- branch line, why: severity 4 (4), the customer reads as vent (no earlier threads); a calm acknowledgement closes it
- world_context line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.387Z","duration_ms":48,"elapsed_ms":53,"run_id":"scenario-7-sample","trace_id":"scenario-7-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of new.customer@example.com and no product","output_summary":"250 entities, 228 relationships; customer none: 0 earlier threads, 0 complaints, public no; product none: 0 complaints; ids: none","status":"success","branch_id":"complaint-vent","memory_ids":[],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.389Z","duration_ms":1,"elapsed_ms":55,"run_id":"scenario-7-sample","trace_id":"scenario-7-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F4","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 4 (4), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-vent","sponsor":"nvidia","gate_source":"rules"}
```

- journey human.reply: kind `draft_for_human`, to `{"employee_id":15,"name":"Soren Adey","role":"complaint owner"}`, attachments none, recommendation `vent: a calm reply closes it; no action`
- reply text (first 200 chars): `Hello Rey Kanata, Thank you for letting us know. We are sorry the order did not arrive as you hoped, and we have noted it. Best regards, Jedi Pack Support team`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-7-sample.jsonl` (32 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 8: s09-legal-threat

Input (`input_examples/example_8.json`):

- message: `This is the second training saber from you whose hilt split open in my son's hands and cut him. I will post this review everywhere and I am talking to a lawyer. Never again. I want this fixed today.`
- from: `tilda.moss@example.com` (Tilda Moss)
- channel: `chat`; scenario: `complaint`; as_of: `2026-10-20`

Checked against: fixture cell `s09-legal-threat`: `branch:success:complaint-legal`, `risk.signoff:success:complaint-legal`, `escalate_or_fallback:success:complaint-legal`, `memory.write:success:complaint-legal`, `synthesis:success:complaint-legal`.

### Live (`scenario-8-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-8-sample`)

- decision: `escalate`; scenario `complaint`; resolved `declared`; branch `complaint-legal`; 0 s
- branch line, why: severity 10 (10 legal or safety), the customer reads as genuine (3 earlier threads on record); a legal threat: a courtesy reply now, Support owns it and Legal reviews
- world_context line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.415Z","duration_ms":1,"elapsed_ms":11,"run_id":"scenario-8-sample","trace_id":"scenario-8-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of tilda.moss@example.com and no product","output_summary":"250 entities, 228 relationships; customer customer:email:tilda.moss@example.com: 3 earlier threads, 0 complaints, public no; product none: 0 complaints; ids: customer:email:tilda.moss@example.com,thread:jedi:T11,thread:jedi:T24,thread:jedi:T14,fact_7f40a4af1de84630,fact_5cd1152f7c761dab","status":"success","branch_id":"complaint-legal","memory_ids":["customer:email:tilda.moss@example.com","thread:jedi:T11","thread:jedi:T24","thread:jedi:T14","fact_7f40a4af1de84630","fact_5cd1152f7c761dab"],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.415Z","duration_ms":1,"elapsed_ms":11,"run_id":"scenario-8-sample","trace_id":"scenario-8-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F5","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 10 (10 legal or safety), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-legal","sponsor":"nvidia","gate_source":"rules"}
```

- journey human.reply: kind `escalation`, to `{"employee_id":15,"name":"Soren Adey","role":"complaint owner"}`, attachments none, recommendation `courtesy reply now, Legal reviews; the send marks follow-up`
- reply text (first 200 chars): `Hello Tilda Moss, We are sorry to read what happened with your order. We are looking into it now and will come back to you within two working days. Best regards, Jedi Pack Support team`
- owner `15 Soren Adey (Support)`; cc `[7,202]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-8-sample.jsonl` (42 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 10: s01-refund-in-limit (demo scenario s01)

Input (`input_examples/example_10.json`):

- message: `I would like a refund of 80 GC for my Drift Boot Wraps, they are too small for my son.`
- from: `alvaneashdown@email.com` (Alvane Ashdown)
- channel: `contact-form`; scenario: `refund`; as_of: `2026-10-25`

Checked against: fixture cell `s01-refund-in-limit`: `branch:success:under-floor`, `critique:success:under-floor`, `risk.signoff:success:under-floor`, `memory.write:success:under-floor`, `synthesis:success:under-floor`.

### Live (`scenario-10-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-10-sample`)

- decision: `hold`; scenario `refund`; resolved `declared`; branch `under-floor`; 0 s
- branch line, why: refund weight 0.55 is under the floor 0.8; owner 15 in
- journey human.reply: kind `draft_for_human`, to `{"employee_id":15,"name":"Soren Adey","role":null}`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello Alvane Ashdown, You wrote about "I would like a refund of 80 GC for my Drift Boot Wraps, they are too small for my son". We are looking into your refund request. Best regards, Jedi Pack Support `
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-10-sample.jsonl` (26 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 11: s02-refund-approver-out (demo scenario s02)

Input (`input_examples/example_11.json`):

- message: `I would like a refund of 80 GC for my Drift Boot Wraps, they are too small for my son.`
- from: `briskbrightmoor@email.com` (Brisk Brightmoor)
- channel: `contact-form`; scenario: `refund`; as_of: `2026-10-27`

Checked against: fixture cell `s02-refund-approver-out`: `branch:success:under-floor`, `critique:success:under-floor`, `risk.signoff:success:under-floor`, `memory.write:success:under-floor`, `synthesis:success:under-floor`.

### Live (`scenario-11-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-11-sample`)

- decision: `hold`; scenario `refund`; resolved `declared`; branch `under-floor`; 0 s
- branch line, why: refund weight 0.55 is under the floor 0.8; owner 15 out, backup 27 in; memory consulted
- journey human.reply: kind `draft_for_human`, to `{"employee_id":27,"name":"Galmel Kernfield","role":null}`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello Brisk Brightmoor, You wrote about "I would like a refund of 80 GC for my Drift Boot Wraps, they are too small for my son". We are looking into your refund request. Best regards, Jedi Pack Suppor`
- owner `27 Galmel Kernfield (Support)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-11-sample.jsonl` (29 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 12: s03-refund-over-limit (demo scenario s03)

Input (`input_examples/example_12.json`):

- message: `I would like a refund of 400 GC for my Sovereign Arc Duellist, the blade will not ignite.`
- from: `camrencobbleton@email.com` (Camren Cobbleton)
- channel: `contact-form`; scenario: `refund`; as_of: `2026-10-25`

Checked against: fixture cell `s03-refund-over-limit`: `branch:success:over-limit`, `critique:success:over-limit`, `risk.signoff:refused:over-limit`, `escalate_or_fallback:success:over-limit`, `memory.write:success:over-limit`, `synthesis:success:over-limit`.

### Live (`scenario-12-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-12-sample`)

- decision: `escalate`; scenario `refund`; resolved `declared`; branch `over-limit`; 0 s
- branch line, why: amount 400 GC is over the 150 GC policy limit
- journey human.reply: kind `escalation`, to `{"employee_id":40,"name":"Zanva Groveley","role":null}`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello Camren Cobbleton, Thank you for your message. Your refund request is routed for approval. We are not promising an amount or a date yet, and a colleague will follow up with you. Best regards, Jed`
- owner `40 Zanva Groveley (Sales)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-12-sample.jsonl` (28 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 13: s04-second-refund (demo scenario s04)

Input (`input_examples/example_13.json`):

- message: `I would like another refund, 60 GC, for the strap on my Drift Boot Wraps.`
- from: `liravenn@email.com` (Lira Venn)
- channel: `contact-form`; scenario: `refund`; as_of: `2026-10-25`

Checked against: fixture cell `s04-second-refund`: `branch:success:under-floor`, `critique:success:under-floor`, `risk.signoff:success:under-floor`, `memory.write:success:under-floor`, `synthesis:success:under-floor`.

### Live (`scenario-13-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-13-sample`)

- decision: `hold`; scenario `refund`; resolved `declared`; branch `under-floor`; 0 s
- branch line, why: refund weight 0.55 is under the floor 0.8; owner 15 in; memory consulted
- journey human.reply: kind `draft_for_human`, to `{"employee_id":15,"name":"Soren Adey","role":null}`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello Lira Venn, You wrote about "I would like another refund, 60 GC, for the strap on my Drift Boot Wraps". We are looking into your refund request. Best regards, Jedi Pack Support team`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `false`; status `open`; memory_note `Second Refund Request from this client (2 earlier: T02, T06).`
- trace: `judging/traces/trace-scenario-13-sample.jsonl` (26 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 14: s05-product-hit (demo scenario s05)

Input (`input_examples/example_14.json`):

- message: `What is the primary material used in the Sovereign Arc Duellist?`
- from: `dessadunmarrow@email.com` (Dessa Dunmarrow)
- channel: `contact-form`; scenario: `free_text`; as_of: `2026-10-25`

Checked against: fixture cell `s05-product-hit`: `branch:success:product-hit`, `planner.plan:success:product-hit`, `nvidia.model:skipped:product-hit`, `critique:skipped:product-hit`, `risk.signoff:success:product-hit`, `retry:skipped:product-hit`, `escalate_or_fallback:skipped:product-hit`, `memory.write:success:product-hit`, `synthesis:success:product-hit`.

### Live (`scenario-14-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-14-sample`)

- decision: `send`; scenario `product`; resolved `scout`; branch `product-hit`; 0 s
- branch line, why: the catalogue row products:FS-B03 (Sovereign Arc Duellist, matched by name) answers it: material; composed from the row, no model call
- journey human.reply: kind `auto_reply`, to `null`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello Dessa Dunmarrow, The Sovereign Arc Duellist is made of tempered duralloy twin-core, hand-wrapped nerf-leather grip. Best regards, Jedi Pack Product team Sent automatically on behalf of the Produ`
- owner `5 Priya Raman (Product)`; cc `[]`; auto_reply `true`; status `handled`; memory_note `none`
- trace: `judging/traces/trace-scenario-14-sample.jsonl` (27 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 15: s06-product-unanswered (demo scenario s06)

Input (`input_examples/example_15.json`):

- message: `Is the Wayfarer Long Cloak waterproof?`
- from: `edricembervale@email.com` (Edric Embervale)
- channel: `chat`; scenario: `free_text`; as_of: `2026-10-25`

Checked against: fixture cell `s06-product-unanswered`: `branch:success:product-unanswered`, `planner.plan:success:product-unanswered`, `nvidia.model:skipped:product-unanswered`, `critique:skipped:product-unanswered`, `risk.signoff:skipped:product-unanswered`, `retry:skipped:product-unanswered`, `escalate_or_fallback:skipped:product-unanswered`, `memory.write:success:product-unanswered`, `synthesis:success:product-unanswered`.

### Live (`scenario-15-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-15-sample`)

- decision: `hold`; scenario `product`; resolved `scout`; branch `product-unanswered`; 0 s
- branch line, why: Wayfarer Long Cloak is in the catalogue (products:FS-A01) but not in the catalogue row: no field answers what was asked
- journey human.reply: kind `none`, to `{"employee_id":5,"name":"Priya Raman","role":"product owner"}`, attachments none, recommendation `not in the catalogue row of FS-A01; the product owner answers the customer`
- reply text (first 200 chars): `(no text)`
- owner `5 Priya Raman (Product)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-15-sample.jsonl` (27 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 16: s07-bulk-quote (demo scenario s07)

Input (`input_examples/example_16.json`):

- message: `Hello, could you send us a quote for 25 Vanta Arc Trainers for our academy? Thank you.`
- from: `fiorafennick@email.com` (Fiora Fennick)
- channel: `email`; scenario: `rfq`; as_of: `2026-10-25`

Checked against: fixture cell `s07-bulk-quote`: `branch:success:rfq-quote`, `risk.signoff:success:rfq-quote`, `memory.write:success:rfq-quote`, `synthesis:success:rfq-quote`.

### Live (`scenario-16-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-16-sample`)

- decision: `hold`; scenario `rfq`; resolved `declared`; branch `rfq-quote`; 0 s
- branch line, why: quote for 25 x Vanta Arc Trainer: tier squad (10% off), unit 170.10 GC, total 4252.50 GC, lead 12 days; parts Humming emitter coil (Mk 1) 25 of 2232, Smug status LED (Mk 2) 50 of 1070
- journey human.reply: kind `draft_for_human`, to `{"employee_id":6,"name":"Tomas Keller","role":"rfq owner"}`, attachments `products:FS-B01, bulk_pricing:squad, bom:FS-B01:PT-0001, bom:FS-B01:PT-0002, policy:rfq`, recommendation `Quote ready: 25 x Vanta Arc Trainer, tier squad, 4252.50 GC. Sales checks it and sends it.`
- reply text (first 200 chars): `Hello Fiora Fennick, Thank you for your request. Here is your quote. Product: Vanta Arc Trainer Quantity: 25 Tier: squad (10% off) Unit price: 170.10 GC Total: 4252.50 GC Lead time: 12 days Parts need`
- owner `6 Tomas Keller (Sales)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-16-sample.jsonl` (30 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 17: s08-mild-injury (demo scenario s08)

Input (`input_examples/example_17.json`):

- message: `This is unacceptable: the hot emitter of my Vanta Arc Trainer gave my son a small burn.`
- from: `galengreystoke@email.com` (Galen Greystoke)
- channel: `email`; scenario: `complaint`; as_of: `2026-10-25`

Checked against: fixture cell `s08-mild-injury`: `branch:success:complaint-genuine`, `risk.signoff:success:complaint-genuine`, `memory.write:success:complaint-genuine`, `synthesis:success:complaint-genuine`.

### Live (`scenario-17-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-17-sample`)

- decision: `hold`; scenario `complaint`; resolved `declared`; branch `complaint-genuine`; 0 s
- branch line, why: severity 6 (6), the customer reads as genuine (no earlier threads); a safety report: the customer names a small burn; the owner gets the draft and the handling note
- world_context line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.551Z","duration_ms":1,"elapsed_ms":6,"run_id":"scenario-17-sample","trace_id":"scenario-17-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of galengreystoke@email.com and FS-B01","output_summary":"250 entities, 228 relationships; customer none: 0 earlier threads, 0 complaints, public no; product FS-B01: 0 complaints; ids: product:jedi:FS-B01,fact_7b75921e9eb61e1b","status":"success","branch_id":"complaint-genuine","memory_ids":["product:jedi:FS-B01","fact_7b75921e9eb61e1b"],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.551Z","duration_ms":1,"elapsed_ms":6,"run_id":"scenario-17-sample","trace_id":"scenario-17-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F13","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 6 (6), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-genuine","sponsor":"nvidia","gate_source":"rules"}
```

- journey human.reply: kind `draft_for_human`, to `{"employee_id":15,"name":"Soren Adey","role":"complaint owner"}`, attachments none, recommendation `safety report, small burn (self-described as mild): A person should own this, repair the failure and answer the customer directly.`
- reply text (first 200 chars): `Hello Galen Greystoke, We are very sorry to hear about the burn. We take product safety seriously, and our Support team will contact you personally about it. Best regards, Jedi Pack Support team`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-17-sample.jsonl` (32 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 18: s09-legal-threat (demo scenario s09)

Input (`input_examples/example_18.json`):

- message: `The Strand Emitter Hilt split open in my hands and I have spoken to my lawyer. If I do not hear from you I will sue.`
- from: `havihollowell@email.com` (Havi Hollowell)
- channel: `email`; scenario: `complaint`; as_of: `2026-10-25`

Checked against: fixture cell `s09-legal-threat`: `branch:success:complaint-legal`, `risk.signoff:success:complaint-legal`, `escalate_or_fallback:success:complaint-legal`, `memory.write:success:complaint-legal`, `synthesis:success:complaint-legal`.

### Live (`scenario-18-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-18-sample`)

- decision: `escalate`; scenario `complaint`; resolved `declared`; branch `complaint-legal`; 0 s
- branch line, why: severity 10 (10 legal or safety), the customer reads as genuine (no earlier threads); a legal threat: a courtesy reply now, Support owns it and Legal reviews
- world_context line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.565Z","duration_ms":1,"elapsed_ms":5,"run_id":"scenario-18-sample","trace_id":"scenario-18-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of havihollowell@email.com and FS-B02","output_summary":"250 entities, 228 relationships; customer none: 0 earlier threads, 0 complaints, public no; product FS-B02: 0 complaints; ids: product:jedi:FS-B02,fact_aa6e9086d79a5174","status":"success","branch_id":"complaint-legal","memory_ids":["product:jedi:FS-B02","fact_aa6e9086d79a5174"],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.565Z","duration_ms":1,"elapsed_ms":5,"run_id":"scenario-18-sample","trace_id":"scenario-18-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F14","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 10 (10 legal or safety), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-legal","sponsor":"nvidia","gate_source":"rules"}
```

- journey human.reply: kind `escalation`, to `{"employee_id":15,"name":"Soren Adey","role":"complaint owner"}`, attachments none, recommendation `courtesy reply now, Legal reviews; the send marks follow-up`
- reply text (first 200 chars): `Hello Havi Hollowell, We are sorry to read what happened with your Strand Emitter Hilt. We are looking into it now and will come back to you within two working days. Best regards, Jedi Pack Support te`
- owner `15 Soren Adey (Support)`; cc `[7,202]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-18-sample.jsonl` (42 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 19: s10-delivery-suspended (demo scenario s10)

Input (`input_examples/example_19.json`):

- message: `Where is my order JP-1001? It was meant to arrive weeks ago.`
- from: `cass.holm@example.com` (Cass Holm)
- channel: `contact-form`; scenario: `free_text`; as_of: `2026-10-25`

Checked against: fixture cell `s10-delivery-suspended`: `branch:success:delivery-suspended`, `nvidia.model:skipped:delivery-suspended`, `planner.plan:success:delivery-suspended`, `nvidia.model:skipped:delivery-suspended`, `critique:skipped:delivery-suspended`, `risk.signoff:success:delivery-suspended`, `retry:skipped:delivery-suspended`, `escalate_or_fallback:skipped:delivery-suspended`, `memory.write:success:delivery-suspended`, `synthesis:success:delivery-suspended`.

### Live (`scenario-19-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-19-sample`)

- decision: `send`; scenario `delivery`; resolved `scout`; branch `delivery-suspended`; 0 s
- branch line, why: order JP-1001 ships to Alderaan, where deliveries are suspended (shipping_rules:Alderaan); the rule's note answers it
- journey human.reply: kind `auto_reply`, to `null`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello Cass Holm, Deliveries to Alderaan are currently suspended. Your order JP-1001 is held for now; our team will contact you as soon as deliveries to Alderaan resume. Best regards, Jedi Pack Support`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `true`; status `handled`; memory_note `none`
- trace: `judging/traces/trace-scenario-19-sample.jsonl` (28 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 20: s11-other-faq-hit (demo scenario s11)

Input (`input_examples/example_20.json`):

- message: `Do you offer gift wrapping?`
- from: `jessajasperly@email.com` (Jessa Jasperly)
- channel: `chat`; scenario: `free_text`; as_of: `2026-10-25`

Checked against: fixture cell `s11-other-faq-hit`: `branch:success:faq-hit`, `planner.plan:success:faq-hit`, `nvidia.model:skipped:faq-hit`, `critique:skipped:faq-hit`, `risk.signoff:success:faq-hit`, `retry:skipped:faq-hit`, `escalate_or_fallback:skipped:faq-hit`, `memory.write:success:faq-hit`, `synthesis:success:faq-hit`.

### Live (`scenario-20-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-20-sample`)

- decision: `send`; scenario `question`; resolved `faq`; branch `faq-hit`; 0 s
- branch line, why: FAQ Q11 matches (score 1.00, shared: offer, gift, wrapping); FAQ text is canonical, the floor gates model drafts
- journey human.reply: kind `auto_reply`, to `null`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello Jessa Jasperly, Gift wrapping is not offered at the moment. Customer service can add a gift note to the order. Best regards, Jedi Pack Support team Sent automatically on behalf of the Support te`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `true`; status `handled`; memory_note `none`
- trace: `judging/traces/trace-scenario-20-sample.jsonl` (26 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 21: s12-other-unanswered (demo scenario s12)

Input (`input_examples/example_21.json`):

- message: `Can I book the Coruscant store for a private birthday party?`
- from: `kovankettleby@email.com` (Kovan Kettleby)
- channel: `chat`; scenario: `free_text`; as_of: `2026-10-25`

Checked against: fixture cell `s12-other-unanswered`: `branch:success:other-unanswered`, `nvidia.model:skipped:other-unanswered`, `planner.plan:success:other-unanswered`, `nvidia.model:skipped:other-unanswered`, `critique:skipped:other-unanswered`, `risk.signoff:skipped:other-unanswered`, `retry:skipped:other-unanswered`, `escalate_or_fallback:skipped:other-unanswered`, `memory.write:success:other-unanswered`, `synthesis:success:other-unanswered`.

### Live (`scenario-21-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-21-sample`)

- decision: `hold`; scenario `other`; resolved `none`; branch `other-unanswered`; 0 s
- branch line, why: nothing in the records answers this; checked the FAQ (18 rows), no match
- journey human.reply: kind `none`, to `{"employee_id":15,"name":"Soren Adey","role":"other owner"}`, attachments none, recommendation `nothing in the records answers this; a person replies`
- reply text (first 200 chars): `(no text)`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-21-sample.jsonl` (26 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 22: s13-trustpilot-complaint (demo scenario s13)

Input (`input_examples/example_22.json`):

- message: `The Drift Boot Wraps arrived scuffed and I am disappointed. Posting my honest review here.`
- from: `leskalongmire@email.com` (Leska Longmire)
- channel: `trustpilot`; scenario: `complaint`; as_of: `2026-10-25`

Checked against: fixture cell `s13-trustpilot-complaint`: `branch:success:`, `risk.signoff:success:`, `memory.write:success:`, `synthesis:success:`.

### Live (`scenario-22-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-22-sample`)

- decision: `hold`; scenario `complaint`; resolved `declared`; branch `complaint-genuine`; 0 s
- branch line, why: severity 8 (8), the customer reads as genuine (no earlier threads); the owner gets the draft and the handling note
- world_context line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.606Z","duration_ms":1,"elapsed_ms":4,"run_id":"scenario-22-sample","trace_id":"scenario-22-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of leskalongmire@email.com and FS-A03","output_summary":"250 entities, 228 relationships; customer none: 0 earlier threads, 0 complaints, public no; product FS-A03: 0 complaints; ids: product:jedi:FS-A03,fact_e112eada793824e9","status":"success","branch_id":"complaint-genuine","memory_ids":["product:jedi:FS-A03","fact_e112eada793824e9"],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.606Z","duration_ms":1,"elapsed_ms":4,"run_id":"scenario-22-sample","trace_id":"scenario-22-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F18","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 8 (8), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-genuine","sponsor":"nvidia","gate_source":"rules"}
```

- journey human.reply: kind `draft_for_human`, to `{"employee_id":15,"name":"Soren Adey","role":"complaint owner"}`, attachments none, recommendation `A person should own this, repair the failure and answer the customer directly.`
- reply text (first 200 chars): `Hello Leska Longmire, Thank you for telling us, and we are sorry. This matters to us, and a colleague will look at it personally and come back to you. Best regards, Jedi Pack Support team`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-22-sample.jsonl` (32 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

## Example 23: s14-direct-email-complaint (demo scenario s14)

Input (`input_examples/example_23.json`):

- message: `Hi, my package arrived with a dented box.`
- from: `marekmarshgate@email.com` (Marek Marshgate)
- channel: `email`; scenario: `complaint`; as_of: `2026-10-25`

Checked against: fixture cell `s14-direct-email-complaint`: `branch:success:`, `critique:success:`, `risk.signoff:success:`, `memory.write:success:`, `synthesis:success:`.

### Live (`scenario-23-live`)

This leg was skipped (no live config). It runs against the live service after the merge (CP6).

### Sample (`scenario-23-sample`)

- decision: `hold`; scenario `complaint`; resolved `declared`; branch `complaint-vent`; 0 s
- branch line, why: severity 3 (3), the customer reads as vent (no earlier threads); a calm acknowledgement closes it
- world_context line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.619Z","duration_ms":1,"elapsed_ms":5,"run_id":"scenario-23-sample","trace_id":"scenario-23-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of marekmarshgate@email.com and no product","output_summary":"250 entities, 228 relationships; customer none: 0 earlier threads, 0 complaints, public no; product none: 0 complaints; ids: none","status":"success","branch_id":"complaint-vent","memory_ids":[],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-24T22:08:02.620Z","duration_ms":1,"elapsed_ms":6,"run_id":"scenario-23-sample","trace_id":"scenario-23-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F19","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 3 (3), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-vent","sponsor":"nvidia","gate_source":"rules"}
```

- journey human.reply: kind `draft_for_human`, to `{"employee_id":15,"name":"Soren Adey","role":"complaint owner"}`, attachments none, recommendation `vent: a calm reply closes it; no action`
- reply text (first 200 chars): `Hello Marek Marshgate, Thank you for letting us know. We are sorry the order did not arrive as you hoped, and we have noted it. Best regards, Jedi Pack Support team`
- owner `15 Soren Adey (Support)`; cc `[]`; auto_reply `false`; status `open`; memory_note `none`
- trace: `judging/traces/trace-scenario-23-sample.jsonl` (32 lines); subsequence check: ok

Live vs sample: live skipped (no live config); sample subsequence ok. Subsequence check: live skipped, sample ok.

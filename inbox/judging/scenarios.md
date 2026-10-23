---
title: Scenario proofs
description: Examples 4 to 8 run live and in sample mode with the traces, the models, the World Model line and the journey reply for each.
date: 2026-10-23
tags: [judging, scenarios]
---

# Scenario proofs

Command: `node inbox/scripts/scenario_proofs.mjs` (starts its own server from `src/server.mjs` with the real `.env`; `B=<url>` uses an existing one). Run time (Europe/Brussels): 2026-10-23 13:23:25.

Each example runs twice through `POST /run`: live (`options.sample_mode: false`) and sample (`options.sample_mode: true`). The traces are copied from `GET /runs/<id>/trace` as the service wrote them; the script writes no trace line. Both traces must contain the fixture's `step:status:branch_id` subsequence for the cell. Overall: all checks passed.

| Example | Cell | Live | Sample | Subsequence live / sample |
|---|---|---|---|---|
| 4 | question-hit | send / faq-hit | send / faq-hit | ok / ok |
| 5 | question-unanswered | escalate / question-unanswered | escalate / question-unanswered | ok / ok |
| 6 | rfq-no-product | escalate / rfq | escalate / rfq | ok / ok |
| 7 | complaint-vent | hold / complaint-vent | hold / complaint-vent | ok / ok |
| 8 | complaint-severe | escalate / complaint-severe | escalate / complaint-severe | ok / ok |

## Example 4: question-hit

Input (`input_examples/example_4.json`):

- message: `How long does shipping take?`
- from: `a@example.com`
- channel: `chat`; scenario: `(not declared)`; as_of: `2026-10-20`

Checked against: fixture cell `question-hit`: `zetaris.query:success:`, `meterless.engine:success:`, `branch:success:faq-hit`, `nvidia.model:skipped:faq-hit`, `critique:skipped:faq-hit`, `risk.signoff:success:faq-hit`, `memory.write:success:faq-hit`, `synthesis:success:faq-hit`.

### Live (`scenario-4-live`)

- decision: `send`; scenario `question`; resolved `scout`; branch `faq-hit`; 1.5 s
- branch line, why: FAQ Q01 matches (score 1.00, shared: long, shipping, take); FAQ text is canonical, the floor gates model drafts
- nvidia.model lines (1): `typed_gates` `openjev-0.1 (openjev-0.1)` success
- journey human.reply: kind `auto_reply`, to `null`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello, Shipping time depends on your region and the product. Your order confirmation shows the estimate for your address, and customer service can tell you where your order is. Best regards, Jedi Pack`
- trace: `judging/traces/trace-scenario-4-live.jsonl` (41 lines); subsequence check: ok

### Sample (`scenario-4-sample`)

- decision: `send`; scenario `question`; resolved `scout`; branch `faq-hit`; 0.1 s
- branch line, why: FAQ Q01 matches (score 1.00, shared: long, shipping, take); FAQ text is canonical, the floor gates model drafts
- journey human.reply: kind `auto_reply`, to `null`, attachments none, recommendation `none`
- reply text (first 200 chars): `Hello, Shipping time depends on your region and the product. Your order confirmation shows the estimate for your address, and customer service can tell you where your order is. Best regards, Jedi Pack`
- trace: `judging/traces/trace-scenario-4-sample.jsonl` (27 lines); subsequence check: ok

Live vs sample: same decision and branch. Subsequence check: live ok, sample ok.

## Example 5: question-unanswered

Input (`input_examples/example_5.json`):

- message: `Do you have a shop in Antwerp I can visit on Saturday?`
- from: `a@example.com`
- channel: `chat`; scenario: `question`; as_of: `2026-10-20`

Checked against: fixture cell `question-unanswered`: `branch:success:question-unanswered`, `critique:skipped:question-unanswered`, `risk.signoff:skipped:question-unanswered`, `escalate_or_fallback:success:question-unanswered`, `memory.write:success:question-unanswered`, `synthesis:success:question-unanswered`.

### Live (`scenario-5-live`)

- decision: `escalate`; scenario `question`; resolved `declared`; branch `question-unanswered`; 1.6 s
- branch line, why: no FAQ match and no record shares two words with the question; checked the FAQ (12 rows), 1 wiki page(s)
- nvidia.model lines (1): `typed_gates` `openjev-0.1 (openjev-0.1)` success
- journey human.reply: kind `escalation`, to `{"employee_id":1,"name":"Mara Solen","role":"question owner"}`, attachments none, recommendation `not in the FAQ or the records; checked: the FAQ (12 rows), 1 wiki page(s)`
- reply text (first 200 chars): `(no text)`
- trace: `judging/traces/trace-scenario-5-live.jsonl` (43 lines); subsequence check: ok

### Sample (`scenario-5-sample`)

- decision: `escalate`; scenario `question`; resolved `declared`; branch `question-unanswered`; 0.1 s
- branch line, why: no FAQ match and no record shares two words with the question; checked the FAQ (12 rows), 1 wiki page(s)
- journey human.reply: kind `escalation`, to `{"employee_id":1,"name":"Mara Solen","role":"question owner"}`, attachments none, recommendation `not in the FAQ or the records; checked: the FAQ (12 rows), 1 wiki page(s)`
- reply text (first 200 chars): `(no text)`
- trace: `judging/traces/trace-scenario-5-sample.jsonl` (28 lines); subsequence check: ok

Live vs sample: same decision and branch. Subsequence check: live ok, sample ok.

## Example 6: rfq-no-product

Input (`input_examples/example_6.json`):

- message: `Incoming RFQ for price difference between ordering 100000 items and 100 (we only have 1 price, so I would like to see how our flow responds`
- from: `einh@example.com`
- channel: `chat`; scenario: `rfq`; as_of: `2026-10-20`

Checked against: fixture cell `rfq-no-product`: `branch:success:rfq`, `risk.signoff:success:rfq`, `escalate_or_fallback:success:rfq`, `memory.write:success:rfq`, `synthesis:success:rfq`.

### Live (`scenario-6-live`)

- decision: `escalate`; scenario `rfq`; resolved `declared`; branch `rfq`; 1.6 s
- branch line, why: request for a quote: no product matched, quantities 100000, 100; sales quotes, prices attached
- nvidia.model lines (1): `typed_gates` `openjev-0.1 (openjev-0.1)` success
- journey human.reply: kind `escalation`, to `{"employee_id":6,"name":"Tomas Keller","role":"rfq owner"}`, attachments none, recommendation `Quantities asked: 100000 and 100; no product in the records matches; sales to identify.`
- reply text (first 200 chars): `Hello, Thank you, your request for a quote is with our sales team, who will come back to you with the price for 100000 and 100. Best regards, Jedi Pack Support`
- trace: `judging/traces/trace-scenario-6-live.jsonl` (37 lines); subsequence check: ok

### Sample (`scenario-6-sample`)

- decision: `escalate`; scenario `rfq`; resolved `declared`; branch `rfq`; 0.1 s
- branch line, why: request for a quote: no product matched, quantities 100000, 100; sales quotes, prices attached
- journey human.reply: kind `escalation`, to `{"employee_id":6,"name":"Tomas Keller","role":"rfq owner"}`, attachments none, recommendation `Quantities asked: 100000 and 100; no product in the records matches; sales to identify.`
- reply text (first 200 chars): `Hello, Thank you, your request for a quote is with our sales team, who will come back to you with the price for 100000 and 100. Best regards, Jedi Pack Support`
- trace: `judging/traces/trace-scenario-6-sample.jsonl` (26 lines); subsequence check: ok

Live vs sample: same decision and branch. Subsequence check: live ok, sample ok.

## Example 7: complaint-vent

Input (`input_examples/example_7.json`):

- message: `the box was dented, I am annoyed, just so you know`
- from: `new.customer@example.com` (Rey Kanata)
- channel: `chat`; scenario: `complaint`; as_of: `2026-10-20`

Checked against: fixture cell `complaint-vent`: `branch:success:complaint-vent`, `critique:success:complaint-vent`, `risk.signoff:success:complaint-vent`, `escalate_or_fallback:skipped:complaint-vent`, `synthesis:success:complaint-vent`.

### Live (`scenario-7-live`)

- decision: `hold`; scenario `complaint`; resolved `declared`; branch `complaint-vent`; 69.4 s
- branch line, why: severity 2 (2), the customer reads as vent (no earlier threads); a calm acknowledgement closes it
- nvidia.model lines (4): `typed_gates` `openjev-0.1 (openjev-0.1)` success; `read_complaint` `nvidia/nemotron-3.5-lightning-30b-a3b` success; `severity_gate` `openjev-0.1 (openjev-0.1)` success; `draft_reply` `nvidia/nemotron-3.5-lightning-30b-a3b` success
- world_context line (verbatim):

```json
{"timestamp":"2026-10-23T11:21:38Z","run_id":"scenario-7-live","trace_id":"scenario-7-live","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of new.customer@example.com and no product","output_summary":"211 entities, 199 relationships; customer none: 0 earlier threads, 0 complaints, public no; product none: 0 complaints; ids: none","status":"success","branch_id":"complaint-vent","memory_ids":[],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-23T11:21:38Z","run_id":"scenario-7-live","trace_id":"scenario-7-live","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F93","output_summary":"severity 2 (2), raw 0.9378819622008716, confidence 0.5742432884774249, source openjev","status":"success","model":"openjev-0.1 (openjev-0.1)","confidence":0.5742432884774249,"branch_id":"complaint-vent","sponsor":"nvidia","gate_source":"openjev"}
```

- journey human.reply: kind `draft_for_human`, to `{"employee_id":5,"name":"Priya Raman","role":"complaint owner"}`, attachments none, recommendation `vent: a calm reply closes it; no action`
- reply text (first 200 chars): `I'm sorry to hear your package arrived dented. I understand your frustration, and I appreciate you letting us know. We'll review this and get back to you.`
- trace: `judging/traces/trace-scenario-7-live.jsonl` (48 lines); subsequence check: ok

### Sample (`scenario-7-sample`)

- decision: `hold`; scenario `complaint`; resolved `declared`; branch `complaint-vent`; 0.1 s
- branch line, why: severity 4 (4), the customer reads as vent (no earlier threads); a calm acknowledgement closes it
- world_context line (verbatim):

```json
{"timestamp":"2026-10-23T11:22:16Z","run_id":"scenario-7-sample","trace_id":"scenario-7-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of new.customer@example.com and no product","output_summary":"211 entities, 199 relationships; customer none: 0 earlier threads, 0 complaints, public no; product none: 0 complaints; ids: none","status":"success","branch_id":"complaint-vent","memory_ids":[],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-23T11:22:16Z","run_id":"scenario-7-sample","trace_id":"scenario-7-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F94","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 4 (4), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-vent","sponsor":"nvidia","gate_source":"rules"}
```

- journey human.reply: kind `draft_for_human`, to `{"employee_id":5,"name":"Priya Raman","role":"complaint owner"}`, attachments none, recommendation `vent: a calm reply closes it; no action`
- reply text (first 200 chars): `Hello Rey Kanata, Thank you for letting us know. We are sorry the order did not arrive as you hoped, and we have noted it. Best regards, Jedi Pack Support`
- trace: `judging/traces/trace-scenario-7-sample.jsonl` (32 lines); subsequence check: ok

Live vs sample: differences: severity live `severity 2 (2), raw 0.9378819622008716, confidence 0.5742432884774249, source openjev` vs sample `sample mode, OpenJev not called; severity by code rules (sample.severity): severity 4 (4), raw n/a, confidence 0.5, source rules`. Subsequence check: live ok, sample ok.

## Example 8: complaint-severe

Input (`input_examples/example_8.json`):

- message: `This is the second training saber from you whose hilt split open in my son's hands and cut him. I will post this review everywhere and I am talking to a lawyer. Never again. I want this fixed today.`
- from: `tilda.moss@example.com` (Tilda Moss)
- channel: `chat`; scenario: `complaint`; as_of: `2026-10-20`

Checked against: fixture cell `complaint-severe`: `branch:success:complaint-severe`, `risk.signoff:refused:complaint-severe`, `retry:skipped:complaint-severe`, `escalate_or_fallback:success:complaint-severe`, `synthesis:success:complaint-severe`.

### Live (`scenario-8-live`)

- decision: `escalate`; scenario `complaint`; resolved `declared`; branch `complaint-severe`; 68.9 s
- branch line, why: severity 10 (10 legal or safety), the customer reads as genuine (3 earlier threads on record); a person handles it
- nvidia.model lines (4): `typed_gates` `openjev-0.1 (openjev-0.1)` success; `read_complaint` `nvidia/nemotron-3.5-lightning-30b-a3b` success; `severity_gate` `openjev-0.1 (openjev-0.1)` success; `draft_reply` `nvidia/nemotron-3.5-lightning-30b-a3b` success
- world_context line (verbatim):

```json
{"timestamp":"2026-10-23T11:22:43Z","run_id":"scenario-8-live","trace_id":"scenario-8-live","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of tilda.moss@example.com and P01, P02","output_summary":"211 entities, 199 relationships; customer customer:email:tilda.moss@example.com: 3 earlier threads, 0 complaints, public no; product P01: 0 complaints, P02: 0 complaints; ids: customer:email:tilda.moss@example.com,thread:jedi:T11,thread:jedi:T24,thread:jedi:T14,fact_7f40a4af1de84630,fact_5cd1152f7c761dab,product:jedi:P01,fact_e1ebf87d9f9ca986,product:jedi:P02,fact_c65a7d3bad61b045","status":"success","branch_id":"complaint-severe","memory_ids":["customer:email:tilda.moss@example.com","thread:jedi:T11","thread:jedi:T24","thread:jedi:T14","fact_7f40a4af1de84630","fact_5cd1152f7c761dab","product:jedi:P01","fact_e1ebf87d9f9ca986","product:jedi:P02","fact_c65a7d3bad61b045"],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-23T11:22:43Z","run_id":"scenario-8-live","trace_id":"scenario-8-live","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F95","output_summary":"severity 10 (10 legal or safety), raw 8.97745735813771, confidence 0.9859017201146587, source openjev","status":"success","model":"openjev-0.1 (openjev-0.1)","confidence":0.9859017201146587,"branch_id":"complaint-severe","sponsor":"nvidia","gate_source":"openjev"}
```

- journey human.reply: kind `escalation`, to `{"employee_id":5,"name":"Priya Raman","role":"complaint owner"}`, attachments none, recommendation `Launch immediate safety investigation, provide replacement or full refund, and initiate direct proactive outreach to the customer to mitigate public escalation and legal exposure.`
- reply text (first 200 chars): `Dear Tilda, I'm very sorry to hear about this frightening experience with your son. I take this safety concern very seriously. A member of our team will follow up with you directly shortly to address `
- trace: `judging/traces/trace-scenario-8-live.jsonl` (48 lines); subsequence check: ok

### Sample (`scenario-8-sample`)

- decision: `escalate`; scenario `complaint`; resolved `declared`; branch `complaint-severe`; 0.1 s
- branch line, why: severity 10 (10 legal or safety), the customer reads as genuine (3 earlier threads on record); a person handles it
- world_context line (verbatim):

```json
{"timestamp":"2026-10-23T11:23:25Z","run_id":"scenario-8-sample","trace_id":"scenario-8-sample","step":"meterless.engine","agent_name":"WorldModel","action":"world_context","input_summary":"history of tilda.moss@example.com and P01, P02","output_summary":"211 entities, 199 relationships; customer customer:email:tilda.moss@example.com: 3 earlier threads, 0 complaints, public no; product P01: 0 complaints, P02: 0 complaints; ids: customer:email:tilda.moss@example.com,thread:jedi:T11,thread:jedi:T24,thread:jedi:T14,fact_7f40a4af1de84630,fact_5cd1152f7c761dab,product:jedi:P01,fact_e1ebf87d9f9ca986,product:jedi:P02,fact_c65a7d3bad61b045","status":"success","branch_id":"complaint-severe","memory_ids":["customer:email:tilda.moss@example.com","thread:jedi:T11","thread:jedi:T24","thread:jedi:T14","fact_7f40a4af1de84630","fact_5cd1152f7c761dab","product:jedi:P01","fact_e1ebf87d9f9ca986","product:jedi:P02","fact_c65a7d3bad61b045"],"sponsor":"meterless"}
```

- severity_gate line (verbatim):

```json
{"timestamp":"2026-10-23T11:23:25Z","run_id":"scenario-8-sample","trace_id":"scenario-8-sample","step":"nvidia.model","agent_name":"Severity","action":"severity_gate","input_summary":"severity for F96","output_summary":"sample mode, OpenJev not called; severity by code rules (sample.severity): severity 10 (10 legal or safety), raw n/a, confidence 0.5, source rules","status":"skipped","model":"rules","confidence":0.5,"branch_id":"complaint-severe","sponsor":"nvidia","gate_source":"rules"}
```

- journey human.reply: kind `escalation`, to `{"employee_id":5,"name":"Priya Raman","role":"complaint owner"}`, attachments none, recommendation `A person should own this, repair the failure and answer the customer directly.`
- reply text (first 200 chars): `Hello Tilda Moss, Thank you for telling us, and we are sorry. This matters to us, and a colleague will look at it personally and come back to you. Best regards, Jedi Pack Support`
- trace: `judging/traces/trace-scenario-8-sample.jsonl` (32 lines); subsequence check: ok

Live vs sample: differences: severity live `severity 10 (10 legal or safety), raw 8.97745735813771, confidence 0.9859017201146587, source openjev` vs sample `sample mode, OpenJev not called; severity by code rules (sample.severity): severity 10 (10 legal or safety), raw n/a, confidence 0.5, source rules`. Subsequence check: live ok, sample ok.

---
title: "Judge video script"
description: "Jedi Pack inbox. Target runtime 2 minutes 20 seconds. One screen recording, no music over the spoken lines. Company is fictional."
date: "2026-10-22"
tags: [jedi-pack, inbox, kristof]
---

# Judge video script

Jedi Pack inbox. Target runtime 2 minutes 20 seconds. One screen recording, no music over the spoken lines. Company is fictional.

Two loops. Say so, or they look like the same loop.

- **Ingest loop, once.** The corpus is fed in. Classification runs once per thread and seeds the trust ledger. This cut is the 24 threads in `kristof/data/threads/threads.jsonl`. The full list is the same loop over about 300. It does not run again on the live ticket.
- **Reply loop, per ticket.** Evaluator and Risk judge the same draft. One fail is a retry, the dashed line back to the draft. Two fails, or one hard fact, escalate. No third draft.

On screen, the file stays `logs/trace-<run_id>.jsonl`. The hand-in chapter is named Trace. The voiceover calls that file the audit trail. Same artifact. A judge hears what it is and still sees the filename they score.

Classification on the card is Scout Sense. The braindump calls that job JEV. JEV is not a Meterless engine a judge can open, so the card shows Scout writing the category, with JEV as the job name above it.

## Beat 1. Three kinds of data land in Zetaris (0:00–0:18)

On screen: three files drop into one Zetaris pane, labeled with their container.

- Trustpilot, fictional, not a live call: `kristof/data/intakes/trustpilot/reviews.json`
- Website form: `kristof/data/intakes/contact-form/submissions.json`
- Client email: `kristof/data/intakes/email/T02.eml`

Say: "Three ways a customer reaches Jedi Pack. A Trustpilot review, a website form, and an email. Different containers. Zetaris is where they become one set of rows."

Judge line: `zetaris.query` will cite these later. Do not call the Trustpilot file a live API.

## Beat 2. Meterless, with a Nemotron brain, starts (0:18–0:30)

On screen: HARDEN, then a ticket id. Sponsor color Meterless. A small NVIDIA mark, dimmed, labeled "not yet."

Say: "Meterless opens the work. The guard reads the message before any model does. A ticket is opened, and a duplicate is not opened twice."

Judge line: `meterless.engine`, then `executor.act`. The model has not been called.

## Beat 3. One-time classification ingest (0:30–0:52)

This is the loop he asked to add.

On screen: a counter. `1 / 24` ticks to `24 / 24`. Each tick shows one thread and one label: complaint, refund, question, appreciation, or other. Title on the card: "JEV. One-time classification ingest." Under it: "Scout Sense." The trust-ledger weights sit at the side and settle on the stored seeds when the counter finishes: complaint 0.62, refund 0.55, question 0.71, appreciation 0.84, other 0.40. Floor 0.80.

A caption under the counter: "Runs once. Same loop if the corpus is 300."

Say: "Before a live reply, the corpus is classified once. Feed it a thread, get a category, move on. Twenty-four times in this cut. Three hundred would be the same loop, not a different product. That pass seeds the trust ledger. It does not send mail."

Judge line: this is the ingest, not `retry`. If a judge asks where the learning is, point at the ledger and at the second run in beat 10.

## Beat 4. Meterless and Nemotron, on one live ticket (0:52–1:04)

On screen: one new message, Lira Venn, refund, 40.00 USD, order JP-1042. A branch: thank-you would close; this one is a request, so it stays open. H-MEM read, empty on this first run, labeled "cold start."

Say: "Now one live ticket. Meterless plans it. Memory is read first. Nothing is there yet, and the log says so. This is a refund request, not a thank-you, so the ticket stays open."

Judge line: `memory.read` with an empty list, `planner.plan` with two branches, `delegate`, `branch`.

## Beat 5. Zetaris is the source of truth (1:04–1:24)

On screen, three files behind the ticket, then the rows that came back. Do not use a model for these.

- Holiday planner, Excel: `kristof/data/holiday-2026.xlsx`. Employee 15, Soren Adey, is out on 2026-10-22. Employee 16, Wynn Okonkwo, is in.
- Policy wiki: `kristof/data/wiki/refund-policy.md`. Limit 150.00 USD. 40 is under it, so the owner stays 15, backup 16.
- Backup for the person who is responsible: `kristof/data/responsibility.csv`, refund row, owner 15, backup 16.

Say: "Zetaris answers the facts. The holiday sheet says the owner is out and the backup is in. The policy page says 40 dollars is under the 150 dollar limit. The responsibility row names the backup. The model is not allowed to invent any of those."

Judge line: `zetaris.query`, with the row ids on screen.

## Beat 6. Meterless and Nemotron, after the facts (1:24–1:34)

On screen: the floor check. Refund weight 0.55 against floor 0.80. A held-send mark, not a send button.

Say: "Meterless compares the weight with the floor. Refunds are under it. Even with a clean backup, this reply cannot send itself."

Judge line: code, the trust floor. `executor.act`.

## Beat 7. Nightshift and NVIDIA (1:34–1:46)

On screen: Nightshift, then the NVIDIA mark, then a short draft that cites the three rows. If the hotspot is down, the card says `nvidia.model` skipped, and the draft is the recorded sample.

Say: "Nightshift is the route. NVIDIA Nemotron writes the draft, and only from those rows. If the judge machine has no hotspot, the same card shows the call skipped and the sample draft used instead."

Judge line: `nvidia.model`, status success or skipped. Both are honest. A skipped call with no explanation is a miss.

## Beat 8. Judge combo (1:46–2:04)

On screen: two stamps on the same draft.

- Evaluator. Nightshift's judge lane. NVIDIA writes the critique. Pass or fail, one sentence.
- Risk. Scout's risk check. Code, no model. Sign or refuse.

Then the rule, in large type: "1 fail, retry. 2 fails, escalate." The dashed line goes back to the draft and stops at 2.

Cutaway, four seconds, Padmé, `T01-reply.eml`: she asked for a replacement, the draft promised a refund. Critique is an error. The ticket reopens, the refund is withdrawn, H-MEM `queueForHuman` fires. No third draft. Nothing is sent.

Say: "Two judges, one draft. The Evaluator is Nightshift, and NVIDIA writes the critique. Risk is Scout, and it does not call a model. One fail sends the draft back. That is the dashed line. Two fails, or one fact a rewrite cannot change, and it escalates to a person. Padmé's reply is that case. The agent promised money she did not ask for."

Judge line: `critique`, `risk.signoff`, `retry`, `escalate_or_fallback`.

## Beat 9. Audit trail (2:04–2:14)

On screen: the file `logs/trace-<run_id>.jsonl`, scrolled so `zetaris.query`, `nvidia.model`, `critique`, `retry`, and `escalate_or_fallback` are visible. Title: "Audit trail." Filename stays `trace-`.

Say: "Every one of those steps is a line in the audit trail. The file is the trace the hand-in quotes. A judge can open it and see how the hold was reached."

Judge line: `synthesis`, and the path in chapter 5 of `result.md`.

## Beat 10. What the trail makes possible (2:14–2:20)

On screen, three chips, one second each.

- Dashboard, a second Zetaris query: incoming, autonomous, first-time-right, escalations.
- A human reject moves the refund weight. The next similar ticket holds.
- A second run reads the memory id the first run wrote, and the planner says which chunk it skipped.

Say: "The dashboard reads the same Zetaris tables. The next similar ticket is shorter, because this path was remembered."

Judge line: `memory.write`, then the second run's `memory.read`.

## What stays out of the video

Swarm, Gaia, the Relay app, a third dashboard page, and a claim that the 24 threads are a trained model. The weights are seeds. The ingest loop wrote them. It did not train anything.

---
title: The trust floor
description: Why a 40 GC refund is held even though it is within policy, how a category earns the right to send on its own, and where each number comes from.
date: 2026-10-25
tags: [judging, trust, feedback, decisions]
---
# The trust floor: how a category earns auto-send

Two different rules decide what happens to a refund request, and the video shows both. The money rule is a hard limit. The trust floor is a score the team earns per category by affirming or rejecting the loop's decisions. This page explains the second one, because at first sight it looks like it duplicates the first.

## The two rules in one sentence

The policy limit protects the money. The trust score protects the tone and the facts: a draft can be within budget and still promise the wrong thing, so each category earns automation through human verdicts instead of a switch.

## What the branch checks, in order

The branch step runs once per message, after the facts have been read from Zetaris. The first rule that applies wins (`src/loop.mjs`, the branch function; the `branch` trace line carries the reason verbatim).

| Order | Rule | Branch | What happens |
|---|---|---|---|
| 1 | A cited fact may not leave the company | `data-block` | held for a person |
| 2 | Same sender, subject and body as an earlier thread | `duplicate` | closed as a duplicate |
| 3 | A complaint on a public channel (Trustpilot) | `public-channel` | held, public-image risk |
| 4 | **Amount over the policy limit** (refund limit 150 GC, `policy.csv`) | `over-limit` | Risk refuses the draft; escalated to the over-limit owner (the Sales head, employee 40; the CEO Paul Jedi, employee 201, when the head is out) with the draft attached |
| 5 | Owner and backup both out that day (`holiday-2026.csv`) | `owner-out` | held |
| 6 | **Category trust weight under the floor** | `under-floor` | held for the owner (backup named when the owner is out), draft attached |
| 7 | A required check could not run (a policy or disclosure read failed) | `data-block` | held |
| 8 | None of the above | `send-ok` | sent automatically |

The 400 GC request stops at rule 4. The 40 GC request passes rule 4 and stops at rule 6.

## Where the weight comes from

`trustFloor()` in `src/gates.mjs`:

```
weight = clamp(seed_weight + 0.05 × affirmed − 0.05 × rejected, 0, 1)
under  = weight < floor          (floor is 0.80 for every category)
```

- `seed_weight` and `floor` are rows of the trust ledger, a CSV registered in Zetaris (`data/synthetic/trust-ledger.csv`, table `JEDI_PACK.trust_ledger`), read by the `trust` query in every run.
- `affirmed` and `rejected` are counts of verdicts for that category in the decisions table (`JEDI_PACK.decisions`, the `ledger_adjust` query). Every completed run writes a decision row; `POST /feedback` sets its verdict and delta (affirm +0.05, reject −0.05) and republishes the table, so the next run of that category reads the new count.
- The category is the one the OpenJev gate chose when it was at least 0.6 confident, otherwise the ticket's own category.

The seeded ledger, as shipped:

| Category | Seed weight | Floor | Affirms needed before auto-send | Today |
|---|---|---|---|---|
| appreciation | 0.84 | 0.80 | 0 | sends on its own |
| question | 0.71 | 0.80 | 2 | held |
| complaint | 0.62 | 0.80 | 4 | held |
| refund | 0.55 | 0.80 | 5 | held |
| other | 0.40 | 0.80 | 8 | held |
| replacement | 0.50 | 0.80 | 6 | held |
| rfq | 0.40 | 0.80 | 8 | held |
| customer_service | 0.40 | 0.80 | 8 | held |
| billing | 0.40 | 0.80 | 8 | held |
| delivery | 0.85 | 0.80 | 0 | sends on its own |
| legal | 0.20 | 0.80 | 12 | held |
| product | 0.71 | 0.80 | 2 | held |

Every affirm moves a category 0.05 closer to the floor; every reject moves it 0.05 back. Five affirmed refund holds take refund from 0.55 to 0.80, and from then on a within-limit refund draft is sent without a person. One rejection pulls it back under. A category that was never affirmed never auto-sends.

FAQ hits are the one deliberate exception: a question that matches an FAQ row is answered from that row and sent (branch `faq-hit`), because the answer is the company's own published text, not a drafted promise.

## What the video shows

- Scene "Gone Fishin'": the branch line under the current seeded policy is `refund weight 0.55 is under the floor 0.8; owner 15 out, backup 27 in`. Within the limit, still held, backup named.
- Scene "A person decides": the backup affirms the held draft on the dashboard; the decision row gets `affirm, +0.05`; the counter ticks. That is the ledger learning. Five such affirms and the next 40 GC refund goes out on its own.

## Evidence a judge can open

- Live trace of the 40 GC step: [traces/trace-refund-live_1.jsonl](traces/trace-refund-live_1.jsonl), the `zetaris.query sql:trust` line (reads the ledger row) and the `branch` line (older traces may show the previous backup; `policy.csv` now names backup 27). The whole chain: [refund-chain.md](refund-chain.md).
- The ledger: `inbox/data/synthetic/trust-ledger.csv`; registered in Zetaris as described in [zetaris-register.md](zetaris-register.md).
- The formula: `src/gates.mjs`, `trustFloor()`; the branch order: `src/loop.mjs`, the branch function; the verdict write: `src/decisions.mjs` and `POST /feedback` in `openapi.yaml`.
- Tests: `tests/loop_core.test.mjs` (the under-floor hold and the branch order), `tests/api.test.mjs` (`POST /feedback`: verdict and delta), run with `npm test`.

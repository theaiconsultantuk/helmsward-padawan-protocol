---
title: Trust ledger learning
description: Staff feedback changes a refund from hold to send and back in sample mode.
tags: [judging, trust, feedback]
---

# Trust ledger learning

Sample mode, decision code and inputs at commit `f7852e8` (2026-10-26).
Regenerate from `inbox/`: `node scripts/impact_numbers.mjs --write` (or this file alone: `node scripts/ledger_learning.mjs --write`).

The ticket is s01, “I would like a refund of 80 GC for my Drift Boot Wraps, they are too small for my son.”
It asks for 80 GC within the 150 GC limit, with a fresh customer each run as on the contact page.

| Step | What a person did before it | Run and trace id | Refund weight | Floor | Decision | Branch |
|---|---|---|---|---|---|---|
| 1 | No feedback yet | ledger-demo-1 / ledger-demo-1 | 0.55 | 0.80 | hold | under-floor |
| 2 | Affirm run 1 | ledger-demo-2 / ledger-demo-2 | 0.60 | 0.80 | hold | under-floor |
| 3 | Affirm run 2 | ledger-demo-3 / ledger-demo-3 | 0.65 | 0.80 | hold | under-floor |
| 4 | Affirm run 3 | ledger-demo-4 / ledger-demo-4 | 0.70 | 0.80 | hold | under-floor |
| 5 | Affirm run 4 | ledger-demo-5 / ledger-demo-5 | 0.75 | 0.80 | hold | under-floor |
| 6 | Affirm run 5 | ledger-demo-6 / ledger-demo-6 | 0.80 | 0.80 | send | send-ok |
| 7 | Reject run 6 | ledger-demo-7 / ledger-demo-7 | 0.75 | 0.80 | hold | under-floor |

The seed is 0.55 from `data/synthetic/trust-ledger.csv`; `src/gates.mjs` (`trustFloor`) computes seed + 0.05 × affirms − 0.05 × rejects, with the deltas in `src/decisions.mjs` (`VERDICTS`).
5 affirms move the weight to 0.80 and the refund sends; one reject moves it to 0.75 and the next refund holds.

The branch trace lines, verbatim:

- ledger-demo-1: refund weight 0.55 is under the floor 0.8; owner 15 in
- ledger-demo-2: refund weight 0.6 is under the floor 0.8; owner 15 in
- ledger-demo-3: refund weight 0.65 is under the floor 0.8; owner 15 in
- ledger-demo-4: refund weight 0.7 is under the floor 0.8; owner 15 in
- ledger-demo-5: refund weight 0.75 is under the floor 0.8; owner 15 in
- ledger-demo-6: weight 0.8 meets the floor 0.8, within the limit, someone is available
- ledger-demo-7: refund weight 0.75 is under the floor 0.8; owner 15 in

What a live server adds: the counts come from `JEDI_PACK.decisions` in Zetaris (`queries.mjs` `ledger_adjust`) instead of the local file; the arithmetic is the same.
How to film it: use a local sample-mode server and the contact page's s01 scenario, affirm each held run, then reject the send.
The hosted ledger is shared by every judge.

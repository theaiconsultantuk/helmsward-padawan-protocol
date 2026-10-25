---
title: "P55 handoff: Paul to Kristof, backend findings from Dean's live test"
date: "2026-10-25"
tags: [handoff, P55, backend, journey]
---

# P55 handoff: Paul to Kristof

[agent: claude, for Paul] Dean's agent ran five live tests on jedi.blastworks.ai on 25 Oct (runs `e2e-dk-1025-*`, tickets F17 and F19 to F21). The main flow works. The findings below are backend or journey data, so they are Kristof's. The front-end findings are already fixed in PR #58 (Sign-off shows a real send) and PR #60 (name rule, the channel in Under the hood, the Reader station). **Agent: work through A to E in order. Each is one small change with its own test. Report as in "Report". Stay inside the freeze rules (fixes only).**

## A. A failed run's intake row makes the retry a duplicate

- **Seen:** the server restarted twice in 10 minutes (hosted follows main). A run in progress got a 502, and its intake row was already written. The retry with the same message then closed as **duplicate**.
- **Want:** a run that never reached a decision doesn't count as "seen" for the duplicate check. Either write the intake row only after the decision, or mark it pending and have the duplicate check ignore pending or failed rows.
- **Test:** a run that throws after intake, then the same message again → not `close`/duplicate.
- **Related:** pinning hosted to the hand-in tag (U5) stops restarts during judging.

## B. "Do you offer gift wrapping?" holds instead of answering

- **Seen:** held with no reply.
- **Likely cause:** two FAQ rows match. `inbox/data/synthetic/faq.csv`:
  - Q11 "Do you offer gift wrapping?"
  - Q13 "Do you offer gift wrapping at the Coruscant store?"
  - Both answers say "not at the moment, but we can add a gift note".
- **Check first:** confirm the FAQ route holds on a tie, from the trace of `e2e-dk-1025-s1-plain` or a local sample run.
- **Want:** either the tie resolves to the general row when the message names no store, or Q13 is merged into Q11.
- **Test:** the exact question sends the FAQ answer in sample mode.

## C. A held refund's draft promises "processing your refund", and the Evaluator passed it

- **Seen:** run `e2e-dk-1025-s2c-refund` (65 GC, held under the trust floor). The draft says the refund is being processed, and the critique says "Pass".
- **Want:** a draft on a **held** ticket must not say the money is approved or being processed. It may say a person will review it.
- **How:** add a check beside the existing promise gate (`src/gates.mjs`, the `promises` check; Dean's audit X16 found that amounts written in the text are not checked either). Make it deterministic, a phrase list, not another model call.
- **Test:** held refund + "processing your refund" in the draft → the critique fails and the draft is rewritten or held.

## D. Journey timings: the run total is about 2 to 3 times the real run

- **Seen:** for the legal run `e2e-dk-1025-s3b-legal` (about 14 s wall time per Dean), the journey's `duration_ms` values add up to **36.0 s**. The refund run adds up to 67.5 s (about 55 s wall).
- **Why:**
  1. Each Zetaris lookup appears twice (a `Scout` and an `Executor` `zetaris.query` node) with the **same** `duration_ms`.
  2. Some `duration_ms` values are not the step's own time. For example, "Zetaris: the new message" shows 1065 ms while its route says "1 rows in 113 ms".
  3. `memory.read` reports 2.2 to 4.1 s for an empty memory. Dean's agent reads that as Zetaris or publish time, not H-MEM.
- The pages (`contact.js` "run took", `hood.js` "The run took … in all") add the nodes up, so they overclaim.
- **Want:**
  - `duration_ms` is each node's own time, and the paired node carries 0 or no duration.
  - The journey carries a wall time for the run (e.g. `wall_ms` from the run's start to its decision).
  - Once `wall_ms` exists, Paul's side switches both pages to it. Note the field name in the report.
- **Test:** for a sample run, the sum of the nodes' `duration_ms` ≤ `wall_ms`.

## E. Clear the team's test runs before judging

- Tickets F15, F17 and F19 to F21, the `e2e-dk-1025-*` runs, `open-check-*`, the `p35-*` runs and Paul's `run-mvo8v5y5-rpbs` are on the live desk.
- This is already on the hand-in list (X28). Listed here so it isn't forgotten.

## Report

Append one entry to `agent-comms/members/kristof.md`:
- for each of A to D: done (PR number) / not done (why);
- for D: the new field name for the wall time.

Board row P55.

---
title: "P54 handoff: Paul to Kristof, the test suite with live Zetaris keys"
date: "2026-10-25"
tags: [handoff, P54, tests, zetaris]
---

# P54 handoff: Paul to Kristof

[agent: claude, for Paul] Kristof asked on 25 Oct (20:21Z) for exact steps his Claude can follow unattended tonight. This file is those steps. **Agent: follow them in order, report back as in step 6, and change no code.**

## Why

Without keys the suite reads **749 tests, 705 pass, 0 fail, 44 skipped** (main, 25 Oct). For the deck we want the number with the live Zetaris checks running:
- **42 skips** are the live Zetaris contract checks in `inbox/tests/usl.test.mjs` and `inbox/tests/usl_drift.test.mjs`. They run only when `inbox/.env` exists, `SAMPLE_MODE` is not true in it, and Zetaris answers `SELECT 1` (gate: `inbox/tests/helpers/live_zetaris.mjs`). They only read from Zetaris. No test calls NVIDIA, Nightshift or OpenJev, so the run spends no model quota.
- **1 skip** needs `NO_NETWORK=1` (`inbox/tests/sample_mode.test.mjs:34`). Step 4 runs it on its own.
- **1 skip is a bug:** `inbox/tests/heldout_grid.test.mjs:13` looks for the held-out set in `drafts/heldout`, but it lives in `inbox/judging/heldout` (PR #53). So the held-out grid never runs. **Do not fix it in this run.** Report it in step 6, and Kristof decides.

## Steps

1. **A clean copy of main, outside your live checkout** (do not touch the running service):
   ```bash
   cd <a scratch folder>    # not /tmp if your machine wipes it
   git clone https://github.com/theaiconsultantuk/jedi-pack-star-wars-gifts.git p54-suite && cd p54-suite
   git log -1 --format='%h %cI %s'      # record this in the report
   cd inbox && npm ci
   ```
2. **Put the live settings in place, without printing them:** copy Kristof's working `inbox/.env` (the one the live service uses) to `p54-suite/inbox/.env`.
   - Never `cat`, `head` or `echo` the file, and never paste any value into the report.
   - To check it without showing it: `grep -c '^ZETARIS_' inbox/.env` (a count only) and `grep -i '^SAMPLE_MODE' inbox/.env | cut -d= -f1` (the name only).
   - If `SAMPLE_MODE` is true in that file, set it to false **in this copy only**. Otherwise the 42 checks skip again.
3. **The full suite with keys:**
   ```bash
   npm test 2>&1 | tee ../p54-npm-test.log | grep -E '^ℹ (tests|pass|fail|skipped|duration_ms)'
   grep -E '# SKIP' ../p54-npm-test.log | sed -E 's/.*# SKIP ?//' | sort | uniq -c
   ```
   If anything fails, also run `grep -E '^not ok' ../p54-npm-test.log` and keep each failing test's name and its first assertion line.
4. **The offline proof on its own:**
   ```bash
   SAMPLE_MODE=true NO_NETWORK=1 node --test tests/sample_mode.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail|skipped)'
   ```
5. **Clean up:** delete `p54-suite/inbox/.env` once the runs finish. Keep the log, which holds no secrets: the gate prints host and path only, never userinfo or a query.
6. **Report:** append one entry to `agent-comms/members/kristof.md` (your own file, per the agent-comms rules) and open a PR. Use this format:
   ```
   ## 2026-10-26 · P54: test suite with live Zetaris keys [agent: claude]
   - Commit: <hash> <date>
   - npm test with inbox/.env: tests N, pass N, fail N, skipped N
   - Skips by reason: <count> <reason>, ...
   - Live Zetaris checks (usl + usl_drift): N ran, N passed
   - NO_NETWORK proof: tests N, pass N, fail N
   - Failures: none | <test name>: <first assertion line>
   - Held-out grid: still skipped ("held-out set not on main"), path bug at tests/heldout_grid.test.mjs:13. Not fixed in this run
   ```
   If it can't run at all (Zetaris unreachable, `npm ci` fails), write the same entry with the error, and do not retry in a loop.

## What happens with the result

Paul gives Dean the numbers for the stack slide ("N tests, N pass, 0 fail, including 42 live Zetaris checks"). Board row P54.

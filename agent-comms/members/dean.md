# dean: log

Owns: (to confirm)

## Entries (append only, newest last)

### 2026-10-24: D1, D6 and D4 findings


Tested main (162352d) from a fresh clone, following the README only, with SAMPLE_MODE=true. Two separate runs were done, and both agree on the main points.

**Overall:** the app works in sample mode. The server starts on 8000, every README route answers, all 9 input examples give the expected decision, and the hosted build is up. Nothing is fatal, but a judge following the README will trip in several places.

#### D1 Fresh-clone snags

| # | Snag | Suggested fix |
|---|------|---------------|
| S1 | The root README's "Run it" section is still the gift-finder practice app. `./run.sh` fails without doppler. | Point the root README straight at the inbox app's Quick start. |
| S2 | "Run from inbox/" comes after the first commands, so the root `cp .env.example .env` fails. | Put `cd inbox` as step 1. |
| S3 | `.env.example` has SAMPLE_MODE=false, so it's unclear whether the command line or the file wins (the command line wins). | Set it to true in the example, or say which one wins. |
| S4 | Creating `.env` (the first Quick start step) switches on live Zetaris tests, so `npm test` gives 8 fails out of 391. Without `.env` it's 380 pass, 0 fail. | Skip live tests unless the credentials are set, or say so in the README. |
| S5 | The API curl examples use port 8810, but the default is 8000. | Change them to 8000. |
| S6 | Re-posting an example returns "Conflict: run_id already used", which isn't documented. | Add one line to the README. |
| S7 | `npm run doctor` exits 0 even when all 3 providers fail. | Exit non-zero on failure. |
| S8 | The README says Node 22+. On Node 20 npm warns, but sample mode still works. | Fine as is, or say 20 works. |

**App bugs seen:**
- One customer draft prints internal row ids (`holiday_2026:15@2026-10-22`).
- `backup_name` is null even when a backup id is set.
- One drafter label reads "sample-rules" but "sample/rules" everywhere else.

#### D6 README read as a judge

The technical detail and honesty are strong. Setup, usage, dependencies, Zetaris, Meterless and Nemotron are all covered. The rough score is 73 to 75 out of 100. The gaps are in impact, innovation and demo, which are worth 60 points:

- J1: there are no impact numbers, such as time saved or wrong replies avoided.
- J2: there's no demo video or deck link, and no "try this first" line at the top.
- J3: there's no "What's new" section, although the rules ask for one.
- J4: there are small errors. It says "17 file sources" but the table lists 18, two steps are numbered "10.", and the 8810 port is wrong.
- Cursor isn't mentioned, but the 22 Oct field guide says Cursor is optional, so this is fine.

#### D4 The 24 thread outcomes

- There are 24 threads and 24 intakes (16 email, 5 contact form, 3 Trustpilot). All of them match, and every owner-on-holiday flag matches the holiday file.
- Most outcomes are backed by the policy files, and the app gives all 24 the expected decision in sample mode.
- **T10: disagree.** It escalates for "public image risk", but no policy file has a rule for public posts like Trustpilot. T05 is also a Trustpilot post and only holds. From the files alone, T10 would be a hold.
- **T05:** the outcome fits, but its stated reason isn't backed by any file.
- **Conflict in the files:** `what-may-leave.md` holds a facts-can't-leave ticket (T04, T23), but `challengetrack.md` line 203 says escalate.
- **Gaps in the files:**
  - There's no trust row for "other", so T21 and T22 use weight 0 instead of 0.40.
  - There's no owner for appreciation or "other" tickets.
  - There's no trust weight for replacements.
  - "close" is used as a 4th outcome (T16, T20, T24).

#### Questions for the team

1. Should a facts-can't-leave ticket be held or escalated?
2. Can we fix S1 to S5 and the test issue before the 26 Oct freeze?
3. Who adds the demo video link, the impact numbers and the "What's new" section?

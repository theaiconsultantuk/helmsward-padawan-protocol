---
title: "The Padawan Protocol: Open Agent Hackathon 2026 submission"
description: "A customer-support inbox agent that decides, critiques and escalates with a full trace. Track 3 Reasoning Architecture. Team: Jedi Pack."
date: "2026-10-23"
tags: [hackathon, inbox, zetaris, meterless, nvidia]
---

# The Padawan Protocol

**An inbox agent that earns its autonomy.** A category below the 0.80 trust floor is a Padawan, in learning mode: its messages are held for a person with a finished draft ready (refunds start at 0.55, complaints at 0.62). Each human Affirm adds trust, stored in Zetaris; once a category reaches the floor the agent replies on its own, and one bad call sends it back to training. Proof: [ledger-learning.md](inbox/judging/ledger-learning.md).

A customer-support inbox agent that reads a ticket, decides (send, hold, escalate or close), has a second reader and a policy check challenge the draft, and writes every step to a trace a judge can read.
**Built on the sponsor stack:** every fact the agent decides from is a live SQL query to **Zetaris** (28 sources, one semantic layer, no ETL); the reasoning runs on three **Meterless** engines; **NVIDIA Nemotron 3.5 Lightning** drafts and critiques through Meterless Nightshift (primary route; every trace records the model that answered).
Track: Open Agent Hackathon 2026, Track 3 "Reasoning Architecture". Team: Jedi Pack.
Read: [inbox/README.md](inbox/README.md) (the submission) and [inbox/judging/README.md](inbox/judging/README.md) (the evidence files).
The service serves a storefront at `GET /` (Home, Shop, FAQ and a Contact page that is the front end, with what happens under the hood beside it) and an internal dashboard at `GET /dashboard`.
It handles five scenarios (refund, question, request for quote, complaint, free text), and the complaint route uses the Meterless World Model: see [inbox/judging/scenarios.md](inbox/judging/scenarios.md).

## Try it

- **Live demo:** [jedi.blastworks.ai/shop/contact.html](https://jedi.blastworks.ai/shop/contact.html). Pick a scenario under "Try a scenario", choose **Live** (real models and data, some runs take minutes) or **Simulated** (rules and sample data, a second or less, not counted), submit, then open **Under the hood** for every step the agent took.
- **The desk:** [jedi.blastworks.ai/shop/desk.html](https://jedi.blastworks.ai/shop/desk.html), what the staff see: the queue, who holds what, a kanban per team and the Sign-off chain for refunds over the limit and legal threats. Deadlines, the clock and sign-off emails on the desk are simulated; the first two sign-off steps are the run's real record.
- **Video:** _link to come_. **Deck:** _link to come_.

## What is new (25 Oct)

- Contact page: Live or Simulated, and a running indicator while the agent works.
- Desk: Teams kanban, Sign-off dialog (Support then Legal for a legal threat, heads in Cc), Sign-off on cards without a run.
- Runs survive a server restart; each run gets a fresh customer so a repeat is not closed as a duplicate.
- 23 input examples, each with its stored sample output; a [held-out set](inbox/judging/heldout/README.md) the rules were never tuned on.

## Zetaris: the agent's data layer

Without Zetaris the agent cannot decide: there is no other source of the owner, the holiday, the refund limit, the trust weight or the price.

| What | How it works here | Proof |
|---|---|---|
| One SQL surface over 28 sources | `CREATE LIGHTNING DATABASE JEDI_PACK`, then one `CREATE LIGHTNING FILESTORE TABLE` per source: 25 synthetic files in six formats (CSV, XML, Markdown, JSON, Parquet, text), two runtime tables and a REST source. No adapter, no ETL, no mapping layer | [zetaris-register.md](inbox/judging/zetaris-register.md), [register_zetaris_sources.sql](inbox/scripts/register_zetaris_sources.sql), [data/sources.json](inbox/data/sources.json) |
| Unified Semantic Layer | `lightning.metastore.jedi_pack.jedi_pack`: typed DDL with primary and foreign keys, live views over the raw sources, so a change in a source shows at once. The scenario routes and the World Model build read its tables (`customer`, `ticket`, `policy`, `responsibility`, `faq`, `holiday`, `decision`, `sales_order` and more) | [zetaris-usl.md](inbox/judging/zetaris-usl.md), [zetaris_usl.sql](inbox/scripts/zetaris_usl.sql) |
| The agent writes back | Every finished run is a row in `decisions`; each Affirm or Reject on the desk is stored there and moves that category's **trust floor** by 0.05, so people steer the agent through Zetaris. Every customer message is published to `intake_runtime` before the loop reads it back | `POST /feedback`, `/counters` is a live `GROUP BY` over `decisions` |
| Safe queries | Named SQL templates in [src/queries.mjs](inbox/src/queries.mjs) with whitelisted parameters; customer text never reaches SQL | [src/adapters/zetaris.mjs](inbox/src/adapters/zetaris.mjs) |
| Tested live | 42 live Zetaris checks pass in the keyed test run (874 tests, 0 fail, 26 Oct) (`usl` and `usl_drift`) | [tests/usl.test.mjs](inbox/tests/usl.test.mjs), [tests/usl_drift.test.mjs](inbox/tests/usl_drift.test.mjs) |

See it in the demo: open **Under the hood** on any run; the **Zetaris** station shows each query and its row count and time (for example "1 row in 108 ms"). Sample mode answers from rows cached from the same tables and says so in the trace. Full write-up: [sponsor-explanation.md](inbox/judging/sponsor-explanation.md).

## Meterless engines

| Engine | What it does here | Proof |
|---|---|---|
| Scout Intent | Classifies the message, blocks injection, redacts PII, signs the contract the loop checks before any model call | Scout eval harness exits 0 on the 32-example v1 set: [engine-scout-evals.md](inbox/judging/engine-scout-evals.md) |
| H-MEM | Stores one sourced memory per run and reads it before planning | Run B names the chunk it skipped because run A wrote it: [engine-hmem-two-run.md](inbox/judging/engine-hmem-two-run.md) |
| World Model | Reads the customer's history on a complaint: vent, genuine or legal | Conformance 8/8 on the reference and our bundle: [engine-world-model.md](inbox/judging/engine-world-model.md) |

Nightshift routes the model calls (Nemotron 3.5 Lightning drafts and critiques): [sponsor-explanation.md](inbox/judging/sponsor-explanation.md).

## Held-out result

<!-- impact:root:start -->
Sample mode, decision code and inputs at commit `f7852e8` (2026-10-26).
On 20 messages the rules were never tuned on (8 adversarial), sample mode matches the expected decision on **14**.
Across the 100 threads, Risk stopped 15 replies from auto-sending (12 over-limit refunds routed to the approver; 2 restricted facts: no draft written; 1 earlier promise: no autonomous reply) and 71 waited for a person until their category is trusted.
[Held-out evidence](inbox/judging/heldout/README.md) · [Results and regeneration](inbox/README.md#results).
<!-- impact:root:end -->

## Run it

The submission is the `inbox/` app. From this folder:

```bash
cd inbox
npm ci
SAMPLE_MODE=true npm start   # bundled data, no network, no keys: open http://127.0.0.1:8000
```

The one process serves the front end, the dashboard and the API, so a clean run needs no key and no other service. The live stack, Docker, the API and the tests: [inbox/README.md](inbox/README.md).

## Practice build (pre-existing, not part of the submission)

### Jedi Pack: Star Wars Gift Finder (practice use case)

Practice build for the Open Agent Hackathon 2026 (22-27 Oct). Team: Jedi Pack.
Picked by team vote. The real challenge statement arrives 22 Oct; this is rehearsal for the stack.

### Idea
Ask in plain English ("gift for a 10 year old who loves Mandalorian, under 30 pounds") and get a ranked
shortlist, sorted by rank, units sold and rating, with the reason for each pick.

### Layout
- `data/` sample catalogue (CSV). Rank, sold and rating fields are SAMPLE values, not live Amazon data.
- `src/` code
- `docs/screenshots/` evidence of each step
- `PROMPT-LOG.md` running log (newest last)
- `STATUS.md` what runs, what was tested, what is blocked

### Rules
- No keys in the repo. Keys come from Doppler at run time.
- Private until submission; the team lead makes the repo public before the deadline.

### Run the practice build (not the submission)
1. Needs the Doppler CLI and access to the `jedi-pack` project (NVIDIA + TMDB keys). Teammates without access: put `NVIDIA_API_KEY` in your own shell env (see `docs/NEMOTRON-QUICKSTART.md`).
2. `./run.sh`, then open http://127.0.0.1:4173
3. `doppler run --project jedi-pack --config prd -- node src/tmdb.mjs` refreshes the Star Wars film/TV data.
4. `OPENROUTER_API_KEY` is optional and only used as a fallback if the NVIDIA call fails.

### How it works
Plain-English request -> Nemotron turns it into filters (price, age, theme, product word) -> ranking in `src/rank.mjs` -> Nemotron explains the top pick using only the facts given.

### Attribution
This product uses the TMDB API but is not endorsed or certified by TMDB.

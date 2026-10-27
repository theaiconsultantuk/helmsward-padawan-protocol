---
title: "Helmsward: the agent that earns its autonomy (Open Agent Hackathon 2026)"
description: "A customer-support inbox agent that decides, critiques and escalates with a full trace. Track 3 Reasoning Architecture. Team: Jedi Pack."
date: "2026-10-23"
tags: [hackathon, inbox, zetaris, meterless, nvidia]
---

# Helmsward: the agent that earns its autonomy

**Helmsward is the autonomous contact hub for a company.** It knows the business inside out through the Zetaris Unified Semantic Layer, acts within guardrails set by the Meterless engines (Scout Intent, H-MEM, World Model), and drafts and critiques with NVIDIA Nemotron through Meterless Nightshift.
Refunds, questions, complaints, tailored quotes: Helmsward handles each one and routes it to the right human(oid) from what Zetaris holds. For example, a refund that needs approval goes to the approver; if the approver is out of office (Zetaris holds the company holiday planner), it goes to the backup approver.
On the live site customers write through the Contact page; email, chat and review (Trustpilot) messages are simulated intake with sample messages. Every channel becomes the same kind of ticket on the same flow, and each keeps its own rules from Zetaris: a public review never gets an automatic reply.

**It earns its autonomy: the Padawan Protocol.** A category below the 0.80 trust floor is a Padawan, in learning mode: its messages are held for a person with a finished draft ready (refunds start at 0.55, complaints at 0.62). Each human Affirm adds trust, stored in Zetaris; once a category reaches the floor Helmsward replies on its own, and one bad call sends it back to training. Proof: [ledger-learning.md](inbox/judging/ledger-learning.md).

**The demo store is Farstrand Supply Co.**, a galactic storefront supplying Jedi with the tools to fight the good fight, owned by the holding company Jedi Pack Inc. The company and its data are fictional.

Under the hood, Helmsward reads a ticket, decides (send, hold, escalate or close), has a second reader and a policy check challenge the draft, and writes every step to a trace a judge can read.
**Built on the sponsor stack:** every fact the agent decides from is a live SQL query to **Zetaris** (28 sources, one semantic layer, no ETL); the reasoning runs on three **Meterless** engines; **NVIDIA Nemotron 3.5 Lightning** drafts and critiques through Meterless Nightshift (primary route; every trace records the model that answered).
Track: Open Agent Hackathon 2026, Track 3 "Reasoning Architecture". Team: Jedi Pack.
Read: [inbox/README.md](inbox/README.md) (the submission) and [inbox/judging/README.md](inbox/judging/README.md) (the evidence files).
The service serves a storefront at `GET /` (Home, Shop, FAQ and a Contact page that is the front end, with what happens under the hood beside it) and an internal dashboard at `GET /dashboard`.
It handles five scenarios (refund, question, request for quote, complaint, free text), and the complaint route uses the Meterless World Model: see [inbox/judging/scenarios.md](inbox/judging/scenarios.md).

## Try it

- **Judges' walkthrough (optional):** [JUDGES.md](JUDGES.md), ten things worth trying on the live site, where to find them and what to look for. Fifteen minutes, any order.
- **Live demo:** [jedi.blastworks.ai/shop/contact.html](https://jedi.blastworks.ai/shop/contact.html). Pick a scenario under "Try a scenario", choose **Live** (real models and data, some runs take minutes) or **Simulated** (rules and sample data, a second or less, not counted), submit, then open **Under the hood** for every step the agent took.
- **The desk:** [jedi.blastworks.ai/shop/desk.html](https://jedi.blastworks.ai/shop/desk.html), what the staff see: the queue, who holds what, a kanban per team and the Sign-off chain for refunds over the limit and legal threats. Deadlines, the clock and sign-off emails on the desk are simulated; the first two sign-off steps are the run's real record.
- **Video:** [Helmsward demo on YouTube (3:39)](https://youtu.be/xfwEyGLAq60). **Deck:** [docs/helmsward-d2-deck-v5.pdf](docs/helmsward-d2-deck-v5.pdf).

## Submission checklist: where each requirement is

| Requirement | Where |
|---|---|
| Setup from a clean clone | [Run it from a clean clone](#run-it-from-a-clean-clone) and [CLEAN-CLONE.md](CLEAN-CLONE.md): `node judge.mjs`, no keys |
| Usage, with sample inputs and outputs | 23 inputs in [inbox/input_examples/](inbox/input_examples/), each with its stored output in [inbox/output_examples/](inbox/output_examples/); the API in [inbox/README.md](inbox/README.md#api) |
| Dependencies | Node 22 or newer, no runtime packages. The live agent needs Zetaris, Meterless Nightshift and OpenJev: placeholders only in [inbox/.env.example](inbox/.env.example). `SAMPLE_MODE=true` runs everything without them ([Sample mode](inbox/README.md#sample-mode)) |
| Logs showing how it reached its output, and which model answered | [inbox/judging/traces/](inbox/judging/traces/): one JSON line per step; live traces name the model per request (`nvidia/nemotron-3.5-lightning-30b-a3b`). Format: [Logs and traces](inbox/README.md#logs-and-traces) |
| Zetaris as the data layer | [Zetaris: the agent's data layer](#zetaris-the-agents-data-layer) |
| Meterless engines, each with a passing test | [Meterless engines](#meterless-engines): Scout Intent, H-MEM, World Model |
| Nightshift as the primary AI provider, NVIDIA Nemotron | [inbox/judging/sponsor-explanation.md](inbox/judging/sponsor-explanation.md) and [AI and Model Usage](inbox/README.md#ai-and-model-usage) |
| No keys in the repo | `.env` is gitignored; the full git history was scanned with gitleaks and trufflehog on 26 Oct 2026: no findings |
| Pre-existing components | [Pre-existing components](inbox/README.md#pre-existing-components): the practice build at the repo root (committed 18 Oct, before the build window) is not used by `inbox/` |
| Every rule, checked | [inbox/judging/rules-checklist.md](inbox/judging/rules-checklist.md) |

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

## Run it from a clean clone

**The fastest way, one command:** needs only Git and Node 22 or newer. No keys, no accounts, no install, no network.

```bash
git clone https://github.com/theaiconsultantuk/helmsward-padawan-protocol.git
cd helmsward-padawan-protocol
node judge.mjs
```

`judge.mjs` runs all 23 shipped examples against their stored outputs, prints one trace and checks what each step did, reproduces the held-out score (14 of 20), then leaves the app open on `http://127.0.0.1:8000` until Ctrl+C. It ends with `ALL 7 CHECKS PASSED`. Step by step, with what each check proves: [CLEAN-CLONE.md](CLEAN-CLONE.md).

**Or by hand,** from the `inbox/` folder:

```bash
cd inbox
SAMPLE_MODE=true npm start    # bundled sample data, no network: open http://127.0.0.1:8000
npm ci && npm test            # optional, second terminal: 874 tests, 0 fail, 43 skipped (the live checks need keys)
```

Then open `/shop/contact.html`, pick a ★ scenario and submit, and open **Under the hood** for every step; the staff desk is `/shop/desk.html`. `PORT=<free port>` moves the server if 8000 is taken.
The one process serves the front end, the dashboard and the API. Sample mode runs the same decision code on rows cached from the same Zetaris tables, with fixed templates standing in for the model calls; the live stack (your own Zetaris and Nightshift keys), Docker, the API and the tests: [inbox/README.md](inbox/README.md).

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

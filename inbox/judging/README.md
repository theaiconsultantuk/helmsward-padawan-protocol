---
title: Judging pack index
description: One line per evidence file in the Jedi Pack judging pack, with the rule or criterion it answers, checked for existence by the script that regenerates it.
date: 2026-10-24
tags: [judging, index]
---

# Judging pack

Everything a judge needs to check the submission without asking the team. Paths are relative to `inbox/judging/`. Each file below was checked to exist when this index was generated (2026-10-24).

Regenerate the whole pack, from the repository root:

```
bash inbox/scripts/judging_pack.sh
```

The script reruns the sample-mode examples in a `--network none` container, runs the hero thread live, regenerates `../result.md` from that trace, reads `GET /sources` from a server it starts, runs `scripts/scenario_proofs.mjs` (examples 4 to 8 live and in sample mode, which writes `scenarios.md`, `engine-world-model.md` and the ten scenario traces), scans for secrets, and exits non-zero if a file below is missing or the scan is not clean. It never writes a trace line by hand.

**Build B (25 October 2026): current hero behavior.** The hero shows the decision and the Nemotron read; the approval reply is a fixed template, so the agent never improvises money language. Fixed over-limit and severe-complaint replies skip draft, critic and revision model calls; legal threats retain the courtesy template and data-block retains its no-draft hold. Gates and complaint reads still run. Existing traces and generated result pages below are historical evidence; this build does not regenerate the judging pack. A fresh s03 timing proof and the pack refresh remain due after review and merge.

Start with [../result.md](../result.md), then [rules-checklist.md](rules-checklist.md).

| File | What it is | Rule or criterion it answers |
|---|---|---|
| [README.md](README.md) | This index, with the regeneration command | Judge navigation |
| [rules-checklist.md](rules-checklist.md) | Technical Execution Guide section 13, each item ticked with a pointer | Section 13 Readiness Checklist |
| [../result.md](../result.md) | The result file: critique, retries, branching, shared memory and synthesis quoted from the hero trace by line | Methodology result file; Critique and validation; Retries; Branching; Shared memory; Final synthesis |
| [sample-mode-run.md](sample-mode-run.md) | The three examples and the recovery pair run with no network inside a container | Section 13 Data (sample mode); Running (nothing interactive) |
| [clean-clone-run.md](clean-clone-run.md) | Clone, build and run from a clean checkout, live and sample legs | Section 13 Running (clean clone) and Build (Docker) |
| [secrets-scan.md](secrets-scan.md) | gitleaks and the no-secrets sweep, exit codes and finding counts | Section 13 Secrets; Logs contain no secrets |
| [sources.json](sources.json) | The live GET /sources body: every Zetaris source, format, table and row count | Zetaris is the data layer, sources documented |
| [zetaris-usl.md](zetaris-usl.md) | The Unified Semantic Layer compiled and activated over the raw sources: keys, foreign keys, live views, join and liveness proof | Sponsor call a judge can see (Zetaris) |
| [zetaris-register.md](zetaris-register.md) | Every statement that registered the sources in Zetaris, with live row counts | Sponsor call a judge can see (Zetaris) |
| [engine-scout-evals.md](engine-scout-evals.md) | Meterless Scout eval run and the command | Meterless Engine really used (Scout) |
| [engine-hmem-two-run.md](engine-hmem-two-run.md) | H-MEM two-run proof: a second run reads what the first wrote | Shared memory (H-MEM) |
| [nightshift-models.json](nightshift-models.json) | The routes Nightshift offered | Nightshift connection; where NVIDIA contributes |
| [nightshift-first-call.json](nightshift-first-call.json) | The first probe call to Nightshift and its receipt | Nightshift connection; which model handled the request |
| [padme-chain.md](padme-chain.md) | Seraphine's email chain processed one step after the other, live | Errors and recovery; misread disclosure |
| [trust-floor.md](trust-floor.md) | Why a within-limit refund is still held: the category trust weight, the floor, the affirm and reject deltas, the branch order, with the numbers and the evidence | Shared memory and feedback; Technical: the decision rule a judge can verify |
| [refund-chain.md](refund-chain.md) | One customer, two refund requests, live: held under the floor with the owner on holiday, then over the limit and escalated with step 1's memory read first | Shared memory (H-MEM); holiday calendar; limit approval |
| [refund-chain-sample.md](refund-chain-sample.md) | The refund chain's deterministic twin (no model call) | Sample mode; the chain logic alone |
| [pre-existing.md](pre-existing.md) | Declaration of pre-existing components | Submission form: pre-existing work |
| [sponsor-explanation.md](sponsor-explanation.md) | The five sponsor paragraphs: Zetaris, engines and tests, Nightshift, NVIDIA, what was unique | Sponsor integration explanation |
| [ai-usage.md](ai-usage.md) | AI and Model Usage declaration | AI usage policy |
| [score-review.md](score-review.md) | Where the points are, kept current | Self-review against the scoring |
| [flow-v2.md](flow-v2.md) | The 17 flow nodes and the refinements this build made | Architecture / flow |
| [traces/trace-hero-live.jsonl](traces/trace-hero-live.jsonl) | Live run of the hero thread: critique, risk, retry, branch, memory, synthesis | Critique, Retries, Branching, Shared memory, Synthesis |
| [traces/trace-example-1.jsonl](traces/trace-example-1.jsonl) | Sample-mode example 1 (hold) | Sample mode; full step list |
| [traces/trace-example-2.jsonl](traces/trace-example-2.jsonl) | Sample-mode example 2 (send) | Sample mode; full step list |
| [traces/trace-example-3.jsonl](traces/trace-example-3.jsonl) | Sample-mode example 3 (escalate, the misread) | Escalation or fallback present in the sample trace |
| [traces/trace-recovery.jsonl](traces/trace-recovery.jsonl) | Sample run with Zetaris refusing once: an error line, then recovery | Errors and recovery |
| [traces/trace-padme-live_1.jsonl](traces/trace-padme-live_1.jsonl) | Seraphine chain step 1, live | Handoff; misread chain |
| [traces/trace-padme-live_2.jsonl](traces/trace-padme-live_2.jsonl) | Seraphine chain step 2, live | Handoff; misread chain |
| [traces/trace-refund-live_1.jsonl](traces/trace-refund-live_1.jsonl) | Refund chain step 1, live (40 USD, held; owner out, backup in) | Holiday calendar; trust floor |
| [traces/trace-refund-live_2.jsonl](traces/trace-refund-live_2.jsonl) | Refund chain step 2, live (400 USD, over the limit, escalated; reads step 1's memory) | Shared memory; limit approval |
| [traces/trace-refund-sample_1.jsonl](traces/trace-refund-sample_1.jsonl) | Refund chain step 1, sample mode | Sample mode |
| [traces/trace-refund-sample_2.jsonl](traces/trace-refund-sample_2.jsonl) | Refund chain step 2, sample mode | Sample mode |
| [traces/trace-two-run-A.jsonl](traces/trace-two-run-A.jsonl) | Two-run proof, run A (writes memory) | Shared memory |
| [traces/trace-two-run-B.jsonl](traces/trace-two-run-B.jsonl) | Two-run proof, run B (reads run A's memory id, skips a chunk) | Shared memory |
| [traces/trace-ask-mvk7jd5c.jsonl](traces/trace-ask-mvk7jd5c.jsonl) | A free-form question answered through /ask | Dynamic delegation |
| [engine-world-model.md](engine-world-model.md) | Meterless World Model: what it does in the complaint route, its tests and the live world_context and severity lines | Meterless Engine really used (World Model, the third engine, in a working feature with a test) |
| [engine-world-model-conformance.md](engine-world-model-conformance.md) | World Model conformance scorecards, 8/8 on the vendored reference and on our bundle | Meterless Engine really used (World Model); the engine's own passing test |
| [scenarios.md](scenarios.md) | Examples 4 to 8 (question, RFQ, vent, severe complaint) run live and in sample mode: decision, branch, models, journey reply, trace links | Branching; Dynamic delegation; Escalation; the scenarios slice |
| [screenshots/README.md](screenshots/README.md) | Captures of the two reference pages (front page, dashboard, journeys) at 1280 and 390 px | Product & UX: the unified front end and the internal dashboard |
| [traces/trace-scenario-4-live.jsonl](traces/trace-scenario-4-live.jsonl) | Example 4 live: a question answered from the FAQ (faq-hit, send) | Branching; Sponsor call (Zetaris faq rows) |
| [traces/trace-scenario-4-sample.jsonl](traces/trace-scenario-4-sample.jsonl) | Example 4 in sample mode (faq-hit, send) | Sample mode; full step list |
| [traces/trace-scenario-5-live.jsonl](traces/trace-scenario-5-live.jsonl) | Example 5 live: a question neither FAQ nor records answer (escalate to a person) | Escalation or fallback |
| [traces/trace-scenario-5-sample.jsonl](traces/trace-scenario-5-sample.jsonl) | Example 5 in sample mode | Sample mode; full step list |
| [traces/trace-scenario-6-live.jsonl](traces/trace-scenario-6-live.jsonl) | Example 6 live: an RFQ about 100 versus 100000 items, one price on file (escalate to sales with the price rows) | Branching; Handoff |
| [traces/trace-scenario-6-sample.jsonl](traces/trace-scenario-6-sample.jsonl) | Example 6 in sample mode | Sample mode; full step list |
| [traces/trace-scenario-7-live.jsonl](traces/trace-scenario-7-live.jsonl) | Example 7 live: a venting customer (complaint-vent, hold with a calm acknowledgement) | Meterless Engine (World Model); Branching |
| [traces/trace-scenario-7-sample.jsonl](traces/trace-scenario-7-sample.jsonl) | Example 7 in sample mode | Sample mode; full step list |
| [traces/trace-scenario-8-live.jsonl](traces/trace-scenario-8-live.jsonl) | Example 8 live: a severe complaint, World Model history, severity 10, escalated with the draft | Meterless Engine (World Model); typed gates (OpenJev); Escalation |
| [traces/trace-scenario-8-sample.jsonl](traces/trace-scenario-8-sample.jsonl) | Example 8 in sample mode | Sample mode; full step list |

50 files listed, 0 missing.

## Two runs of the script

A fresh run is inherent in the live parts, so a second run changes only: trace timestamps and run ids in `traces/trace-hero-live.jsonl`, `traces/trace-example-*.jsonl` and `traces/trace-recovery.jsonl`; the run timestamps, ids and model wording in the live `traces/trace-scenario-*-live.jsonl` (the sample ones differ only in timestamps) and the quotes in `scenarios.md` and `engine-world-model.md` that cite them; the memory ids and model wording inside the hero trace; and the quotes in `../result.md` and `sample-mode-run.md` that cite them. `sources.json` changes only if the live row counts changed. The rest is static or derived from files that do not change. The traces of the five earlier runs (`padme-live`, `two-run`, `ask`) are kept as committed.

---
title: Judging pack index
description: One line per evidence file in the Jedi Pack judging pack, with the rule or criterion it answers, checked for existence by the script that regenerates it.
date: 2026-10-23
tags: [judging, index]
---

# Judging pack

Everything a judge needs to check the submission without asking the team. Paths are relative to `inbox/judging/`. Each file below was checked to exist when this index was generated (2026-10-23).

Regenerate the whole pack, from the repository root:

```
bash inbox/scripts/judging_pack.sh
```

The script reruns the sample-mode examples in a `--network none` container, runs the hero thread live, regenerates `../result.md` from that trace, reads `GET /sources` from a server it starts, scans for secrets, and exits non-zero if a file below is missing or the scan is not clean. It never writes a trace line by hand.

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
| [zetaris-register.md](zetaris-register.md) | Every statement that registered the sources in Zetaris, with live row counts | Sponsor call a judge can see (Zetaris) |
| [engine-scout-evals.md](engine-scout-evals.md) | Meterless Scout eval run and the command | Meterless Engine really used (Scout) |
| [engine-hmem-two-run.md](engine-hmem-two-run.md) | H-MEM two-run proof: a second run reads what the first wrote | Shared memory (H-MEM) |
| [nightshift-models.json](nightshift-models.json) | The routes Nightshift offered | Nightshift connection; where NVIDIA contributes |
| [nightshift-first-call.json](nightshift-first-call.json) | The first probe call to Nightshift and its receipt | Nightshift connection; which model handled the request |
| [padme-chain.md](padme-chain.md) | Padme's email chain processed one step after the other, live | Errors and recovery; misread disclosure |
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
| [traces/trace-padme-live_1.jsonl](traces/trace-padme-live_1.jsonl) | Padme chain step 1, live | Handoff; misread chain |
| [traces/trace-padme-live_2.jsonl](traces/trace-padme-live_2.jsonl) | Padme chain step 2, live | Handoff; misread chain |
| [traces/trace-two-run-A.jsonl](traces/trace-two-run-A.jsonl) | Two-run proof, run A (writes memory) | Shared memory |
| [traces/trace-two-run-B.jsonl](traces/trace-two-run-B.jsonl) | Two-run proof, run B (reads run A's memory id, skips a chunk) | Shared memory |
| [traces/trace-ask-mvk7jd5c.jsonl](traces/trace-ask-mvk7jd5c.jsonl) | A free-form question answered through /ask | Dynamic delegation |

28 files listed, 0 missing.

## Two runs of the script

A fresh run is inherent in the live parts, so a second run changes only: trace timestamps and run ids in `traces/trace-hero-live.jsonl`, `traces/trace-example-*.jsonl` and `traces/trace-recovery.jsonl`; the memory ids and model wording inside the hero trace; and the quotes in `../result.md` and `sample-mode-run.md` that cite them. `sources.json` changes only if the live row counts changed. The rest is static or derived from files that do not change. The traces of the five earlier runs (`padme-live`, `two-run`, `ask`) are kept as committed.

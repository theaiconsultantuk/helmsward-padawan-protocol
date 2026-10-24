---
title: Rules checklist, Technical Execution Guide section 13
description: Every readiness-checklist item from the hackathon technical execution requirements, ticked with the file or command that proves it; the team's attended steps are marked owner step and not ticked.
date: 2026-10-24
tags: [judging, checklist, rules]
---

# Rules checklist

Source: Technical Execution Requirements, section 13 "Readiness Checklist". A box is ticked only when the script measured the claim on this run; the pointer says where to see it. Regenerate with `bash inbox/scripts/judging_pack.sh`.

## Running

- [x] A documented command starts the project from a clean clone. Pointer: Quick start in [../README.md](../README.md); the clone, build and run proof is [clean-clone-run.md](clean-clone-run.md) (`bash inbox/scripts/clean_clone_test.sh`).
- [x] There is a programmatic entry point, not only a UI. Pointer: `POST /run` in [../openapi.yaml](../openapi.yaml) and `node src/cli.mjs run --thread <id>`; the two reference pages in `public/` use only that API.
- [x] Input and output are structured and machine-readable. Pointer: [../input_examples/example_1.json](../input_examples/example_1.json), [../output_examples/example_1.json](../output_examples/example_1.json), and one JSON object per trace line ([traces/trace-example-1.jsonl](traces/trace-example-1.jsonl)).
- [x] Nothing requires interactive input. Pointer: [sample-mode-run.md](sample-mode-run.md): a detached container, then non-interactive `docker exec`, exit 0.

## Build

- [x] Docker build succeeds, or setup is fully documented. Pointer: [../Dockerfile](../Dockerfile); image `oah-inbox` (339e040f9133) was built from it and ran this pack's sample runs; the clean-clone build is in [clean-clone-run.md](clean-clone-run.md).
- [x] Dependencies install at build time. Pointer: [../Dockerfile](../Dockerfile) has no `npm` step at all: the service has no runtime dependencies (`package.json` lists dev dependencies only, used by the Scout evals).
- [x] Runs without a local GPU. Pointer: `grep -rIlE "cuda|nvidia-smi|torch" src Dockerfile` finds 0 files; models are reached over HTTP through Nightshift. The sample run above used none.
- [x] No runtime installs or model downloads. Pointer: the `--network none` container in [sample-mode-run.md](sample-mode-run.md) completed all three examples, which it could not do if anything were downloaded at run time.

## Secrets

- [x] No keys in code, logs, examples, the demo video or the slide deck. Pointer: [secrets-scan.md](secrets-scan.md) (gitleaks 0 findings, exit 0; `tests/no_secrets.test.mjs` exit 0). Code, logs and examples are covered by that scan. **Owner step:** the demo video and the slide deck are the team's to check by eye before upload; they are not in this repository.
- [x] The NVIDIA key is in Nightshift, not in the app. Pointer: `grep -rIlE "NVIDIA_API_KEY|nvapi-" src .env.example Dockerfile` finds 0 files; the app holds only `METERLESS_RUNTIME_TOKEN` for Nightshift ([../.env.example](../.env.example)).
- [x] `.env.example` present with placeholders. Pointer: [../.env.example](../.env.example).
- [x] `.env` is gitignored. Pointer: line `.env` of `inbox/.gitignore` and of `inbox/.dockerignore`. The gitleaks run without its allowlist finds the local `.env` only (see [secrets-scan.md](secrets-scan.md)); that file is never committed or put in the image.

## Data

- [x] Zetaris is the data layer, with sources documented. Pointer: [sources.json](sources.json) (live `GET /sources`: 21 sources, 20 live in Zetaris), the registration statements in [zetaris-register.md](zetaris-register.md), and 23 `zetaris.query` lines in the hero trace.
- [x] A Unified Semantic Layer compiled and activated over the raw sources. Pointer: [zetaris-usl.md](zetaris-usl.md) (12 keyed tables with foreign keys over CSV, JSON, Parquet, Markdown and the runtime CSVs, a cross-source join and a live-view proof), built by the scripted [../scripts/register_usl.mjs](../scripts/register_usl.mjs) with [../scripts/zetaris_usl.sql](../scripts/zetaris_usl.sql).
- [x] Repository is small. Pointer: `inbox/` without node_modules, logs and runtime data is 3916 KB (`du -sk`, measured by the script).
- [x] Sources and licences documented. Pointer: the data sources table and the Third-Party Code and Licences section of [../README.md](../README.md), [../data/sources.json](../data/sources.json), [pre-existing.md](pre-existing.md).
- [x] No manual data setup. Pointer: the synthetic data is committed under `data/synthetic/`; registration is the scripted [../scripts/register_sources.mjs](../scripts/register_sources.mjs) with [../scripts/register_zetaris_sources.sql](../scripts/register_zetaris_sources.sql) with the statements in [zetaris-register.md](zetaris-register.md). Zetaris itself is the sponsor's installed service.
- [x] Sample mode works without Zetaris, Nightshift or network access. Pointer: [sample-mode-run.md](sample-mode-run.md) (three examples, `--network none`, `SAMPLE_MODE=true`).

## Runtime

- [x] A run finishes in minutes. Pointer: the live hero run took 51.906 s (`execution_time_seconds` in the run's own output); sample runs take under a second ([sample-mode-run.md](sample-mode-run.md)).
- [x] External calls have timeouts. Pointer: `grep -rnE "AbortSignal.timeout|TIMEOUT_MS|setTimeout" src` finds 19 sites (per-call Nightshift, Zetaris, OpenJev timeouts; the server's request timeout).
- [x] Agent loops are bounded. Pointer: `maxRounds = 2` and a 300000 ms run cap in [../src/loop.mjs](../src/loop.mjs); the hero trace in [../result.md](../result.md) shows the loop ending at round 2.
- [x] Failures return a controlled response. Pointer: [traces/trace-recovery.jsonl](traces/trace-recovery.jsonl) (an `error` line, then `recovery`, result unchanged); `errBody` in [../src/server.mjs](../src/server.mjs) returns `{status:"error", error:{type, message, recoverable}}`.

## Logs

- [x] Written to stdout and `logs/`. Pointer: [../src/trace.mjs](../src/trace.mjs) writes each event to `logs/trace-<run_id>.jsonl` and to stdout as `[INFO] run_id=...`.
- [x] Show agent handoffs, critique, retries and recovery. Pointer: `delegate`, `critique`, `retry` in [traces/trace-hero-live.jsonl](traces/trace-hero-live.jsonl), `recovery` in [traces/trace-recovery.jsonl](traces/trace-recovery.jsonl); quoted by line number in [../result.md](../result.md).
- [x] Show Zetaris queries, Meterless Engine activity and which model handled each request. Pointer: the hero trace has 23 lines with `sponsor: zetaris`, 2 with `sponsor: meterless`, 2 with `sponsor: nvidia`, and 2 `nvidia.model` success lines that carry a model id.
- [x] Contain no secrets. Pointer: [secrets-scan.md](secrets-scan.md) (`tests/no_secrets.test.mjs` sweeps `logs/`, `output_examples/`, `judging/` and `data/sample/` for every configured secret value and any Bearer token).

## Engines and the scenario slice

- [x] A third Meterless engine, the World Model, in a working feature with a test. Pointer: the complaint route in [engine-world-model.md](engine-world-model.md); the Meterless conformance suite scores 8/8 on the vendored reference and on our committed bundle ([engine-world-model-conformance.md](engine-world-model-conformance.md), `npm run conformance`); the domain layer is tested in `tests/world.test.mjs`.
- [x] The World Model's work is visible in a live trace. Pointer: the `world_context` line (sponsor `meterless`, cited ids in `memory_ids`) in [traces/trace-scenario-8-live.jsonl](traces/trace-scenario-8-live.jsonl), quoted in [engine-world-model.md](engine-world-model.md).
- [x] The unified front end and the internal dashboard are served by the service from the API alone. Pointer: `GET /` and `GET /dashboard` ([../public/](../public/index.html)), screenshots in [screenshots/README.md](screenshots/README.md), the contract for a replacement in [../docs/FRONTEND-SPEC.md](../docs/FRONTEND-SPEC.md).
- [x] A free-text message becomes a ticket row that Zetaris reads, so every fact in the trace still comes through Zetaris. Pointer: the `intake_publish` line in [traces/trace-scenario-4-live.jsonl](traces/trace-scenario-4-live.jsonl) and the `intake_runtime` table in [../data/sources.json](../data/sources.json).
- [x] The five scenario examples run live and in sample mode and agree on decision and branch. Pointer: [scenarios.md](scenarios.md) and the ten `traces/trace-scenario-*.jsonl`, written by `scripts/scenario_proofs.mjs`.

## Owner steps (not ticked; not provable from this repository)

- [ ] Owner step: the repository is public before submission (judges must be able to open the link).
- [ ] Owner step: the demo video, checked for keys and for the on-screen terminal.
- [ ] Owner step: the slide deck, checked for keys.
- [ ] Owner step: the submission form, with the declarations drafted in [pre-existing.md](pre-existing.md), [sponsor-explanation.md](sponsor-explanation.md) and [ai-usage.md](ai-usage.md).

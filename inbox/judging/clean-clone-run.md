---
title: Clean-clone run
description: A build of the repo into the oah-inbox Docker image, run on the nine input examples live and the same nine in sample mode with no network.
date: 2026-10-23
tags: [judging, docker, clean-clone, sample-mode]
---

# Clean-clone run

Result: **PASS** (2026-10-23 08:05 CEST). Script: `inbox/scripts/clean_clone_test.sh`.

- Source: git clone --branch task/scenarios /opt/glitch/workspaces/open-agent-hackathon-2026--scenarios (fresh clone, committed files only)
- Commit: 95a9c08
- Build: `docker build -t oah-inbox <context>/inbox` (Dockerfile: node:22-slim, no npm step)
- Image `.env` check: `docker run --rm --entrypoint ls oah-inbox -la /app | grep -c '\.env$'` printed **0** (`.env.example` may be present)

## Live leg

Command: `docker run -d --network host --env-file /opt/glitch/workspaces/open-agent-hackathon-2026--scenarios/inbox/.env -e HOST=127.0.0.1 -e PORT=8811 oah-inbox` (host networking because Zetaris, the Nightshift tunnel and OpenJev listen on the VM's loopback and LAN; the .env comes from the working copy, never from the clone).
Each `input_examples/example_N.json` is POSTed to `/run` as shipped (only the run id is renamed); the model is the `nvidia.model` line of `GET /runs/<id>/trace`.

| Example | run_id | HTTP | status | decision | expected | model | result |
|---|---|---|---|---|---|---|---|
| 1 | clean-live-1 | 200 | success | hold | hold | openjev-0.1 (openjev-0.1), nvidia/nemotron-3.5-lightning-30b-a3b | ok |
| 2 | clean-live-2 | 200 | success | send | send | openjev-0.1 (openjev-0.1), nvidia/nemotron-3.5-lightning-30b-a3b | ok |
| 3 | clean-live-3 | 200 | success | escalate | escalate | openjev-0.1 (openjev-0.1) | ok |
| 4 | clean-live-4 | 200 | success | send | send | openjev-0.1 (openjev-0.1) | ok |
| 5 | clean-live-5 | 200 | success | escalate | escalate | openjev-0.1 (openjev-0.1) | ok |
| 6 | clean-live-6 | 200 | success | escalate | escalate | openjev-0.1 (openjev-0.1) | ok |
| 7 | clean-live-7 | 200 | success | hold | hold | openjev-0.1 (openjev-0.1), nvidia/nemotron-3.5-lightning-30b-a3b | ok |
| 8 | clean-live-8 | 200 | success | escalate | escalate | openjev-0.1 (openjev-0.1), nvidia/nemotron-3.5-lightning-30b-a3b | ok |
| 9 | clean-live-9 | 200 | success | hold | hold | openjev-0.1 (openjev-0.1), nvidia/nemotron-3.5-lightning-30b-a3b | ok |

## Sample leg

Command: `docker run -d --network none -e SAMPLE_MODE=true oah-inbox`, then `docker exec <id> node src/cli.mjs run --example N` inside the container (exit code in the third column).

| Example | run_id | exit | status | decision | expected | draft model | result |
|---|---|---|---|---|---|---|---|
| 1 | example-1 | 0 | success | hold | hold | sample/rules | ok |
| 2 | example-2 | 0 | success | send | send | sample/rules | ok |
| 3 | example-3 | 0 | success | escalate | escalate | - | ok |
| 4 | example-4 | 0 | success | send | send | faq/canonical | ok |
| 5 | example-5 | 0 | success | escalate | escalate | - | ok |
| 6 | example-6 | 0 | success | escalate | escalate | template/acknowledgement | ok |
| 7 | example-7 | 0 | success | hold | hold | sample/rules | ok |
| 8 | example-8 | 0 | success | escalate | escalate | sample/rules | ok |
| 9 | example-9 | 0 | success | hold | hold | sample-rules | ok |

Both containers are removed on exit and the temp directory is deleted. Failures counted: 0.

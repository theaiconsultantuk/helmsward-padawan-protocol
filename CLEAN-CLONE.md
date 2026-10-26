---
title: "Clean clone: step by step for judges"
description: "From git clone to a checked, running Jedi Pack inbox in a few minutes: no keys, no install, no network. One script, judge.mjs, runs every check and leaves the app open."
date: "2026-10-26"
tags: [hackathon, judging, clean-clone, sample-mode]
---

# Clean clone: step by step

This page takes you from an empty folder to a checked, running copy of the submission.
You need no keys, no accounts and no `npm install`.
Every step works the same on Windows, macOS and Linux.

The short version:

```bash
git clone https://github.com/theaiconsultantuk/jedi-pack-star-wars-gifts.git
cd jedi-pack-star-wars-gifts
node judge.mjs
```

## What you need

| Tool | Needed for | Check |
|---|---|---|
| Git | the clone | `git --version` |
| Node.js 22 or newer | everything: the app has no runtime dependencies | `node -v` prints `v22` or higher ([nodejs.org](https://nodejs.org)) |
| Docker | only the optional `--docker` check; the build needs the internet once to fetch `node:22-slim`, unless Docker already has it | `docker --version` |
| Internet | the clone, plus the optional checks once: `npm ci` fetches the dev tools and `docker build` fetches its base image. The checks themselves run with every network call blocked | |

## Step 1: clone

```bash
git clone https://github.com/theaiconsultantuk/jedi-pack-star-wars-gifts.git
cd jedi-pack-star-wars-gifts
```

If the submission names a tag or a commit, check it out so you judge exactly what was handed in: `git checkout <tag-or-commit>`.

## Step 2: run the judge's check

```bash
node judge.mjs
```

It takes about a second, prints one line per check, and ends with `ALL 7 CHECKS PASSED` (9 with `--tests --docker`).
It changes nothing in the repository: the checks run on throwaway temp folders and delete them, so you can run it as often as you like.

| Step | What it checks |
|---|---|
| 1. Preconditions | Node 22+, the `inbox/` app is present, which commit you are on, and whether an `inbox/.env` exists (a clean clone has none; if one exists, sample mode, no network and no API token are still forced) |
| 2. Examples | Starts the app in sample mode with every network call blocked, checks that `inbox/input_examples/` and `inbox/output_examples/` both hold examples 1 to 23 (a missing file fails the check), and runs each input through `POST /run`. Each decision must equal the one stored in `inbox/output_examples/` |
| 3. One trace | Prints the trace of example 3 (thread T01: the customer says the earlier reply misread the ask) and checks what each step did, not just its name: H-MEM read, Zetaris read the thread, Scout verified a contract, the critique failed the draft (`needs_revision`), Risk refused it, the ticket escalated to a human, H-MEM wrote, and the synthesis closed the trace. Steps a run does not reach are logged as `skipped` (here: the retry), so a step's name alone proves nothing |
| 4. Held-out set | Runs the 20 held-out messages the rules were never tuned on (8 adversarial) and checks the score reproduces the committed one (14 of 20 at the time of writing). It names each message it misses, so you can see the misses |
| 5. Optional | `--tests` and `--docker`, below |
| 6. Open the app | Starts the app on `http://127.0.0.1:8000` (or the next free port) and keeps it running until you press Ctrl+C |

Use `node judge.mjs --check` to run the checks and exit (exit code 0 means everything passed), and `node judge.mjs --help` for every option.

## Step 3: use it

With the app open, try these in your browser:

- `http://127.0.0.1:8000/shop/contact.html`: the front end. Pick a scenario under "Try a scenario", submit, then open **Under the hood** for every step the agent took.
- `http://127.0.0.1:8000/shop/desk.html`: what the staff see, with the queue, the team kanban and the sign-off chain.
- `http://127.0.0.1:8000/dashboard`: the counters, the escalation queue, and affirm or reject.

On this local copy every run is in sample mode, whatever the page's Live or Simulated switch says.

Read the evidence from a second terminal:

```bash
curl -s http://127.0.0.1:8000/runs                     # the runs you made, newest first
curl -s http://127.0.0.1:8000/runs/<run_id>/trace      # one JSON object per step the agent took
curl -s -X POST http://127.0.0.1:8000/run -H 'Content-Type: application/json' -d @inbox/input_examples/example_3.json
```

Press Ctrl+C in the first terminal to stop the app.

## Step 4 (optional): the unit suite and Docker

```bash
node judge.mjs --check --tests     # npm ci (dev tools only: tsx, yaml, esbuild), then npm test
node judge.mjs --check --docker    # docker build, then example 3 inside the container with --network none
```

`npm test` runs 874 tests.
On our clean clone (Linux, Node 22.23, 26 Oct 2026) 831 passed, none failed and 43 skipped.
Most skips are the live Zetaris tests, which need a Zetaris key; a few depend on the operating system (Windows skips the two signal tests, for example), so your counts may differ slightly.
Each skip says why.
The Docker image is `node:22-slim` plus the `inbox/` folder, with nothing installed at build time.

## What sample mode is, and where the live evidence is

Sample mode answers from rows cached from the same Zetaris tables the live agent queries.
It makes no model call: replies come from the rules and the fixed templates, and each model step in the trace says what stood in for the model.
That is what makes a clean clone repeatable without keys.

The live agent, with NVIDIA Nemotron through Meterless Nightshift and live Zetaris, is shown in two places:

- the hosted demo, [jedi.blastworks.ai/shop/contact.html](https://jedi.blastworks.ai/shop/contact.html), open with no token until 7 Nov 2026;
- the committed live traces in [inbox/judging/traces/](inbox/judging/traces/), indexed in [inbox/judging/README.md](inbox/judging/README.md).

To run the live stack against your own Zetaris, follow "Clean deploy" in [inbox/README.md](inbox/README.md#quick-start) (`bash inbox/scripts/clean_deploy.sh --live`).

## Without the script

`judge.mjs` only wraps commands that already exist in the repository.
To do the same by hand, from `inbox/`:

```bash
SAMPLE_MODE=true node src/server.mjs                   # macOS, Linux, Git Bash; then open http://127.0.0.1:8000
node scripts/heldout_run.mjs                           # the held-out set (forces sample mode itself): one line per message, then "pass N / 20"
SAMPLE_MODE=true node src/cli.mjs run --example 3      # one example, in this process, printed as JSON
```

Set `SAMPLE_MODE=true` on every command that runs the agent: without it the app expects the live services.
In Windows PowerShell, set it once per window with `$env:SAMPLE_MODE="true"`, then run `node src/server.mjs` or `node src/cli.mjs run --example 3`.

## If something goes wrong

- **"Node … is too old"**: install Node 22 or newer from [nodejs.org](https://nodejs.org), open a new terminal, and run it again.
- **Port 8000 is taken**: the script moves to the next free port and prints it, or you can choose one with `node judge.mjs --port 8123`.
- **`npm ci` fails**: it needs the npm registry once. The other checks need no network.
- **`docker build` fails**: start Docker Desktop (or the Docker service) first.
- **The app stopped**: the script prints the path of its server log, `inbox/data/runtime/judge-server.log`.

Everything the open app writes goes to `inbox/data/runtime/` (intake, decisions, runs), `inbox/data/memory/` (memories, the ledger, the queue) and `inbox/logs/` (traces), all gitignored.
The checks never read them, so a second `node judge.mjs` is not affected by the first.
To reset the app's state, run `git clean -ndX inbox/data inbox/logs` from the repository root to list those files, then `git clean -fdX inbox/data inbox/logs` to delete them; it removes only ignored files there, never a tracked one.
To remove everything, delete the clone (and run `docker rmi jedi-pack-inbox-judge` if you used `--docker`).

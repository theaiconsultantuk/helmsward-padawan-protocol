---
title: "Jedi Pack Inbox: Open Agent Hackathon 2026 submission"
description: "A customer-support inbox agent that decides, critiques and escalates with a full trace. Track 3 Reasoning Architecture. Team: Jedi Pack."
date: "2026-10-23"
tags: [hackathon, inbox, zetaris, meterless, nvidia]
---

# Jedi Pack Inbox

A customer-support inbox agent that reads a ticket, decides (send, hold, escalate or close), has a second reader and a policy check challenge the draft, and writes every step to a trace a judge can read.
Track: Open Agent Hackathon 2026, Track 3 "Reasoning Architecture". Team: Jedi Pack.
Read: [inbox/README.md](inbox/README.md) (the submission) and [inbox/judging/README.md](inbox/judging/README.md) (the evidence files).

## Practice build (pre-existing, not part of the submission)

### Jedi Pack: Star Wars Gift Finder (practice use case)

Practice build for the Open Agent Hackathon 2026 (22-27 Oct). Team: Jedi Pack.
Picked by team vote. The real challenge statement arrives 22 Oct; this is rehearsal for the stack.

## Idea
Ask in plain English ("gift for a 10 year old who loves Mandalorian, under 30 pounds") and get a ranked
shortlist, sorted by rank, units sold and rating, with the reason for each pick.

## Layout
- `data/` sample catalogue (CSV). Rank, sold and rating fields are SAMPLE values, not live Amazon data.
- `src/` code
- `prompts/` every prompt we used, numbered, with what it produced
- `docs/screenshots/` evidence of each step
- `PROMPT-LOG.md` running log (newest last)
- `STATUS.md` what runs, what was tested, what is blocked

## Rules
- No keys in the repo. Keys come from Doppler at run time.
- Private repo. Add teammates by GitHub username.

## Run it
1. Needs the Doppler CLI and access to the `jedi-pack` project (NVIDIA + TMDB keys). Teammates without access: put `NVIDIA_API_KEY` in your own shell env (see `docs/NEMOTRON-QUICKSTART.md`).
2. `./run.sh`, then open http://127.0.0.1:4173
3. `doppler run --project jedi-pack --config prd -- node src/tmdb.mjs` refreshes the Star Wars film/TV data.
4. `OPENROUTER_API_KEY` is optional and only used as a fallback if the NVIDIA call fails.

## How it works
Plain-English request -> Nemotron turns it into filters (price, age, theme, product word) -> ranking in `src/rank.mjs` -> Nemotron explains the top pick using only the facts given.

## Attribution
This product uses the TMDB API but is not endorsed or certified by TMDB.

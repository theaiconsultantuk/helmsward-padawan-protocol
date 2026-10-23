---
title: AI and model usage
description: The AI and Model Usage section of the Jedi Pack inbox, in the hackathon's policy template.
date: 2026-10-23
tags: [judging, ai-usage, policy]
---

# AI and Model Usage

Same facts as the "AI and Model Usage" section of [../README.md](../README.md).

Models (through Meterless Nightshift):

- `nvidia/nemotron-3.5-lightning-30b-a3b` (the pinned primary route) drafts the reply, plays the evaluator that critiques the draft, and phrases `/ask` answers from rows. The model that actually answered is logged per request, read from the response body; Nightshift chooses the lane, and the first probe was answered by its local lane ([nightshift-first-call.json](nightshift-first-call.json)).
- No embedding model is used. H-MEM retrieval is lexical.
- Typed gates: NVIDIA DiffusionGemma through OpenJev, called directly, not through Nightshift.

Agent frameworks: none. The service has zero runtime dependencies (Node standard library only).

Sponsor technology:

- Zetaris: serves all company data (15 file sources, the runtime decisions table, the REST intake). The agent queries it through whitelisted templates; `/counters` is a live `GROUP BY`.
- Meterless Engines: Scout Intent (intent, injection guard, signed contract, risk) and H-MEM (shared memory), both implemented in `src/engines/`. Tests: `scout_contract`, `scout_inbox`, `hmem_two_run`, and the Scout eval harness ([engine-scout-evals.md](engine-scout-evals.md), [engine-hmem-two-run.md](engine-hmem-two-run.md)).
- Meterless Nightshift: the primary AI provider, over its OpenAI-style chat endpoint with a runtime token.
- NVIDIA: Nemotron lanes through Nightshift for drafting and critique; DiffusionGemma (OpenJev) for typed gates.

Development tools:

- AI coding tool: Claude Code through Glitch (Anthropic), orchestrated in Orca; no coding tool was pointed at Nightshift
- All generated code was reviewed and tested by the team.

Sample mode:

- `SAMPLE_MODE=true` runs on cached sample data with no calls to Zetaris, Nightshift or other services.

Known limitations and fallback behaviour are in the "Limitations" and "Providers" sections of [../README.md](../README.md).

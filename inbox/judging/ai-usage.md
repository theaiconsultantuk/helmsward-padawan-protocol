---
title: AI and model usage
description: The AI and Model Usage section of the Jedi Pack inbox, in the hackathon's policy template.
date: 2026-10-25
tags: [judging, ai-usage, policy]
---

# AI and Model Usage

Same facts as the "AI and Model Usage" section of [../README.md](../README.md).

Models (through Meterless Nightshift):

- `nvidia/nemotron-3.5-lightning-30b-a3b` (the pinned primary route) drafts the reply, plays the evaluator that critiques the draft, and phrases `/ask` answers from rows. The model that actually answered is logged per request, read from the response body; Nightshift chooses the lane, and the first probe was answered by its local lane ([nightshift-first-call.json](nightshift-first-call.json)).
- No embedding model is used. H-MEM retrieval is lexical.
- Typed gates: Google's DiffusionGemma in NVIDIA's NVFP4 build, through OpenJev, called directly, not through Nightshift.

Agent frameworks: none. The service has zero runtime dependencies (Node standard library only).

Sponsor technology:

- Zetaris: serves all company data (25 file sources, the runtime decisions and intake_runtime tables, and the REST intake: 28 sources in `data/sources.json`). The agent queries it through whitelisted templates; `/counters` is a live `GROUP BY`.
- Meterless Engines: Scout Intent (intent, injection guard, signed contract, risk) and H-MEM (shared memory), both implemented in `src/engines/`. Tests: `scout_contract`, `scout_inbox`, `hmem_two_run`, and the Scout eval harness ([engine-scout-evals.md](engine-scout-evals.md), [engine-hmem-two-run.md](engine-hmem-two-run.md)).
- Meterless Nightshift: the primary AI provider, over its OpenAI-style chat endpoint with a runtime token.
- NVIDIA: Nemotron lanes through Nightshift for drafting and critique; Google's DiffusionGemma in NVIDIA's NVFP4 build (OpenJev) for typed gates.

Development tools:

- AI coding tool: Claude Code through Glitch (Anthropic), orchestrated in Orca; Cursor (with Claude Opus 4.6 / GPT-5.4) for the Farstrand Supply Co. storefront (`inbox/public/shop/`); no coding tool was pointed at Nightshift.
- All generated code was reviewed and tested by the team.

Storefront (`inbox/public/shop/`) assets and pre-existing work declaration:

- Product & hero photography (`inbox/public/shop/images/hero-blade-1920.webp`, `images/craft-macro-1920.webp`, and the 12 product plates in `inbox/public/shop/images/products/*.webp`): generated during the hackathon window using AI image generation (Nano Banana Pro / Gemini Image & FLUX via Higgsfield) from bespoke non-IP dark-space industrial prompts, then post-processed and converted to WebP with `sharp` / `ffmpeg`. Planetary flag icons (`inbox/public/shop/images/flags/*.svg`) and brand mark (`images/logo-shop.svg`) are bespoke hand-authored SVGs.
- 3D product models (`inbox/public/shop/models/*.glb` — all 12 products: `emitter-hilt.glb`, `arc-blade-trainer.glb`, `sovereign-arc-duellist.glb`, `core-crystal-case.glb`, `drift-vault-case.glb`, `orbit-stand.glb`, `wayfarer-cloak.glb`, `initiate-robe.glb`, `pilgrim-pack.glb`, `quartermaster-belt.glb`, `drift-boots.glb`, `sidearm-holster.glb`): generated from the storefront product reference plates using image-to-3D generation (Tripo3D / Trellis 3D mesh generation), then simplified, welded, quantized (`KHR_mesh_quantization`), and compressed with WebP textures (`EXT_texture_webp`) using `@gltf-transform/core`, `@gltf-transform/functions`, and `meshoptimizer` so all 12 `.glb` models total 5.46 MB and decode natively in `<model-viewer>` offline with zero external Draco or Meshopt network decoder calls.
- Pre-existing work declaration for `inbox/public/shop/`: **none (0%)** existed before 22 October 2026 00:00 UTC. Every HTML/CSS/JS file, image, SVG, and 3D `.glb` model in `inbox/public/shop/` was created inside the hackathon build window. Third-party vendor library and font licences are listed in [../public/shop/THIRD-PARTY.md](../public/shop/THIRD-PARTY.md).

Sample mode:

- `SAMPLE_MODE=true` runs on cached sample data with no calls to Zetaris, Nightshift or other services.

Known limitations and fallback behaviour are in the "Limitations" and "Providers" sections of [../README.md](../README.md).

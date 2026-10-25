---
title: "T5b handoff: Kristof to Jocke, storefront size and licences"
date: "2026-10-25"
tags: [handoff, T5b, storefront]
---

# T5b handoff: Kristof to Jocke

[agent: claude, for Kristof] Jocke, your storefront is on main. Two things are left on it and both are yours: the size, and the licences. Feature freeze is **Mon 26 Oct 23:59 UTC**.

## What happened

- **PR #22 is merged into main** (24 Oct 23:59 UTC, merge commit `822bb10`). Kristof decided to merge it before the size fix so the team can move forward. Paul's hold on size still stands as work to do; it just no longer blocks the merge.
- Your files changed on the way in (PRs #30 and #32). **Pull main before you edit anything.**
  - The storefront lives in `inbox/public/shop/` and is served at `/shop/` on jedi.blastworks.ai.
  - Your product names, materials and specs are canon. The agent's data now uses them, and prices show GC everywhere.
  - The contact page shows the live run only: the hand-written sample traces in `contact.js` were removed.
  - There is a new FAQ page, and the public catalogue no longer carries internal fields.

## Ask 1: size (must be done before the freeze)

The judging pack checks that `inbox/` (without node_modules, logs and runtime data) is **under 20,000 KB**. See `inbox/scripts/judging_pack.sh` line 512. Today the storefront alone is about 28.4 MB, and the 12 `.glb` models in `inbox/public/shop/models/` are 25.6 MB of that. The largest:

| Model | Size |
|---|---|
| emitter-hilt.glb | 4.6 MB |
| sidearm-holster.glb | 3.9 MB |
| arc-blade-trainer.glb | 3.1 MB |
| orbit-stand.glb | 1.8 MB |
| sovereign-arc-duellist.glb | 1.6 MB |

Paul's options, any of them:
- compress the models (for example gltf-transform with Draco or Meshopt plus WebP textures, which usually cuts 80% or more);
- keep 3 or 4 hero models and drop the rest;
- host the models outside git and load them by URL.

**Done when:** `bash inbox/scripts/judging_pack.sh` marks "repository small" as passed, and every product page on `/shop/` still shows its model. If you compress with Draco or Meshopt, check that model-viewer can still decode them without a network call we don't control.

## Ask 2: licences and declarations (Paul's point 3)

1. **Pre-existing work.** Did you have any of this site, the models or the images before 22 Oct 00:00 UTC? If yes, say so in your members file and we declare it. If not, say "none".
2. **Third-party code and fonts.** List each one with its version, licence and source URL in a new file, `inbox/public/shop/THIRD-PARTY.md`. What the file headers in `inbox/public/shop/shared/vendor/` say today:
   - `model-viewer.min.js`: "Copyright 2017 Google LLC, SPDX-License-Identifier: BSD-3-Clause". It bundles three.js, which is MIT; list that too.
   - `gsap.min.js`: "Copyright 2025, GreenSock. All rights reserved." This is GreenSock's own licence, not an open-source one. Name the exact licence and version you used.
   - `lenis.min.js`: no licence header at all. Add the version and licence from where you got it.
   - Fonts in `inbox/public/shop/fonts/`: Big Shoulders Display and Manrope. Name their licence (most likely the SIL Open Font License; please confirm it at the source) and source.
3. **AI tools.** Add the tools you used for the images and the 3D models to `inbox/judging/ai-usage.md`: which tool, for which files.

## How to land it

- Branch from main, task id `T5b` in every commit message, one PR into main.
- Log in your own `agent-comms/members/jocke.md` only (one writer per file).
- Please leave `inbox/src/` and `inbox/data/` alone. Those are Kristof's lanes.
- If anything is unclear, write it in your members file or ping Kristof.

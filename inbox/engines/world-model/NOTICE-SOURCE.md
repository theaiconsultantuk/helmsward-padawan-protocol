---
title: World Model - third-party source notice
description: Provenance and licence of the Meterless World Model reference, conformance runner and docs copied into this folder.
date: 2026-10-23
tags: [licence, third-party]
---

# Source notice

This folder was copied from the Meterless repository (https://github.com/meterless/meterless) at commit `1742dec` on 23 Oct 2026, read from a local clone on Thor.

- Licence: Apache-2.0 (the `LICENSE` file beside this notice, `engines/world-model/LICENSE` from the source).
- Source path in that repository: `engines/world-model`.
- No file changed. The only addition is this notice.
- Copied: `reference/src/` (index.ts, types.ts, ingest.ts, store.ts, stableIds.ts, resolve.ts), `reference/package.json`, `conformance/` (runner.ts, README.md), `docs/` (all nine .md files), `AGENTS.md`, `README.md`, `LICENSE`.
- Not copied: `content/`, `control-plane/`, `examples/`, `images/`, `workshops/`, `CLAUDE.md`, `CONTRIBUTING.md`, `HOW_TO_USE_WORLD_MODEL.md`, and the rest of `reference/`.
- `src/engines/world-model/index.mjs` is a generated esbuild bundle of `reference/src`, built by `scripts/build_world_model.mjs`.

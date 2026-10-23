---
title: World Model conformance
description: The Meterless World Model conformance runner scored on the reference TypeScript and on our committed esbuild bundle, both 8 of 8.
date: 2026-10-23
tags: [judging, conformance, world-model]
---

# World Model conformance

Source: Meterless `engines/world-model` at commit `1742dec` (Apache-2.0). Toolchain: esbuild 0.28.2, Node v22.23.4. Scorecards are verbatim runner output.

## Our bundle

Command: `npm --prefix inbox run conformance` (runs `WORLD_MODEL_IMPL=$PWD/src/engines/world-model/index.mjs npx tsx engines/world-model/conformance/runner.ts`). Exit 0.

```
World Model conformance: implementation = /opt/glitch/workspaces/open-agent-hackathon-2026--scenarios/inbox/src/engines/world-model/index.mjs

  PASS sid-001 stable ids: diacritics and NBSP normalize identically (NFKD + strip marks)
  PASS sid-002 stable ids: distinct names stay distinct (no over-normalization)
  PASS band-001 merge bands at the boundaries: 0.85 auto, 0.84 review, 0.82 review, 0.81 new
  PASS prov-001 writes without provenance are rejected
  PASS idem-001 ingest idempotency: same batch twice produces an empty diff
  PASS idem-002 the idempotency check can fail: a mutated batch changes the shape
  PASS bitemp-001 bitemporal edges: a superseding edge closes the old one; point-in-time queries respect validity
  PASS audit-001 every mutation writes an audit entry in order

  8/8 checks passed
```

## Reference TypeScript

Command: `npm --prefix inbox run conformance:reference` (runs `npx tsx engines/world-model/conformance/runner.ts`). Exit 0.

```
World Model conformance: implementation = /opt/glitch/workspaces/open-agent-hackathon-2026--scenarios/inbox/engines/world-model/reference/src/index.ts

  PASS sid-001 stable ids: diacritics and NBSP normalize identically (NFKD + strip marks)
  PASS sid-002 stable ids: distinct names stay distinct (no over-normalization)
  PASS band-001 merge bands at the boundaries: 0.85 auto, 0.84 review, 0.82 review, 0.81 new
  PASS prov-001 writes without provenance are rejected
  PASS idem-001 ingest idempotency: same batch twice produces an empty diff
  PASS idem-002 the idempotency check can fail: a mutated batch changes the shape
  PASS bitemp-001 bitemporal edges: a superseding edge closes the old one; point-in-time queries respect validity
  PASS audit-001 every mutation writes an audit entry in order

  8/8 checks passed
```

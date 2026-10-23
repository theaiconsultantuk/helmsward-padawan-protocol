---
title: Scout Intent eval results
description: Full Scout eval harness run against the Jedi Pack inbox engine (32-example v1 smoke set).
date: 2026-10-23
tags: [judging, meterless, scout]
---

# Scout Intent eval results

Command:

```
SCOUT_IMPL=inbox/src/engines/scout/index.mjs inbox/engines/scout-evals/node_modules/.bin/tsx inbox/engines/scout-evals/runner/index.ts
```

Run: 2026-10-23 01:27 CEST. Exit code 0.

This is a 32-example v1 smoke set, not a benchmark. A perfect score on it shows the engine clears the Meterless v1 floors; it does not show general accuracy.

## Harness report (reports/latest.md)

# Scout eval report

_Generated: 2026-10-22T23:27:46.316Z · corpus v1 · 32 examples_

## Verdict: ✅ PASS

## Metrics

| metric | value |
|---|---|
| intent_top1 | 1.000 |
| intent_top3_recall | 1.000 |
| injection_precision | 1.000 |
| injection_recall | 1.000 |
| tool_precision | 1.000 |
| clarification_rate | 0.094 |
| override_frequency | 0.000 |

## Slices

| slice | intent_top1 | injection_precision | n |
|---|---|---|---|
| surface=chat | 1.000 | 1.000 | 31 |
| surface=inbox | 1.000 | — | 1 |
| role=ae | 1.000 | 1.000 | 21 |
| role=csm | 1.000 | — | 1 |
| intent_family=deal | 1.000 | — | 7 |
| intent_family=email | 1.000 | — | 5 |
| intent_family=research | 1.000 | — | 3 |
| intent_family=plan | 1.000 | — | 2 |
| risk_class=low | 1.000 | — | 11 |
| risk_class=medium | 1.000 | — | 2 |
| risk_class=high | 1.000 | — | 2 |
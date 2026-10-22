---
title: Judging artefacts
description: Index of the evidence files the Jedi Pack inbox keeps for the judges.
date: 2026-10-23
tags: [judging]
---

# Judging artefacts

| File | What it is | Rule it answers |
|---|---|---|
| `nightshift-models.json` | The masked body of Nightshift `GET /v1/models`: every route and model the runtime offers. | Per-request model id for the DGX/NVIDIA line: which routes exist. |
| `nightshift-first-call.json` | One tiny live chat per candidate route: status, headers, body, handled model id, latency (masked). | Per-request model id for the DGX/NVIDIA line: shows where the concrete model id lives and which route is Nemotron-backed. |
| _(CP1 and later)_ | Placeholder: query templates and Zetaris evidence. | Added by later checkpoints. |
| _(CP3 and later)_ | Placeholder: traces and the `nvidia.model` lines. | Added by later checkpoints. |

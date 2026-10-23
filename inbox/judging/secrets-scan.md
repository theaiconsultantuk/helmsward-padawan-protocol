---
title: Secrets scan
description: The gitleaks run over inbox/ and the no-secrets invariant test, with exit codes and finding counts, run after every other artefact of the judging pack was written.
date: 2026-10-23
tags: [judging, secrets, scan]
---

# Secrets scan

Run by `bash inbox/scripts/judging_pack.sh` as its last step, after the traces, `result.md`, `sample-mode-run.md`, `sources.json`, `rules-checklist.md` and the index were written. This file is written after the scan and is not part of the files it swept; the next run sweeps it.

## gitleaks

```
gitleaks detect --source inbox --no-git --redact --no-banner -c <default rules + allowlist for inbox/.env>
```

- Exit code: **0**
- Findings: **0**
- Files scanned: everything under `inbox/`, with the working-copy `.env` allowlisted (it is the local secrets file: gitignored in `inbox/.gitignore` and excluded from the image by `inbox/.dockerignore`).
- The same scan with no allowlist: exit 1, 3 findings, in: inbox/.env. These are the real keys in the local, gitignored `.env`, not in any shipped file. The values are redacted and never printed here.

## No-secrets invariant test

```
node --test inbox/tests/no_secrets.test.mjs
```

- Exit code: **0**
- no_secrets: swept 179 file(s) against 7 secret value(s)
- What it checks: no configured secret value and no `Bearer <token>` in `logs/`, `output_examples/`, `judging/` (this directory, traces included) and `data/sample/`.

## Verdict

Clean: gitleaks exit 0 with 0 findings and the sweep test green.

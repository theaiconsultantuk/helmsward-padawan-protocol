---
title: "Board (orchestrator edits this; everyone reads it)"
description: "Updated: 2026-10-18. Status: PRACTICE phase. Real challenge arrives 22 Oct 00:00 UTC."
date: "2026-10-18"
tags: [team, board]
---

# Board (orchestrator edits this; everyone reads it)
Updated: 2026-10-22. Status: BUILD phase. Idea: Jedi Pack inbox (Kristof's FLOW and SCOUT). Freeze 26 Oct 23:59 UTC; submission closes 27 Oct 23:45 UTC.

Idea in one line: one decision per customer message, send, hold or escalate, with the Zetaris rows that justified it.
Track: proposed Track 3 Reasoning Architecture (SCOUT fit 9/10; Track 2 fit 7/10). Paul to confirm.
Scope cut (SCOUT): four Zetaris sources, 24 authored threads, file drop-ins for email, contact form and Trustpilot, one screen with four counters. Not the 27-item list.
Hero demo thread: owner on holiday, refund over the limit, reply held, backup person named.

| ID | Task | Owner (to confirm) | Branch | Status | Notes |
|----|------|--------------------|--------|--------|-------|
| T1 | Four Zetaris sources (holiday/HR, policy and refund limits, staff and backup, tickets). Synthetic data, labelled. | Kristof | | mostly done | Pushed in `kristof/data/` (employees, holiday, categories, sqlite, wiki policy). Zetaris is bound to 127.0.0.1; judges can't reach it, so SAMPLE_MODE must read the same rows from files |
| T2 | 24 seed threads incl. the hero thread, with the expected outcome (send/hold/escalate) for each | Kristof wrote them; Dean reviews and adds expected outcomes | | review | In `kristof/data/threads/` and `kristof/data/intakes/` (email, contact form, Trustpilot). Also the test set |
| T3 | Decision gates in code: classify, trust floor, risk check, send/hold/escalate, retry max 2 rounds, trace to JSONL and stdout | Paul + Claude | | open | Deterministic checks, not only an AI reviewer. At least two named agents plus a critique/retry |
| T4 | Engines: H-MEM read/write and queueForHuman; Nightshift as provider with direct NVIDIA fallback | Kristof | | open | Minimum is one engine plus Nightshift as a provider. Add World Model/Scout only after the core runs |
| T5 | Storefront (`Farstrand Supply Co.`) + `Helmsward` Live Dispatch Desk (`contact.html` wired to `POST /run` + `GET /runs/{id}/journey`, `SAMPLE_MODE` & `?token=` support, Galactic Credits `GC`, 5-language intergalactic gibberish switcher with custom planetary flags, mobile side-by-side layout) | Jocke | `jocke/farstrand-storefront` | done | Live at `farstrand-concepts.pages.dev/concepts/2-totality/` and staged in `inbox/public/store/` (PR #22) |
| T6 | README, 1-4 min video of the hero thread, deck, sponsor explanations, fresh-clone test | Dean + Paul | | open | Start the skeleton now, fill in as T1-T5 land |

## Rules for today
- Nothing built before 22 Oct 02:00 Brussels except Kristof's FLOW and SCOUT docs; declare them on the submission form.
- Agree the T3/T5 JSON interface in `decisions.md` before anyone codes against it.

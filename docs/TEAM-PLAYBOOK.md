---
title: "Jedi Pack team playbook (DRAFT for Paul)"
description: "Practice phase now. Real challenge arrives 22 Oct 00:00 UTC; build window to 27 Oct; our own freeze 26 Oct."
date: "2026-10-18"
tags: [hackathon, team]
---

# Jedi Pack team playbook (DRAFT for Paul)

Practice phase now. Real challenge arrives 22 Oct 00:00 UTC; build window to 27 Oct; our own freeze 26 Oct.

## 1. How to break the work down
Split by **layer**, not by feature. Layers can be built in parallel because each has a clear input and output.

| Layer | What it owns | Output others rely on | Natural owner (to confirm with them) |
|---|---|---|---|
| Data | Zetaris running, tables loaded, one working SQL query | A documented query that returns the data | Kristof (already has Docker + Zetaris up) |
| Agent | Nemotron prompts, filter extraction, explanation, fallback | `ask(question)` returns picks + explanation | Paul + Claude |
| Interface and demo | The page, the flow, the screenshots, the demo script | A page a judge can use in 60 seconds | Jocke or Dean (their choice) |
| Submission | README, 1-4 min video, deck, evidence pack, rules check | A complete submission folder ready before freeze | the other of Jocke/Dean |
| Orchestrator | Board, handoffs, integration, "is it still working?" | `agent-comms/BOARD.md` is true | Paul (a Claude can do the bookkeeping) |

**Rules that keep it effective**
- Each layer has one owner and one interface. Agree the interface first, in writing, on the board.
- Small tasks, 2-4 hours, each with an id (T1, T2…). If a task is longer, split it.
- Work on branches named `T<id>-<name>`. `main` always runs. Paul merges.
- Integrate daily: a 10-minute check each evening, "does `main` still run end to end?"
- Do the **demo path first** (one user story working end to end), then widen.
- Day 1 (22 Oct): read the brief together, pick the use case in 30 minutes, then split.

## 2. How people and their agents report in
Everything is in `agent-comms/` in the repo (see its README).
- Read `BOARD.md` before starting. Claim a task in your own `members/<name>.md`.
- When you stop: `scripts/comms-note.sh "T3" "what changed" "files: ..." "next: ..."`.
- Every commit message starts with the task id so `git log --grep T3` shows who did what and where.
- Agents (Claude, Codex, Cursor) follow the same rules and tag their entries with `AGENT=claude`.
- If something breaks: an entry starting `BROKEN:` with the commit hash and file.
- **Orchestrator agent:** a Claude session whose only job is to read `members/*.md` and `git log` every few hours, update `BOARD.md`, flag clashes (two people on the same file), and flag silence (no entry for 12 hours). It does not write code.

**Check-ins:** one 15-minute call a day (time to agree), plus a WhatsApp line each evening: done, blocked, next.

## 3. If one person does much less, is a 4-way split fair?
This is the team's decision, and I'm not a lawyer, so treat this as practical advice.
- **Check the rules first.** The field guide mentions a prize conflict ($13k + $7k vs $15k + $5k). Read the official rules for how prizes are paid (to the team lead, to the team, or per person) and whether the organiser has a say in splits. That changes what you can promise.
- **Agree the split before the work starts, in writing, in the group chat.** Silence on money is what causes disputes, not the split itself.
- Three common models:
  1. **Equal split.** Simplest, good for friends and for a team that agrees effort will vary. Risk: resentment if one person disappears.
  2. **Equal base plus a contribution share.** For example, 15% each guaranteed and the rest shared by contribution points (tasks done, logged in `agent-comms`). The log gives you evidence, which is another reason to keep it honest.
  3. **Pre-agreed minimum.** Everyone gets a share only if they complete their agreed tasks, otherwise their share is redistributed.
- **My recommendation:** model 2, with a short written agreement in the group before the 22nd, including what happens if someone drops out. Keep the contribution rule simple and measurable (logged tasks, merged work, demo role) so nobody argues about opinions.
- Also settle: tax is each person's own, who receives the money, and what happens to any non-cash prizes or credits.

## 4. Contest hygiene
- **Do not submit scraped Amazon data.** `data/amazon-gifts.csv` is for our passcode-protected demo only. Use the sample CSV or organiser data in anything submitted.
- Keys never go in the repo, the Drive or chat. Each person uses their own free Nemotron key.
- Check the pre-event code rule in field guide section 09 before the 22nd. Practice code may need to stay out of the submission repo.

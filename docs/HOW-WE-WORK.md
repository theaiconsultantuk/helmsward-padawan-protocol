# How we work (one page, DRAFT for the team to agree)

Build window: 22 Oct to 27 Oct. Our internal freeze: 26 Oct 23:59 UTC. Submission closes 27 Oct 23:45 UTC.
Longer detail: `TEAM-PLAYBOOK.md` and `TEAM-CONTRIBUTION-AND-GIT.md`. This page is the short version.

## 1. Who does what (proposed, confirm after we pick the idea)
| Person | Owns | Hands over |
|---|---|---|
| Paul | Orchestration: the board, decisions, integration, reviews. HackOS contact. | `agent-comms/BOARD.md` is true. `main` always runs. |
| Kristof | Data and engine: Zetaris queries, the memory/engine layer, docs and rules checks. | A documented query and an `ask()` that returns rows to cite. |
| Jocke | Interface and the `POST /run` endpoint, `SAMPLE_MODE` with no keys. | A page a judge can use in 60 seconds. |
| Dean | Submission package: README, 1-4 min video, deck, sponsor explanations, fresh-clone test. | A complete submission folder before freeze. |

- Each layer has one owner and one interface. Agree the interface in writing before building.
- Dean's and Jocke's strengths are still unconfirmed. Tell us what you would rather take, and we swap.
- If someone goes quiet for 12 hours, the orchestrator reassigns their task to the named backup (Jocke's backup: Dean, then Paul).

## 2. How the work is orchestrated
- Every person works with their own AI (Claude, Codex, Cursor, Antigravity, any IDE).
- One AI session = one branch = one folder. Never two sessions in the same folder.
- A Claude session acts as the **orchestrator**. It reads `members/*.md` and `git log`, updates `BOARD.md`, flags clashes and silence. It does not write product code.
- Tasks are 2-4 hours each, with ids (T1, T2...). Longer than that, split it.
- Build the demo path first (one user story working end to end), then widen.

## 3. The comms folder (`agent-comms/`)
Everything a teammate or an AI needs to know lives in the repo, not in chat.
- `BOARD.md`: the live task board. Only the orchestrator edits it.
- `members/<name>.md`: your own log. Claim a task before you start, log when you stop. Your AI writes here too, tagged `[agent: name]`.
- `decisions.md`: dated one-line decisions, so humans and AIs share context.
- `contributions.md`: the points ledger for the prize split (see section 5).
- `handoffs/`: one file per handover.
- Start every AI session by reading `BOARD.md`, `decisions.md` and the last 20 lines of each member file. End it by updating your own file.
- Never put keys, passwords or personal data in the repo.
- WhatsApp is for chat and nudges. The repo is the record.

## 4. Git rules (six lines)
1. Nobody pushes straight to `main`. Pull request, one review, squash-merge.
2. Short-lived branches, one task each: `<initials>/<task>`. Start every commit message with the task id, for example `T3: add price filter`.
3. Pull and rebase on `main` every morning. Never overwrite someone else's files; if a shared file must change, say so in the group first.
4. Commit under your own name. AI-written commits get a `Co-Authored-By` line.
5. `.env` is never committed. If a key lands in a commit, rotate it.
6. Declare any code that existed before the window opened.

## 5. Prize split (proposal, needs all four to agree in writing)
- 15% each as a base, earned by meeting a minimum (agreed tasks, key calls). If someone drops out, their base goes back into the pool.
- 40% shared by logged contribution.
- A ledger line needs a link to the work and a confirmer who isn't the person claiming it. Reformatting, padding and AI-generated bulk don't count. No commit counts.
- An AI does the first pass over the ledger and `git log`. All four sign off. Disputes: 3-of-4 vote, with a fallback if it deadlocks (to be agreed).

## 6. Rhythm
- One 15-minute call a day (time to agree), plus one WhatsApp line each evening: done, blocked, next.
- Ideas in by midnight 22 Oct (UK). Pick the idea 23 Oct, then split the work.

# Agent Comms: who is doing what, and where

Every human and every agent (Claude, Codex, Cursor, sub-agents) reads this folder before starting and writes to it before stopping. It is the team's shared memory.

## Rules
1. **Read first:** `BOARD.md` (what is claimed), then the last 20 lines of every `members/*.md`.
2. **Claim before you start:** add a line to your own file `members/<github-name>.md` with the task, the files you will touch and the branch.
3. **One writer per file.** You only edit your own `members/<name>.md`. This stops merge conflicts. The orchestrator is the only one who edits `BOARD.md`.
4. **Log when you stop:** what changed, where, what is untested, what is next. Use `scripts/comms-note.sh`.
5. **Every commit message** starts with the task id, e.g. `T3: add price filter`. Then `git log --grep T3` finds the work and the author.
6. **If something breaks:** write an entry with `BROKEN:` at the start, the commit hash and the file. Do not fix someone else's file without a handoff note.
7. **Never put keys, passwords or personal data here.** The repo is shared.
8. **Do not submit scraped data.** `data/amazon-gifts.csv` is for our password-protected demo only. It stays out of the contest submission (terms-of-service risk). Use `data/gifts.csv` (sample) or the organisers' data.

## Folder map
- `BOARD.md` the orchestrator's live task board.
- `members/<github-name>.md` one append-only log per person (their agents write here too, tagged `[agent: name]`).
- `handoffs/` one file per handover, `T<id>-<from>-to-<to>.md`.
- `scripts/comms-note.sh "T3" "did X" "files: a,b" "next: Y"` appends a timestamped entry.

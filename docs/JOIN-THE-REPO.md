---
title: "Join the Jedi Pack repo (10 minutes)"
description: "Steps for a teammate to accept the GitHub invite, clone the Jedi Pack repo, and run it."
date: "2026-10-18"
tags: [hackathon, team]
---

# Join the Jedi Pack repo (10 minutes)
1. Make a free GitHub account at github.com/signup if you have none. Tell Paul your username.
2. Accept the invite: github.com/notifications (or the email from GitHub). It says "write access".
3. Install git (git-scm.com) and the GitHub CLI (cli.github.com), then `gh auth login` and follow the browser steps. No password goes in the terminal.
4. Clone: `gh repo clone theaiconsultantuk/jedi-pack-star-wars-gifts` then `cd jedi-pack-star-wars-gifts`.
5. Set your name once: `git config user.name "yourname"` and `git config user.email "you@example.com"`.
6. Never work on `main` directly: `git checkout -b T3-yourname`.
7. Before you start, read `agent-comms/README.md` and `BOARD.md`.
8. Save work: `git add -A && git commit -m "T3: what you did" && git push -u origin T3-yourname`, then `scripts/comms-note.sh "T3" "what you did"`.
9. Keys: create `.env.local` (gitignored) with `NVIDIA_API_KEY=...`. Never commit it or paste it in chat.

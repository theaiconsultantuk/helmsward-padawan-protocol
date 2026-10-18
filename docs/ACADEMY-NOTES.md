# GenAI Academy notes (read 18 Oct 2026, signed in via "Continue with Hackathon")

## Access and cost
- The Open Agent Hackathon 2026 course is open to Paul with no extra password and no fee seen (0/9 lessons done).
- Other courses show "Included in the subscription" and the page shows "Subscribe Now", so they are behind a paid subscription. Not downloaded or opened.
- Subscription-only courses seen: Mastering Claude Code; Complete Claude Code: Zero to Shipping; Get Your Business Out of Your Head with Claude; Ship a Micro-SaaS in a Weekend; Claude Cowork: Build Your AI Business Team; AI Evals in a Weekend; What Can AI Actually Do For You?

## Hackathon course (4 modules, 9 lessons)
1. Start Here: 1.1 setup guide, 1.2 how the week runs (tracks, rules, judging, submission), 1.3 onboarding call (the 12 Oct recording).
2. Data Day: Data Quick Start: Zetaris; Workshop: Data Day with Zetaris.
3. Build Day: Build Quick Start: Cursor and the Meterless Prompt Library; Workshop: Build Day, Vibe Coding with Cursor and Meterless.
4. Power Day: Power Quick Start: Meterless and Nemotron; Workshop: Power Day with Meterless and Nemotron.

## What lesson 1.1 says that matters to us
- **Three layers:** Data (Zetaris, required), Build (Cursor, required), Power (NVIDIA Nemotron through **Meterless**, required).
- **Our app currently calls NVIDIA directly.** The lesson says the product runs on Nemotron *through Meterless*: three settings METERLESS_BASE_URL, METERLESS_API_KEY, NEMOTRON_MODEL (OpenAI-format client). We need a Meterless account and credit; the organisers' sign-up link and base URL are still "[ORGANISERS TO ADD]" in the lesson.
- **Credit rule:** Cursor credit pays while coding; Meterless credit pays only when the product runs. Keep the Meterless key out of Cursor settings.
- **Zetaris (public Freemium install):** `git clone https://github.com/zetaris/Freemium.git`; UI http://localhost:9001, REST API port 8888, JDBC 10000; start only four containers (zetaris-db, zetaris-server, zetaris-api, zetaris-gui); Docker needs 8 GB+ memory (16 GB laptop). Request image access first (up to 24 h). Our local containers (ports 3000 etc.) are a different build, so check with mentors which to use.
- **Pre-event code rule:** lesson 1.2 / field guide section 09 says how much code may be prepared in advance. Check before reusing the Gift Finder in the real build.
- Agent loop pattern: Nemotron decides, code runs `run_sql` against Zetaris, result back to Nemotron, repeat.

## Not yet read
Lessons 1.2 (rules, judging, submission), 2.1, 3.1, 4.1 and the three workshops, plus any workshop dates.

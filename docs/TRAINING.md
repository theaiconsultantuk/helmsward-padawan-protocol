# Jedi Pack training page

Official course (free with the hackathon, sign in with "Continue with Hackathon"):
https://academy.genai.works/courses/open-agent-hackathon-2026

9 lessons in 4 modules: Start Here, Data Day (Zetaris), Build Day (Cursor + Meterless), Power Day (Meterless + Nemotron).

How to read this page: each lesson gets three summaries.
- **20%**: the working version. Enough to do the task without watching.
- **4%**: the key points, about a minute.
- **1%**: one line.

Status: only lesson 1.1 is summarised so far. The others are marked TODO and get filled in as they are read. Always check the lesson itself for anything marked "[ORGANISERS TO ADD]".

---

## 1.1 Setup guide (read 18 Oct 2026)

### 20%
- **Three required layers:** Data = Zetaris, Build = Cursor, Power = NVIDIA Nemotron served through Meterless.
- **Credits:** Cursor credit pays while you code. Meterless credit pays only when the product runs. Keep the Meterless key out of Cursor's settings.
- **Meterless wiring:** an OpenAI-format client with three settings: `METERLESS_BASE_URL`, `METERLESS_API_KEY`, `NEMOTRON_MODEL`. Sign-up link, base URL and Cursor credit claim were still blank in the lesson.
- **Zetaris install (public Freemium):** `git clone https://github.com/zetaris/Freemium.git`. Request image access first (up to 24 h). UI on port 9001, REST API on 8888, JDBC on 10000. Start only four containers: zetaris-db, zetaris-server, zetaris-api, zetaris-gui. Docker needs 8 GB+ memory, ideally a 16 GB laptop.
- **Agent loop:** Nemotron decides, your code runs `run_sql` against Zetaris, the result goes back to Nemotron, repeat until done.
- **Open question:** how much code may be prepared before 22 Oct (lesson 1.2 / field guide section 09).

### 4%
- Use Zetaris for data, Cursor to build, Nemotron via Meterless to run.
- Two separate credit pots, two separate keys.
- Install Zetaris early because image access takes up to a day.

### 1%
Data in Zetaris, build in Cursor, run on Nemotron through Meterless.

---

## 1.2 How the week runs: tracks, rules, judging, submission
TODO. Not read yet. Priority: pre-event code rule, prize payout rules, judging criteria, submission format.

## 1.3 Onboarding call (12 Oct recording)
TODO.

## 2.1 Data Quick Start: Zetaris
TODO.

## 2.2 Workshop: Data Day with Zetaris
TODO.

## 3.1 Build Quick Start: Cursor and the Meterless Prompt Library
TODO.

## 3.2 Workshop: Build Day, Vibe Coding with Cursor and Meterless
TODO.

## 4.1 Power Quick Start: Meterless and Nemotron
TODO.

## 4.2 Workshop: Power Day with Meterless and Nemotron
TODO.

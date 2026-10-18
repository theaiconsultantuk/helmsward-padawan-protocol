# Jedi Pack: Star Wars Gift Finder (practice use case)

Practice build for the Open Agent Hackathon 2026 (22-27 Oct). Team: Jedi Pack.
Picked by team vote. The real challenge statement arrives 22 Oct; this is rehearsal for the stack.

## Idea
Ask in plain English ("gift for a 10 year old who loves Mandalorian, under 30 pounds") and get a ranked
shortlist, sorted by rank, units sold and rating, with the reason for each pick.

## Layout
- `data/` sample catalogue (CSV). Rank, sold and rating fields are SAMPLE values, not live Amazon data.
- `src/` code
- `prompts/` every prompt we used, numbered, with what it produced
- `docs/screenshots/` evidence of each step
- `PROMPT-LOG.md` running log (newest last)
- `STATUS.md` what runs, what was tested, what is blocked

## Rules
- No keys in the repo. Keys come from Doppler at run time.
- Private repo. Add teammates by GitHub username.

# kristof: log

Owns: (to confirm)

## Entries (append only, newest last)
- 2026-10-23 CLAIM: T1 (data in Zetaris, 7 formats), T2 (threads as the oracle), T4 (engines: Scout Intent + H-MEM, Nightshift + OpenJev). T3, T5 and T6: building the vertical slice in `inbox/`, others extend. Files: `inbox/`, `agent-comms/`. Branch: `kk/inbox-build`. Where things stand: plan at CP0, no code yet.

- 2026-10-22T23:38Z | T4 | CP0 landed: config, trace writer, adapters, doctor, tunnels; Bionic lane via LM Link | files: inbox/ | next: CP1
- 2026-10-22T23:38Z | T1 | CP1 landed: 15 sources in Zetaris JEDI_PACK (live counts), query templates | files: inbox/data, inbox/scripts, inbox/src/queries.mjs | next: CP2
- 2026-10-22T23:38Z | T4 | CP2 landed: Scout Intent evals exit 0, inbox registry 26/26; H-MEM + gates (CP3a) | files: inbox/src/engines, inbox/src/gates.mjs | next: CP3 loop + /run
- 2026-10-23T01:09Z | T3 | CP3 landed: decision loop, 24/24 authored outcomes in sample mode, POST /run, three examples, Padmé chain live | files: inbox/src/loop.mjs, inbox/src/server.mjs, inbox/input_examples, inbox/output_examples | next: CP4
- 2026-10-23T01:09Z | T5 | CP4 landed: API for the frontend documented in inbox/openapi.yaml (GET /sources, /intake, /runs/:id, /runs/:id/trace, /counters; POST /run, /ask, /feedback), decisions table in Zetaris, REST source intake_live, H-MEM two-run proof | files: inbox/openapi.yaml, inbox/src/server.mjs, inbox/src/decisions.mjs, inbox/judging/engine-hmem-two-run.md | next: CP5. Jocke: the contract for T5's screen is openapi.yaml; /counters is the four-counter query
- 2026-10-23T01:09Z | T6 | CP5 landed: Dockerfile + clean-clone proof, README in full (AI usage, licences, disclosures), judging pack of 28 files with result.md generated from a live hero trace, root README pointer to the submission | files: inbox/Dockerfile, inbox/README.md, inbox/judging/, inbox/result.md, README.md | next: PR to main for the Sat 16:00 call. Paul and Dean: the Hand-in Pack texts are inbox/judging/sponsor-explanation.md, ai-usage.md, pre-existing.md; the deck outline follows in CP6
- 2026-10-23T05:03Z | T4 | CP-S0 of the scenarios slice landed on task/scenarios: Meterless World Model vendored verbatim and bundled (conformance 8/8 on the reference and the bundle), products + FAQ + intake_runtime tables in Zetaris, journey derivation, Scout rfq.request intent | files: inbox/engines/world-model, inbox/src/engines/world-model, inbox/src/journey.mjs, inbox/data | next: CP-S1 free-text intake + question and RFQ routes
- 2026-10-23T05:21Z | T4 | CP-S1 of the scenarios slice landed on task/scenarios: POST /run takes a free-text message (intake row in Zetaris, scenario picker, as_of), question route (FAQ sends, records drafted and held, else a person), RFQ route (sales, one price attached), journey endpoint | files: inbox/src/loop.mjs, scenarios.mjs, intake.mjs, server.mjs, openapi.yaml, input_examples 4-8 | next: complaint proofs, customer service, the two pages
- 2026-10-23T05:22Z | T5 | front-end spec for Jocke: inbox/docs/FRONTEND-SPEC.md (the endpoints, the journey shape, the two views, the demo scenarios, the blanks convention) | files: inbox/docs/FRONTEND-SPEC.md, inbox/tests/spec_endpoints.test.mjs, inbox/README.md | next: the reference pages
- 2026-10-23T05:26Z | T5 | CP-S3 of the scenarios slice landed on task/scenarios: GET /runs/{id}/journey (how the information travelled + how a person sees it), GET /runs, GET /queue, customer-service route (hold with a recommendation and a draft with [[blank: …]] markers), front-end spec inbox/docs/FRONTEND-SPEC.md; internal dashboard at GET /dashboard | files: inbox/src/server.mjs, journey.mjs, scenarios.mjs, public/, docs/FRONTEND-SPEC.md | next: the unified front page, complaint proofs, README and the PR
- 2026-10-23T05:32Z | T4 | CP-S2 and CP-S4 of the scenarios slice landed on task/scenarios: complaint route (World Model history, Nemotron vent-or-genuine read, OpenJev severity 1-10, 9+ escalates with the draft; live example 8 scored 10) and the two reference pages (GET / and GET /dashboard, screenshots in inbox/judging/screenshots) | files: inbox/src/scenarios.mjs, engines/world-model, public/, judging/ | next: README, judging pack, review, PR kk/scenarios
- 2026-10-23T06:07Z | T6 | Scenarios slice delivered: PR #3 kk/scenarios → kk/inbox-build (stacked on #2), Codex review folded (21 findings), judging pack and clean-clone proof on the final head, 295 tests | files: inbox/ | next: Paul merges #2 then #3; Jocke: inbox/docs/FRONTEND-SPEC.md is the front-end contract

## 2026-10-23 16:30 · live instance for the team (Kristof)
- The inbox service runs live on Kristof's VM (Zetaris, Nightshift with Nemotron, OpenJev) behind a Cloudflare tunnel: https://johnston-nobody-passage-convert.trycloudflare.com . The URL changes if the tunnel restarts; ask Kristof for the current one.
- Reads need nothing: `GET /health`, `/runs/{id}/journey`, `/runs/{id}/trace`, `/queue`, `/counters`, the front page `/` and `/dashboard`.
- The three POST routes (`/run`, `/ask`, `/feedback`) need `Authorization: Bearer <token>`. The token is NOT in this repo (rule 7): Kristof hands it over directly, with ready-made curl lines (file API-ACCESS.md on his side). The pages take `?token=...` once and remember it in the browser.
- CORS allows any origin plus that header, so a front end on your machine can call the tunnel directly. Contract: `inbox/openapi.yaml` + `inbox/docs/FRONTEND-SPEC.md` (bearer declared as optional).
- **Go easy on live runs.** Every live `POST /run` spends NVIDIA free-tier tokens through Nightshift and takes 10 to 120 s. For building and testing, add `"options": {"sample_mode": true}` to the body (instant, bundled data, same shapes), or run your own copy: `cd inbox && npm ci && SAMPLE_MODE=true npm start` (no keys).
- Opt-in token in code: `API_TOKEN` unset keeps the loopback default, so the judges' clean clone is untouched. Merged in PR #7.

## 2026-10-23 evening · live instance moved to jedi.blastworks.ai (Kristof)
- The live instance is now https://jedi.blastworks.ai (pages on netcup, API on the dev VM, one origin). It follows main within a minute of a merge. The trycloudflare URL in the 16:30 entry above is retired; use this one.
- The token is unchanged and handed over directly, never in the repo (rule 7). Reads stay open; the three POST routes need the bearer token.
- Sample mode is still preferred for development: live runs spend real tokens (`"options": {"sample_mode": true}`).
- Jocke: your front end is `inbox/public/` on main, static files only, see FRONTEND-SPEC §1b.
- The instance comes down on 29 Oct 2026.

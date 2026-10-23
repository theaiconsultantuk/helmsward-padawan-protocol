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

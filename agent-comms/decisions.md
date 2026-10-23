# Decisions (dated, one line each)

- 2026-10-22: Working track: Track 2 (An Agent That Can Explain Why). Not final until the vote.
- 2026-10-22: (superseded) idea deadline and vote dropped, see decision below.
- 2026-10-22: Prize split proposal: 15% base each + 40% by contribution. Needs all four to agree.
- 2026-10-22: Paul decided to go with Kristof's idea (Jedi Pack inbox: an assistant that knows when NOT to send). No idea vote. Track still to confirm (Track 2 vs 3).
- 2026-10-23: The product code lives in `inbox/` (self-contained Node 22 service, zero runtime deps). Paul's practice gift finder stays at the repo root and is declared pre-existing.
- 2026-10-23: `POST /run` interface (T3 and T5 code against this). Request: `{run_id, input: {thread_id, as_of?} | {message, from, channel}, options: {sample_mode}}`. Response: `{run_id, status, output: {decision: send|hold|escalate|close, reasons, cited_rows, draft?, queued_for?}, agents, trace_id, log_file, execution_time_seconds}`. Error: `{run_id, status:"error", error:{type, message, recoverable}, trace_id, execution_time_seconds}`.
- 2026-10-23: `POST /ask` takes `{question, customer?}` and returns `{answer, intent, cited_rows, model, trace_id, confidence}`; a question that trips the injection guard is refused with no model call.
- 2026-10-23: Other routes: GET /health, /sources, /intake, /runs/:id, /runs/:id/trace, /counters, /openapi.yaml; POST /feedback `{run_id, verdict: affirm|reject, note?}`.
- 2026-10-23: Branch for this slice is `kk/inbox-build`, landing on `main` by PR. Commits are authored as "Kristof Kennes" with no Co-Authored-By line; the AI disclosure lives in `inbox/README.md` under "AI and Model Usage".
- 2026-10-23: The Zetaris database is `JEDI_PACK`, loaded from `inbox/data/synthetic/` through the driver's shared file root.
- 2026-10-23: Provider order: Nightshift on Thor is primary (pinned Nemotron route), `meterless/local` is the fallback, sample rules come last.

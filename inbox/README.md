# Jedi Pack Inbox

One-line pitch: a customer-support inbox agent that decides, critiques and escalates with a full trace.

## Quick start
Placeholder: install, configure `.env`, run.

## Architecture
Placeholder: Scout intent engine, H-MEM, decision loop, adapters.

## Sponsors
Placeholder: Zetaris, Meterless/Nightshift, NVIDIA Nemotron.

## API
The contract is `openapi.yaml` (also served at `GET /openapi.yaml`). JSON everywhere, CORS open (`*`), no credentials.

**Base URL.** `http://127.0.0.1:8000` by default; `PORT` moves it (`8810` on the dev VM) and `HOST` defaults to `127.0.0.1`. Start it with `node src/server.mjs`. `SAMPLE_MODE=true` answers from cached rows with no network (counters then come from the local decisions file); `"options": {"sample_mode": true}` on a `/run` forces it for one call.

```bash
B=http://127.0.0.1:8810
curl -s $B/health
curl -s $B/sources                      # every source: name, format, table, rows, live
curl -s $B/intake                       # the contact-form submissions (the REST source Zetaris reads)
curl -s -X POST $B/run -H 'Content-Type: application/json' -d '{"run_id":"demo-1","input":{"thread_id":"T02"}}'
curl -s -X POST $B/ask -H 'Content-Type: application/json' -d '{"question":"Can I get a refund on my lightsaber?"}'
curl -s $B/runs/demo-1                  # the stored result
curl -s $B/runs/demo-1/trace            # the trace link: one JSON object per step
curl -s -X POST $B/feedback -H 'Content-Type: application/json' -d '{"run_id":"demo-1","verdict":"affirm","note":"good call"}'
curl -s $B/counters                     # {send, hold, escalate, close, queued, affirmed, rejected}
curl -s $B/openapi.yaml
```

Every result carries a `trace_id` and a `log_file`; `GET /runs/<run_id>/trace` returns that file as a JSON array (works for `/ask` run ids too). Results are kept for the last 200 runs, so a restart forgets them.

**Feedback and the trust ledger.** Every completed `/run` writes a row to `data/runtime/decisions.csv`, which is copied into Zetaris and read as `JEDI_PACK.decisions`; `POST /feedback` sets that row's verdict and delta (affirm +0.05, reject -0.05) and refreshes the table, so `/counters` is a live Zetaris `GROUP BY`. Each affirm or reject for a category moves that category's trust weight by the same 0.05 when the loop reads it (`trustFloor`'s `ledgerAdjust`).

## Sample mode
Placeholder: running with no network.

## Evals
Placeholder: Scout evals.

## Docker
Placeholder: build and run.

## Judging pack
Placeholder: where the evidence lives.

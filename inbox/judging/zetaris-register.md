---
title: Zetaris registration of the Jedi Pack synthetic data
description: Every statement that registered the synthetic file sources as Zetaris Lightning tables, with options, result and live row counts.
date: 2026-10-24
tags: [judging, zetaris]
---

# Zetaris registration

**27 file sources in `data/sources.json`** (25 synthetic and the 2 runtime tables) are described for registration as `JEDI_PACK.<table>` Lightning filestore tables. On the dev Zetaris instance on 23 Oct, 15 synthetic file sources were registered and each read every record of its file (document tables return one row per file by design). The JSON sources are single JSON arrays registered with `multiLine "true"` (refresh note below). The 24 Oct data model (50 products in Galactic Credits, customers, orders, shipping rules, bulk tiers, bill of materials, channels, company hierarchy, 207 employees) changed the row counts in the table below, which now come from `data/sources.json` rather than a live count; the seven added sources are registered, and the live counts re-measured, when the branch is published to Zetaris (`SKIP_RUNTIME=1 bash inbox/scripts/zetaris_drop.sh`, then `register_sources.mjs --apply`).

Drop: `bash inbox/scripts/zetaris_drop.sh` streams `inbox/data/synthetic` into the driver container as uid 1001 (57 files under `/home/zetaris/customer-data/shared/jedi-pack`). Register: `node inbox/scripts/register_sources.mjs --apply` (SQL also in `inbox/scripts/register_zetaris_sources.sql`).

## Statements

`CREATE LIGHTNING DATABASE JEDI_PACK DESCRIBE BY "Jedi Pack Inc synthetic company data"` : ok

| table | format | options | rows (data/sources.json) | status |
|---|---|---|---|---|
| employees | CSV | header "true" | 207 | registered 23 Oct |
| holiday_2026 | CSV | header "true" | 1263 | registered 23 Oct |
| responsibility | CSV | header "true" | 12 | registered 23 Oct |
| policy | CSV | header "true" | 2 | registered 23 Oct |
| categories | CSV | header "true" | 5 | registered 23 Oct |
| trust_ledger | CSV | header "true" | 12 | registered 23 Oct |
| automation_matrix | XML | rowTag "category" | 5 | registered 23 Oct |
| wiki_refund_policy | MARKDOWN | none | 1 | registered 23 Oct, document table: one row per file |
| wiki_replacement_policy | MARKDOWN | none | 1 | registered 23 Oct, document table: one row per file |
| wiki_what_may_leave | MARKDOWN | none | 1 | registered 23 Oct, document table: one row per file |
| threads_json | JSON | multiLine "true" | 100 | registered 23 Oct |
| threads_parquet | PARQUET | none | 100 | registered 23 Oct |
| contact_form_submissions | JSON | multiLine "true" | 41 | registered 23 Oct |
| trustpilot_reviews | JSON | multiLine "true" | 19 | registered 23 Oct |
| escalation_notes | TEXT | none | 1 | registered 23 Oct, document table: one row per file |
| decisions | CSV | header "true", escape """, multiLine "true" | 0 | runtime table the service writes, published at run time |
| products | CSV | header "true" | 50 | registered 23 Oct, columns changed 24 Oct, re-registered at publish |
| faq | CSV | header "true" | 18 | registered 23 Oct, columns changed 24 Oct, re-registered at publish |
| contacts | CSV | header "true" | 1 | registered 23 Oct, columns changed 24 Oct, re-registered at publish |
| intake_runtime | CSV | header "true", escape """, multiLine "true" | 0 | runtime table the service writes, published at run time |
| companyhierarchy | CSV | header "true" | 207 | added 24 Oct, registered at publish (CP6) |
| customers | CSV | header "true" | 58 | added 24 Oct, registered at publish (CP6) |
| orders | CSV | header "true" | 82 | added 24 Oct, registered at publish (CP6) |
| shipping_rules | CSV | header "true" | 12 | added 24 Oct, registered at publish (CP6) |
| bulk_pricing | CSV | header "true" | 3 | added 24 Oct, registered at publish (CP6) |
| bom | CSV | header "true" | 149 | added 24 Oct, registered at publish (CP6) |
| channels | CSV | header "true" | 4 | added 24 Oct, registered at publish (CP6) |

Each is `CREATE LIGHTNING FILESTORE TABLE <table> FROM JEDI_PACK FORMAT <format> OPTIONS (path "file:///home/zetaris/customer-data/shared/jedi-pack/<path>"[, options])`. No statement failed on the first attempt; none needed a retry.

## Finding and refresh (23 Oct)

Zetaris reads one JSON document per file, so the line-delimited files registered as 1 row each (`threads_jsonl` 100 lines, `contact_form_submissions` 41, `trustpilot_reviews` 19), whatever `multiLine` said. Refresh 23 Oct: `gen_company.py` now writes the two intake files and the new `threads/threads.json` as single pretty-printed JSON arrays; all three register with `multiLine "true"` and read 41, 19 and 100 rows. `threads/threads.jsonl` stays on disk for the oracle (first 24 lines byte-identical to `kristof/data/threads/threads.jsonl`) but is no longer a Zetaris source: `threads_jsonl` was dropped with `DROP LIGHTNING DATABASE TABLE JEDI_PACK.threads_jsonl`. The two intake tables were refreshed with `register_sources.mjs --apply --refresh --only contact_form_submissions,trustpilot_reviews,threads_json` (the new `--only` option takes a comma list of table names).

## Other notes

- MARKDOWN and TEXT accepted with no options; they return one document row per file with a `preview` column holding the text (wiki pages hold 15 to 17 lines each, escalation notes 21).
- XML `rowTag "category"` yields columns `_autonomous`, `_name`, `_weight` (attributes get an underscore prefix).
- Probe artefacts (a session table and `shared/jedi-probe`) were removed afterwards.

## Runtime table and REST source (23 Oct)

**Runtime table `decisions` (16th file source).** The service writes `data/runtime/decisions.csv` (gitignored; header `run_id,thread_id,category,decision,verdict,delta,ts`): one row per completed `/run` (a re-run of the same `run_id` replaces its row), verdict and delta filled by `POST /feedback` (affirm +0.05, reject -0.05), atomic rewrite. `decisions.publish()` streams it into the container as uid 1001 (`docker exec -u 1001 zetaris-driver-1 mkdir -p .../jedi-pack/runtime`, then `tar -C data/runtime -cf - decisions.csv | docker exec -i -u 1001 zetaris-driver-1 tar -xf - -C /home/zetaris/customer-data/shared/jedi-pack/runtime`) and runs `UNCACHE LIGHTNING FILESTORE TABLE decisions FROM JEDI_PACK` (syntax from the Lightning SQL reference, 5.7); a missing table on the first publish is tolerated. Registered once with `register_sources.mjs --apply --only decisions`: `CREATE LIGHTNING FILESTORE TABLE decisions FROM JEDI_PACK FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/jedi-pack/runtime/decisions.csv", header "true")`, 0 rows at registration (header only), `"runtime": true` in `data/sources.json`. `counters()` reads `SELECT decision, verdict, COUNT(*) AS n FROM JEDI_PACK.decisions GROUP BY decision, verdict`.

Live proof (127.0.0.1:8810): `POST /run` T02, `POST /feedback` affirm, then `GET /counters` returned `{"send":0,"hold":0,"escalate":1,"close":0,"queued":1,"affirmed":1,"rejected":0}` from the refreshed Zetaris table; the file in the container matched the local file byte for byte. The test row was removed afterwards (header-only file re-published, `COUNT(*)` = 0).

**REST source `intake_live` (registered).** Docker bridge gateway of `zetaris-driver-1`: `<bridge-gateway>` (the host's address on the driver's Docker network; redacted here). With the service on `HOST=0.0.0.0 PORT=8810`, the driver reached `http://<bridge-gateway>:8810/intake` (curl from inside the container: HTTP 200) and:

```
CREATE LIGHTNING REST TABLE intake_live FROM JEDI_PACK REQUEST (endpoint "http://<bridge-gateway>:8810/intake", method "GET", http_encoding "URLENCODED", response_type "JSON", insecure_ssl "false") HEADER () BODY ()
SELECT COUNT(*) FROM JEDI_PACK.intake_live   -> 41
```

The plan's `url` key is `endpoint` in the Lightning SQL reference (6.2), and `HEADER () BODY ()` are required; the first attempt with `url` and no HEADER/BODY failed with HTTP 400. The service was then stopped. **Finding:** the REST table is read at query time, not cached: with the service stopped (or bound to 127.0.0.1) `SELECT ... FROM JEDI_PACK.intake_live` returns HTTP 400. `GET /sources` shows it `live: false` then. Source count 23 Oct: 15 file sources + decisions + intake_live = 17 in `data/sources.json`; 24 Oct: 28 entries (25 synthetic file sources, 2 runtime tables, 1 REST) (`"rest": true`; the register script skips REST entries).

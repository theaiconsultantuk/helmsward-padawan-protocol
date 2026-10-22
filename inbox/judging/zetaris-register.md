---
title: Zetaris registration of the Jedi Pack synthetic data
description: Every statement that registered the 15 synthetic file sources as Zetaris Lightning tables, with options, result and live row counts.
date: 2026-10-23
tags: [judging, zetaris]
---

# Zetaris registration

**15 of 15 file sources registered** as `JEDI_PACK.<table>` Lightning filestore tables on the dev Zetaris instance. All 15 read every record of their file (document tables return one row per file by design). The JSON sources are single JSON arrays registered with `multiLine "true"` (refresh note below).

Drop: `bash inbox/scripts/zetaris_drop.sh` streams `inbox/data/synthetic` into the driver container as uid 1001 (57 files under `/home/zetaris/customer-data/shared/jedi-pack`). Register: `node inbox/scripts/register_sources.mjs --apply` (SQL also in `inbox/scripts/register_zetaris_sources.sql`).

## Statements

`CREATE LIGHTNING DATABASE JEDI_PACK DESCRIBE BY "Jedi Pack Inc synthetic company data"` : ok

| table | format | options | live rows | result |
|---|---|---|---|---|
| employees | CSV | header "true" | 200 | ok |
| holiday_2026 | CSV | header "true" | 1251 | ok |
| responsibility | CSV | header "true" | 5 | ok |
| policy | CSV | header "true" | 1 | ok |
| categories | CSV | header "true" | 5 | ok |
| trust_ledger | CSV | header "true" | 5 | ok |
| automation_matrix | XML | rowTag "category" | 5 | ok |
| wiki_refund_policy | MARKDOWN | none | 1 | ok, document table: one row per file |
| wiki_replacement_policy | MARKDOWN | none | 1 | ok, document table: one row per file |
| wiki_what_may_leave | MARKDOWN | none | 1 | ok, document table: one row per file |
| threads_json | JSON | multiLine "true" | 100 | ok, one JSON array, all 100 threads |
| threads_parquet | PARQUET | none | 100 | ok |
| contact_form_submissions | JSON | multiLine "true" | 41 | ok, one JSON array, all 41 records |
| trustpilot_reviews | JSON | multiLine "true" | 19 | ok, one JSON array, all 19 records |
| escalation_notes | TEXT | none | 1 | ok, document table: one row per file |

Each is `CREATE LIGHTNING FILESTORE TABLE <table> FROM JEDI_PACK FORMAT <format> OPTIONS (path "file:///home/zetaris/customer-data/shared/jedi-pack/<path>"[, options])`. No statement failed on the first attempt; none needed a retry.

## Finding and refresh (23 Oct)

Zetaris reads one JSON document per file, so the line-delimited files registered as 1 row each (`threads_jsonl` 100 lines, `contact_form_submissions` 41, `trustpilot_reviews` 19), whatever `multiLine` said. Refresh 23 Oct: `gen_company.py` now writes the two intake files and the new `threads/threads.json` as single pretty-printed JSON arrays; all three register with `multiLine "true"` and read 41, 19 and 100 rows. `threads/threads.jsonl` stays on disk for the oracle (first 24 lines byte-identical to `kristof/data/threads/threads.jsonl`) but is no longer a Zetaris source: `threads_jsonl` was dropped with `DROP LIGHTNING DATABASE TABLE JEDI_PACK.threads_jsonl`. The two intake tables were refreshed with `register_sources.mjs --apply --refresh --only contact_form_submissions,trustpilot_reviews,threads_json` (the new `--only` option takes a comma list of table names).

## Other notes

- MARKDOWN and TEXT accepted with no options; they return one document row per file with a `preview` column holding the text (wiki pages hold 15 to 17 lines each, escalation notes 21).
- XML `rowTag "category"` yields columns `_autonomous`, `_name`, `_weight` (attributes get an underscore prefix).
- Probe artefacts (a session table and `shared/jedi-probe`) were removed afterwards.

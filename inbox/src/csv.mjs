// Zero-dependency RFC-4180 CSV reader and the offline table loader behind every template's `local`.
//
// readCsv(path)            -> objects, one per data row, keys from the header row, every value a STRING
//                             (an empty cell is "", never null: the null rule lives in queries.mjs, which mirrors Spark's
//                             "empty CSV cell reads as NULL"). Handles quoted commas, quoted newlines, doubled quotes,
//                             CRLF / LF / CR line ends and a UTF-8 BOM. A row shorter than the header pads with "";
//                             a wholly blank line is skipped. Throws on an unterminated quote or a row longer than the header.
// parseCsv(text)           -> the same as arrays of arrays, header row first (pure, used by readCsv and the tests).
// loadTables(dir)          -> { <raw table>: rows[] } for every *.csv in `dir` (file name, "-" -> "_", is the table name:
//                             holiday-2026.csv -> holiday_2026, trust-ledger.csv -> trust_ledger) plus threads_json from
//                             threads/threads.json when present. This is the `tables` argument of a template's local().
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [], cur = "", quoted = false, started = false;
  const endRow = () => { row.push(cur); cur = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; started = false; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"' && !started) { quoted = true; started = true; }
    else if (c === ",") { row.push(cur); cur = ""; started = false; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; endRow(); }
    else { cur += c; started = true; }
  }
  if (quoted) throw new Error("csv: unterminated quoted field");
  if (cur !== "" || row.length) endRow();
  return rows;
}

export function readCsv(path) {
  const [head, ...body] = parseCsv(readFileSync(path, "utf8"));
  if (!head) return [];
  return body.map((r, n) => {
    if (r.length > head.length) throw new Error(`csv: ${path} row ${n + 2} has ${r.length} fields, header has ${head.length}`);
    return Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]));
  });
}

export function loadTables(dir) {
  const tables = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".csv")).sort()) tables[f.slice(0, -4).replace(/-/g, "_")] = readCsv(join(dir, f));
  const tj = join(dir, "threads", "threads.json");
  if (existsSync(tj)) tables.threads_json = JSON.parse(readFileSync(tj, "utf8"));
  return tables;
}

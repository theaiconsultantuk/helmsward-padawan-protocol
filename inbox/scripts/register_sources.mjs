#!/usr/bin/env node
// Render and apply the Zetaris Lightning registration of inbox/data/sources.json.
// --print writes register_zetaris_sources.sql only; --apply runs it (idempotent); --refresh UNCACHEs and re-creates.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config, sampleMode } from "../src/config.mjs";
import * as zetaris from "../src/adapters/zetaris.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, "..", "data", "sources.json");
const SQL_OUT = join(HERE, "register_zetaris_sources.sql");
const ROOT = (config().ZETARIS_FILE_ROOT || "file:///home/zetaris/customer-data/shared/jedi-pack").replace(/\/$/, "");
const DB = "JEDI_PACK";

const { values } = parseArgs({ options: { print: { type: "boolean" }, apply: { type: "boolean" }, refresh: { type: "boolean" }, only: { type: "string" } } });
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const optStr = (o) => Object.entries(o).map(([k, v]) => `${k} "${v}"`).join(", ");
export const createDb = `CREATE LIGHTNING DATABASE ${DB} DESCRIBE BY "Jedi Pack Inc synthetic company data"`;
export const createTable = (s, opts = s.options) =>
  `CREATE LIGHTNING FILESTORE TABLE ${s.table} FROM ${DB} FORMAT ${s.format} OPTIONS (${optStr({ path: `${ROOT}/${s.path}`, ...opts })})`;
const onlySet = values.only ? new Set(values.only.split(",").map((x) => x.trim())) : null;
const allFileSources = manifest.sources.filter((s) => s.format !== "REST");
const fileSources = onlySet ? allFileSources.filter((s) => onlySet.has(s.table)) : allFileSources;

const stmts = [createDb, ...allFileSources.map((s) => createTable(s))];
writeFileSync(SQL_OUT, stmts.map((s) => s + ";").join("\n") + "\n");
console.log(`wrote ${SQL_OUT} (${stmts.length} statements)`);
if (!values.apply) process.exit(0);

if (sampleMode()) { console.error("refused: SAMPLE_MODE is on, nothing would reach Zetaris"); process.exit(2); }
const run = (q) => zetaris.sqlRun(q, { cfg: config(), limit: 1000, timeoutMs: 120000 });
const flat = (r) => JSON.stringify(r.rows).toLowerCase();
const errText = (e) => `${e.name}: ${e.message}${e.detail ? " | " + JSON.stringify(e.detail) : ""}`.slice(0, 600);
const alternatives = (s) => {
  if (s.format === "JSON") return [{ multiLine: s.options.multiLine === "true" ? "false" : "true" }];
  if (s.format === "MARKDOWN" || s.format === "TEXT") return [{ header: "false" }, { wholetext: "true" }];
  if (s.format === "PARQUET") return [{ mergeSchema: "true" }];
  return [];
};

const log = [];
try {
  const dbs = await run("SHOW LIGHTNING DATABASES");
  if (flat(dbs).includes(`"${DB.toLowerCase()}"`)) log.push({ stmt: createDb, status: "exists, skipped" });
  else { await run(createDb); log.push({ stmt: createDb, status: "ok" }); }
} catch (e) { log.push({ stmt: createDb, status: "FAILED", error: errText(e) }); }

let existing = new Set();
try {
  const t = await run(`SHOW LIGHTNING TABLES ${DB}`);
  for (const row of t.rows) for (const c of row) if (typeof c === "string") existing.add(c.toLowerCase());
} catch (e) { log.push({ stmt: `SHOW LIGHTNING TABLES ${DB}`, status: "FAILED", error: errText(e) }); }

for (const s of fileSources) {
  const entry = { table: s.table, format: s.format, attempts: [] };
  log.push(entry);
  const have = existing.has(s.table.toLowerCase());
  if (have && values.refresh) {
    const u = `UNCACHE LIGHTNING FILESTORE TABLE ${s.table} FROM ${DB}`;
    try { await run(u); entry.attempts.push({ stmt: u, status: "ok" }); }
    catch (e) { entry.attempts.push({ stmt: u, status: "FAILED", error: errText(e) }); }
  }
  const tries = [s.options, ...alternatives(s).map((a) => ({ ...s.options, ...a }))];
  let ok = have && !values.refresh;
  if (ok) entry.attempts.push({ stmt: createTable(s), status: "exists, skipped" });
  for (const o of ok ? [] : tries) {
    const stmt = createTable(s, o);
    try {
      if (have) { try { await run(`DROP LIGHTNING DATABASE TABLE ${DB}.${s.table}`); } catch {} }
      await run(stmt);
      const c = await run(`SELECT COUNT(*) FROM ${DB}.${s.table}`);
      const n = Number(c.rows[0][0]);
      entry.attempts.push({ stmt, status: "ok", rows: n });
      entry.options = o; entry.rows = n; ok = true; break;
    } catch (e) {
      entry.attempts.push({ stmt, status: "FAILED", error: errText(e) });
      try { await run(`DROP LIGHTNING DATABASE TABLE ${DB}.${s.table}`); } catch {}
    }
  }
  if (ok && entry.rows === undefined) {
    try { entry.rows = Number((await run(`SELECT COUNT(*) FROM ${DB}.${s.table}`)).rows[0][0]); } catch (e) { entry.attempts.push({ stmt: "COUNT", status: "FAILED", error: errText(e) }); }
  }
  entry.ok = ok && entry.rows !== undefined;
  // JSON lines: Zetaris reads one record per file in this build; flag it, never hide it.
  const local = join(HERE, "..", "data", "synthetic", s.path);
  if (entry.ok && s.format === "JSON" && existsSync(local)) {
    const txt = readFileSync(local, "utf8");
    entry.file_lines = s.options.multiLine === "true" ? JSON.parse(txt).length : txt.split("\n").filter(Boolean).length;
    if (entry.file_lines !== entry.rows) { entry.warning = `reads ${entry.rows} of ${entry.file_lines} records`; console.log(`WARN   ${s.table}: ${entry.warning}`); }
  }
  console.log(`${entry.ok ? "ok    " : "FAILED"} ${s.table} ${entry.rows ?? ""}`);
}

// rows back into sources.json: text substitution on the "rows" lines only keeps the rest byte-identical.
let text = readFileSync(MANIFEST, "utf8");
for (const e of log.filter((l) => l.table && l.ok)) {
  const re = new RegExp(`("table": "${e.table}"[\\s\\S]*?"rows": )\\d+`);
  text = text.replace(re, `$1${e.rows}`);
}
writeFileSync(MANIFEST, text);
writeFileSync(join(HERE, "register_result.json"), JSON.stringify(log, null, 2));
const n = log.filter((l) => l.table && l.ok).length;
console.log(`${n} of ${fileSources.length} file sources registered`);
process.exit(n === fileSources.length ? 0 : 1);

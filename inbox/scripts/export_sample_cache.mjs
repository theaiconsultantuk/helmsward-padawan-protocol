// Export the live Zetaris answers the loop and /ask need into data/sample/<template>.json,
// so SAMPLE_MODE serves the same rows as live. Live SELECTs only. Deterministic output.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import * as zetaris from "../src/adapters/zetaris.mjs";
import { TEMPLATES, CATEGORIES, TOPICS, TABLES, run, factsForTicket } from "../src/queries.mjs";

const OUT = join(INBOX_ROOT, "data", "sample");
const cfg = config({ SAMPLE_MODE: "false" });
if (String(cfg.SAMPLE_MODE) === "true") throw new Error("export needs live Zetaris");

const threads = readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

const wanted = new Map(); // name -> Map(paramsJSON -> params)
const want = (name, params = {}) => {
  if (!wanted.has(name)) wanted.set(name, new Map());
  const key = JSON.stringify(Object.fromEntries(Object.keys(params).sort().map((k) => [k, params[k]])));
  wanted.get(name).set(key, JSON.parse(key));
};

for (const t of threads) want("thread", { thread_id: t.thread_id });
for (const c of CATEGORIES) { want("category", { category: c }); want("trust", { category: c }); }
for (const c of TOPICS) { want("policy", { topic: c }); want("responsibility", { topic: c }); }
for (const w of ["refund", "replacement", "leave"]) want("wiki", { wiki: w });
for (const t of TABLES) want("table_count", { table: t });
want("decision_counts", {});
want("faq", {}); want("products", {}); want("reviews", {}); want("world_threads", {}); want("holidays", {});
for (let i = 1; i <= 10; i++) want("product_price", { product_id: "P" + String(i).padStart(2, "0") });
want("thread_fingerprints", {});
for (const c of CATEGORIES) want("ledger_adjust", { category: c });
const emps = new Set(Array.from({ length: 20 }, (_, i) => i + 1));
for (const t of threads) for (const k of ["owner_id", "backup_id"]) if (t[k] !== "" && t[k] != null) emps.add(Number(t[k]));
for (const e of emps) want("employee", { employee_id: e });

// Record everything factsForTicket asks for, per thread, through a recording runner.
const rec = async (sql, o) => { want(o.name, o.params); return zetaris.sqlRun(sql, o); };
const factsErrors = [];
for (const t of threads) {
  try { await factsForTicket(t.thread_id, { cfg, sqlRunImpl: rec }); }
  catch (e) { factsErrors.push(`${t.thread_id} (${t.category}): ${e.name}: ${e.message}`); }
}
for (const t of threads) for (const k of ["owner_id", "backup_id"]) {
  if (t[k] !== "" && t[k] != null) want("holiday", { employee_id: Number(t[k]), date: String(t.received_at).slice(0, 10) });
}

mkdirSync(OUT, { recursive: true });
const summary = [];
const skipped = [];
for (const name of Object.keys(TEMPLATES)) {
  if (name === "intake_thread") continue; // runtime rows only, never cached
  const entries = [];
  for (const [key, params] of [...(wanted.get(name) ?? new Map())].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (name === "decision_counts" || name === "ledger_adjust") { entries.push({ params, result: { headers: [], rows: [], total: 0 } }); continue; }
    try {
      const r = await run(name, params, { cfg, limit: 1000 });
      entries.push({ params, result: { headers: r.headers, rows: r.rows, total: r.total } });
    } catch (e) { skipped.push(name + " " + key + ": " + e.name + ": " + e.message); }
  }
  const f = join(OUT, `${name}.json`);
  writeFileSync(f, JSON.stringify(entries, null, 2) + "\n");
  summary.push({ template: name, entries: entries.length, bytes: statSync(f).size });
}
console.table(summary);
const total = readdirSync(OUT).reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`total bytes: ${total}`);
if (factsErrors.length) console.log("factsForTicket live errors (" + factsErrors.length + "):\n  " + factsErrors.join("\n  "));
if (skipped.length) console.log("live errors, no entry written (sample mode fails the same way):\n  " + skipped.join("\n  "));
if (total > 1_000_000) { console.error("over 1 MB"); process.exit(1); }

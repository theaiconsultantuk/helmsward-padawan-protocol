// Export the Zetaris answers the loop and /ask need into data/sample/<template>.json,
// so SAMPLE_MODE serves the same rows as live. Deterministic output.
//   (no flag)         live: every wanted request is a live SELECT (needs Zetaris; unchanged from before).
//   --from-csv        offline: every wanted request of a template with local() is answered by runLocal on
//                     loadTables(data/synthetic) and written in the same file shape. Templates without local()
//                     (LOCAL_EXEMPT) are skipped: their caches stay as they are (live-exported in CP6).
//   --patch-exempt    offline stand-in for the exempt caches until CP6's live re-export: rebuilds thread, world_threads,
//                     reviews, wiki and table_count from the regenerated synthetic files (see the derivations below).
//   --data=<dir>      data root (default inbox/data; holds synthetic/, sources.json, sample/). Used to verify the
//                     derivations against an older checkout.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import * as zetaris from "../src/adapters/zetaris.mjs";
import { queryByName } from "../src/adapters/sample.mjs";
import { TEMPLATES, CATEGORIES, TOPICS, TABLES, INTAKE_CHANNELS, LOCAL_EXEMPT, run, runLocal, factsForTicket } from "../src/queries.mjs";
import { loadTables } from "../src/csv.mjs";

const args = process.argv.slice(2);
const FROM_CSV = args.includes("--from-csv");
const PATCH = args.includes("--patch-exempt");
const DATA = (args.find((a) => a.startsWith("--data=")) ?? "").slice(7) || join(INBOX_ROOT, "data");
const OUT = join(DATA, "sample");
const cfg = config({ SAMPLE_MODE: "false" });
if (!FROM_CSV && !PATCH && String(cfg.SAMPLE_MODE) === "true") throw new Error("export needs live Zetaris");

const tables = loadTables(join(DATA, "synthetic"));
const threads = tables.threads_json;
const wanted = new Map(); // name -> Map(paramsJSON -> params)
const want = (name, params = {}) => {
  if (!wanted.has(name)) wanted.set(name, new Map());
  const key = JSON.stringify(Object.fromEntries(Object.keys(params).sort().map((k) => [k, params[k]])));
  wanted.get(name).set(key, JSON.parse(key));
};

mkdirSync(OUT, { recursive: true });
const write = (name, entries) => {
  const f = join(OUT, `${name}.json`);
  writeFileSync(f, JSON.stringify(entries, null, 2) + "\n");
  return statSync(f).size;
};

// ---- exempt caches, offline (--patch-exempt) ------------------------------------------------------------------
// These templates read Parquet, Markdown, the runtime tables or the USL ticket/review views, so they have no local().
// Until CP6 re-exports them live, they are REBUILT from the regenerated synthetic files with the typing Zetaris's REST API
// gives (every value a string, NULL as null; int "15", double "40.0", boolean "true"). Nothing is typed by hand:
// verified by running this against the pre-regeneration checkout (--data=<old data>) and comparing with its committed caches.
const TYPE = { amount: "dbl", owner_id: "int", backup_id: "int", may_leave: "bool", owner_out: "bool", fictional: "bool" };
const cell = (k, v) => {
  if (v === null || v === undefined) return null;
  const t = TYPE[k];
  if (t === "dbl") { const n = Number(v); return Number.isInteger(n) ? n.toFixed(1) : String(n); }
  if (t === "int") return String(Math.trunc(Number(v)));
  if (t === "bool") return String(v);
  return String(v);
};
const entryOf = (params, headers, rows) => ({ params, result: { headers, rows, total: rows.length } });
const byKey = (a, b) => (JSON.stringify(a.params) < JSON.stringify(b.params) ? -1 : 1);
function patchExempt() {
  const sizes = {};
  // thread: one entry per thread, every threads_json column in file order (threads_parquet has the same columns).
  const cols = Object.keys(threads[0]);
  sizes.thread = write("thread", threads.map((t) => entryOf({ thread_id: t.thread_id }, cols, [cols.map((k) => cell(k, t[k]))])).sort(byKey));
  // world_threads: the USL ticket view's columns, every thread, ordered by thread_id as text.
  const wc = ["thread_id", "sender_email", "sender_name", "category", "channel", "received_at", "owner_id", "outcome", "subject"];
  sizes.world_threads = write("world_threads", [entryOf({}, wc, [...threads].sort((a, b) => (a.thread_id < b.thread_id ? -1 : 1)).map((t) => wc.map((k) => cell(k, t[k]))))]);
  // reviews: intakes/trustpilot/reviews.json through the review view (stars cast to int), ordered by review_id.
  const rc = ["review_id", "thread_id", "reviewer_name", "stars", "created_at"];
  const rv = JSON.parse(readFileSync(join(DATA, "synthetic", "intakes", "trustpilot", "reviews.json"), "utf8"));
  sizes.reviews = write("reviews", [entryOf({}, rc, [...rv].sort((a, b) => (a.review_id < b.review_id ? -1 : 1)).map((r) => rc.map((k) => cell(k, r[k]))))]);
  // wiki: the markdown file as the whole preview, under the path Zetaris serves it from.
  const WIKI = { leave: "what-may-leave.md", refund: "refund-policy.md", replacement: "replacement-policy.md" };
  sizes.wiki = write("wiki", Object.entries(WIKI).map(([w, f]) => entryOf({ wiki: w }, ["type", "format", "path", "preview"],
    [["markdown", "md", `file:///home/zetaris/customer-data/shared/jedi-pack/wiki/${f}`, readFileSync(join(DATA, "synthetic", "wiki", f), "utf8")]])).sort(byKey));
  // table_count: the manifest's row count per registered table (data/sources.json); intake_live is a REST source with no SQL count.
  const rows = Object.fromEntries(JSON.parse(readFileSync(join(DATA, "sources.json"), "utf8")).sources.map((x) => [x.table, x.rows]));
  sizes.table_count = write("table_count", TABLES.filter((t) => t in rows && t !== "intake_live").map((t) => entryOf({ table: t }, ["n"], [[String(rows[t])]])).sort(byKey));
  return sizes;
}
const patched = PATCH ? patchExempt() : null;

// ---- what to export ---------------------------------------------------------------------------------------------
const skus = tables.products.map((r) => r.sku);
const customerEmails = tables.customers.map((r) => r.email);
const customerSet = new Set(customerEmails.map((e) => e.toLowerCase()));
const heads = tables.companyhierarchy.filter((r) => r.role.startsWith("Head of ") || r.role === "CEO").map((r) => Number(r.employee_id));
for (const t of threads) want("thread", { thread_id: t.thread_id });
for (const c of CATEGORIES) { want("category", { category: c }); want("trust", { category: c }); }
for (const c of TOPICS) { want("policy", { topic: c }); want("responsibility", { topic: c }); want("trust", { category: c }); }
for (const w of ["refund", "replacement", "leave"]) want("wiki", { wiki: w });
for (const t of TABLES) want("table_count", { table: t });
want("decision_counts", {});
want("contact", { topic: "default" });
want("faq", {}); want("products", {}); want("reviews", {}); want("world_threads", {}); want("holidays", {});
want("product_lookup", {}); want("bulk_tiers", {});
for (const sku of skus) { want("product_price", { sku }); want("product_by_sku", { sku }); want("bom", { sku }); }
want("thread_fingerprints", {});
for (const c of CATEGORIES) want("ledger_adjust", { category: c });
// employees: 1-20, every owner/backup on a thread, every head and the CEO, and the 201-207 block (employees.csv carries those seven rows:
// the CEO, the Legal head and the Legal staff the legal route copies, so their emails are not null in sample mode)
const emps = new Set([...Array.from({ length: 20 }, (_, i) => i + 1), ...Array.from({ length: 7 }, (_, i) => 201 + i), ...heads]);
for (const t of threads) for (const k of ["owner_id", "backup_id"]) if (t[k] !== "" && t[k] != null) emps.add(Number(t[k]));
for (const e of [...emps].sort((a, b) => a - b)) want("employee", { employee_id: e });
// hierarchy: every id the validator allows. 1-207 exist; 208-210 are valid ids with no row, cached as empty answers
// (that is what live returns) so asking about one in sample mode is not an error.
for (let i = 1; i <= 210; i++) want("hierarchy", { employee_id: i });
for (const team of [...new Set(tables.companyhierarchy.map((r) => r.team))].sort()) want("team_head", { team });
for (const ch of INTAKE_CHANNELS) want("channel", { channel: ch });
// shipping_rule: every planet in the rules (incl. `default`) plus 3 planets that are not, which cache the default row
const known = new Set(tables.shipping_rules.map((r) => r.planet.toLowerCase()));
const unknown = ["Jakku", "Hoth", "Endor", "Dagobah", "Mustafar"].filter((p) => !known.has(p.toLowerCase())).slice(0, 3);
for (const planet of [...tables.shipping_rules.map((r) => r.planet), ...unknown]) want("shipping_rule", { planet });
// orders: every order id plus 2 that do not exist
for (const id of [...tables.orders.map((r) => r.order_id), "JP-9998", "JP-9999"]) want("order", { order_id: id });
// customer_by_email: every customers.csv email.
for (const email of customerEmails) want("customer_by_email", { email });
// prior_refunds takes the ticket's own {email, thread_id, received_at} (CP2 passes sender_email, thread_id, received_at).
//  (a) every stored thread whose sender is a customer: its exact params, so a replay of that thread hits an exact entry;
//  (b) for every sender with a refund thread (customers and not) a SENTINEL {thread_id: "F0", received_at: "2099-12-31T23:59:59Z"}:
//      all of that sender's refund threads. A NEW intake (thread F<n>, received now) matches no exact entry; sample.mjs derives its
//      answer from the sentinel by dropping rows at or after its received_at, exactly the filter the SQL applies.
const SENTINEL = { thread_id: "F0", received_at: "2099-12-31T23:59:59Z" };
const lower = (e) => String(e).toLowerCase();
for (const t of threads) if (customerSet.has(lower(t.sender_email))) want("prior_refunds", { email: t.sender_email, thread_id: t.thread_id, received_at: t.received_at });
for (const email of new Set([...customerEmails, ...threads.filter((t) => t.category === "refund").map((t) => t.sender_email)])) want("prior_refunds", { email, ...SENTINEL });

// Record everything factsForTicket asks for, per thread, through a recording runner.
const answer = async (sql, o) => {
  if (!FROM_CSV && !PATCH) return zetaris.sqlRun(sql, o);
  if (!LOCAL_EXEMPT.includes(o.name)) return runLocal(o.name, o.params, tables);
  return queryByName(o.name, o.params, { cfg: { SAMPLE_DIR: OUT } }); // an exempt template: the (patched) cache
};
const rec = async (sql, o) => { want(o.name, o.params); return answer(sql, o); };
const factsErrors = [];
for (const t of threads) {
  try { await factsForTicket(t.thread_id, { cfg, sqlRunImpl: rec }); }
  catch (e) { factsErrors.push(`${t.thread_id} (${t.category}): ${e.name}: ${e.message}`); }
}
for (const t of threads) for (const k of ["owner_id", "backup_id"]) {
  if (t[k] !== "" && t[k] != null) want("holiday", { employee_id: Number(t[k]), date: String(t.received_at).slice(0, 10) });
}

const summary = [];
const skipped = [];
for (const name of Object.keys(TEMPLATES)) {
  if (name === "intake_thread") continue; // runtime rows only, never cached
  if (PATCH && !FROM_CSV) { if (patched[name]) summary.push({ template: name, entries: "patched", bytes: patched[name] }); continue; }
  if (FROM_CSV && LOCAL_EXEMPT.includes(name)) continue; // keeps its existing live-exported (or patched) cache
  const entries = [];
  for (const [key, params] of [...(wanted.get(name) ?? new Map())].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (name === "decision_counts" || name === "ledger_adjust") { entries.push({ params, result: { headers: [], rows: [], total: 0 } }); continue; }
    try {
      const r = FROM_CSV ? runLocal(name, params, tables) : await run(name, params, { cfg, limit: 1000 });
      entries.push({ params, result: { headers: r.headers, rows: r.rows, total: r.total } });
    } catch (e) { skipped.push(name + " " + key + ": " + e.name + ": " + e.message); }
  }
  summary.push({ template: name, entries: entries.length, bytes: write(name, entries) });
}
console.table(summary);
const total = readdirSync(OUT).reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`total bytes: ${total}`);
if (factsErrors.length) console.log("factsForTicket errors (" + factsErrors.length + "):\n  " + factsErrors.join("\n  "));
if (skipped.length) console.log("errors, no entry written (sample mode fails the same way):\n  " + skipped.join("\n  "));
if (total > 1_000_000) { console.error("over 1 MB"); process.exit(1); }

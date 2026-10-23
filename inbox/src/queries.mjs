// Named Zetaris query templates. Every SQL is rendered from a template with whitelisted parameters;
// free text from a customer never reaches SQL. validate() throws TypeError before any network call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, INBOX_ROOT } from "./config.mjs";
import * as zetaris from "./adapters/zetaris.mjs";

export const CATEGORIES = ["refund", "replacement", "question", "complaint", "appreciation"];
export const INTENTS = ["refund.request", "replacement.request", "question", "complaint", "appreciation", "other"];
export const TOPICS = [...CATEGORIES, "billing", "rfq", "customer_service"];
export const TABLES = [
  "employees", "holiday_2026", "responsibility", "policy", "categories", "trust_ledger", "automation_matrix",
  "threads_parquet", "threads_json", "wiki_refund_policy", "wiki_replacement_policy", "wiki_what_may_leave", "escalation_notes",
  "contact_form_submissions", "trustpilot_reviews", "decisions", "intake_live",
  "products", "faq", "intake_runtime",
];
// The Unified Semantic Layer (USL) Zetaris compiles over JEDI_PACK: live views, same facts. Scenario routes and the World Model read it;
// the legacy thread road keeps the raw JEDI_PACK tables.
export const USL = "lightning.metastore.jedi_pack.jedi_pack";
export const TABLES_USL = ["employee", "customer", "ticket", "product", "policy", "responsibility", "faq", "holiday", "intake", "review", "decision", "wiki_page"];
const WIKI_TABLE = { refund: "wiki_refund_policy", replacement: "wiki_replacement_policy", leave: "wiki_what_may_leave" };

const V = {
  thread_id: (v) => typeof v === "string" && /^T\d{1,3}$/.test(v),
  product_id: (v) => typeof v === "string" && /^P\d{2}$/.test(v),
  intake_id: (v) => typeof v === "string" && /^F\d{1,6}$/.test(v),
  employee_id: (v) => (typeof v === "number" || (typeof v === "string" && /^\d{1,3}$/.test(v))) && Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 200,
  category: (v) => CATEGORIES.includes(v),
  topic: (v) => TOPICS.includes(v),
  date: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  intent: (v) => INTENTS.includes(v),
  wiki: (v) => Object.keys(WIKI_TABLE).includes(v),
  table: (v) => TABLES.includes(v),
};

const id = (p) => String(Number(p.employee_id));
const row = (headers, r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]));

// cite(params, objects) -> the row ids a result used
export const TEMPLATES = {
  thread: {
    params: { thread_id: V.thread_id }, cacheable: true, question: "the thread row",
    sql: (p) => `SELECT * FROM JEDI_PACK.threads_parquet WHERE thread_id = '${p.thread_id}'`,
    cite: (p, o) => o.map((x) => `threads_parquet:${x.thread_id}`),
  },
  policy: {
    params: { topic: V.topic }, cacheable: true, question: "the policy limit and owners",
    sql: (p) => `SELECT * FROM JEDI_PACK.policy WHERE topic = '${p.topic}'`,
    cite: (p, o) => o.map((x) => `policy:${x.topic}`),
  },
  responsibility: {
    layer: "usl", params: { topic: V.topic }, cacheable: true, question: "who owns the topic",
    sql: (p) => `SELECT * FROM ${USL}.responsibility WHERE topic = '${p.topic}'`,
    cite: (p, o) => o.map((x) => `responsibility:${x.topic}`),
  },
  employee: {
    params: { employee_id: V.employee_id }, cacheable: true, question: "the employee record",
    sql: (p) => `SELECT * FROM JEDI_PACK.employees WHERE employee_id = ${id(p)}`,
    cite: (p, o) => o.map((x) => `employees:${x.employee_id}`),
  },
  holiday: {
    params: { employee_id: V.employee_id, date: V.date }, cacheable: true, question: "is the employee out on the date",
    sql: (p) => `SELECT * FROM JEDI_PACK.holiday_2026 WHERE employee_id = ${id(p)} AND date = '${p.date}'`,
    cite: (p, o) => o.map((x) => `holiday_2026:${x.employee_id}@${x.date}`),
  },
  category: {
    params: { category: V.category }, cacheable: true, question: "the category label",
    sql: (p) => `SELECT * FROM JEDI_PACK.categories WHERE category = '${p.category}'`,
    cite: (p, o) => o.map((x) => `categories:${x.category}`),
  },
  trust: {
    params: { category: V.category }, cacheable: true, question: "the trust weight and floor",
    sql: (p) => `SELECT * FROM JEDI_PACK.trust_ledger WHERE category = '${p.category}'`,
    cite: (p, o) => o.map((x) => `trust_ledger:${x.category}`),
  },
  wiki: {
    params: { wiki: V.wiki }, cacheable: true, question: "the wiki page",
    sql: (p) => `SELECT type, format, path, preview FROM JEDI_PACK.${WIKI_TABLE[p.wiki]}`,
    cite: (p) => [WIKI_TABLE[p.wiki]],
  },
  table_count: {
    params: { table: V.table }, cacheable: false, question: "the live row count",
    sql: (p) => `SELECT COUNT(*) AS n FROM JEDI_PACK.${p.table}`,
    cite: (p) => [p.table],
  },
  // The duplicate check reads every thread's fingerprint and compares in JS: customer text never reaches SQL.
  thread_fingerprints: {
    params: {}, cacheable: true, question: "every thread's sender, subject, body and time, for the duplicate check",
    sql: () => "SELECT thread_id, sender_email, subject, body, received_at FROM JEDI_PACK.threads_json ORDER BY thread_id",
    cite: () => ["threads_json"],
  },
  // Scenario tables (S0.2): parameterless reads compared in JS, or one validated id. No customer text reaches SQL.
  faq: {
    layer: "usl", params: {}, cacheable: true, question: "every FAQ row, matched in JS",
    sql: () => `SELECT faq_id, question, answer, keywords, faq_source AS source FROM ${USL}.faq ORDER BY faq_id`,
    cite: (p, o) => o.map((x) => `faq:${x.faq_id}`),
  },
  products: {
    layer: "usl", params: {}, cacheable: true, question: "every product and its one unit price",
    sql: () => `SELECT product_id, name, unit_price_usd, currency, min_order_qty, lead_days FROM ${USL}.product ORDER BY product_id`,
    cite: (p, o) => o.map((x) => `products:${x.product_id}`),
  },
  product_price: {
    layer: "usl", params: { product_id: V.product_id }, cacheable: true, question: "the unit price of one product",
    sql: (p) => `SELECT product_id, name, unit_price_usd, currency, min_order_qty, lead_days FROM ${USL}.product WHERE product_id = '${p.product_id}'`,
    cite: (p, o) => o.map((x) => `products:${x.product_id}`),
  },
  reviews: {
    layer: "usl", params: {}, cacheable: true, question: "the public review index",
    sql: () => `SELECT review_id, thread_id, reviewer_name, stars, created_at FROM ${USL}.review ORDER BY review_id`,
    cite: (p, o) => o.map((x) => `trustpilot_reviews:${x.review_id}`),
  },
  world_threads: {
    layer: "usl", params: {}, cacheable: true, minLimit: 1000, question: "every thread's sender, category, owner and outcome, for the world model",
    sql: () => `SELECT thread_id, sender_email, sender_name, category, channel, received_at, owner_id, outcome, subject FROM ${USL}.ticket ORDER BY thread_id`,
    cite: () => ["threads_json"],
  },
  holidays: {
    layer: "usl", params: {}, cacheable: true, minLimit: 2000, question: "every holiday row, filtered by date in JS",
    sql: () => `SELECT employee_id, date FROM ${USL}.holiday`,
    cite: () => ["holiday_2026"],
  },
  intake_thread: {
    layer: "usl", params: { thread_id: V.intake_id }, cacheable: false, question: "one free-text intake row",
    sql: (p) => `SELECT thread_id, received_at, channel, sender_name, sender_email, subject, body, scenario, category FROM ${USL}.intake WHERE thread_id = '${p.thread_id}'`,
    cite: (p, o) => o.map((x) => `intake_runtime:${x.thread_id}`),
  },
  // The trust ledger's feedback: affirm / reject counts for one category, read from the runtime decisions table.
  ledger_adjust: {
    params: { category: V.category }, cacheable: false, question: "the affirm and reject verdicts for the category",
    sql: (p) => `SELECT verdict, COUNT(*) AS n FROM JEDI_PACK.decisions WHERE category = '${p.category}' AND verdict IN ('affirm', 'reject') GROUP BY verdict`,
    cite: () => ["decisions"],
  },
  decision_counts: {
    params: {}, cacheable: false, question: "the decision counters",
    sql: () => "SELECT decision, verdict, COUNT(*) AS n FROM JEDI_PACK.decisions GROUP BY decision, verdict",
    cite: () => ["decisions"],
  },
};

export function validate(name, params = {}) {
  if (typeof name !== "string" || !Object.hasOwn(TEMPLATES, name)) throw new TypeError(`unknown query template: ${JSON.stringify(name)}`);
  const t = TEMPLATES[name];
  if (params === null || typeof params !== "object") throw new TypeError("params must be an object");
  for (const k of Object.keys(params)) if (!Object.hasOwn(t.params, k)) throw new TypeError(`${name}: unexpected parameter ${JSON.stringify(k)}`);
  for (const [k, ok] of Object.entries(t.params)) {
    if (!Object.hasOwn(params, k)) throw new TypeError(`${name}: missing parameter ${k}`);
    if (!ok(params[k])) throw new TypeError(`${name}: parameter ${k} is not allowed`);
  }
  return t;
}

export async function run(name, params = {}, { trace, cfg = config(), limit = 100, sqlRunImpl = zetaris.sqlRun } = {}) {
  const t = validate(name, params);
  const sql = t.sql(params);
  const q = `${t.question} ${JSON.stringify(params)}${t.layer === "usl" ? " via the USL" : ""}`;
  let r;
  try {
    r = await sqlRunImpl(sql, { name, params, limit: Math.max(limit, t.minLimit ?? 0), cfg, trace });
  } catch (e) {
    trace?.line({ step: "zetaris.query", agent_name: "Executor", action: `sql:${name}`, input_summary: q,
      output_summary: `${e.name}: ${e.message}`, status: "error", sponsor: "zetaris" });
    throw e;
  }
  const objects = r.rows.map((x) => row(r.headers, x));
  const cited = t.cite(params, objects);
  trace?.line({ step: "zetaris.query", agent_name: "Executor", action: `sql:${name}`, input_summary: q,
    output_summary: `${r.rows.length} rows: ${cited.join(", ") || "none"}`, status: "success", sponsor: "zetaris" });
  return { name, params, headers: r.headers, rows: r.rows, objects, total: r.total ?? r.rows.length, source: r.source ?? "live" };
}

export async function thread(thread_id, opts = {}) {
  const r = await run("thread", { thread_id }, opts);
  return r.objects[0] ?? null;
}

export async function policyForCategory(category, opts = {}) {
  const [policy, categories, trust] = await Promise.all([
    run("policy", { topic: category }, opts), run("category", { category }, opts), run("trust", { category }, opts)]);
  return { category, policy: policy.objects, categories: categories.objects, trust_ledger: trust.objects,
    rows: [...policy.objects, ...categories.objects, ...trust.objects] };
}

export async function employeeAvailability(employee_id, date, opts = {}) {
  const r = await run("holiday", { employee_id, date }, opts);
  return { employee_id: Number(employee_id), date, out: r.objects.length > 0, rows: r.objects };
}

export async function wikiFor(intent, opts = {}) {
  if (!V.intent(intent)) throw new TypeError(`intent is not allowed: ${JSON.stringify(intent)}`);
  const wiki = intent === "refund.request" ? "refund" : intent === "replacement.request" ? "replacement" : "leave";
  return (await run("wiki", { wiki }, opts)).objects;
}

// the runtime table: registered once, rewritten by src/decisions.mjs, refreshed with UNCACHE after each write
export const decisionsTable = "JEDI_PACK.decisions";

export async function counters(opts = {}) {
  const out = { send: 0, hold: 0, escalate: 0, close: 0, queued: 0, affirmed: 0, rejected: 0 };
  let r;
  try {
    r = await run("decision_counts", {}, { ...opts, trace: undefined });
  } catch (e) {
    // the table is registered in CP4: until then the SELECT fails (HTTP 400 / not found) and the answer is zeros
    // only a positively identified missing table is zeros: Zetaris/Spark says [TABLE_OR_VIEW_NOT_FOUND] ... cannot be found
    // (observed 23 Oct on JEDI_PACK.no_such_table_xyz), or the sample reader has no cached rows. A bare HTTP 400, 500, 401 or timeout surfaces.
    const text = `${e?.message ?? ""} ${e?.detail ?? ""}`;
    const missing = /TABLE_OR_VIEW_NOT_FOUND|table or view not found|table or view .{0,200}cannot be found|does not exist|no such table|no cached rows|ENOENT/i.test(text);
    if (missing) return out;
    throw e;
  }
  for (const o of r.objects) {
    // columns of the runtime decisions table; outcome/ledger_effect are the pre-23-Oct names, still read
    const n = Number(o.n ?? o["count(1)"] ?? o["count(*)"]) || 0;
    const decision = o.decision ?? o.outcome, verdict = o.verdict ?? o.ledger_effect;
    if (decision in out) out[decision] += n;
    if (decision === "escalate") out.queued += n;
    if (verdict === "affirm") out.affirmed += n;
    if (verdict === "reject") out.rejected += n;
  }
  return out;
}

// {affirmed, rejected} for a category, the shape trustFloor's ledgerAdjust takes. No rows yet gives zeros; a failed query throws.
export async function ledgerAdjustFor(category, opts = {}) {
  const r = await run("ledger_adjust", { category }, opts);
  const out = { affirmed: 0, rejected: 0 };
  for (const o of r.objects) {
    const n = Number(o.n ?? o["count(1)"] ?? o["count(*)"]) || 0;
    if (o.verdict === "affirm") out.affirmed += n;
    if (o.verdict === "reject") out.rejected += n;
  }
  return out;
}

// Pure: the earliest earlier thread with the same sender, subject and body, never the ticket itself; null if none.
export function earliestDuplicate(ticket, rows) {
  const key = (t) => [t.sender_email, t.subject, t.body].join("\u0000");
  const mine = key(ticket);
  const at = Date.parse(ticket.received_at);
  const hits = rows.filter((t) => t.thread_id !== ticket.thread_id && key(t) === mine && Date.parse(t.received_at) < at)
    .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  return hits.length ? { thread_id: hits[0].thread_id, received_at: hits[0].received_at } : null;
}

// The duplicate lookup through Zetaris (sample mode: the cached rows). A failed query throws.
export async function findDuplicate(ticket, opts = {}) {
  const r = await run("thread_fingerprints", {}, { limit: 1000, ...opts });
  return earliestDuplicate(ticket, r.objects);
}

export async function sources(opts = {}) {
  const manifest = JSON.parse(readFileSync(opts.manifestPath ?? join(INBOX_ROOT, "data", "sources.json"), "utf8")).sources;
  return Promise.all(manifest.map(async (s) => {
    const base = { name: s.name, format: s.format, table: s.table, rows: s.rows };
    if (!TABLES.includes(s.table)) return { ...base, live: false };
    try {
      const r = await run("table_count", { table: s.table }, opts);
      const n = Number(r.rows[0]?.[0]);
      return Number.isFinite(n) ? { ...base, rows: n, live: true } : { ...base, live: false };
    } catch {
      return { ...base, live: false };
    }
  }));
}

// The wiki "what may leave" page lists what a reply may not include: "A reply may not include a, b, or c."
export function parseRestricted(preview) {
  const m = /may not include\s+([^.]+)\./i.exec(String(preview ?? "").replace(/\s+/g, " "));
  if (!m) return [];
  return m[1].split(/,\s*(?:or\s+)?|\s+or\s+/i).map((s) => s.trim().replace(/^(an?|the)\s+/i, "")).filter(Boolean);
}

// Free-text (F) tickets: the same facts as a thread ticket, with the intake row as the ticket, an explicit topic
// (never a fall-through to "question") and an amount typed in the message. Thread (T) tickets are unchanged.
const todayLondon = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/London" });
const OTHER_WEIGHT = 0.4, DEFAULT_FLOOR = 0.8; // rfq / customer_service / billing have no trust row: the "other" row's weight, the default floor

export async function factsForTicket(thread_id, { as_of, trace, cfg = config(), sqlRunImpl, ticketSource, intakeRow, topic: topicOpt, amount: amountOpt, published } = {}) {
  const o = { trace, cfg, ...(sqlRunImpl ? { sqlRunImpl } : {}) };
  const intake = ticketSource === "intake";
  let ticket, cited;
  if (intake) {
    const pub = published ?? intakeRow?.published === true;
    let live = null;
    if (pub) live = (await run("intake_thread", { thread_id }, o)).objects[0] ?? null;
    ticket = live ?? (intakeRow ? { ...intakeRow } : null);
    if (!ticket) throw new Error(`no intake row ${thread_id}`);
    delete ticket.published;
    cited = [live ? `intake_runtime:${thread_id}` : `intake_runtime:${thread_id} (local)`];
    if (topicOpt) ticket.category = topicOpt;
  } else {
    ticket = await thread(thread_id, o);
    if (!ticket) throw new Error(`no thread ${thread_id}`);
    cited = [`threads_parquet:${thread_id}`];
  }
  let amount = ticket.amount_usd === "" || ticket.amount_usd == null ? null : Number(ticket.amount_usd);
  if (intake && amountOpt != null && Number.isFinite(Number(amountOpt))) { amount = Number(amountOpt); cited.push("amount from the message"); }
  const topic = TOPICS.includes(ticket.category) ? ticket.category : "question";

  const pol = (await run("policy", { topic }, o)).objects[0];
  const resp = (await run("responsibility", { topic }, o)).objects[0];
  let limit = pol ? Number(pol.limit_amount) : null;
  const valid = (n) => Number.isInteger(n) && n >= 1 && n <= 200;
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const notes = [];
  let owner = null, backup = null;
  if (pol) {
    cited.push(`policy:${topic}`);
  } else {
    // a category with no policy row of its own is measured against the refund limit
    const ref = (await run("policy", { topic: "refund" }, o)).objects[0];
    if (ref) { limit = Number(ref.limit_amount); cited.push("policy:refund"); }
  }
  const tOwner = num(ticket.owner_id), tBackup = num(ticket.backup_id);
  if (valid(tOwner) && valid(tBackup)) {
    owner = tOwner; backup = tBackup;
  } else if (pol) {
    const over = amount != null && amount > limit;
    owner = num(over ? pol.over_limit_owner_id : pol.under_limit_owner_id);
    backup = num(over ? pol.over_limit_backup_id : pol.under_limit_backup_id);
  } else if (resp && valid(num(resp.owner_id)) && valid(num(resp.backup_id))) {
    cited.push(`responsibility:${topic}`);
    owner = num(resp.owner_id); backup = num(resp.backup_id);
  } else {
    let gen = null;
    for (const t of ["general", "support"]) {
      const r = (await run("responsibility", { topic: t }, o).catch(() => ({ objects: [] }))).objects[0];
      if (r && valid(num(r.owner_id)) && valid(num(r.backup_id))) { gen = r; cited.push(`responsibility:${t}`); break; }
    }
    if (gen) { owner = num(gen.owner_id); backup = num(gen.backup_id); }
    else {
      const ref = (await run("policy", { topic: "refund" }, o)).objects[0];
      if (ref && valid(num(ref.under_limit_owner_id)) && valid(num(ref.under_limit_backup_id))) {
        owner = num(ref.under_limit_owner_id); backup = num(ref.under_limit_backup_id);
        cited.push("responsibility:fallback");
      }
    }
  }
  if (!valid(owner)) owner = null;
  if (!valid(backup)) backup = null;
  if (owner == null && backup == null) notes.push("owner: none (no responsibility row)");

  const day = as_of ?? (intake ? todayLondon() : String(ticket.received_at).slice(0, 10));
  const none = { out: false };
  let ownerAv, backupAv;
  if (intake) {
    // parameterless holidays read, filtered in JS on the date
    const hol = (await run("holidays", {}, o)).objects.filter((h) => h.date === day);
    const avail = (e) => (e == null ? none : { out: hol.some((h) => Number(h.employee_id) === e) });
    ownerAv = avail(owner); backupAv = avail(backup);
  } else {
    ownerAv = owner == null ? none : await employeeAvailability(owner, day, o);
    backupAv = backup == null ? none : await employeeAvailability(backup, day, o);
  }
  if (owner != null) cited.push(`holiday_2026:${owner}@${day}`);
  if (backup != null) cited.push(`holiday_2026:${backup}@${day}`);
  const emps = await Promise.all([owner, backup].map((e) => (e == null ? { objects: [] } : run("employee", { employee_id: e }, o))));
  for (const e of emps) if (e.objects[0]) cited.push(`employees:${e.objects[0].employee_id}`);
  const name = (e) => (e.objects[0] ? `${e.objects[0].given_name} ${e.objects[0].family_name}` : null);

  let weight = intake ? OTHER_WEIGHT : 0, floor = intake ? DEFAULT_FLOOR : 0.8;
  if (CATEGORIES.includes(ticket.category)) {
    const led = (await run("trust", { category: ticket.category }, o)).objects[0];
    if (led) { weight = Number(led.weight); floor = Number(led.floor); cited.push(`trust_ledger:${ticket.category}`); }
  }

  let restricted = [];
  let disclosure_unknown = false;
  try {
    const w = (await run("wiki", { wiki: "leave" }, o)).objects[0];
    restricted = parseRestricted(w?.preview);
    if (restricted.length) cited.push("wiki_what_may_leave");
  } catch { restricted = []; disclosure_unknown = true; } // run() already traced the error line

  return {
    thread_id, category: ticket.category, amount_usd: amount, policy_limit_usd: limit,
    category_weight: weight, floor, owner_id: owner, backup_id: backup, owner_name: name(emps[0]), backup_name: name(emps[1]),
    owner_out: ownerAv.out, backup_out: backupAv.out, // a free-text ticket carries no authored may_leave flag; Risk guards the draft through restricted terms and the amount limit, so a false flag would hard-refuse every FAQ send
    may_leave: intake || ticket.may_leave === true || ticket.may_leave === "true",
    restricted_terms: restricted, disclosure_unknown, cited_rows: cited, notes, received_at: ticket.received_at, as_of: day,
    subject: ticket.subject, body: ticket.body, sender_name: ticket.sender_name, sender_email: ticket.sender_email,
    channel: ticket.channel, follow_up_kind: ticket.follow_up_kind || null, follow_up_body: ticket.follow_up_body || null,
    parent_thread_id: ticket.parent_thread_id || null, ticket,
  };
}

// Named Zetaris query templates. Every SQL is rendered from a template with whitelisted parameters;
// free text from a customer never reaches SQL. validate() throws TypeError before any network call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, INBOX_ROOT } from "./config.mjs";
import * as zetaris from "./adapters/zetaris.mjs";
import { readIntake } from "./intake.mjs";

export const CATEGORIES = ["refund", "replacement", "question", "complaint", "appreciation", "other"];
export const INTENTS = ["refund.request", "replacement.request", "question", "complaint", "appreciation", "other"];
// delivery, legal and product have responsibility and trust rows (CP1 seeds) but no policy row; billing/rfq/customer_service as before
export const TOPICS = [...CATEGORIES, "billing", "rfq", "customer_service", "delivery", "legal", "product"];
export const TABLES = [
  "employees", "holiday_2026", "responsibility", "policy", "categories", "trust_ledger", "automation_matrix",
  "threads_parquet", "threads_json", "wiki_refund_policy", "wiki_replacement_policy", "wiki_what_may_leave", "escalation_notes",
  "contact_form_submissions", "trustpilot_reviews", "decisions", "intake_live",
  "products", "faq", "intake_runtime", "contacts",
  "companyhierarchy", "customers", "orders", "shipping_rules", "bulk_pricing", "bom", "channels",
];
// The Unified Semantic Layer (USL) Zetaris compiles over JEDI_PACK: live views, same facts. Scenario routes and the World Model read it;
// the legacy thread road keeps the raw JEDI_PACK tables.
export const USL = "lightning.metastore.jedi_pack.jedi_pack";
export const TABLES_USL = ["employee", "customer", "ticket", "product", "policy", "responsibility", "faq", "holiday", "intake", "review", "decision", "wiki_page",
  "hierarchy", "client", "sales_order", "shipping_rule", "bulk_tier", "bom_part", "channel"];
const WIKI_TABLE = { refund: "wiki_refund_policy", replacement: "wiki_replacement_policy", leave: "wiki_what_may_leave" };

// The server's CHANNELS list, mirrored (server.mjs imports this module, so importing it back would be circular).
// tests/queries.test.mjs pins the two lists equal.
export const INTAKE_CHANNELS = ["email", "contact-form", "chat", "trustpilot"];
// intake.mjs's EMAIL pattern is not exported; this is the same shape, minus quote, backslash and % characters because an email reaches SQL here.
const SQL_SAFE_EMAIL = /^[^\s@,;<>'"\\`%]+@[^\s@,;<>'"\\`%]+\.[^\s@,;<>'"\\`%]+$/;

const V = {
  thread_id: (v) => typeof v === "string" && /^T\d{1,3}$/.test(v),
  // the ticket being read: a stored thread (T) or a free-text intake row (F)
  any_thread_id: (v) => typeof v === "string" && /^(T\d{1,3}|F\d{1,6})$/.test(v),
  sku: (v) => typeof v === "string" && /^FS-[A-Z]\d{2}$/.test(v),
  intake_id: (v) => typeof v === "string" && /^F\d{1,6}$/.test(v),
  employee_id: (v) => (typeof v === "number" || (typeof v === "string" && /^\d{1,3}$/.test(v))) && Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 210,
  order_id: (v) => typeof v === "string" && /^JP-\d{4}$/.test(v),
  // the plan's pattern without the apostrophe: a planet name is interpolated into SQL
  planet: (v) => typeof v === "string" && /^[A-Za-z][A-Za-z -]{1,40}$/.test(v),
  team: (v) => typeof v === "string" && /^[A-Za-z][A-Za-z -]{1,40}$/.test(v),
  email: (v) => typeof v === "string" && v.length <= 200 && SQL_SAFE_EMAIL.test(v),
  channel: (v) => INTAKE_CHANNELS.includes(v),
  received_at: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z?$/.test(v),
  category: (v) => CATEGORIES.includes(v),
  topic: (v) => TOPICS.includes(v),
  contact_topic: (v) => v === "default" || TOPICS.includes(v),
  date: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  intent: (v) => INTENTS.includes(v),
  wiki: (v) => Object.keys(WIKI_TABLE).includes(v),
  table: (v) => TABLES.includes(v),
};

const id = (p) => String(Number(p.employee_id));
const row = (headers, r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]));

// ---- offline twins -------------------------------------------------------------------------------------------
// A template's local(tables, params) answers from the CSV/JSON files and returns the SAME {headers, rows, total} the live
// sql would, in the representation Zetaris's REST API gives: every value a string, NULL as null. That is:
//   raw table columns   -> the cell text as is ("150.00"), an empty CSV cell is null
//   USL view columns    -> as the view casts them: int "15", double "189.0" (Java's Double.toString), varchar as is
// TYPES below are the view column types this module assumes (register_usl.mjs owns the DDL; usl_drift compares the two live).
const nul = (v) => (v === undefined || v === null || v === "" ? null : v);
const CAST = {
  str: (v) => (nul(v) === null ? null : String(v)),
  int: (v) => { if (nul(v) === null) return null; const n = Number(v); return Number.isFinite(n) ? String(Math.trunc(n)) : null; },
  dbl: (v) => { if (nul(v) === null) return null; const n = Number(v); return !Number.isFinite(n) ? null : Number.isInteger(n) ? n.toFixed(1) : String(n); },
};
// spec: [outName, type, srcName = outName][]
const proj = (rows, spec) => ({ headers: spec.map((s) => s[0]), rows: rows.map((r) => spec.map(([o, t, src]) => CAST[t](r[src ?? o]))), total: rows.length });
const byCol = (col) => (a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0);
const need = (tables, name) => { if (!Array.isArray(tables?.[name])) throw new Error(`local: table ${name} not loaded`); return tables[name]; };

const RAW_EMPLOYEE = [["employee_id", "str"], ["given_name", "str"], ["family_name", "str"], ["email", "str"], ["team", "str"], ["role", "str"], ["trust_weight_seed", "str"]];
const RAW_POLICY = ["topic", "limit_amount", "currency", "under_limit_owner_id", "under_limit_backup_id", "over_limit_owner_id", "over_limit_backup_id"].map((c) => [c, "str"]);
const PRODUCT_COLS = [["sku", "str"], ["name", "str"], ["unit_price", "dbl"], ["currency", "str"], ["min_order_qty", "int"], ["lead_days", "int"],
  ["material", "str"], ["specs", "str"], ["show_in_store", "str"], ["aliases", "str"]];
const PRODUCT_FULL = [["sku", "str"], ["slug", "str"], ["name", "str"], ["category", "str"], ["unit_price", "dbl"], ["currency", "str"], ["stock", "str"],
  ["min_order_qty", "int"], ["lead_days", "int"], ["show_in_store", "str"], ["image", "str"], ["model", "str"], ["aliases", "str"], ["material", "str"], ["specs", "str"], ["description", "str"]];
const HIER_COLS = [["employee_id", "int"], ["name", "str"], ["role", "str"], ["team", "str"], ["team_label", "str"]];
const CUSTOMER_COLS = [["customer_id", "str"], ["name", "str"], ["callsign", "str"], ["email", "str"], ["home_planet", "str"], ["since", "str"], ["seeded_prior_refund", "str"], ["fictional", "str"]];
const ORDER_COLS = [["order_id", "str"], ["customer_id", "str"], ["sku", "str"], ["quantity", "int"], ["amount", "dbl"], ["currency", "str"], ["shipping_planet", "str"], ["status", "str"], ["ordered_at", "str"]];
const ts = (s) => Date.parse(s);

// cite(params, objects) -> the row ids a result used
// detail(params, objects) -> the rows in words, for the trace line (optional; a person reads it, nothing parses it)
// local(tables, params) -> the same {headers, rows, total} from the CSV/JSON files (absent: the template reads Parquet, Markdown, XML or a runtime table)
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
    detail: (p, o) => o.map((x) => `limit ${x.limit_amount} ${x.currency} · under: owner ${x.under_limit_owner_id}, backup ${x.under_limit_backup_id} · over: owner ${x.over_limit_owner_id}, backup ${x.over_limit_backup_id}`).join("; "),
    local: (t, p) => proj(need(t, "policy").filter((r) => r.topic === p.topic), RAW_POLICY),
  },
  responsibility: {
    layer: "usl", params: { topic: V.topic }, cacheable: true, question: "who owns the topic",
    sql: (p) => `SELECT topic, owner_id, backup_id, label FROM ${USL}.responsibility WHERE topic = '${p.topic}'`,
    cite: (p, o) => o.map((x) => `responsibility:${x.topic}`),
    detail: (p, o) => o.map((x) => `owner ${x.owner_id}, backup ${x.backup_id}`).join("; "),
    local: (t, p) => proj(need(t, "responsibility").filter((r) => r.topic === p.topic), [["topic", "str"], ["owner_id", "int"], ["backup_id", "int"], ["label", "str"]]),
  },
  employee: {
    params: { employee_id: V.employee_id }, cacheable: true, question: "the employee record",
    sql: (p) => `SELECT * FROM JEDI_PACK.employees WHERE employee_id = ${id(p)}`,
    cite: (p, o) => o.map((x) => `employees:${x.employee_id}`),
    detail: (p, o) => o.map((x) => [`${x.given_name} ${x.family_name}`, x.role, x.team].filter(Boolean).join(" · ")).join("; "),
    local: (t, p) => proj(need(t, "employees").filter((r) => Number(r.employee_id) === Number(p.employee_id)), RAW_EMPLOYEE),
  },
  // A row with a BLANK employee_id is a company-wide day (P15): it matches every employee, and cites as holiday_2026:company@<date>.
  holiday: {
    params: { employee_id: V.employee_id, date: V.date }, cacheable: true, question: "is the employee out on the date",
    sql: (p) => `SELECT * FROM JEDI_PACK.holiday_2026 WHERE (employee_id = ${id(p)} OR employee_id IS NULL OR employee_id = '') AND date = '${p.date}'`,
    cite: (p, o) => o.map((x) => `holiday_2026:${nul(x.employee_id) ?? "company"}@${x.date}`),
    local: (t, p) => proj(need(t, "holiday_2026").filter((r) => (r.employee_id === "" || Number(r.employee_id) === Number(p.employee_id)) && r.date === p.date),
      [["employee_id", "str"], ["date", "str"], ["kind", "str"], ["holiday_name", "str"]]),
  },
  // The default contact desk: a raw table (no USL view), read only when nobody on the owner chain is in.
  contact: {
    params: { topic: V.contact_topic }, cacheable: true, question: "the contact desk for the topic",
    sql: (p) => `SELECT * FROM JEDI_PACK.contacts WHERE topic = '${p.topic}'`,
    cite: (p, o) => o.map((x) => `contacts:${x.topic}`),
    detail: (p, o) => o.map((x) => `${x.label} \u00b7 ${x.email}`).join("; "),
    local: (t, p) => proj(need(t, "contacts").filter((r) => r.topic === p.topic), [["topic", "str"], ["email", "str"], ["label", "str"]]),
  },
  category: {
    params: { category: V.category }, cacheable: true, question: "the category label",
    sql: (p) => `SELECT * FROM JEDI_PACK.categories WHERE category = '${p.category}'`,
    cite: (p, o) => o.map((x) => `categories:${x.category}`),
    local: (t, p) => proj(need(t, "categories").filter((r) => r.category === p.category), [["category", "str"], ["label", "str"]]),
  },
  // one trust row per topic (the ledger has all twelve): the param is still called category
  trust: {
    params: { category: V.topic }, cacheable: true, question: "the trust weight and floor",
    sql: (p) => `SELECT * FROM JEDI_PACK.trust_ledger WHERE category = '${p.category}'`,
    cite: (p, o) => o.map((x) => `trust_ledger:${x.category}`),
    local: (t, p) => proj(need(t, "trust_ledger").filter((r) => r.category === p.category), [["category", "str"], ["weight", "str"], ["floor", "str"], ["source_id", "str"]]),
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
    local: (t) => proj([...need(t, "threads_json")].sort(byCol("thread_id")), ["thread_id", "sender_email", "subject", "body", "received_at"].map((c) => [c, "str"])),
  },
  // Scenario tables (S0.2): parameterless reads compared in JS, or one validated id. No customer text reaches SQL.
  faq: {
    layer: "usl", params: {}, cacheable: true, question: "every FAQ row, matched in JS",
    sql: () => `SELECT faq_id, question, answer, keywords, faq_source AS source FROM ${USL}.faq ORDER BY faq_id`,
    cite: (p, o) => o.map((x) => `faq:${x.faq_id}`),
    local: (t) => proj([...need(t, "faq")].sort(byCol("faq_id")), ["faq_id", "question", "answer", "keywords", "source"].map((c) => [c, "str"])),
  },
  products: {
    layer: "usl", params: {}, cacheable: true, question: "every product, its one unit price, material and specs",
    sql: () => `SELECT sku, name, unit_price, currency, min_order_qty, lead_days, material, specs, show_in_store, aliases FROM ${USL}.product ORDER BY sku`,
    cite: (p, o) => o.map((x) => `products:${x.sku}`),
    local: (t) => proj([...need(t, "products")].sort(byCol("sku")), PRODUCT_COLS),
  },
  product_price: {
    layer: "usl", params: { sku: V.sku }, cacheable: true, question: "the unit price of one product",
    sql: (p) => `SELECT sku, name, unit_price, currency, min_order_qty, lead_days, material, specs, show_in_store, aliases FROM ${USL}.product WHERE sku = '${p.sku}'`,
    cite: (p, o) => o.map((x) => `products:${x.sku}`),
    local: (t, p) => proj(need(t, "products").filter((r) => r.sku === p.sku), PRODUCT_COLS),
  },
  // every sku with its name and aliases: the catalogue a message is matched against in JS (matchProducts)
  product_lookup: {
    layer: "usl", params: {}, cacheable: true, question: "every sku with its name and aliases, matched in JS",
    sql: () => `SELECT sku, name, aliases FROM ${USL}.product ORDER BY sku`,
    cite: (p, o) => o.map((x) => `products:${x.sku}`),
    local: (t) => proj([...need(t, "products")].sort(byCol("sku")), [["sku", "str"], ["name", "str"], ["aliases", "str"]]),
  },
  product_by_sku: {
    layer: "usl", params: { sku: V.sku }, cacheable: true, question: "the full product row",
    sql: (p) => `SELECT sku, slug, name, category, unit_price, currency, stock, min_order_qty, lead_days, show_in_store, image, model, aliases, material, specs, description FROM ${USL}.product WHERE sku = '${p.sku}'`,
    cite: (p, o) => o.map((x) => `products:${x.sku}`),
    local: (t, p) => proj(need(t, "products").filter((r) => r.sku === p.sku), PRODUCT_FULL),
  },
  // the employee and the manager, one row (the CEO is their own manager)
  hierarchy: {
    layer: "usl", params: { employee_id: V.employee_id }, cacheable: true, question: "the employee's place in the hierarchy and their manager",
    sql: (p) => `SELECT h.employee_id, h.name, h.role, h.team, h.team_label, h.manager_id, m.name AS manager_name, m.role AS manager_role FROM ${USL}.hierarchy h LEFT JOIN ${USL}.hierarchy m ON m.employee_id = h.manager_id WHERE h.employee_id = ${id(p)}`,
    cite: (p, o) => o.map((x) => `companyhierarchy:${x.employee_id}`),
    detail: (p, o) => o.map((x) => `${x.name} · ${x.role} · ${x.team}; manager ${x.manager_id} ${x.manager_name ?? ""}`.trim()).join("; "),
    local: (t, p) => {
      const h = need(t, "companyhierarchy");
      const rows = h.filter((r) => Number(r.employee_id) === Number(p.employee_id)).map((r) => {
        const m = h.find((x) => Number(x.employee_id) === Number(r.manager_id));
        return [CAST.int(r.employee_id), CAST.str(r.name), CAST.str(r.role), CAST.str(r.team), CAST.str(r.team_label), CAST.int(r.manager_id), CAST.str(m?.name), CAST.str(m?.role)];
      });
      return { headers: ["employee_id", "name", "role", "team", "team_label", "manager_id", "manager_name", "manager_role"], rows, total: rows.length };
    },
  },
  // the team's head: the row whose role is "Head of ..." in that team (CP1 seeds one per team; the CEO's team has none)
  team_head: {
    layer: "usl", params: { team: V.team }, cacheable: true, question: "the head of the team",
    sql: (p) => `SELECT employee_id, name, role, team, team_label FROM ${USL}.hierarchy WHERE team = '${p.team}' AND role LIKE 'Head of %' ORDER BY employee_id`,
    cite: (p, o) => o.map((x) => `companyhierarchy:${x.employee_id}`),
    local: (t, p) => proj(need(t, "companyhierarchy").filter((r) => r.team === p.team && r.role.startsWith("Head of ")).sort((a, b) => Number(a.employee_id) - Number(b.employee_id)), HIER_COLS),
  },
  customer_by_email: {
    layer: "usl", params: { email: V.email }, cacheable: true, question: "the client with this email",
    sql: (p) => `SELECT customer_id, name, callsign, email, home_planet, since, seeded_prior_refund, fictional FROM ${USL}.client WHERE LOWER(email) = '${p.email.toLowerCase()}' ORDER BY customer_id`,
    cite: (p, o) => o.map((x) => `customers:${x.customer_id}`),
    local: (t, p) => proj(need(t, "customers").filter((r) => r.email.toLowerCase() === p.email.toLowerCase()).sort(byCol("customer_id")), CUSTOMER_COLS),
  },
  // Earlier refund tickets from the same sender: category refund, same sender_email (case-insensitive), a DIFFERENT thread, received STRICTLY BEFORE this one.
  // One row per earlier ticket (count = rows, ids = thread_id), oldest first; `src` says which table (threads_json | intake_runtime) for the cite.
  // local() reads threads.json only: the runtime intake rows exist only live.
  prior_refunds: {
    layer: "usl", params: { email: V.email, thread_id: V.any_thread_id, received_at: V.received_at }, cacheable: true, question: "the sender's earlier refund tickets",
    sql: (p) => {
      const e = p.email.toLowerCase();
      const tail = `LOWER(sender_email) = '${e}' AND thread_id <> '${p.thread_id}' AND CAST(received_at AS timestamp) < CAST('${p.received_at}' AS timestamp)`;
      return `SELECT thread_id, received_at, src FROM (SELECT thread_id, received_at, 'threads_json' AS src FROM JEDI_PACK.threads_json WHERE category = 'refund' AND ${tail} `
        + `UNION ALL SELECT thread_id, received_at, 'intake_runtime' AS src FROM ${USL}.intake WHERE (category = 'refund' OR scenario = 'refund') AND ${tail}) u `
        + "ORDER BY CAST(received_at AS timestamp), thread_id";
    },
    cite: (p, o) => o.map((x) => `${x.src ?? "threads_json"}:${x.thread_id}`),
    local: (t, p) => {
      const rows = need(t, "threads_json")
        .filter((r) => r.category === "refund" && String(r.sender_email ?? "").toLowerCase() === p.email.toLowerCase() && r.thread_id !== p.thread_id && ts(r.received_at) < ts(p.received_at))
        .sort((a, b) => ts(a.received_at) - ts(b.received_at) || (a.thread_id < b.thread_id ? -1 : 1));
      return { headers: ["thread_id", "received_at", "src"], rows: rows.map((r) => [String(r.thread_id), String(r.received_at), "threads_json"]), total: rows.length };
    },
  },
  order: {
    layer: "usl", params: { order_id: V.order_id }, cacheable: true, question: "the order",
    sql: (p) => `SELECT order_id, customer_id, sku, quantity, amount, currency, shipping_planet, status, ordered_at FROM ${USL}.sales_order WHERE order_id = '${p.order_id}'`,
    cite: (p, o) => o.map((x) => `orders:${x.order_id}`),
    local: (t, p) => proj(need(t, "orders").filter((r) => r.order_id === p.order_id), ORDER_COLS),
  },
  // the planet's rule, else the `default` row
  shipping_rule: {
    layer: "usl", params: { planet: V.planet }, cacheable: true, question: "the shipping rule for the planet (the default row when none)",
    sql: (p) => {
      const pl = p.planet.toLowerCase();
      return `SELECT planet, status, note FROM ${USL}.shipping_rule WHERE LOWER(planet) = '${pl}' `
        + `UNION ALL SELECT planet, status, note FROM ${USL}.shipping_rule WHERE planet = 'default' AND NOT EXISTS (SELECT 1 FROM ${USL}.shipping_rule WHERE LOWER(planet) = '${pl}')`;
    },
    cite: (p, o) => o.map((x) => `shipping_rules:${x.planet}`),
    local: (t, p) => {
      const all = need(t, "shipping_rules");
      let hit = all.filter((r) => r.planet.toLowerCase() === p.planet.toLowerCase());
      if (!hit.length) hit = all.filter((r) => r.planet === "default");
      return proj(hit, [["planet", "str"], ["status", "str"], ["note", "str"]]);
    },
  },
  bulk_tiers: {
    layer: "usl", params: {}, cacheable: true, question: "the bulk price tiers",
    sql: () => `SELECT tier, min_qty, max_qty, discount_pct FROM ${USL}.bulk_tier ORDER BY min_qty`,
    cite: (p, o) => o.map((x) => `bulk_pricing:${x.tier}`),
    local: (t) => proj([...need(t, "bulk_pricing")].sort((a, b) => Number(a.min_qty) - Number(b.min_qty)), [["tier", "str"], ["min_qty", "int"], ["max_qty", "int"], ["discount_pct", "dbl"]]),
  },
  bom: {
    layer: "usl", params: { sku: V.sku }, cacheable: true, question: "the parts of the product and their stock",
    sql: (p) => `SELECT sku, part_id, part_name, qty_per_unit, stock FROM ${USL}.bom_part WHERE sku = '${p.sku}' ORDER BY part_id`,
    cite: (p, o) => o.map((x) => `bom:${x.sku}:${x.part_id}`),
    local: (t, p) => proj(need(t, "bom").filter((r) => r.sku === p.sku).sort(byCol("part_id")), [["sku", "str"], ["part_id", "str"], ["part_name", "str"], ["qty_per_unit", "int"], ["stock", "int"]]),
  },
  channel: {
    layer: "usl", params: { channel: V.channel }, cacheable: true, question: "the channel's rules",
    sql: (p) => `SELECT channel, public, autonomous_reply, intake_address, label FROM ${USL}.channel WHERE channel = '${p.channel}'`,
    cite: (p, o) => o.map((x) => `channels:${x.channel}`),
    local: (t, p) => proj(need(t, "channels").filter((r) => r.channel === p.channel), ["channel", "public", "autonomous_reply", "intake_address", "label"].map((c) => [c, "str"])),
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
  // Every holiday row; a blank employee_id (a company-wide day) comes back null.
  holidays: {
    layer: "usl", params: {}, cacheable: true, minLimit: 2000, question: "every holiday row, filtered by date in JS",
    sql: () => `SELECT employee_id, date FROM ${USL}.holiday`,
    cite: () => ["holiday_2026"],
    local: (t) => proj(need(t, "holiday_2026"), [["employee_id", "int"], ["date", "str"]]),
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

// Templates with NO local(): they read Parquet, Markdown previews, XML, the runtime tables or the USL review/ticket views, so their
// caches stay live-exported. Pinned by tests/local_templates.test.mjs.
export const LOCAL_EXEMPT = ["thread", "wiki", "table_count", "reviews", "world_threads", "intake_thread", "ledger_adjust", "decision_counts"];

// Run a template's offline twin: validate the params exactly as run() does, then answer from `tables` (loadTables(dir) in csv.mjs).
// Returns {headers, rows, total}, the shape the sample cache stores. Throws TypeError for an exempt template.
export function runLocal(name, params = {}, tables) {
  const t = validate(name, params);
  if (typeof t.local !== "function") throw new TypeError(`${name}: no local twin (reads Parquet, Markdown, XML or a runtime table)`);
  return t.local(tables, params);
}

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

// why: the caller's reason for the read, in words; it lands in the trace line's input_summary ("owner for refund: under the refund limit 150 (policy:refund)")
export async function run(name, params = {}, { trace, cfg = config(), limit = 100, sqlRunImpl = zetaris.sqlRun, why } = {}) {
  const t = validate(name, params);
  const sql = t.sql(params);
  const q = `${t.question} ${JSON.stringify(params)}${why ? ` · ${why}` : ""}${t.layer === "usl" ? " via the USL" : ""}`;
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
  const detail = t.detail ? t.detail(params, objects) : "";
  trace?.line({ step: "zetaris.query", agent_name: "Executor", action: `sql:${name}`, input_summary: q,
    output_summary: `${r.rows.length} rows: ${cited.join(", ") || "none"}`, status: "success", sponsor: "zetaris", ...(detail ? { detail } : {}) });
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

// Pure (P13/H13): the earliest earlier free-text intake row with the same sender_email and the same body (case and spacing aside) within 7 days;
// the subject is not compared, because a free-text subject is derived from the body. An empty sender never matches.
const DUP_WINDOW_MS = 7 * 24 * 3600 * 1000;
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const fnum = (id) => { const m = /^F(\d+)$/.exec(String(id)); return m ? Number(m[1]) : Infinity; };
export function earliestIntakeDuplicate(ticket, rows) {
  const mail = norm(ticket.sender_email), body = norm(ticket.body);
  const at = Date.parse(ticket.received_at);
  if (!mail || !body || Number.isNaN(at)) return null;
  const hits = (rows ?? []).filter((t) => {
    if (t.thread_id === ticket.thread_id || norm(t.sender_email) !== mail || norm(t.body) !== body) return false;
    const ta = Date.parse(t.received_at);
    if (Number.isNaN(ta) || at - ta > DUP_WINDOW_MS) return false;
    return ta < at || (ta === at && fnum(t.thread_id) < fnum(ticket.thread_id));
  }).sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at) || fnum(a.thread_id) - fnum(b.thread_id));
  return hits.length ? { thread_id: hits[0].thread_id, received_at: hits[0].received_at } : null;
}

// The duplicate lookup: the thread fingerprints through Zetaris (sample mode: the cached rows), then the runtime intake rows (opts.runtimeDir,
// default data/runtime), which are never in the fingerprints on a cold start. A failed query throws.
export async function findDuplicate(ticket, opts = {}) {
  const r = await run("thread_fingerprints", {}, { limit: 1000, ...opts });
  const hit = earliestDuplicate(ticket, r.objects);
  if (hit) return hit;
  let intake = [];
  try { intake = readIntake(opts.runtimeDir ? { runtimeDir: opts.runtimeDir } : {}); } catch { /* an unreadable local file is no duplicate evidence */ }
  return earliestIntakeDuplicate(ticket, intake);
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

export async function factsForTicket(thread_id, { as_of, trace, cfg = config(), sqlRunImpl, ticketSource, intakeRow, topic: topicOpt, amount: amountOpt, published, needs } = {}) {
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
  let amount = ticket.amount === "" || ticket.amount == null ? null : Number(ticket.amount);
  if (intake && amountOpt != null && Number.isFinite(Number(amountOpt))) { amount = Number(amountOpt); cited.push("amount from the message"); }
  const topic = TOPICS.includes(ticket.category) ? ticket.category : "question";

  const valid = (n) => Number.isInteger(n) && n >= 1 && n <= 210; // 201-207 are the CEO and Legal (CP1); the bound matches V.employee_id
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const scoped = Array.isArray(needs);
  const wantLimit = scoped && needs.includes("limit");
  const notes = [];
  let owner = null, backup = null, how = "", limit = null;
  let respSeen; // undefined until the responsibility row is read; then the row or null
  if (scoped) {
    // Scoped gather: only the facts the scenario declared. No policy read unless it needs the limit; no general/support or refund-policy fallback.
    const tOwner = num(ticket.owner_id), tBackup = num(ticket.backup_id);
    const pol = wantLimit ? (await run("policy", { topic }, o)).objects[0] : undefined;
    if (pol) { limit = Number(pol.limit_amount); cited.push(`policy:${topic}`); }
    if (valid(tOwner) && valid(tBackup)) {
      owner = tOwner; backup = tBackup; how = "named on the ticket";
    } else if (pol && valid(num(pol.under_limit_owner_id))) {
      const over = amount != null && amount > limit;
      owner = num(over ? pol.over_limit_owner_id : pol.under_limit_owner_id);
      backup = num(over ? pol.over_limit_backup_id : pol.under_limit_backup_id);
      how = `${over ? "over" : "under"} the ${topic} limit ${limit} (policy:${topic})`;
    } else {
      const resp = (await run("responsibility", { topic }, o)).objects[0];
      respSeen = resp ?? null;
      if (resp && valid(num(resp.owner_id)) && valid(num(resp.backup_id))) {
        cited.push(`responsibility:${topic}`);
        owner = num(resp.owner_id); backup = num(resp.backup_id); how = `responsibility:${topic}`;
      }
    }
  } else {
    const pol = (await run("policy", { topic }, o)).objects[0];
    const resp = (await run("responsibility", { topic }, o)).objects[0];
    respSeen = resp ?? null;
    limit = pol ? Number(pol.limit_amount) : null;
    if (pol) {
      cited.push(`policy:${topic}`);
    } else {
      // a category with no policy row of its own is measured against the refund limit
      const ref = (await run("policy", { topic: "refund" }, o)).objects[0];
      if (ref) { limit = Number(ref.limit_amount); cited.push("policy:refund"); }
    }
    const tOwner = num(ticket.owner_id), tBackup = num(ticket.backup_id);
    if (valid(tOwner) && valid(tBackup)) {
      owner = tOwner; backup = tBackup; how = "named on the ticket";
    } else if (pol) {
      const over = amount != null && amount > limit;
      owner = num(over ? pol.over_limit_owner_id : pol.under_limit_owner_id);
      backup = num(over ? pol.over_limit_backup_id : pol.under_limit_backup_id);
      how = `${over ? "over" : "under"} the ${topic} limit ${limit} (policy:${topic})`;
    } else if (resp && valid(num(resp.owner_id)) && valid(num(resp.backup_id))) {
      cited.push(`responsibility:${topic}`);
      owner = num(resp.owner_id); backup = num(resp.backup_id); how = `responsibility:${topic}`;
    } else {
      let gen = null;
      for (const t of ["general", "support"]) {
        const r = (await run("responsibility", { topic: t }, o).catch(() => ({ objects: [] }))).objects[0];
        if (r && valid(num(r.owner_id)) && valid(num(r.backup_id))) { gen = r; cited.push(`responsibility:${t}`); how = `responsibility:${t} (no row for ${topic})`; break; }
      }
      if (gen) { owner = num(gen.owner_id); backup = num(gen.backup_id); }
      else {
        const ref = (await run("policy", { topic: "refund" }, o)).objects[0];
        if (ref && valid(num(ref.under_limit_owner_id)) && valid(num(ref.under_limit_backup_id))) {
          owner = num(ref.under_limit_owner_id); backup = num(ref.under_limit_backup_id);
          cited.push("responsibility:fallback"); how = `the refund policy's under-limit owners (no row for ${topic})`;
        }
      }
    }
  }
  // hierarchy rows read so far, by employee id: the Sales head, their manager, then whoever holds or backs the ticket
  const hier = new Map();
  const readHier = async (eid, why) => {
    if (!valid(eid)) return null;
    if (hier.has(eid)) return hier.get(eid);
    const r = (await run("hierarchy", { employee_id: eid }, { ...o, why })).objects[0] ?? null;
    hier.set(eid, r);
    if (r) cited.push(`companyhierarchy:${r.employee_id}`);
    return r;
  };
  // Over the limit the approver is the Sales head and the backup is the head's manager (the CEO), read from the hierarchy (companyhierarchy.csv).
  // The policy row's over-limit ids are still read and must agree; a ticket that names its own owners keeps them (a note says when they differ).
  const isOver = limit != null && amount != null && amount > limit;
  if (isOver && (how.startsWith("over") || how === "named on the ticket")) {
    const head = (await run("team_head", { team: "Sales" }, { ...o, why: `${topic} amount ${amount} is over the limit ${limit}: the Sales head approves` })).objects[0];
    const hid = head ? num(head.employee_id) : NaN;
    const hrow = valid(hid) ? await readHier(hid, `Sales head ${hid}: who approves and who they report to`) : null;
    const mid = hrow ? num(hrow.manager_id) : NaN;
    if (hrow && valid(mid)) {
      const named = how === "named on the ticket";
      if (!(owner === hid && backup === mid)) notes.push(`${named ? "the ticket's" : "the policy's over-limit"} owners ${owner}/${backup} disagree with the hierarchy (Sales head ${hid}, manager ${mid})${named ? "; the ticket's ids stand" : "; the hierarchy wins"}`);
      if (!named) {
        owner = hid; backup = mid;
        how = `over the ${topic} limit ${limit}: ${hrow.role} per companyhierarchy:${hid}, backup their manager ${mid}`;
      }
      await readHier(mid, `backup ${mid}: the Sales head's manager`);
    } else notes.push("hierarchy: no Sales head row, the policy's over-limit owners stand");
  }
  if (!valid(owner)) owner = null;
  if (!valid(backup)) backup = null;
  if (owner == null && backup == null) notes.push("owner: none (no responsibility row)");

  const day = as_of ?? (intake ? todayLondon() : String(ticket.received_at).slice(0, 10));
  const none = { out: false };
  let ownerAv, backupAv, emps;
  const nobodyIn = () => ownerAv.out && (backup == null || backupAv.out);
  let contactCite = null, fallback_contact = null;
  const readContact = async () => {
    try {
      const c = (await run("contact", { topic: "default" }, { ...o, why: `default contact: ${backup == null ? `owner ${owner} out, no backup named` : `owner ${owner} and backup ${backup} both out`} on ${day}` })).objects[0];
      if (c) { fallback_contact = { email: c.email, label: c.label, cited: "contacts:default" }; contactCite = "contacts:default"; }
    } catch { fallback_contact = null; } // run() already traced the error line; the escalation falls back to the owner/backup form
  };
  if (scoped) {
    // lazy, per employee, never the whole holidays table: owner first, the backup only when the owner is out
    ownerAv = owner == null ? none : await employeeAvailability(owner, day, { ...o, why: `owner for ${topic}: ${how}` });
    if (owner != null) cited.push(`holiday_2026:${owner}@${day}`);
    backupAv = ownerAv.out && backup != null ? await employeeAvailability(backup, day, { ...o, why: `backup: owner ${owner} out on ${day}` }) : none;
    if (ownerAv.out && backup != null) cited.push(`holiday_2026:${backup}@${day}`);
    emps = [owner == null ? { objects: [] } : await run("employee", { employee_id: owner }, { ...o, why: `owner for ${topic}: ${how}` }),
      ownerAv.out && backup != null ? await run("employee", { employee_id: backup }, { ...o, why: `backup: owner ${owner} out on ${day}` }) : { objects: [] }];
    for (const e of emps) if (e.objects[0]) cited.push(`employees:${e.objects[0].employee_id}`);
    if (nobodyIn()) await readContact();
  } else {
    if (intake) {
      // parameterless holidays read, filtered in JS on the date
      const hol = (await run("holidays", {}, o)).objects.filter((h) => h.date === day);
      // a blank employee_id is a company-wide day (P15): it takes everyone out
      const avail = (e) => (e == null ? none : { out: hol.some((h) => h.employee_id === null || h.employee_id === undefined || h.employee_id === "" || Number(h.employee_id) === e) });
      ownerAv = avail(owner); backupAv = avail(backup);
    } else {
      ownerAv = owner == null ? none : await employeeAvailability(owner, day, o);
      backupAv = backup == null ? none : await employeeAvailability(backup, day, o);
    }
    if (owner != null) cited.push(`holiday_2026:${owner}@${day}`);
    if (backup != null) cited.push(`holiday_2026:${backup}@${day}`);
    emps = await Promise.all([owner, backup].map((e, i) => (e == null ? { objects: [] } : run("employee", { employee_id: e }, { ...o, why: `${i ? "backup" : "owner"} for ${topic}: ${how}` }))));
    for (const e of emps) if (e.objects[0]) cited.push(`employees:${e.objects[0].employee_id}`);
    // einh's pick B (24 Oct): a stored thread with nobody in reads the default contact too, after the employee reads and before the trust row
    if (nobodyIn()) await readContact();
  }
  const empRow = (i) => emps[i]?.objects?.[0] ?? null;
  const empName = (e) => (e ? `${e.given_name} ${e.family_name}` : null);
  // team, label and name of the owner and the backup. The CEO and Legal (201-207) have no employees row: the hierarchy template answers for them.
  // Scoped, the backup is read only when the owner is out or the over-limit path already read it.
  const backupWanted = backup != null && (!scoped || ownerAv.out || hier.has(backup));
  const ownerH = owner == null ? null : await readHier(owner, `owner ${owner}: team and place in the hierarchy`);
  const backupH = backupWanted ? await readHier(backup, `backup ${backup}: team and place in the hierarchy`) : null;
  const name = (e, h) => empName(e) ?? h?.name ?? null;

  // the channel's rules (channels.csv): public or not, whether the agent may answer on its own, its label
  let chan = null;
  if (INTAKE_CHANNELS.includes(ticket.channel)) {
    try {
      chan = (await run("channel", { channel: ticket.channel }, { ...o, why: `the rules of the ${ticket.channel} channel` })).objects[0] ?? null;
      if (chan) cited.push(`channels:${chan.channel}`);
    } catch { notes.push(`channels:unavailable:${ticket.channel}`); } // run() already traced the error line
  }
  const asBool = (v) => v === true || String(v).toLowerCase() === "true";

  // the topic's department label (responsibility.label): read once, by the owner chain when it came from there
  if (respSeen === undefined) {
    try { respSeen = (await run("responsibility", { topic }, { ...o, why: `the department label for ${topic}` })).objects[0] ?? null; } catch { respSeen = null; }
  }

  // earlier refund tickets from the same sender (case-insensitive), strictly before this one, never this one
  let prior = null;
  if (topic === "refund" && ticket.sender_email && ticket.received_at) {
    try {
      const pr = await run("prior_refunds", { email: String(ticket.sender_email), thread_id, received_at: String(ticket.received_at) }, { ...o, why: "an earlier refund request from this client?" });
      prior = { count: pr.objects.length, thread_ids: pr.objects.map((x) => x.thread_id) };
      for (const c of TEMPLATES.prior_refunds.cite({}, pr.objects)) cited.push(c);
    } catch (e) { notes.push(`prior_refunds:unavailable (${e?.name ?? "Error"})`); } // run() already traced the error line
  }

  // the trust row for EVERY category/topic (the ledger has all twelve); a category outside TOPICS reads the "other" row.
  // Only when no row exists does the weight fall back to OTHER_WEIGHT, and the note says so.
  const trustKey = TOPICS.includes(ticket.category) ? ticket.category : "other";
  let weight = OTHER_WEIGHT, floor = intake ? DEFAULT_FLOOR : 0.8;
  const led = (await run("trust", { category: trustKey }, o)).objects[0];
  if (led) { weight = Number(led.weight); floor = Number(led.floor); cited.push(`trust_ledger:${trustKey}`); }
  else notes.push(`trust_ledger:missing:${trustKey}`);

  let restricted = [];
  let disclosure_unknown = false;
  try {
    const w = (await run("wiki", { wiki: "leave" }, o)).objects[0];
    restricted = parseRestricted(w?.preview);
    if (restricted.length) cited.push("wiki_what_may_leave");
  } catch { restricted = []; disclosure_unknown = true; } // run() already traced the error line

  if (contactCite) cited.push(contactCite);

  return {
    thread_id, category: ticket.category, amount, policy_limit: limit,
    category_weight: weight, floor, owner_id: owner, backup_id: backup, owner_name: name(empRow(0), ownerH), backup_name: name(empRow(1), backupH),
    owner_role: empRow(0)?.role ?? ownerH?.role ?? null, backup_role: empRow(1)?.role ?? backupH?.role ?? null,
    owner_team: ownerH?.team ?? empRow(0)?.team ?? null, backup_team: backupH?.team ?? empRow(1)?.team ?? null,
    owner_team_label: ownerH?.team_label ?? null, backup_team_label: backupH?.team_label ?? null,
    topic_label: respSeen?.label ?? null,
    channel_public: asBool(chan?.public), channel_autonomous: chan ? asBool(chan.autonomous_reply) : null, channel_label: chan?.label ?? null,
    prior_refunds: prior,
    owner_out: ownerAv.out, backup_out: backupAv.out || (ownerAv.out && backup == null), fallback_contact, // an absent backup counts as out when the owner is out, so nobody-in is one predicate everywhere (Codex review 7, MEDIUM)
    // a free-text ticket carries no authored may_leave flag; Risk guards the draft through restricted terms and the amount limit, so a false flag would hard-refuse every FAQ send
    may_leave: intake || ticket.may_leave === true || ticket.may_leave === "true",
    restricted_terms: restricted, disclosure_unknown, cited_rows: cited, notes, received_at: ticket.received_at, as_of: day,
    subject: ticket.subject, body: ticket.body, sender_name: ticket.sender_name, sender_email: ticket.sender_email,
    channel: ticket.channel, follow_up_kind: ticket.follow_up_kind || null, follow_up_body: ticket.follow_up_body || null,
    parent_thread_id: ticket.parent_thread_id || null, ticket,
  };
}

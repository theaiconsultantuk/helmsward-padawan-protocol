// Live contract-drift test: the USL changed nothing about the facts. Each switched template's rows equal the raw table's rows.
// Skipped unless inbox/.env points at a Zetaris that answers (tests/helpers/live_zetaris.mjs). Sample mode serves what the USL serves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run, runLocal, TEMPLATES, LOCAL_EXEMPT } from "../src/queries.mjs";
import { loadTables } from "../src/csv.mjs";
import * as zetaris from "../src/adapters/zetaris.mjs";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { liveZetaris } from "./helpers/live_zetaris.mjs";

const { live, why } = await liveZetaris();
const t = (name, fn) => (live ? test(name, { timeout: 120000 }, fn) : test(name, { skip: why }, fn));
const cfg = () => ({ ...config(), SAMPLE_MODE: "false" });
// A typed layer prints 99.0 where the raw CSV says 99: the FACT is equal, so numeric strings compare as numbers.
const num = (v) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? String(Number(v)) : v);
const canon = (objs) => objs.map((o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, num(v)])))).sort();
async function raw(sql, limit = 2000) {
  const r = await zetaris.sqlRun(sql, { name: "usl_drift_raw", params: {}, limit, cfg: cfg() });
  return r.rows.map((x) => Object.fromEntries(r.headers.map((h, i) => [h, x[i]])));
}
async function same(name, params, rawSql, limit) {
  const usl = (await run(name, params, { cfg: cfg(), limit: limit ?? 2000 })).objects;
  const base = await raw(rawSql, limit ?? 2000);
  assert.ok(usl.length > 0, `${name}: USL returned rows`);
  assert.deepEqual(canon(usl), canon(base), `${name}: USL rows equal the raw rows`);
}

t("faq", () => same("faq", {}, "SELECT faq_id, question, answer, keywords, source FROM JEDI_PACK.faq"));
t("products", () => same("products", {}, "SELECT sku, name, unit_price, currency, min_order_qty, lead_days, material, specs, show_in_store, aliases FROM JEDI_PACK.products"));
for (const topic of ["rfq", "customer_service", "refund", "complaint"]) t(`responsibility ${topic}`, () => same("responsibility", { topic }, `SELECT * FROM JEDI_PACK.responsibility WHERE topic = '${topic}'`));
t("holidays", () => same("holidays", {}, "SELECT employee_id, date FROM JEDI_PACK.holiday_2026", 2000));
t("world_threads", () => same("world_threads", {}, "SELECT thread_id, sender_email, sender_name, category, channel, received_at, owner_id, outcome, subject FROM JEDI_PACK.threads_json", 1000));
t("reviews", () => same("reviews", {}, "SELECT review_id, thread_id, reviewer_name, stars, created_at FROM JEDI_PACK.trustpilot_reviews"));

for (const [name, file] of [["faq", "faq.json"], ["products", "products.json"]]) {
  t(`sample cache ${name} equals the live USL rows`, async () => {
    const entries = JSON.parse(readFileSync(join(INBOX_ROOT, "data", "sample", file), "utf8"));
    const e = entries.find((x) => Object.keys(x.params).length === 0);
    assert.ok(e, "cached entry for empty params");
    const cached = e.result.rows.map((r) => Object.fromEntries(e.result.headers.map((h, i) => [h, r[i]])));
    const live = (await run(name, {}, { cfg: cfg() })).objects;
    assert.deepEqual(canon(cached), canon(live));
  });
}

// ---- the seven views added in CP1: each equals its raw table (the USL changed nothing about the facts) -----------------
t("hierarchy view = companyhierarchy (every employee, manager joined)", async () => {
  const usl = (await run("hierarchy", { employee_id: 15 }, { cfg: cfg() })).objects[0];
  const [r] = await raw("SELECT employee_id, name, role, team, team_label, manager_id FROM JEDI_PACK.companyhierarchy WHERE employee_id = 15");
  const [m] = await raw(`SELECT name, role FROM JEDI_PACK.companyhierarchy WHERE employee_id = ${Number(r.manager_id)}`);
  assert.deepEqual(canon([usl]), canon([{ ...r, manager_name: m.name, manager_role: m.role }]));
  assert.equal((await raw("SELECT employee_id FROM JEDI_PACK.companyhierarchy", 1000)).length, 207);
});
t("client view = customers", () => same("customer_by_email", { email: "liravenn@email.com" }, "SELECT customer_id, name, callsign, email, home_planet, since, seeded_prior_refund, fictional FROM JEDI_PACK.customers WHERE LOWER(email) = 'liravenn@email.com'"));
t("sales_order view = orders", () => same("order", { order_id: "JP-1042" }, "SELECT order_id, customer_id, sku, quantity, amount, currency, shipping_planet, status, ordered_at FROM JEDI_PACK.orders WHERE order_id = 'JP-1042'"));
t("shipping_rule view = shipping_rules", () => same("shipping_rule", { planet: "Alderaan" }, "SELECT planet, status, note FROM JEDI_PACK.shipping_rules WHERE planet = 'Alderaan'"));
t("bulk_tier view = bulk_pricing", () => same("bulk_tiers", {}, "SELECT tier, min_qty, max_qty, discount_pct FROM JEDI_PACK.bulk_pricing"));
t("bom_part view = bom", () => same("bom", { sku: "FS-B04" }, "SELECT sku, part_id, part_name, qty_per_unit, stock FROM JEDI_PACK.bom WHERE sku = 'FS-B04'"));
t("channel view = channels", () => same("channel", { channel: "email" }, "SELECT channel, public, autonomous_reply, intake_address, label FROM JEDI_PACK.channels WHERE channel = 'email'"));

// ---- the contract-drift test: for every template with local(), the live sql and the CSV twin give the same headers and rows ----
// Params come from the committed cache (the requests the loop makes): up to five per template, the first, the last, an empty answer and
// two spread between. Normalised: nothing but what Zetaris's representation demands (a number prints as a number: "189.0" = "189", a
// boolean as true/false, NULL as null). prior_refunds keeps only the threads_json rows (local() cannot see the runtime intake).
const SAMPLE = join(INBOX_ROOT, "data", "sample");
const tables = loadTables(join(INBOX_ROOT, "data", "synthetic"));
const norm = (v) => (v === null || v === undefined || v === "" ? null : num(String(v)));
const pick = (entries) => {
  const idx = new Set([0, entries.length - 1, Math.floor(entries.length / 3), Math.floor((2 * entries.length) / 3)]);
  const empty = entries.findIndex((e) => e.result.total === 0);
  if (empty >= 0) idx.add(empty);
  return [...idx].filter((i) => i >= 0).map((i) => entries[i]);
};
for (const [name, tpl] of Object.entries(TEMPLATES)) {
  if (!tpl.local || LOCAL_EXEMPT.includes(name)) continue;
  t(`contract drift: ${name} live sql = local() on the CSVs`, async () => {
    const entries = JSON.parse(readFileSync(join(SAMPLE, `${name}.json`), "utf8"));
    for (const e of pick(entries)) {
      const local = runLocal(name, e.params, tables);
      const liveRes = await run(name, e.params, { cfg: cfg(), limit: 2000 });
      let rows = liveRes.rows;
      if (name === "prior_refunds") rows = rows.filter((r) => r[liveRes.headers.indexOf("src")] === "threads_json");
      if (local.rows.length || rows.length) assert.deepEqual(liveRes.headers, local.headers, `${name} headers ${JSON.stringify(e.params)}`);
      assert.deepEqual(rows.map((r) => r.map(norm)), local.rows.map((r) => r.map(norm)), `${name} rows ${JSON.stringify(e.params)}`);
    }
  });
}

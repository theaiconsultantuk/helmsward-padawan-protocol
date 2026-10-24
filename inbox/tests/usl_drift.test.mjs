// Live contract-drift test: the USL changed nothing about the facts. Each switched template's rows equal the raw table's rows.
// Skipped unless inbox/.env points at a Zetaris that answers (tests/helpers/live_zetaris.mjs). Sample mode serves what the USL serves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/queries.mjs";
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
t("products", () => same("products", {}, "SELECT product_id, name, unit_price_usd, currency, min_order_qty, lead_days FROM JEDI_PACK.products"));
for (const topic of ["rfq", "customer_service"]) t(`responsibility ${topic}`, () => same("responsibility", { topic }, `SELECT * FROM JEDI_PACK.responsibility WHERE topic = '${topic}'`));
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

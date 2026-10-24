import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { INBOX_ROOT, config } from "../src/config.mjs";
import { queryByName } from "../src/adapters/sample.mjs";
import { factsForTicket, wikiFor, counters } from "../src/queries.mjs";

const SAMPLE = join(INBOX_ROOT, "data", "sample");
const cfg = config({ SAMPLE_MODE: "true", SAMPLE_DIR: SAMPLE });

test("T02 facts match live", async () => {
  const f = await factsForTicket("T02", { cfg });
  assert.equal(f.category_weight, 0.55);
  assert.equal(f.floor, 0.8);
  assert.equal(f.owner_out, true);
  assert.equal(f.backup_out, false);
  assert.equal(f.amount ?? f.amount_usd, 39, "T02 is 39 GC (the amount is read from the thread's `amount` column)");
  assert.equal(f.owner_id, 15); assert.equal(f.backup_id, 27);
});

test("T03 is 400 over 150, so the over-limit owners 40 / 201", async () => {
  const f = await factsForTicket("T03", { cfg });
  assert.equal(f.amount ?? f.amount_usd, 400);
  assert.equal(f.policy_limit ?? f.policy_limit_usd, 150);
  assert.equal(f.owner_id, 40); assert.equal(f.backup_id, 201);
});

test("the thread cache carries `amount` in GC, no amount_usd, and the policy row says GC", () => {
  const th = JSON.parse(readFileSync(join(SAMPLE, "thread.json"), "utf8"));
  assert.ok(th.every((e) => e.result.headers.includes("amount") && !e.result.headers.includes("amount_usd")));
  const col = (id, c) => { const e = th.find((x) => x.params.thread_id === id).result; return e.rows[0][e.headers.indexOf(c)]; };
  assert.equal(col("T02", "amount"), "39.0"); assert.equal(col("T03", "amount"), "400.0");
  assert.equal(col("T02", "sender_email"), "liravenn@email.com"); assert.equal(col("T06", "sender_email"), "liravenn@email.com");
  assert.deepEqual(["owner_id", "backup_id", "owner_out"].map((c) => col("T02", c)), ["15", "27", "true"]);
  assert.equal(col("T04", "outcome"), "escalate");
  const pol = JSON.parse(readFileSync(join(SAMPLE, "policy.json"), "utf8")).find((e) => e.params.topic === "refund").result;
  assert.equal(pol.rows[0][pol.headers.indexOf("currency")], "GC");
  const pr = JSON.parse(readFileSync(join(SAMPLE, "product_price.json"), "utf8"));
  assert.equal(pr.length, 50);
  assert.ok(pr.every((e) => /^FS-[A-Z]\d{2}$/.test(e.params.sku) && e.result.rows[0][e.result.headers.indexOf("currency")] === "GC"));
});

test("new shapes: hierarchy 1-210 (208-210 empty), a prior_refunds entry per customer email, shipping default, bulk tiers, bom, channel", () => {
  const read = (n) => JSON.parse(readFileSync(join(SAMPLE, `${n}.json`), "utf8"));
  const h = read("hierarchy");
  assert.equal(h.length, 210);
  assert.deepEqual(h.filter((e) => e.result.total === 0).map((e) => e.params.employee_id), [208, 209, 210]);
  assert.equal(h.find((e) => e.params.employee_id === 201).result.rows[0][5], "201");
  assert.equal(read("bulk_tiers")[0].result.total, 3);
  assert.ok(read("shipping_rule").some((e) => e.params.planet === "default"));
  assert.ok(read("channel").length === 4 && read("bom").length === 50 && read("order").some((e) => e.result.total === 0));
  const emails = readFileSync(join(INBOX_ROOT, "data", "synthetic", "customers.csv"), "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split(",")[3]);
  const pr = read("prior_refunds");
  const cu = read("customer_by_email");
  for (const e of emails) {
    assert.ok(pr.some((x) => x.params.email === e && x.params.thread_id === "F0"), `sentinel prior_refunds for ${e}`);
    assert.ok(cu.some((x) => x.params.email === e && x.result.total === 1), `customer_by_email ${e}`);
  }
});

test("sample reader derives what a new intake asks: prior_refunds from the sender's sentinel, an unknown client/order/planet as live would", () => {
  const q = (n, p) => queryByName(n, p, { cfg });
  // a brand-new intake from T02's sender (own thread id, a time after T06): both earlier refunds, oldest first
  const r = q("prior_refunds", { email: "LiraVenn@email.com", thread_id: "F7", received_at: "2026-11-01T10:00:00.000Z" });
  assert.deepEqual(r.rows.map((x) => x[0]), ["T02", "T06"]);
  assert.deepEqual(q("prior_refunds", { email: "liravenn@email.com", thread_id: "F7", received_at: "2026-10-22T09:20:00Z" }).rows, [], "strictly before: T02's own time excludes it");
  assert.equal(q("prior_refunds", { email: "stranger@example.com", thread_id: "F8", received_at: "2026-11-01T10:00:00Z" }).rows.length, 0);
  assert.deepEqual(q("prior_refunds", { email: "liravenn@email.com", thread_id: "T06", received_at: "2026-10-22T11:05:00Z" }).rows.map((x) => x[0]), ["T02"], "an exact entry wins");
  assert.equal(q("customer_by_email", { email: "brand.new@example.com" }).rows.length, 0);
  assert.equal(q("customer_by_email", { email: "LIRAVENN@email.com" }).rows.length, 1);
  assert.equal(q("order", { order_id: "JP-7777" }).rows.length, 0);
  assert.equal(q("shipping_rule", { planet: "Sullust" }).rows[0][0], "default");
  assert.equal(q("shipping_rule", { planet: "alderaan" }).rows[0][1], "suspended");
  assert.equal(q("hierarchy", { employee_id: 15 }).rows[0][5], "7");
  assert.equal(q("product_by_sku", { sku: "FS-Z99" }).rows.length, 0);
});

test("wiki row has a preview; counters are zero", async () => {
  const rows = await wikiFor("refund.request", { cfg });
  assert.ok(rows.length >= 1 && typeof rows[0].preview === "string" && rows[0].preview.length > 0);
  const c = await counters({ cfg });
  assert.equal(c.send + c.hold + c.escalate + c.queued + c.affirmed + c.rejected, 0);
});

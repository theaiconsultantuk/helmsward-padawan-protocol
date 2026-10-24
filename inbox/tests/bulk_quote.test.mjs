// The bulk quote through runTicket in sample mode (P29): tier by quantity, parts against stock, the quote limit and who approves.
// Expected numbers are recomputed here from the seed CSVs (integer cents), never copied from the code under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { runMessage, msg, dirs, assertAutoReplyInvariant } from "./helpers/route_run.mjs";
import { parseCsv } from "../src/csv.mjs";

const csv = (f) => { const t = parseCsv(readFileSync(join(INBOX_ROOT, "data", "synthetic", f), "utf8")); const [h, ...rows] = t; return rows.map((r) => Object.fromEntries(h.map((c, i) => [c, r[i]]))); };
const TIERS = csv("bulk_pricing.csv"), PRODUCTS = csv("products.csv"), BOM = csv("bom.csv"), POLICY = csv("policy.csv");
const product = (sku) => PRODUCTS.find((p) => p.sku === sku);
const tierFor = (q) => TIERS.find((t) => q >= Number(t.min_qty) && (t.max_qty === "" || q <= Number(t.max_qty)));
const cents = (n) => Math.round(Number(n) * 100);
const gc = (c) => (c / 100).toFixed(2);
// unit = list x (1 - d/100) rounded to cents; total = unit x quantity
const expected = (sku, q) => { const t = tierFor(q); const unit = Math.round(cents(product(sku).unit_price) * (100 - Number(t.discount_pct)) / 100); return { tier: t.tier, discount: Number(t.discount_pct), unit, total: unit * q }; };
const LIMIT = cents(POLICY.find((p) => p.topic === "rfq").limit_amount);
const ask = (q, name, as_of = "2026-10-20", extra = {}) => runMessage(msg(`Hello, we need a quote for ${q} ${name} for our guild. Thank you.`, "email", "guild@example.com", extra), { as_of });

test("the CSV facts the tests stand on: tiers 1-10 / 11-100 / 101+, a rfq limit of 5000 GC", () => {
  assert.deepEqual(TIERS.map((t) => [t.tier, t.min_qty, t.max_qty, t.discount_pct]), [["crew", "1", "10", "0"], ["squad", "11", "100", "10"], ["fleet", "101", "", "20"]]);
  assert.equal(LIMIT, 500000);
});

for (const q of [10, 11, 100, 101]) {
  test(`${q} Strand Emitter Hilts: the ${tierFor(q).tier} tier, unit price and total exact from the CSV, a held quote for Sales`, async () => {
    const e = expected("FS-B02", q);
    const { result, lines } = await ask(q, "Strand Emitter Hilts");
    const o = result.output;
    assert.equal(result.scenario, "rfq");
    assert.equal(result.branch_id, "rfq-quote");
    assert.equal(o.decision, "hold", "a human sends quotes");
    assert.equal(o.queued_for.owner_id, 6);
    assert.equal(o.team, "Sales");
    assert.equal(o.status, "open");
    assert.equal(o.auto_reply, false);
    const quote = o.queued_for.attachments.quote;
    assert.equal(quote.sku, "FS-B02");
    assert.equal(quote.quantity, q);
    assert.equal(quote.tier, e.tier);
    assert.equal(quote.discount_pct, e.discount);
    assert.equal(cents(quote.unit_price), e.unit);
    assert.equal(cents(quote.total), e.total);
    assert.equal(quote.currency, "GC");
    for (const x of [`Tier: ${e.tier} (${e.discount}% off)`, `Unit price: ${gc(e.unit)} GC`, `Total: ${gc(e.total)} GC`, `Quantity: ${q}`, `Lead time: ${product("FS-B02").lead_days} days`, "valid 14 days"]) assert.ok(o.draft.text.includes(x), `draft has "${x}"`);
    assert.match(o.draft.text, /Jedi Pack Sales team$/, "signed by Sales");
    assert.ok(!o.draft.text.includes("on behalf of"), "a human sends a quote: not an automatic reply");
    for (const c of ["products:FS-B02", `bulk_pricing:${e.tier}`, "policy:rfq", "bom:FS-B02:PT-0003"]) assert.ok(o.cited_rows.includes(c), `cites ${c}`);
    assert.equal(lines.find((l) => l.step === "risk.signoff").status, "success");
    assertAutoReplyInvariant(assert, result, `q${q}`);
  });
}

test("parts: each part listed with qty_per_unit x quantity against stock, none short", async () => {
  const q = 25;
  const { result } = await ask(q, "Vanta Arc Trainers");
  const quote = result.output.queued_for.attachments.quote;
  const rows = BOM.filter((b) => b.sku === "FS-B01");
  assert.equal(quote.parts.length, rows.length);
  for (const b of rows) {
    const p = quote.parts.find((x) => x.part_id === b.part_id);
    assert.deepEqual(p, { part_id: b.part_id, part_name: b.part_name, needed: Number(b.qty_per_unit) * q, stock: Number(b.stock), short: Number(b.qty_per_unit) * q > Number(b.stock) });
    assert.ok(result.output.draft.text.includes(`${b.part_name} x ${Number(b.qty_per_unit) * q}`), `draft lists ${b.part_name}`);
  }
  assert.ok(quote.parts.every((x) => !x.short));
  assert.deepEqual(Object.keys(quote), ["sku", "quantity", "tier", "unit_price", "discount_pct", "total", "currency", "parts"]);
  assert.deepEqual(Object.keys(quote.parts[0]), ["part_id", "part_name", "needed", "stock", "short"]);
});

test("a short part (FS-B04 hinge, stock 0): rfq-quote-stock holds for Sales, names the part and the shortfall, the draft keeps the quote with the part flagged", async () => {
  const { result } = await ask(20, "Dual-Phase Practice Poles");
  const o = result.output;
  assert.equal(result.branch_id, "rfq-quote-stock");
  assert.equal(o.decision, "hold");
  assert.equal(o.queued_for.owner_id, 6);
  const hinge = BOM.find((b) => b.part_id === "PT-0038");
  assert.equal(hinge.stock, "0");
  assert.match(o.reasons[0], /Wobble-free hinge \(Mk 2\) \(PT-0038\) is short by 20: needs 20, stock 0/);
  assert.match(o.recommendation, /short by 20/);
  const parts = o.queued_for.attachments.quote.parts;
  assert.deepEqual(parts.filter((x) => x.short).map((x) => x.part_id), ["PT-0038"]);
  assert.ok(o.draft.text.includes("Wobble-free hinge (Mk 2) x 20 (short on stock)"));
  assert.ok(!o.draft.text.includes("Reinforced brass rivet (Mk 1) x 80 (short"), "the part in stock is not flagged");
  assert.ok(o.draft.text.includes(`Total: ${gc(expected("FS-B04", 20).total)} GC`), "the quote is kept");
});

test("over the quote limit: escalated to the Sales head (40) with a quote_total approval; the CEO (201) when the head is out", async () => {
  const e = expected("FS-B01", 50);
  assert.ok(e.total > LIMIT);
  const run = (as_of) => ask(50, "Vanta Arc Trainers", as_of);
  const inDay = await run("2026-10-25");
  const o = inDay.result.output;
  assert.equal(inDay.result.branch_id, "rfq-quote-over-limit");
  assert.equal(o.decision, "escalate");
  assert.equal(o.queued_for.owner_id, 40);
  assert.deepEqual(o.queued_for.approval, { kind: "quote_total", amount: e.total / 100, limit: LIMIT / 100, approver_id: 40, approver_name: "Zanva Groveley" });
  assert.equal(o.team, "Sales");
  assert.equal(o.status, "open");
  assert.ok(o.draft.text.includes(`Total: ${gc(e.total)} GC`));
  assert.ok(o.draft.text.includes("routed for approval"));
  assert.ok(!/we will (refund|honou?r)/i.test(o.draft.text));
  assert.equal(o.queued_for.attachments.quote.total, e.total / 100, "the quote stays attached");
  const out = await run("2026-10-29");           // employee 40 has a vacation row on 29 Oct
  const p = out.result.output;
  assert.equal(out.result.branch_id, "rfq-quote-over-limit");
  assert.equal(p.queued_for.owner_id, 201);
  assert.deepEqual(p.queued_for.approval, { kind: "quote_total", amount: e.total / 100, limit: LIMIT / 100, approver_id: 201, approver_name: "Paul Jedi" });
  assert.match(p.reasons[0], /Sales head 40 is out on 2026-10-29/);
  assert.ok(p.cited_rows.includes("holiday_2026:40@2026-10-29"));
  // the durable queue file carries the approval and the status
  const q = JSON.parse(readFileSync(p.queued_for.queue_file, "utf8"));
  assert.equal(q.ticket.approval.kind, "quote_total");
  assert.equal(q.status, "open");
});

test("a total at or under the limit is a plain held quote, never an approval", async () => {
  // 25 trainers: 4252.50 GC < 5000
  const { result } = await ask(25, "Vanta Arc Trainers");
  assert.equal(result.branch_id, "rfq-quote");
  assert.equal(result.output.queued_for.approval, undefined);
});

test("no quantity, no product, or two quantities: today's acknowledgement path (rfq), no quote, no price in the draft", async () => {
  for (const [text, why] of [
    ["Can you quote Orbit Display Stands for our school?", "no quantity"],
    ["Please quote 40 of the thingamajigs for our school", "no product"],
    ["Incoming RFQ for price difference between ordering 100000 Vanta Arc Trainers and 100 (we only have 1 price", "two quantities"],
  ]) {
    const { result } = await runMessage(msg(text, "chat", "a@example.com", { scenario: "rfq" }));
    assert.equal(result.branch_id, "rfq", why);
    assert.equal(result.output.decision, "escalate", why);
    assert.equal(result.output.queued_for.owner_id, 6, why);
    assert.equal(result.output.queued_for.attachments.quote, undefined, why);
    assert.ok(!/Unit price|Total:/.test(result.output.draft?.text ?? ""), why);
  }
});

test("cold-start twin: the same quote asked twice by the same email is F1 then F2 and the numbers do not move", async () => {
  const d = dirs();
  const a = await ask(11, "Strand Emitter Hilts", "2026-10-20", {});
  const x = await runMessage(msg("Hello, we need a quote for 11 Strand Emitter Hilts for our guild. Thank you.", "email", "guild@example.com"), { d, run_id: "twin1" });
  const y = await runMessage(msg("Hello, we need a quote for 11 Strand Emitter Hilts for our guild. Thank you again.", "email", "guild@example.com"), { d, run_id: "twin2" });
  assert.equal(x.result.input.thread_id, "F1");
  assert.equal(y.result.input.thread_id, "F2");
  for (const r of [a, x, y]) assert.equal(r.result.branch_id, "rfq-quote");
  assert.deepEqual(x.result.output.queued_for.attachments.quote, y.result.output.queued_for.attachments.quote);
  assert.equal(y.result.output.status, "open");
});

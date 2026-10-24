import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { config } from "../src/config.mjs";
import { hardRisk } from "../src/gates.mjs";
import { HANDLERS, resolveScenario, matchProducts } from "../src/scenarios.mjs";

const sampleFile = (n) => JSON.parse(readFileSync(new URL(`../data/sample/${n}.json`, import.meta.url), "utf8"));
const obj = (r) => ({ ...r, objects: r.rows.map((x) => Object.fromEntries(r.headers.map((h, i) => [h, x[i]]))) });
const cache = (name, params) => {
  const e = sampleFile(name).find((x) => JSON.stringify(x.params) === JSON.stringify(params)) ?? sampleFile(name).find((x) => Object.keys(x.params).length === 0);
  return obj(e.result);
};
const MSG = "Incoming RFQ for price difference between ordering 100000 items and 100 (we only have 1 price, so I would like to see how our flow responds";

function toolbox(text) {
  const lines = [], esc = [];
  const L = (x) => { lines.push(x); return x; };
  const tb = {
    f: { thread_id: "F1", category: "question", owner_id: 1, backup_id: 2, may_leave: true, restricted_terms: [], cited_rows: [] },
    ticket: { sender_name: "Einh" }, inputText: text, cfg: config({ SAMPLE_MODE: "true" }), o: {}, decided: null,
    L, skipped: (step, why, extra = {}) => L({ step, status: "skipped", input_summary: why, output_summary: "gate not reached", ...extra }),
    escalate: (...a) => { esc.push(a); },
    hardRisk,
    queries: { run: async (name, params, o) => {
      const r = cache(name, params);
      o?.trace?.line({ step: "zetaris.query", action: `sql:${name}`, output_summary: `${r.rows.length} rows: ${r.objects.map((x) => x.sku ?? x.topic ?? x.faq_id).join(", ")}`, status: "success" });
      return r;
    } },
  };
  return { tb, lines, esc };
}
async function run(text) {
  const { tb, lines, esc } = toolbox(text);
  const probe = await HANDLERS.rfq.probe(tb);
  assert.equal(lines.length, 0, "probe writes no lines");
  const out = await HANDLERS.rfq.act(tb, probe);
  return { probe, out, lines, esc };
}

test("price difference, no product named: both quantities, nothing matched, sales told", async () => {
  const { probe, out, esc } = await run(MSG);
  assert.deepEqual(probe.data.quantities, [100000, 100]);
  assert.equal(probe.data.prices.length, 0);
  assert.match(out.recommendation, /no product in the records matches/);
  assert.equal(out.decision, "escalate");
  assert.equal(out.queued.owner_id, 6);
  assert.equal(out.queued.backup_id, 14);
  assert.equal(esc.length, 1);
  assert.equal(esc[0][3].owner.owner_id, 6);
});

test("Vanta Arc Trainer named: one price row cited, two quantities named, no tier denial", async () => {
  const { probe, out, lines, esc } = await run(`${MSG} for Vanta Arc Trainers`);
  assert.equal(probe.data.prices.length, 1);
  assert.ok(probe.cited.includes("products:FS-B01"));
  assert.deepEqual(out.attachments.cited, ["products:FS-B01"]);
  assert.match(out.recommendation, /a unit price/);
  assert.match(out.recommendation, /more than one quantity/);
  assert.equal(out.queued.owner_id, 6);
  assert.ok(probe.lines.some((l) => l.action === "sql:product_price"));
  assert.ok(!out.draft.text.includes("189"), "no price in the acknowledgement");
  assert.match(out.draft.text, /100000 and 100/);
  const risk = lines.find((l) => l.step === "risk.signoff");
  assert.equal(risk.status, "success");
  assert.equal(lines.find((l) => l.step === "nvidia.model").output_summary, "acknowledgement template, no model call");
  assert.equal(lines.find((l) => l.step === "critique").output_summary, "template, nothing to evaluate");
  assert.equal(esc[0][3].attachments.prices.length, 1);
});

test("matchProducts needs every name token", () => {
  const rows = [{ sku: "FS-B01", name: "Vanta Arc Trainer" }, { sku: "FS-B02", name: "Strand Emitter Hilt" }];
  assert.deepEqual(matchProducts("quote 5 strand emitter hilts", rows).map((r) => r.sku), ["FS-B02"]);
  assert.deepEqual(matchProducts("a saber", rows), []);
});

test("resolveScenario", () => {
  assert.deepEqual(resolveScenario({ kind: "thread" }), { scenario: "legacy", how: "thread" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: { intent: { primary: { id: "GENERAL" }, confidence: 0.1 } }, faqHit: { row: {} } }), { scenario: "question", how: "faq" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: { intent: { primary: { id: "rfq.request" }, confidence: 0.9 } } }), { scenario: "rfq", how: "scout" });
  assert.deepEqual(resolveScenario({ kind: "thread", declared: "question" }), { scenario: "question", how: "declared" });
  assert.deepEqual(resolveScenario({ kind: "message", declared: "free_text" }), { scenario: "customer_service", how: "none" });
});

// ---- the quote road (P29): one product and one quantity are quoted from the tier and the parts; anything less stays the acknowledgement above ----

test("one product and one quantity: the handler probes tiers and parts and holds a quote for the rfq owner (no escalate)", async () => {
  const { probe, out, esc } = await run("Please quote 25 Vanta Arc Trainers for our academy");
  assert.equal(probe.branch_id, "rfq-quote");
  assert.deepEqual(probe.data.quote, { sku: "FS-B01", quantity: 25, tier: "squad", unit_price: 170.1, discount_pct: 10, total: 4252.5, currency: "GC",
    parts: probe.data.quote.parts });
  assert.ok(probe.lines.some((l) => l.action === "sql:bulk_tiers") && probe.lines.some((l) => l.action === "sql:bom"));
  assert.equal(out.decision, "hold");
  assert.equal(out.queued.owner_id, 6);
  assert.equal(esc.length, 0, "a plain quote is a hold: nothing is escalated");
  assert.match(out.draft.text, /Total: 4252\.50 GC/);
  assert.equal(out.attachments.quote.parts.length, 2);
});

test("the quantity may stand before the product name (Scout counts only before a unit word); two numbers do not make an order", async () => {
  assert.equal((await run("send a quote for 50 Vanta Arc Trainers")).probe.data.quote.quantity, 50);
  assert.equal((await run("send a quote for 1,000 Vanta Arc Trainers")).probe.data.quote.quantity, 1000);
  assert.equal((await run("the difference between 100000 Vanta Arc Trainers and 100")).probe.branch_id, "rfq");
  assert.equal((await run("Vanta Arc Trainers, quantity not decided yet")).probe.branch_id, "rfq");
});

test("resolveScenario: a quote for a counted product is an RFQ even when Scout read a plain order question; a product question stays a product question", () => {
  const decided = { intent: { primary: { id: "GENERAL" }, confidence: 0.2 } };
  const productHit = { row: { sku: "FS-B01", name: "Vanta Arc Trainer" } };
  assert.deepEqual(resolveScenario({ kind: "message", decided, text: "could you quote 25 Vanta Arc Trainers?", productHit }), { scenario: "rfq", how: "scout" });
  assert.equal(resolveScenario({ kind: "message", decided, text: "What is the Vanta Arc Trainer made of?", productHit }).scenario, "product");
});

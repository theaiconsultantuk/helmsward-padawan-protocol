// Codex review 3, 9, 12, 13 and the scenario half of 8: safety cues first, quote counts before delivery, teams from rows,
// an honest RFQ fallback, a product question answered in full or held, and stamped scenario buffers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runMessage, msg } from "./helpers/route_run.mjs";
import { resolveScenario, requestedAttributes } from "../src/scenarios.mjs";
import { stampedBuffer } from "../src/trace_buffer.mjs";

const ask = (text, extra) => runMessage(msg(text, "contact-form"), extra);

test("3: a refund that threatens a lawyer is a complaint-legal escalation, the refund amount stays in the reasons", async () => {
  const text = "I want a refund of 80 GC for my Drift Boot Wraps or I will sue";
  assert.equal(resolveScenario({ kind: "message", text, decided: { intent: { primary: { id: "refund.request" }, confidence: 0.9 } } }).scenario, "complaint");
  const { result } = await ask(text);
  assert.equal(result.scenario, "complaint");
  assert.equal(result.branch_id, "complaint-legal");
  assert.equal(result.output.decision, "escalate");
  assert.match(result.output.reasons.join(" "), /refund/);
  assert.match(result.output.reasons.join(" "), /80/);
});

test("3: a quote naming an order id is an RFQ, not a delivery reply", async () => {
  const text = "Please quote 20 Vanta Arc Trainers, same as my order JP-1008";
  const r = resolveScenario({ kind: "message", text, productHit: { row: { sku: "FS-B01", name: "Vanta Arc Trainer" } }, decided: { intent: { primary: { id: "order.question" }, confidence: 0.8 } } });
  assert.equal(r.scenario, "rfq");
  const { result } = await ask(text);
  assert.equal(result.scenario, "rfq");
  assert.notEqual(result.scenario, "delivery");
});

test("3: a plain delivery question naming an order stays delivery", () => {
  const r = resolveScenario({ kind: "message", text: "Where is my order JP-1008?", productHit: { row: {} }, decided: { intent: { primary: { id: "order.question" }, confidence: 0.8 } } });
  assert.equal(r.scenario, "delivery");
});

test("9: the reply team is the owner's team from the rows, and the product reply says so", async () => {
  const { result } = await ask("How much does the Wayfarer Long Cloak cost and what is its lead time?");
  assert.equal(result.output.decision, "send");
  assert.match(result.output.draft.text, new RegExp(`Jedi Pack ${result.output.team} team`));
  assert.ok(result.output.team);
});

test("12: the RFQ fallback names what is missing and never denies the pricing rows", async () => {
  const none = await ask("Incoming RFQ for price difference between ordering Vanta Arc Trainers, no quantity yet");
  assert.doesNotMatch(none.result.output.recommendation, /no volume tiers/);
  assert.match(none.result.output.recommendation, /no quantity was stated/);
  const two = await ask("Could you quote 100 or 1000 Vanta Arc Trainers for me");
  assert.doesNotMatch(two.result.output.recommendation ?? "", /no volume tiers/);
  assert.equal(two.result.scenario, "rfq");
});

test("13: price answered but waterproof unknown holds for the product owner, no draft", async () => {
  const text = "What does the Wayfarer Long Cloak cost and is it waterproof?";
  const { result } = await ask(text);
  const o = result.output;
  assert.equal(result.branch_id, "product-unanswered");
  assert.equal(o.decision, "hold");
  assert.equal(o.auto_reply, false);
  assert.ok(!o.draft);
  assert.match(o.reasons.join(" "), /waterproof/);
  assert.match(o.reasons.join(" "), /not in the catalogue row/);
});

test("13: price and lead time still auto-reply both; a single unknown still holds", async () => {
  const { result } = await ask("How much does the Wayfarer Long Cloak cost and what is its lead time?");
  assert.equal(result.branch_id, "product-hit");
  assert.match(result.output.draft.text, /costs 119 GC/);
  assert.match(result.output.draft.text, /lead time of 9 days/);
  const w = await ask("Is the Wayfarer Long Cloak waterproof?");
  assert.equal(w.result.branch_id, "product-unanswered");
});

test("13: requestedAttributes lists the unanswered clause", () => {
  const row = { name: "Wayfarer Long Cloak", unit_price: "119", currency: "GC", lead_days: "9", material: "", specs: "" };
  const r = requestedAttributes("What does the Wayfarer Long Cloak cost and is it waterproof?", row);
  assert.deepEqual(r.answers.map((a) => a.field), ["unit_price"]);
  assert.equal(r.unanswered.length, 1);
  assert.match(r.unanswered[0], /waterproof/);
});

test("8: the scenario buffer stamps each line with its recording time", () => {
  const b = stampedBuffer();
  const before = Date.now();
  b.push({ step: "a" }, { step: "b", at: 5 });
  assert.ok(b[0].at >= before);
  assert.equal(b[1].at, 5);
});

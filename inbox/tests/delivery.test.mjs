// The delivery route: an order id and a delivery word, answered from the order row and the planet's shipping rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { runMessage, msg, dirs, assertAutoReplyInvariant } from "./helpers/route_run.mjs";
import { resolveScenario } from "../src/scenarios.mjs";

const orders = readFileSync(join(INBOX_ROOT, "data", "synthetic", "orders.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const HELD_ALDERAAN = orders.find((r) => r[6] === "Alderaan" && r[7] === "held")[0];   // order_id,customer_id,sku,quantity,amount,currency,shipping_planet,status
const OPEN = orders.find((r) => r[6] === "Corellia");
const where = (id) => msg(`Where is my order ${id}? It was meant to arrive weeks ago.`, "contact-form");

test("a held order to Alderaan: the shipping rule is suspended, so the note is sent on behalf of Support", async () => {
  const { result, lines } = await runMessage(where(HELD_ALDERAAN));
  const o = result.output;
  assert.equal(result.scenario, "delivery");
  assert.equal(result.branch_id, "delivery-suspended");
  assert.equal(o.decision, "send");
  assert.equal(o.auto_reply, true);
  assert.equal(o.status, "handled");
  assert.equal(o.team, "Support");
  assert.ok(o.cited_rows.includes(`orders:${HELD_ALDERAAN}`));
  assert.ok(o.cited_rows.includes("shipping_rules:Alderaan"));
  assert.ok(o.draft.text.includes("Deliveries to Alderaan are currently suspended."), o.draft.text);
  assert.ok(o.draft.text.includes(`Your order ${HELD_ALDERAAN} is held`), o.draft.text);
  assert.ok(o.draft.text.includes("our team will contact you as soon as deliveries to Alderaan resume"), o.draft.text);
  assert.ok(o.draft.text.endsWith("Jedi Pack Support team\nSent automatically on behalf of the Support team."), o.draft.text);
  assert.ok(lines.filter((l) => l.step === "nvidia.model" && l.branch_id === "delivery-suspended").every((l) => l.status === "skipped"));
  assertAutoReplyInvariant(assert, result, "s10");
});

test("an order to an open planet is answered with its status", async () => {
  const { result } = await runMessage(where(OPEN[0]));
  const o = result.output;
  assert.equal(result.branch_id, "delivery-status");
  assert.equal(o.decision, "send");
  assert.equal(o.auto_reply, true);
  assert.ok(o.draft.text.includes(`Your order ${OPEN[0]} is currently ${OPEN[7]}, shipping to Corellia.`), o.draft.text);
  assert.ok(o.cited_rows.includes("shipping_rules:Corellia"));
  assertAutoReplyInvariant(assert, result, "open");
});

test("an order that is not in the records holds for the delivery owner, no draft", async () => {
  const { result } = await runMessage(where("JP-9999"));
  const o = result.output;
  assert.equal(result.branch_id, "delivery-unknown");
  assert.equal(o.decision, "hold");
  assert.equal(o.queued_for.owner_id, 15);
  assert.equal(o.team, "Support");
  assert.equal(o.status, "open");
  assert.equal(o.auto_reply, false);
  assert.ok(!o.draft);
  assert.match(o.reasons.join(" "), /JP-9999 is not in the records/);
  assertAutoReplyInvariant(assert, result, "unknown");
});

test("cold-start twins: F1 then F2 in the same dirs both answer from the rows; the second remembers the first", async () => {
  const d = dirs();
  const a = await runMessage(where(HELD_ALDERAAN), { d, run_id: "cold-1" });
  const b = await runMessage({ ...where(HELD_ALDERAAN), message: `${where(HELD_ALDERAAN).message} Thanks.` }, { d, run_id: "cold-2" }); // identical text would be a duplicate
  assert.equal(a.result.input.thread_id, "F1");
  assert.equal(b.result.input.thread_id, "F2");
  for (const r of [a, b]) {
    assert.equal(r.result.output.decision, "send");
    assert.ok(r.result.output.draft.text.includes("Deliveries to Alderaan are currently suspended."));
  }
  const read = (x) => x.lines.find((l) => l.step === "memory.read");
  assert.match(read(a).output_summary, /empty \(cold first run\)/);
  assert.doesNotMatch(read(b).output_summary, /empty \(cold first run\)/);
});

test("an order id in a refund or a replacement is not a delivery question", async () => {
  const refund = await runMessage(msg(`I want a refund of 20 GC for order ${OPEN[0]}, where is my money`));
  assert.equal(refund.result.scenario, "refund");
  const dec = (id) => ({ intent: { primary: { id }, confidence: 0.9 } });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec("replacement.request"), text: `replace order ${OPEN[0]} please` }), { scenario: "legacy", how: "scout" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec("complaint"), text: `where is order ${OPEN[0]}, I am furious` }), { scenario: "complaint", how: "scout" });
});

test("resolveScenario: an order id plus a delivery word; no id, no delivery road", () => {
  const dec = { intent: { primary: { id: "order.question" }, confidence: 0.9 } };
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec, text: "Where is my order JP-1001?" }), { scenario: "delivery", how: "scout" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec, text: "Where is my order?" }), { scenario: "question", how: "scout" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec, text: "JP-1001 is a lovely number" }), { scenario: "question", how: "scout" });
});

test("the first Alderaan held orders in the data are all answered as suspended", async () => {
  for (const r of orders.filter((x) => x[6] === "Alderaan").slice(0, 4)) {
    const { result } = await runMessage(where(r[0]));
    assert.equal(result.branch_id, "delivery-suspended", r[0]);
    assertAutoReplyInvariant(assert, result, r[0]);
  }
});

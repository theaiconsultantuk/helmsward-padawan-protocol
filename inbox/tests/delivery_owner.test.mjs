// einh's pick: the delivery road answers an order only to the order's own customer. The sender's email must be the email of the
// customer on the order (orders.csv customer_id -> customers.csv email); anyone else is held for Support with no draft, and nothing of the order
// (its status, its planet, the shipping rule) reaches the output, the journey or the trace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { parseCsv } from "../src/csv.mjs";
import { deriveJourney } from "../src/journey.mjs";
import { runMessage, msg, assertAutoReplyInvariant } from "./helpers/route_run.mjs";

const csv = (f) => { const [h, ...rows] = parseCsv(readFileSync(join(INBOX_ROOT, "data", "synthetic", f), "utf8")); return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const orders = csv("orders.csv"), customers = csv("customers.csv");
const ORDER = orders.find((o) => o.order_id === "JP-1001");
const OWNER = customers.find((c) => c.customer_id === ORDER.customer_id);
const DEMO = JSON.parse(readFileSync(join(INBOX_ROOT, "public", "demo-scenarios.json"), "utf8")).find((d) => d.id === "s10");
const ask = (from, extra = {}) => runMessage(msg("Where is my order JP-1001? It was meant to arrive weeks ago.", "contact-form", from, extra));

test("s10 by the order's own customer (Cass Holm, the demo client): the delivery-suspended answer is sent", async () => {
  assert.equal(OWNER.name, "Cass Holm");
  assert.equal(DEMO.email, OWNER.email, "the s10 demo client is the order's seeded owner");
  assert.equal(DEMO.name, OWNER.name);
  assert.equal(DEMO.client, "seeded-order-owner");
  const { result } = await ask(OWNER.email, { name: OWNER.name });
  assert.equal(result.branch_id, "delivery-suspended");
  assert.equal(result.output.decision, "send");
  assert.equal(result.output.auto_reply, true);
  assert.match(result.output.draft.text, /Deliveries to Alderaan are currently suspended/);
  // the email is compared case-insensitively
  assert.equal((await ask(OWNER.email.toUpperCase(), { name: OWNER.name })).result.branch_id, "delivery-suspended");
});

test("s10 by anyone else: held for Support, no draft, nothing of the order in the output, the journey or the trace", async () => {
  for (const from of ["ilmarironbridge@email.com", "someone.new@email.com", customers.find((c) => c.customer_id !== OWNER.customer_id).email]) {
    const { result, lines } = await ask(from);
    const o = result.output;
    assert.equal(result.scenario, "delivery");
    assert.equal(result.branch_id, "delivery-not-owner", from);
    assert.equal(o.decision, "hold");
    assert.equal(o.auto_reply, false);
    assert.equal(o.status, "open");
    assert.equal(o.team, "Support");
    assert.equal(o.queued_for.owner_id, 15);
    assert.ok(!o.draft, "no draft");
    assert.match(o.reasons.join(" "), /does not belong to the sender/);
    assertAutoReplyInvariant(assert, result, from);
    // nothing of the order's row or its shipping rule is anywhere in what the run says
    const everything = JSON.stringify({ result, lines, journey: deriveJourney(result, lines) });
    for (const secret of [ORDER.shipping_planet, "suspended", "Alderaan", ORDER.sku, `${ORDER.amount} ${ORDER.currency}`, ORDER.ordered_at, OWNER.name, OWNER.email, "shipping_rules"]) {
      assert.ok(!everything.toLowerCase().includes(String(secret).toLowerCase()), `${from}: "${secret}" leaked`);
    }
  }
});

test("a message with no sender email is not the order's owner either", async () => {
  const { result } = await runMessage({ message: "Where is my order JP-1001? It was meant to arrive weeks ago.", channel: "contact-form" });
  assert.notEqual(result.branch_id, "delivery-suspended");
  assert.ok(["delivery-not-owner", "delivery-unknown"].includes(result.branch_id) || result.output.decision !== "send", result.branch_id);
  assert.notEqual(result.output.decision, "send");
});

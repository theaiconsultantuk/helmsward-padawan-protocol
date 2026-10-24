// A product question that names the flagship product is a product question, not a quote request.
// Regression: an rfq.request example carrying the noun "trainers" made every "Vanta Arc Trainer" question an RFQ that escalated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runMessage, msg } from "./helpers/route_run.mjs";
import { resolveScenario } from "../src/scenarios.mjs";

const ask = (text) => runMessage(msg(text, "contact-form", "q@email.com", { scenario: "free_text" }));
const products = JSON.parse(readFileSync(new URL("../public/shop/data/catalogue.json", import.meta.url), "utf8")).products;
const arc = products.find((p) => p.name === "Vanta Arc Trainer");

test("what the flagship is made of: product-hit send naming the material", async () => {
  const { result } = await ask("What is the Vanta Arc Trainer made of?");
  assert.equal(result.scenario, "product");
  assert.equal(result.branch_id, "product-hit");
  assert.equal(result.output.decision, "send");
  assert.match(result.output.draft.text, /aluminium/i);
});

test("how much the flagship weighs and whether it suits kids: the product road, never the RFQ", async () => {
  for (const q of ["How much does the Vanta Arc Trainer weigh?", "Is the Vanta Arc Trainer good for kids?"]) {
    const { result } = await ask(q);
    assert.equal(result.scenario, "product", q);
    assert.notEqual(result.branch_id, "rfq", q);
    assert.ok(["product-hit", "product-unanswered"].includes(result.branch_id), `${q}: ${result.branch_id}`);
  }
});

test("a quote for a counted number of flagships is still an RFQ", async () => {
  for (const q of ["We need a quote for 50 Vanta Arc Trainers for the new academy wing", "Please quote 20 Vanta Arc Trainers, same as my order JP-1008"]) {
    const { result } = await ask(q);
    assert.equal(result.scenario, "rfq", q);
  }
});

test("resolveScenario: an rfq.request read with no quote cue and no count does not take the RFQ road", () => {
  const decided = { intent: { primary: { id: "rfq.request" }, confidence: 0.9 } };
  const productHit = { row: { sku: arc.id } };
  assert.equal(resolveScenario({ kind: "message", text: "What is the Vanta Arc Trainer made of?", decided, productHit }).scenario, "product");
  assert.equal(resolveScenario({ kind: "message", text: "Please quote 20 Vanta Arc Trainers", decided, productHit }).scenario, "rfq");
  assert.equal(resolveScenario({ kind: "message", text: "wholesale pricing for the Vanta Arc Trainer", decided, productHit }).scenario, "rfq");
});

test("sweep: no storefront product's made-of question routes to the RFQ", async () => {
  assert.equal(products.length, 12);
  for (const p of products) {
    const { result } = await ask(`What is the ${p.name} made of?`);
    assert.notEqual(result.scenario, "rfq", p.name);
    assert.notEqual(result.branch_id, "rfq", p.name);
  }
});

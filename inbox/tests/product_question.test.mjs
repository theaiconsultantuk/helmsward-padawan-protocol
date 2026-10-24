// The product route (S: a question the catalogue row answers): resolved from the message, answered from products by sku, never a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runMessage, msg, assertAutoReplyInvariant } from "./helpers/route_run.mjs";
import { matchProductLookup, answerFromRow, resolveScenario } from "../src/scenarios.mjs";

const S05 = "What is the primary material used in the Sovereign Arc Duellist?";
const ask = (text, extra) => runMessage(msg(text, "contact-form"), extra);

test("s05: the material sentence comes from the row, sent on behalf of the Product team", async () => {
  const { result, lines } = await ask(S05);
  const o = result.output;
  assert.equal(result.scenario, "product");
  assert.equal(result.branch_id, "product-hit");
  assert.equal(o.decision, "send");
  assert.equal(o.auto_reply, true);
  assert.equal(o.status, "handled");
  assert.equal(o.team, "Product");
  assert.ok(o.cited_rows.includes("products:FS-B03"));
  assert.ok(o.draft.text.includes("The Sovereign Arc Duellist is made of brass and blackened steel."), o.draft.text);
  assert.ok(o.draft.text.endsWith("Best regards,\nJedi Pack Product team\nSent automatically on behalf of the Product team."), o.draft.text);
  assert.equal(o.draft.model, "catalogue/row");
  // no model was asked: every nvidia.model line of the branch is skipped, the Risk sign-off ran on the draft
  assert.ok(lines.filter((l) => l.step === "nvidia.model" && l.branch_id === "product-hit").every((l) => l.status === "skipped"));
  assert.ok(lines.some((l) => l.step === "risk.signoff" && l.status === "success" && l.branch_id === "product-hit"));
  assertAutoReplyInvariant(assert, result, "s05");
});

test("the trust floor does not hold a product answer: category product weighs under the floor and the row still answers", async () => {
  const { result, lines } = await ask(S05);
  assert.equal(result.output.decision, "send");
  const branch = lines.find((l) => l.step === "branch");
  assert.equal(branch.branch_id, "product-hit");
  assert.equal(result.output.trusted_to_send, false, "the weight is under the floor; the row-composed answer is the exception");
});

test("a product named only by an alias is found, and the price comes from the row", async () => {
  const { result } = await ask("How much does the duellist cost?");
  assert.equal(result.branch_id, "product-hit");
  assert.match(result.output.draft.text, /The Sovereign Arc Duellist costs 420 GC\./);
  assert.ok(result.output.reasons.join(" ").includes("matched by alias"));
});

test("a spec key asked by name is read from the specs column", async () => {
  const w = await ask("What is the length of the Strand Emitter Hilt?");
  assert.match(w.result.output.draft.text, /The Strand Emitter Hilt length is 26 cm, 410 g\./);
  const l = await ask("What is the core of the Sovereign Arc Duellist?");
  assert.match(l.result.output.draft.text, /The Sovereign Arc Duellist core is smooth-swing sound board, 24 colours, ignition flicker\./);
});

test("price and lead time in one question are both answered from the row", async () => {
  const { result } = await ask("How much does the Wayfarer Long Cloak cost and what is its lead time?");
  assert.equal(result.branch_id, "product-hit");
  assert.match(result.output.draft.text, /The Wayfarer Long Cloak costs 119 GC\. The Wayfarer Long Cloak has a lead time of 9 days\./);
  assert.ok(result.output.cited_rows.includes("products:FS-A01"));
});

test("s06: a product in the catalogue but not in the row holds for the Product owner with no draft", async () => {
  const { result, lines } = await ask("Is the Wayfarer Long Cloak waterproof?");
  const o = result.output;
  assert.equal(result.scenario, "product");
  assert.equal(result.branch_id, "product-unanswered");
  assert.equal(o.decision, "hold");
  assert.equal(o.queued_for.owner_id, 5);
  assert.equal(o.queued_for.backup_id, 13);
  assert.equal(o.team, "Product");
  assert.equal(o.status, "open");
  assert.equal(o.auto_reply, false);
  assert.ok(!o.draft, "no draft");
  assert.match(o.reasons.join(" "), /not in the catalogue row/);
  assert.ok(o.cited_rows.includes("products:FS-A01"));
  assert.ok(!lines.some((l) => l.step === "critique" && l.status === "success"), "nothing to critique");
  assertAutoReplyInvariant(assert, result, "s06");
});

test("a product-shaped question with no product named holds for the Product owner, no draft", async () => {
  const { result } = await ask("What is the main material of the thing you sell?");
  assert.equal(result.branch_id, "product-unanswered");
  assert.equal(result.output.decision, "hold");
  assert.equal(result.output.queued_for.owner_id, 5);
  assert.ok(!result.output.draft);
  assert.match(result.output.reasons.join(" "), /not in the catalogue row/);
});

test("matchProductLookup: name beats alias, longer beats shorter, a tie is ambiguous", () => {
  const rows = [
    { sku: "FS-X1", name: "Vanta Arc Trainer", aliases: "training blade;blade" },
    { sku: "FS-X2", name: "Strand Emitter Hilt", aliases: "hilt;blade" },
    { sku: "FS-X3", name: "Blade Stand", aliases: "stand" },
  ];
  assert.equal(matchProductLookup("is the vanta arc trainer safe", rows).hit.row.sku, "FS-X1");
  assert.equal(matchProductLookup("is the vanta arc trainer safe", rows).hit.via, "name");
  assert.equal(matchProductLookup("tell me about the hilt", rows).hit.row.sku, "FS-X2");
  assert.equal(matchProductLookup("tell me about the hilt", rows).hit.via, "alias");
  const tie = matchProductLookup("does the blade glow", rows);
  assert.equal(tie.hit, null);
  assert.deepEqual(tie.ambiguous, ["FS-X1", "FS-X2"]);
  assert.equal(matchProductLookup("nothing relevant", rows).all.length, 0);
});

test("answerFromRow: only the fields the question asks for; no field, no sentence", () => {
  const row = { name: "Wayfarer Long Cloak", unit_price: "119.0", currency: "GC", lead_days: "9", material: "linen", specs: "length=135 cm;hood=yes" };
  assert.deepEqual(answerFromRow("what material is it made of", row).map((a) => a.field), ["material"]);
  assert.deepEqual(answerFromRow("does it have a hood", row).map((a) => a.field), ["specs.hood"]);
  assert.deepEqual(answerFromRow("list the specs", row).map((a) => a.field), ["specs"]);
  assert.deepEqual(answerFromRow("is it waterproof", row), []);
});

test("resolveScenario: a product match or a material question is a product, an order id with a refund stays a refund", () => {
  const dec = (id) => ({ intent: { primary: { id }, confidence: 0.9 } });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec("order.question"), text: "x", productHit: { all: [{}] } }), { scenario: "product", how: "scout" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec("GENERAL"), text: "what is it made of" }), { scenario: "product", how: "scout" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec("refund.request"), text: "refund the Wayfarer Long Cloak", productHit: { all: [{}] } }), { scenario: "refund", how: "scout" });
  assert.deepEqual(resolveScenario({ kind: "message", declared: "product" }), { scenario: "product", how: "declared" });
});

// A product question that names the flagship product is a product question, not a quote request.
// Regression: an rfq.request example carrying the noun "trainers" made every "Vanta Arc Trainer" question an RFQ that escalated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runMessage, msg } from "./helpers/route_run.mjs";
import { resolveScenario, hasQuantity } from "../src/scenarios.mjs";

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

const csv = readFileSync(new URL("../data/synthetic/products.csv", import.meta.url), "utf8");
// a minimal CSV reader for the quoted fields of products.csv
function rowsOf(text) {
  const out = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); out.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out;
}
const [head, ...body] = rowsOf(csv);
const catalogue = body.map((r) => ({ name: r[head.indexOf("name")], aliases: r[head.indexOf("aliases")].split(";").filter(Boolean), sku: r[0] }));
const plural = (w) => (/(?:s|x|ch|sh)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
// every name and alias is swept in the singular (the P-codes too); only word names and aliases are pluralised
const isCode = (a) => /^P\d+$/.test(a);
const phrases = catalogue.flatMap((p) => [p.name, ...p.aliases].flatMap((n) => (isCode(n) ? [n] : [n, plural(n)])));

test("sweep: every catalogue name, alias and plural, asked what it is made of, is a product question (never RFQ, refund or legacy)", async () => {
  assert.ok(phrases.length > 100);
  const bad = [];
  for (const ph of phrases) {
    const { result } = await ask(`What is the ${ph} made of?`);
    if (result.scenario !== "product" || !["product-hit", "product-unanswered"].includes(result.branch_id)) bad.push(`${ph} -> ${result.scenario}/${result.branch_id}`);
  }
  assert.deepEqual(bad, []);
});

test("a quantity-bound price request is an RFQ whatever number it carries, and whether or not Scout scores it", async () => {
  for (const q of ["How much for 51 Strand Emitter Hilts?", "How much for 50 Strand Emitter Hilts?", "What is the price for 73 Quartermaster Utility Belts?", "I want to order 12 Vanta Arc Trainers", "What would 300 Wayfarer Long Cloaks cost?"]) {
    const { result } = await ask(q);
    assert.equal(result.scenario, "rfq", q);
  }
});

test("spelled-out quantities count: a price for fifty, twenty-five, a dozen", async () => {
  for (const q of ["We need a price for fifty Vanta Arc Trainers for the new academy wing", "Please quote twenty-five Vanta Arc Trainers", "How much for a dozen Strand Emitter Hilts?", "price for two hundred hilts"]) {
    const { result } = await ask(q);
    assert.equal(result.scenario, "rfq", q);
  }
});

test("money, dates and unrelated counts are not quantities; a lone attribute word needs commercial context", async () => {
  const hit = { all: [{ row: { sku: "FS-B01", name: "Vanta Arc Trainer", aliases: "" } }] };
  for (const t of ["189 GC", "on 24/10", "on 2026/10/24", "2 questions about the Vanta Arc Trainer", "JP-1008", "costs 189 GC for the Vanta Arc Trainer"]) assert.equal(hasQuantity(t, hit), false, t);
  for (const t of ["50 Vanta Arc Trainers", "fifty vanta arc trainers", "20 units", "a dozen units", "twenty-five Vanta Arc Trainers"]) assert.equal(hasQuantity(t, hit), true, t);
  const decided = { intent: { primary: { id: "rfq.request" }, confidence: 0.9 } };
  for (const q of ["What is the volume and price of the Core Crystal Cleaning Solution?", "Do you give a discount on the Vanta Arc Trainer?", "I have 2 questions about the Vanta Arc Trainer, it costs 189 GC on 24/10"]) {
    assert.notEqual(resolveScenario({ kind: "message", text: q, decided, productHit: hit }).scenario, "rfq", q);
  }
  const { result } = await ask("What is the volume and price of the Core Crystal Cleaning Solution?");
  assert.equal(result.scenario, "product");
});

// ---- the table: one row per phrase either Codex review named, plus counterexamples of my own for each rule ----
// [text, expected scenario ("!x" = anything but x), rule]
const TABLE = [
  // A: one predicate for keeping and promoting
  ["How much for 51 Strand Emitter Hilts?", "rfq", "A: price for a count, not in the examples"],
  ["How much for 50 Strand Emitter Hilts?", "rfq", "A"],
  ["How much for 51 Drift Vault Cases?", "rfq", "B: Cases/Case agree"],
  ["What is the price for 73 Quartermaster Utility Belts?", "rfq", "A"],
  ["What would 300 Wayfarer Long Cloaks cost?", "rfq", "A: cost with the count"],
  ["50 Strand Emitter Hilts, how much?", "rfq", "A: the count first, how much after"],
  ["We need a price for fifty Vanta Arc Trainers for the new academy wing", "rfq", "A+B: spelled-out count"],
  ["Please quote twenty-five Vanta Arc Trainers", "rfq", "A: hyphenated number word"],
  ["How much for a dozen Strand Emitter Hilts?", "rfq", "A"],
  ["Please quote 20 Vanta Arc Trainers, same as my order JP-1008", "rfq", "A: explicit quote beats the past order"],
  ["I want to order 12 Vanta Arc Trainers", "rfq", "A: order N"],
  ["I bought 2 Vanta Arc Trainers, what are they made of?", "!rfq", "A: past purchase + attribute is not a quote"],
  ["How much do 2 Vanta Arc Trainers weigh?", "product", "A: bare how much is an attribute question"],
  ["How much do 3 Drift Vault Cases weigh?", "product", "A: same, another product"],
  ["I received 4 Strand Emitter Hilts, what colour are they?", "!rfq", "A: past purchase"],
  // B: binding
  ["I have 2 questions: Vanta Arc Trainer price and materials?", "product", "B: no arbitrary skipped word, no clause crossing"],
  ["I have 2 questions about the Vanta Arc Trainer, how much is it?", "product", "B"],
  ["On 24/10 the Vanta Arc Trainer costs 189 GC, what is it made of?", "product", "3: date and money are not counts"],
  // 3: attribute word needs commercial context
  ["What is the volume and price of the Core Crystal Cleaning Solution?", "product", "3: volume alone"],
  ["Do you give a discount on the Vanta Arc Trainer?", "product", "3: discount alone"],
  // C: the override keeps complaint roads
  ["The hilt is cracked and this is unacceptable, what is it made of?", "complaint", "C: complaint cue in the remainder"],
  ["The hilt burned my hand, what is it made of?", "complaint", "C: safety cue"],
  ["What is the Cracked Core Recycling Pouch made of?", "product", "C: the product's own name is not a complaint"],
  ["What are the etiquette cards made of?", "product", "C: refund read, plain product question"],
];

test("table: every named phrase takes its expected road", async () => {
  const bad = [];
  for (const [text, want, rule] of TABLE) {
    const { result } = await ask(text);
    if (want.startsWith("!") ? result.scenario === want.slice(1) : result.scenario !== want) bad.push(`[${rule}] ${text} -> ${result.scenario}/${result.branch_id}, wanted ${want}`);
  }
  assert.deepEqual(bad, []);
});

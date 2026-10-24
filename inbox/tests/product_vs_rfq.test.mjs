// A product question that names the flagship product is a product question, not a quote request.
// Regression: an rfq.request example carrying the noun "trainers" made every "Vanta Arc Trainer" question an RFQ that escalated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runMessage, msg } from "./helpers/route_run.mjs";
import { resolveScenario, matchProductLookup } from "../src/scenarios.mjs";

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

test("resolveScenario: an rfq.request read without a quote / quotation / RFQ / bulk / wholesale word does not take the RFQ road", () => {
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

// ---- the labelled corpus: families of phrases, each with the Scout read it arrives with and the road it must take ----
// tests/fixtures/rfq_corpus.json: { family, text, scout_read, road }. Every phrase Codex reviews 34 to 36 named is in it.
// Labelled to einh's simplest rule (25 Oct): RFQ only on a quote / quotation / RFQ / bulk / wholesale word; rows with a comment field are the blunt rule's accepted cost.
const corpus = JSON.parse(readFileSync(new URL("./fixtures/rfq_corpus.json", import.meta.url), "utf8"));
const lookup = catalogue.map((p) => ({ sku: p.sku, name: p.name, aliases: p.aliases.join(";") }));
const ROADS = { rfq: ["rfq"], product: ["product"], refund: ["refund"], complaint: ["complaint"], "refund/legacy": ["refund", "legacy"], "question/other": ["question", "other", "customer_service"] };

test("corpus: at least 120 phrases, every family has at least 8 variants", () => {
  assert.ok(corpus.length >= 120, `${corpus.length} phrases`);
  const n = {};
  for (const c of corpus) n[c.family] = (n[c.family] ?? 0) + 1;
  for (const [f, k] of Object.entries(n)) if (f !== "non-product-counts" && f !== "complaints-refunds") assert.ok(k >= 8, `${f}: ${k}`);
  assert.ok(new Set(corpus.map((c) => c.scout_read)).size >= 5);
});

test("corpus: every phrase takes its labelled road through resolveScenario with the stated Scout read", () => {
  const bad = [];
  // the rule does not look at Scout's read, so every row is driven under all three reads; a refund or replacement row keeps its own read as well
  for (const c of corpus) {
    const hit = matchProductLookup(c.text, lookup);
    for (const read of new Set(["rfq.request", "order.question", "GENERAL", c.scout_read])) {
      if (/^(refund|replacement)\./.test(c.scout_read) && read !== c.scout_read) continue;
      const r = resolveScenario({ kind: "message", text: c.text, productHit: hit.all.length ? hit : null, decided: { intent: { primary: { id: read }, confidence: 0.9 } } });
      if (!ROADS[c.road].includes(r.scenario)) bad.push(`[${c.family}] (${read}) ${c.text} -> ${r.scenario}, wanted ${c.road}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("corpus: ten representative phrases through the real loop", async () => {
  const pick = ["How much for 51 Strand Emitter Hilts?", "How much for 50 Crimson Cadet Trainers?", "Please quote 20 Vanta Arc Trainers, same as my order JP-1008", "Please send a quotation for the Vanta Arc Trainer", "What is the price for 50 Wayfarer Long Cloaks in size XL?",
    "We would like a quote for your Drift Vault Cases", "I bought 50 Vanta Arc Trainers in bulk. What are they made of?", "I'd like to know the warranty on 2 Vanta Arc Trainers", "How much do 2 Vanta Arc Trainers weigh?", "I have 2 questions: Vanta Arc Trainer price and materials?"];
  const bad = [];
  for (const text of pick) {
    const c = corpus.find((x) => x.text === text);
    assert.ok(c, `${text} is in the corpus`);
    const { result } = await ask(text);
    if (!ROADS[c.road].includes(result.scenario) && !(c.road === "product" && result.scenario === "question")) bad.push(`${text} -> ${result.scenario}/${result.branch_id}, wanted ${c.road}`);
  }
  assert.deepEqual(bad, []);
});

// ---- Codex 38: the safety family, the whole-word strip, and the rule's own words ----
const readsOf = (text, reads, productHit = null) => reads.map((id) => resolveScenario({ kind: "message", text, productHit, decided: { intent: { primary: { id }, confidence: 0.9 } } }).scenario);

test("a quote word does not turn a complaint into a quote: burns, injuries and Scout's own complaint read keep the complaint road", () => {
  for (const t of ["Please quote 10 Vanta Arc Trainers; the last one gave my child burns.", "Please quote 10 hilts, the last one is burning my hand", "Quote 5 hilts: the last batch injured two kids", "Quote for 5 hilts, it hurts to hold"]) {
    assert.deepEqual(readsOf(t, ["complaint", "rfq.request", "GENERAL", "order.question"]), ["complaint", "complaint", "complaint", "complaint"], t);
  }
  // no safety cue: the quote word decides, under a complaint read too (a product name such as "Cracked" is not a complaint)
  assert.deepEqual(readsOf("Please quote 20 Cracked Core Recycling Pouches", ["complaint", "rfq.request", "GENERAL", "order.question"]), ["rfq", "rfq", "rfq", "rfq"]);
});

test("a quote word inside a complaint does not make an RFQ: the complaint cues are read before it, under every read", () => {
  for (const t of ["Your quote is unacceptable. I want to complain to your manager.", "Your quote never arrived, this is terrible"]) {
    assert.deepEqual(readsOf(t, ["complaint", "rfq.request", "GENERAL", "order.question"]), ["complaint", "complaint", "complaint", "complaint"], t);
  }
});

test("the product name is stripped as whole words only: 'tin' inside 'insulting' is not the Twin Core Travel Tin", () => {
  const text = "What is the Twin Core Travel Tin made of? Your replies are insulting.";
  const hit = matchProductLookup(text, lookup);
  assert.ok(hit.all.length > 0);
  assert.notEqual(readsOf(text, ["replacement.request"], hit)[0], "product");
});

test("the rule's words: quotes, quotations, RFQs, bulk, wholesale are RFQ under every read; near-words are not", () => {
  const reads = ["rfq.request", "GENERAL", "order.question", "complaint"];
  for (const t of ["Do you send quotes?", "Where can I get quotations?", "RFQs for hilts", "Bulk pricing for the Strand Emitter Hilt?", "Wholesale price for Drift Boot Wraps?"]) {
    const hit = matchProductLookup(t, lookup);
    assert.deepEqual(readsOf(t, reads, hit.all.length ? hit : null), ["rfq", "rfq", "rfq", "rfq"], t);
  }
  for (const t of ["unquoted Vanta Arc Trainer price?", "bulky packaging price?", "tender price for 10 trainers?"]) {
    const hit = matchProductLookup(t, lookup);
    for (const r of readsOf(t, reads, hit.all.length ? hit : null)) assert.notEqual(r, "rfq", t);
  }
});

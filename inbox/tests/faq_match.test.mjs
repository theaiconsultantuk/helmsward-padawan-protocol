import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tokens } from "../src/engines/scout/index.mjs";
import { matchFaq, blanks, resolveScenario } from "../src/scenarios.mjs";

const file = JSON.parse(readFileSync(new URL("../data/sample/faq.json", import.meta.url), "utf8"));
const { headers, rows } = file[0].result;
const FAQ = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));

test("shipping question hits Q01 with score >= 0.6", () => {
  const h = matchFaq("How long does shipping take to Belgium?", FAQ);
  assert.equal(h.row.faq_id, "Q01");
  assert.ok(h.score >= 0.6);
  assert.ok(h.shared.length >= 2);
});

test("stands question hits the stands row", () => {
  const h = matchFaq("Do you sell lightsaber stands", FAQ);
  assert.equal(h.row.faq_id, "Q06");
});

test("off-topic text misses", () => {
  assert.equal(matchFaq("what is the weather", FAQ), null);
  assert.equal(matchFaq("", FAQ), null);
  assert.equal(matchFaq("shipping", FAQ), null, "one shared token is never a hit");
});

test("contract drift: matchFaq tokenizes through Scout's tokens()", () => {
  const text = "How long does shipping take to Belgium?";
  const h = matchFaq(text, FAQ);
  const pool = new Set([...tokens(h.row.question), ...tokens(h.row.keywords)]);
  const expected = [...new Set(tokens(text))].filter((w) => pool.has(w));
  assert.deepEqual([...h.shared].sort(), expected.sort());
  assert.equal(h.score, expected.length / new Set(tokens(h.row.question)).size);
});

test("blanks finds every [[blank: …]] marker", () => {
  assert.deepEqual(blanks("Hi [[blank: order id]] and [[blank: date]]."), ["order id", "date"]);
  assert.deepEqual(blanks("none"), []);
});

test("the added FAQ rows hit: gift wrapping is Q11, and an exact 0.6 score is still a hit", () => {
  const h = matchFaq("Do you offer gift wrapping?", FAQ);
  assert.equal(h.row.faq_id, "Q11");
  assert.ok(h.score >= 0.6);
  const edge = [{ faq_id: "Qe", question: "alpha beta gamma delta epsilon", keywords: "", answer: "a" }];
  assert.equal(matchFaq("alpha beta gamma", edge).score, 0.6);
  assert.equal(matchFaq("alpha beta", edge), null);
});

test("an order id question reaches the delivery route before the FAQ's 'where is my order' row", () => {
  // the FAQ would hit Q09 on this text; resolveScenario must not leave it there
  assert.equal(matchFaq("Where is my order JP-1001?", FAQ).row.faq_id, "Q09");
  const dec = { intent: { primary: { id: "order.question" }, confidence: 0.9 } };
  assert.equal(resolveScenario({ kind: "message", decided: dec, faqHit: { row: {} }, text: "Where is my order JP-1001?" }).scenario, "delivery");
  assert.equal(resolveScenario({ kind: "message", decided: dec, faqHit: { row: {} }, text: "Where is my order?" }).scenario, "question");
});

test("a thank-you word does not hide an FAQ question: appreciation plus an FAQ hit plus a question mark is the FAQ", () => {
  const dec = { intent: { primary: { id: "appreciation" }, confidence: 0.6 } };
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec, faqHit: { row: {} }, text: "Do you offer gift wrapping?" }), { scenario: "question", how: "faq" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec, faqHit: { row: {} }, text: "Thank you, love the gift wrapping" }), { scenario: "legacy", how: "scout" });
});

test("P13/H05 negation guard: a negation within 3 tokens before a keyword halves its contribution", () => {
  assert.equal(matchFaq("I do not want my money back, I want the blade replaced.", FAQ), null, "the refund FAQ is missed");
  const plain = matchFaq("I want my money back", FAQ);
  assert.equal(plain.row.faq_id, "Q08");
  assert.equal(plain.negated, undefined);
  const half = matchFaq("Can I get my money back for a refund?", FAQ);
  assert.equal(half.score, 1, "no negation, the score is unchanged");
  // a negation too far before the keyword does not count
  assert.equal(matchFaq("not today but later I wonder about my money back refund", FAQ)?.row.faq_id, "Q08");
});

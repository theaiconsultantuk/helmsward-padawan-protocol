import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tokens } from "../src/engines/scout/index.mjs";
import { matchFaq, blanks } from "../src/scenarios.mjs";

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

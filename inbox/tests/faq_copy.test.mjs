// The FAQ is shop copy for a visitor, not a view of the agent's rules (einh, 25 Oct 2026): no approval chain, no owners, no data-table words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rows = JSON.parse(readFileSync(new URL("../public/shop/data/faq.json", import.meta.url), "utf8"));
const answer = (id) => rows.find((r) => r.faq_id === id).answer;

const BANNED = [
  /approv/i, /\bowner\b/i, /sales head/i, /refund owner/i, /\b\d+\s*GC\b/i, /product list/i, /shipping rules/i,
  /\brows?\b/i, /card number/i, /customer service can/i,
];

test("no FAQ answer exposes the approval chain, an owner, a GC limit or the data behind it", () => {
  assert.equal(rows.length, 18);
  for (const r of rows) for (const re of BANNED) assert.ok(!re.test(r.answer), `${r.faq_id} matches ${re}: ${r.answer}`);
});

test("the shipping, colour and region answers carry their house style", () => {
  assert.match(answer("Q01"), /Kessel Run/);
  assert.ok(answer("Q02").startsWith("We ship galaxy-wide"), answer("Q02"));
  assert.match(answer("Q05"), /pink kyber crystals/i);
  assert.match(rows.find((r) => r.faq_id === "Q02").question, /space stations/);
});

test("no demo scenario label uses the word row or rows (einh, 25 Oct 2026)", () => {
  const list = JSON.parse(readFileSync(new URL("../public/demo-scenarios.json", import.meta.url), "utf8"));
  assert.ok(list.length >= 14);
  for (const s of list) assert.ok(!/\brows?\b/i.test(s.label), `${s.id}: ${s.label}`);
});

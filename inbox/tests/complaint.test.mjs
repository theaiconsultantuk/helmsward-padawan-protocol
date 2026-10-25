import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComplaintReadJson, complaintReadMessages, COMPLAINT_READ_SYSTEM } from "../src/prompts.mjs";
import * as sample from "../src/adapters/sample.mjs";
import { SEVERITY_LEVELS, fillQuote, fillCourtesy, QUOTE_TEMPLATE, COURTESY_TEMPLATE } from "../src/prompts.mjs";

const SEVERE = { subject: "No", body: "This is unacceptable, never again, everyone should know", channel: "chat" };
const VENT = { subject: "Dent", body: "the box was dented, I am annoyed, just so you know", channel: "chat" };

test("parseComplaintReadJson: plain and fenced JSON", () => {
  const j = { kind: "genuine", face_risk: true, reasoning: "r", handle: "h" };
  assert.deepEqual(parseComplaintReadJson(JSON.stringify(j)), j);
  assert.deepEqual(parseComplaintReadJson("```json\n" + JSON.stringify(j) + "\n```"), j);
});

test("parseComplaintReadJson: rejects a missing or out-of-enum kind", () => {
  assert.throws(() => parseComplaintReadJson('{"face_risk":true}'), /kind/);
  assert.throws(() => parseComplaintReadJson('{"kind":"angry"}'), /kind/);
  assert.throws(() => parseComplaintReadJson("no json"), /kind/);
});

test("complaintReadMessages: system text and context in the user message", () => {
  const m = complaintReadMessages({ ticket: SEVERE, worldText: "3 earlier threads", provenanceIds: ["t1", "t2"] });
  assert.equal(m[0].role, "system"); assert.ok(m[0].content.startsWith(COMPLAINT_READ_SYSTEM));
  assert.match(m[1].content, /3 earlier threads/); assert.match(m[1].content, /t1, t2/); assert.match(m[1].content, /never again/);
});

test("SEVERITY_LEVELS has 10 entries; frame greets without a stray space", () => {
  assert.equal(SEVERITY_LEVELS.length, 10);
  assert.ok(sample.frame({ sender_name: "" }, "x").startsWith("Hello,\n"));
  assert.ok(sample.frame({ sender_name: "Tilda" }, "x").startsWith("Hello Tilda,\n"));
});

test("sample.complaintRead and severity", () => {
  assert.equal(sample.complaintRead(SEVERE).kind, "genuine");
  assert.ok(sample.severity(SEVERE, { kind: "genuine" }).score >= 9);
  assert.equal(sample.complaintRead(VENT).kind, "vent");
  const v = sample.severity(VENT);
  assert.equal(v.score, 4); assert.ok(v.score <= 6);
  assert.equal(sample.severity(VENT, { publicChannel: true }).score, v.score + 4);
  assert.equal(sample.severity(VENT, { repeat: true }).score, v.score + 2);
  assert.equal(sample.severity({ body: "furious terrible" }, { publicChannel: true, repeat: true }).score, 8, "channel and repeat bumps are capped at 8");
  assert.equal(sample.severity({ body: "my lawyer" }).legend, "10 legal or safety");
});

test("sample.severity splits injury from legal; a plain Trustpilot complaint stays <= 8", () => {
  const legal = sample.severity({ body: "I will sue you in court" });
  assert.equal(legal.score, 10); assert.equal(legal.legal, true);
  assert.equal(sample.severity({ body: "my attorney will call" }).legal, true);
  assert.equal(sample.severity({ body: "the product is unsafe" }).score, 10);
  assert.equal(sample.severity({ body: "the product is unsafe" }).legal, false, "unsafe alone is not a legal threat");
  for (const w of ["I got injured", "it cut my hand", "it burned me", "it hurt"]) {
    const s = sample.severity({ body: w }); assert.equal(s.score, 6, w); assert.equal(s.legal, false, w);
  }
  for (const body of ["furious, terrible, the worst", "slow delivery, disappointed", "meh"]) {
    assert.ok(sample.severity({ body }, { publicChannel: true, repeat: true }).score <= 8, body);
    assert.ok(sample.severity({ body }, { kind: "channel_public" }).score <= 8, body);
  }
  assert.equal(sample.severity(VENT, { kind: "channel_public" }).score, sample.severity(VENT).score + 4, "channel_public kind counts as public");
});

test("frame: one sign-off, team default Support, onBehalf footer", () => {
  const t = { sender_name: "Tilda" };
  assert.equal(sample.frame(t, "x"), "Hello Tilda,\n\nx\n\nBest regards,\nFarstrand Support team");
  assert.equal(sample.frame(t, "x", { team: "Sales" }), "Hello Tilda,\n\nx\n\nBest regards,\nFarstrand Sales team");
  assert.equal(sample.frame(t, "x", { team: "Sales", onBehalf: true }), "Hello Tilda,\n\nx\n\nBest regards,\nFarstrand Sales team\nSent automatically on behalf of the Sales team.");
  assert.ok(sample.frame(t, "x", { onBehalf: true }).endsWith("Sent automatically on behalf of the Support team."));
  const d = sample.draft({ sender_name: "Tilda", subject: "s", category: "question" }, { category: "question" }).text;
  assert.equal(d.match(/Best regards/g).length, 1); assert.doesNotMatch(d, /Sent automatically/);
});

test("sample.draft over-limit refund: routed for approval, no promise", () => {
  const t = { sender_name: "Tilda", subject: "Refund", category: "refund", amount: 400 };
  const d = sample.draft(t, { category: "refund", policy_limit: 150 }, { seed: "correct", overLimit: true });
  assert.match(d.text, /routed for approval/); assert.equal(d.promises.refund_amount, null); assert.doesNotMatch(d.text, /400|will refund/);
});

test("QUOTE_TEMPLATE and COURTESY_TEMPLATE fill with every field", () => {
  const q = fillQuote({ product: "Folding Sun-Blade", quantity: 120, tier: "20 percent", unit_price: 31.2, total: 3744, lead_days: 9,
    parts: [{ part_id: "P1", part_name: "Hilt", needed: 120, short: false }, { part_id: "P2", part_name: "Crystal", needed: 240, short: true }] });
  for (const s of ["Folding Sun-Blade", "120", "20 percent", "31.2 GC", "3744 GC", "9 days", "Hilt x 120", "Crystal x 240 (short on stock)", "valid 14 days"]) assert.ok(q.includes(s), s);
  assert.doesNotMatch(q, /\{\w+\}/);
  const framed = sample.frame({ sender_name: "Ada" }, q, { team: "Sales" });
  assert.ok(framed.startsWith("Hello Ada,")); assert.ok(framed.endsWith("Farstrand Sales team"));
  const c = fillCourtesy({ situation: "your cracked hilt" });
  assert.equal(c, "We are sorry to read what happened with your cracked hilt. We are looking into it now and will come back to you within two working days.");
  assert.ok(COURTESY_TEMPLATE.includes("{situation}") && QUOTE_TEMPLATE.includes("{total}"));
});

test("S5.3-12: parseComplaintReadJson validates the full schema", () => {
  assert.throws(() => parseComplaintReadJson('{"kind":"genuine"}'), /face_risk/);
  assert.throws(() => parseComplaintReadJson('{"kind":"genuine","face_risk":"yes","reasoning":"r","handle":"h"}'), /face_risk/);
  assert.throws(() => parseComplaintReadJson('{"kind":"vent","face_risk":false,"reasoning":"","handle":"h"}'), /reasoning/);
  assert.throws(() => parseComplaintReadJson('{"kind":"vent","face_risk":false,"reasoning":"r","handle":" "}'), /handle/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComplaintReadJson, complaintReadMessages, COMPLAINT_READ_SYSTEM } from "../src/prompts.mjs";
import * as sample from "../src/adapters/sample.mjs";
import { SEVERITY_LEVELS } from "../src/prompts.mjs";

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
  assert.equal(sample.severity({ body: "furious terrible" }, { publicChannel: true, repeat: true }).score, 10);
  assert.equal(sample.severity({ body: "my lawyer" }).legend, "10 legal or safety");
});

test("S5.3-12: parseComplaintReadJson validates the full schema", () => {
  assert.throws(() => parseComplaintReadJson('{"kind":"genuine"}'), /face_risk/);
  assert.throws(() => parseComplaintReadJson('{"kind":"genuine","face_risk":"yes","reasoning":"r","handle":"h"}'), /face_risk/);
  assert.throws(() => parseComplaintReadJson('{"kind":"vent","face_risk":false,"reasoning":"","handle":"h"}'), /reasoning/);
  assert.throws(() => parseComplaintReadJson('{"kind":"vent","face_risk":false,"reasoning":"r","handle":" "}'), /handle/);
});

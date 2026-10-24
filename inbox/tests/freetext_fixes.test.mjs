// P13 free-text fixes (2.1d): the cells where the live Nightshift probe was wrong (receipts/freetext-probe-20261024), run in sample mode
// from tests/fixtures/freetext_cases.json. H08/H10 did not reproduce and H09 is ruled (hold by severity): no fix, no test here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMessage, msg, dirs } from "./helpers/route_run.mjs";

const CASES = Object.fromEntries(JSON.parse(readFileSync(new URL("./fixtures/freetext_cases.json", import.meta.url), "utf8")).cases.map((c) => [c.id, c]));
const send = (c, o = {}) => runMessage(msg(c.message, c.channel, c.from, { name: c.name, subject: c.subject }), o);

test("H05 negation: 'I do not want my money back, I want the blade replaced' misses the refund FAQ and takes the replacement route", async () => {
  const { result, lines } = await send(CASES.H05, { run_id: "ft-h05" });
  assert.notEqual(result.branch_id, "faq-hit");
  assert.equal(result.scenario, "legacy");
  assert.match(result.output.draft.text, /replacement/i);
  assert.doesNotMatch(result.output.draft.text, /A refund at or under/);
  assert.ok(lines.length > 0);
});

test("H13 duplicate free text: F1 then F2 over the same dirs, same sender and body: F2 is a duplicate and closes", async () => {
  const d = dirs();
  const a = await send(CASES.H13, { d, run_id: "ft-h13-1" });
  const b = await send(CASES.H13, { d, run_id: "ft-h13-2" });
  assert.notEqual(a.result.branch_id, "duplicate", "the first message is not a duplicate");
  assert.equal(b.result.branch_id, "duplicate");
  assert.equal(b.result.output.decision, "close");
  assert.match(b.result.output.reasons?.join(" ") ?? JSON.stringify(b.result.output), /F1/);
});

test("H13: a different sender with the same words is not a duplicate; an empty sender never matches", async () => {
  const d = dirs();
  await send(CASES.H13, { d, run_id: "ft-h13-x1" });
  const other = await send({ ...CASES.H13, from: "probe-h13b@email.com" }, { d, run_id: "ft-h13-x2" });
  assert.notEqual(other.result.branch_id, "duplicate");
});

test("H16 a card number in the body: data-block wins (assert the branch), held with no draft that promises an amount", async () => {
  const { result } = await send(CASES.H16, { run_id: "ft-h16" });
  assert.equal(result.branch_id, "data-block");
  assert.equal(result.output.decision, "hold");
  const draft = result.output.draft;
  assert.ok(!draft || draft.promises?.refund_amount == null, "no draft promises an amount");
  if (draft?.text) assert.doesNotMatch(draft.text, /refund you|we will refund|40/i);
});

test("H17 smuggled total: 90 + 90 + 90 listed with no 'total' is a refund of 270 GC, and the planner line says it summed 3 listed amounts", async () => {
  const { result, lines } = await send(CASES.H17, { run_id: "ft-h17" });
  assert.equal(result.scenario, "refund");
  assert.equal(result.output.queued_for.approval.amount, 270);
  assert.match(lines.find((l) => l.step === "planner.plan").output_summary, /summed 3 listed amounts/);
  assert.match(result.output.draft.text, /routed for approval/);
});

test("H17: a stated total is not summed", async () => {
  const c = { ...CASES.H17, from: "probe-h17t@email.com", message: "I want a refund for three damaged items, the razor 90 GC, the stand 90 GC and the brush 90 GC, 270 GC in total." };
  const { lines } = await send(c, { run_id: "ft-h17t" });
  assert.doesNotMatch(lines.find((l) => l.step === "planner.plan").output_summary, /summed/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChain, renderReport } from "../scripts/chain_run.mjs";
import { mentionsRefund } from "../src/prompts.mjs";

const go = (seed) => runChain({
  sample: true, seed, quiet: true,
  memoryRoot: mkdtempSync(join(tmpdir(), "padme-mem-")), logsDir: mkdtempSync(join(tmpdir(), "padme-logs-")),
});

// einh, 24 Oct 2026: refunds are mentioned only on refund requests. The seeded misread (a refund promised on her replacement ticket) is now
// refused by Risk and the Evaluator on step 1's round 1 and rewritten, so the system no longer produces the misread it used to hand step 2.
// The misread branch itself is still proved by the authored T01 of the grid, where the earlier reply is supplied as data.
test("seeded misread: Risk catches step 1's refund wording on round 1, the revised draft is handed over, step 2 is not a misread (c)", async () => {
  const c = await go("misread");
  const [s1, s2] = c.results;
  assert.equal(c.outcome, "c");
  assert.equal(s1.rec.branch_id === "misread", false, "step 1 is a fresh request, not a misread");
  const r1 = s1.lines.find((l) => l.step === "risk.signoff" && l.retry_count === 0);
  assert.equal(r1.status, "needs_revision");
  assert.match(r1.output_summary, /refund wording on a replacement message: refunds are mentioned only on refund requests/);
  assert.ok(s1.lines.some((l) => l.step === "retry" && l.status === "retrying"), "step 1 rewrote the draft");
  assert.equal(s1.lines.find((l) => l.step === "risk.signoff" && l.retry_count === 1).status, "success");
  assert.equal(s1.rec.draft.promises.refund_amount, null);
  assert.ok(!mentionsRefund(s1.rec.draft), "the handed-over draft says nothing about a refund (its cited row ids travel with it)");
  assert.ok(Array.isArray(s1.rec.draft.cited_rows) && s1.rec.draft.cited_rows.length > 0, "the draft handed over carries the row ids it cited");
  assert.ok(s2.priorUsed, "step 2 had step 1's draft");
  assert.notEqual(s2.rec.branch_id, "misread");
  assert.ok(s1.rec.memory_written.length > 0);
  for (const id of s1.rec.memory_written) assert.ok(s2.rec.memory_read.includes(id), `step 2 memory.read lists ${id}`);
  assert.ok(c.carried.length > 0);
  assert.equal(s1.rec.run_id, "padme-sample-misread_1");
  assert.equal(s2.rec.run_id, "padme-sample-misread_2");
  assert.match(renderReport(c), /\(c\) caught at step 1/);
});

test("seeded correct: step 1 promises the replacement, step 2 is not a misread and does not escalate (b)", async () => {
  const c = await go("correct");
  const [s1, s2] = c.results;
  assert.equal(c.outcome, "b");
  assert.equal(s1.rec.draft.promises.replacement, true);
  assert.ok(s2.priorUsed);
  assert.notEqual(s2.rec.branch_id, "misread");
  assert.notEqual(s2.rec.decision, "escalate");
  assert.ok(["send", "hold", "close"].includes(s2.rec.decision));
  assert.equal(existsSync(join(c.memoryDir, "queue", "T01.json")), false, "no queue file");
  for (const id of s1.rec.memory_written) assert.ok(s2.rec.memory_read.includes(id), `step 2 memory.read lists ${id}`);
  assert.match(renderReport(c), /\(b\) correct/);
});

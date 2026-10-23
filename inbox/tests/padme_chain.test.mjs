import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChain, renderReport } from "../scripts/chain_run.mjs";

const go = (seed) => runChain({
  sample: true, seed, quiet: true,
  memoryRoot: mkdtempSync(join(tmpdir(), "padme-mem-")), logsDir: mkdtempSync(join(tmpdir(), "padme-logs-")),
});

test("seeded misread: step 1 promises a refund, step 2 detects it and escalates (a)", async () => {
  const c = await go("misread");
  const [s1, s2] = c.results;
  assert.equal(c.outcome, "a");
  assert.equal(s1.rec.branch_id === "misread", false, "step 1 is a fresh request, not a misread");
  assert.equal(s1.rec.draft.promises.replacement, false);
  assert.match(s1.rec.draft.text, /refund/i);
  assert.ok(s2.priorUsed, "step 2 had step 1's draft");
  assert.equal(s2.rec.branch_id, "misread");
  assert.equal(s2.rec.decision, "escalate");
  assert.ok(s2.lines.some((l) => l.step === "critique" && l.status === "needs_revision" && l.branch_id === "misread"));
  assert.ok(s2.lines.some((l) => l.step === "escalate_or_fallback" && l.status === "success"));
  assert.ok(existsSync(join(c.memoryDir, "queue", "T01.json")), "queue file");
  assert.ok(s1.rec.memory_written.length > 0);
  for (const id of s1.rec.memory_written) assert.ok(s2.rec.memory_read.includes(id), `step 2 memory.read lists ${id}`);
  assert.ok(c.carried.length > 0);
  assert.equal(s1.rec.run_id, "padme-sample-misread_1");
  assert.equal(s2.rec.run_id, "padme-sample-misread_2");
  assert.match(renderReport(c), /\(a\) misread detected/);
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

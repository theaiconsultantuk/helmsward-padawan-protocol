// The complaint scenario through runTicket in sample mode (S2.3): vent, genuine, severe, and the public-channel pre-emption.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
const example = (n) => JSON.parse(readFileSync(join(INBOX_ROOT, "input_examples", `example_${n}.json`), "utf8")).input;
async function go(run_id, input) {
  const d = { logsDir: mkdtempSync(join(tmpdir(), "cr-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "cr-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "cr-run-")), quiet: true };
  const result = await runTicket(null, { run_id, cfg, as_of: input.as_of, input, deps: d });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines };
}
const find = (lines, step, action) => lines.find((l) => l.step === step && (!action || l.action === action));

test("vent: complaint-vent holds a calm draft with a vent recommendation", async () => {
  const { result, lines } = await go("cr-vent", example(7));
  assert.equal(result.scenario, "complaint");
  assert.equal(result.branch_id, "complaint-vent");
  assert.equal(result.output.decision, "hold");
  assert.match(result.output.recommendation, /^vent:/);
  assert.ok(result.output.draft?.text);
  const w = find(lines, "meterless.engine", "world_context");
  assert.equal(w.agent_name, "WorldModel");
  assert.match(w.output_summary, /customer none: 0 earlier threads/);
  assert.ok(find(lines, "nvidia.model", "read_complaint"));
  assert.ok(find(lines, "nvidia.model", "severity_gate"));
});

test("genuine: complaint-genuine holds the draft with the handling note", async () => {
  const input = { ...example(7), from: "someone.new@example.com", name: "Sam Tarn", message: "This is unacceptable, the stand arrived broken twice and nobody answers my emails" };
  const { result } = await go("cr-genuine", input);
  assert.equal(result.branch_id, "complaint-genuine");
  assert.equal(result.output.decision, "hold");
  assert.ok(result.output.draft?.text);
  assert.ok(result.output.recommendation.length > 0);
});

test("severe: round 1 hard refusal, no retry, escalates to the complaint owner with the draft and the world", async () => {
  const { result, lines } = await go("cr-severe", example(8));
  assert.equal(result.branch_id, "complaint-severe");
  const risk = find(lines, "risk.signoff");
  assert.equal(risk.status, "refused");
  assert.equal(risk.retry_count, 0);
  assert.equal(find(lines, "retry").status, "skipped");
  assert.equal(result.output.decision, "escalate");
  assert.equal(result.output.queued_for.owner_id, 5);
  assert.ok(result.output.draft?.text, "the draft sits on output.draft (queued_for carries only the owner, queue file and escalation)");
  assert.ok(result.output.queued_for.escalation.severity >= 9);
  assert.ok(result.output.queued_for.escalation.world.length > 0);
  assert.match(find(lines, "meterless.engine", "world_context").output_summary, /3 earlier threads/);
});

test("a complaint on trustpilot is pre-empted by public-channel", async () => {
  const { result, lines } = await go("cr-public", { ...example(8), channel: "trustpilot" });
  assert.equal(result.branch_id, "public-channel");
  assert.equal(result.output.decision, "escalate");
  assert.equal(find(lines, "meterless.engine", "world_context"), undefined);
});

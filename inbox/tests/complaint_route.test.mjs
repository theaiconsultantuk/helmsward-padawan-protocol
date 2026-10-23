// The complaint scenario through runTicket in sample mode (S2.3): vent, genuine, severe, and the public-channel pre-emption.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { handleComplaint } from "../src/scenarios.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
const example = (n) => JSON.parse(readFileSync(join(INBOX_ROOT, "input_examples", `example_${n}.json`), "utf8")).input;
async function go(run_id, input) {
  const d = { logsDir: mkdtempSync(join(tmpdir(), "cr-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "cr-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "cr-run-")), quiet: true };
  const result = await runTicket(null, { run_id, cfg, as_of: input.as_of, input, deps: d });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines, d };
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
  const { result, lines, d } = await go("cr-severe", example(8));
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
  // S5.3-4: the world_threads / products query lines are in the trace, after the branch line
  const bi = lines.findIndex((l) => l.step === "branch");
  for (const q of ["sql:world_threads", "sql:products"]) assert.ok(lines.findIndex((l, i) => i > bi && l.step === "zetaris.query" && l.action === q) > -1, q + " traced after the branch line");
  // S5.3-9: sample mode: the rules read and the rules severity are skipped, not successful model calls
  const rd = find(lines, "nvidia.model", "read_complaint"), sv = find(lines, "nvidia.model", "severity_gate");
  assert.equal(rd.status, "skipped"); assert.match(rd.output_summary, /^sample mode/);
  assert.equal(sv.status, "skipped"); assert.match(sv.output_summary, /^sample mode/);
  // S5.3-5: the durable queue file holds the escalation
  const q = JSON.parse(readFileSync(join(d.memoryDir, "queue", "F1.json"), "utf8"));
  assert.ok(q.escalation.severity >= 9);
});

test("a complaint on trustpilot is pre-empted by public-channel", async () => {
  const { result, lines } = await go("cr-public", { ...example(8), channel: "trustpilot" });
  assert.equal(result.branch_id, "public-channel");
  assert.equal(result.output.decision, "escalate");
  assert.equal(find(lines, "meterless.engine", "world_context"), undefined);
});

// S5.3-12 / 10: the complaint read repairs an incomplete answer with one traced nudge; a local-lane answer carries no sponsor.
test("an incomplete complaint read gets one nudge, both models named; local lane has no nvidia sponsor", async () => {
  const live = { ...config(), SAMPLE_MODE: "false", OPENJEV_BASE_URL: "http://127.0.0.1:9", OPENJEV_API_KEY: "x" };
  const calls = [];
  const drafter = async (messages) => {
    calls.push(messages.length);
    return calls.length === 1 ? { model: "model-A", lane: "local-lane", text: '{"kind":"genuine"}' }
      : { model: "model-B", lane: "local-lane", text: '{"kind":"genuine","face_risk":true,"reasoning":"repeat failure","handle":"call the customer"}' };
  };
  const out = [];
  const tb = { f: { subject: "Broken", body: "it broke", sender_email: "n@example.com", thread_id: "F9", category: "complaint", owner_id: 5, backup_id: 6 }, ticket: { thread_id: "F9" }, inputText: "it broke",
    queries: { run: async () => ({ objects: [] }) }, o: {}, cfg: live, sampleOn: false, io: { drafter, adapterTrace: { line: () => {} }, signal: undefined } };
  const p = await handleComplaint.probe(tb);
  assert.equal(calls.length, 2, "exactly one nudge");
  assert.equal(p.data.read.kind, "genuine");
  const rd = p.lines.find((l) => l.action === "read_complaint");
  assert.equal(rd.model, "model-B");
  assert.match(rd.output_summary, /models: model-A, then model-B/);
  assert.equal(rd.sponsor, undefined, "local lane carries no nvidia sponsor");
  out.push(rd);
});

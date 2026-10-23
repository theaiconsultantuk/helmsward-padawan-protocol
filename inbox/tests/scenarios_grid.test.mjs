// The status-by-operation grid for the scenario slice: message and thread inputs, declared and resolved, sample mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";

const CELLS = JSON.parse(readFileSync(join(INBOX_ROOT, "tests", "fixtures", "scenario_shapes.json"), "utf8")).cells;
const cfg = () => ({ ...config(), SAMPLE_MODE: "true" });
const dirs = (runtimeDir = mkdtempSync(join(tmpdir(), "sgrid-rt-"))) => ({ logsDir: mkdtempSync(join(tmpdir(), "sgrid-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "sgrid-mem-")), runtimeDir, quiet: true });
async function go({ thread = null, input, as_of }, { d = dirs(), run_id = "sg", extra = {} } = {}) {
  const result = await runTicket(thread, { run_id, cfg: cfg(), as_of, input, deps: { ...d, ...extra } });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines, d };
}
const tokens = (lines) => lines.map((l) => `${l.step}:${l.status}:${l.branch_id ?? ""}`);
function assertSubsequence(actual, expected, label) {
  let i = 0;
  // a trailing ":" (no branch id) matches any branch id
  for (const t of actual) if (t === expected[i] || (expected[i]?.endsWith(":") && t.startsWith(expected[i]))) i += 1;
  assert.equal(i, expected.length, `${label}: expected order not found; matched ${i}/${expected.length}, next wanted ${expected[i]}; actual ${actual.join(" ")}`);
}
const oneOf = (want, got, label) => Array.isArray(want) ? assert.ok(want.includes(got), `${label}: ${got} not in ${want}`) : assert.equal(got, want, label);

test("the scenario grid: every cell decides to its expected branch, decision and order", async () => {
  for (const c of CELLS) {
    // provider spies: a Scout-refused cell must reach neither the gates nor the drafter
    const spy = { gates: 0, drafter: 0 };
    const extra = c.expect.scout_refused ? {
      gates: async () => { spy.gates += 1; return { answers: {}, model: "spy", gate_source: "rules", confidence: 0.5 }; },
      drafter: async () => { spy.drafter += 1; return { model: "spy", text: "{}" }; } } : {};
    const { result, lines } = await go({ thread: c.thread ?? null, input: c.input, as_of: c.as_of }, { extra });
    const e = c.expect, o = result.output;
    assert.equal(result.status, "success", c.id);
    assert.equal(result.scenario, e.scenario, `${c.id} scenario`);
    oneOf(e.resolved_how, result.resolved_how, `${c.id} resolved_how`);
    oneOf(e.branch_id, result.branch_id, `${c.id} branch_id`);
    if (e.decision) assert.equal(o.decision, e.decision, `${c.id} decision`);
    if (e.owner_id !== undefined) assert.equal(o.queued_for?.owner_id ?? o.queued_for?.approval?.approver_id, e.owner_id, `${c.id} owner`);
    for (const x of e.cited_includes ?? []) assert.ok(o.cited_rows.includes(x), `${c.id} cites ${x}`);
    for (const x of e.recommendation_includes ?? []) assert.ok((o.recommendation ?? "").includes(x), `${c.id} recommendation has "${x}": ${o.recommendation}`);
    if (e.draft_absent) assert.ok(!o.draft, `${c.id} has no draft`);
    if (e.draft_present) assert.ok(o.draft?.text, `${c.id} has a draft`);
    for (const x of e.draft_excludes ?? []) assert.ok(!(o.draft?.text ?? "").includes(x), `${c.id} draft excludes ${x}`);
    if (e.scout_refused) {
      assert.ok(lines.some((l) => l.step === "meterless.engine" && l.status === "refused"), `${c.id} Scout refused`);
      assert.ok(!lines.some((l) => l.step === "nvidia.model" && l.status === "success"), `${c.id} no model call`);
      assert.deepEqual(spy, { gates: 0, drafter: 0 }, `${c.id} provider spies saw no call`);
      assert.ok(lines.some((l) => l.step === "zetaris.query" && l.action === "intake_publish"), `${c.id} row appended first`);
    }
    assertSubsequence(tokens(lines), c.sequence, c.id);
    console.log(`${c.id.padEnd(36)}: ${String(result.branch_id).padEnd(20)} ${o.decision}`);
  }
});

test("cold-start twins: the first free-text run is F1 and finds an empty memory, the second is F2 and finds the first", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "sgrid-cold-"));
  const input = { message: "How long does shipping take?", from: "a@example.com", channel: "chat" };
  const a = await go({ input, as_of: "2026-10-20" }, { d: dirs(runtimeDir), run_id: "cold-1" });
  assert.equal(a.result.input.thread_id, "F1");
  const b = await go({ input, as_of: "2026-10-20" }, { d: { ...dirs(runtimeDir), memoryDir: a.d.memoryDir }, run_id: "cold-2" });
  assert.equal(b.result.input.thread_id, "F2");
  const read = (x) => x.lines.find((l) => l.step === "memory.read");
  console.log(`cold-start twins: 1st memory.read "${read(a).output_summary}" | 2nd "${read(b).output_summary}"`);
  assert.match(read(a).output_summary, /empty \(cold first run\)/);
  assert.doesNotMatch(read(b).output_summary, /empty \(cold first run\)/);
});

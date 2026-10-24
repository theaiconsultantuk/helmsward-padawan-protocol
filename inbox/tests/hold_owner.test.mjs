// A3 follow-up (A2): a refund hold names the person it waits for in output.queued_for (s01, s02, s04), s11's team and team_label come from one
// hierarchy row, and the fixture step tokens hold for a LIVE-shaped run (the typed-gates line is a success there, "skipped" in sample).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { runMessage } from "./helpers/route_run.mjs";
import { deriveJourney } from "../src/journey.mjs";

const DEMO = JSON.parse(readFileSync(join(INBOX_ROOT, "public", "demo-scenarios.json"), "utf8"));
const CELLS = JSON.parse(readFileSync(join(INBOX_ROOT, "tests", "fixtures", "scenario_shapes.json"), "utf8")).cells;
const demo = (id) => DEMO.find((s) => s.id === id);
const input = (sc) => ({ message: sc.message, from: sc.email, name: sc.name, subject: sc.subject, channel: sc.channel, scenario: sc.scenario });
const go = (id, extra = {}) => runMessage(input(demo(id)), { as_of: demo(id).as_of, run_id: `ho-${id}-${Object.keys(extra).length}`, extra });

for (const [id, owner] of [["s01", 15], ["s02", 27], ["s04", 15]]) {
  test(`${id}: the refund hold names its owner ${owner} in output.queued_for, and the journey names the person`, async () => {
    const { result, lines } = await go(id);
    const q = result.output.queued_for;
    assert.ok(q, "queued_for is present on the hold");
    assert.equal(result.output.decision, "hold");
    assert.equal(q.owner.employee_id, owner);
    assert.ok(q.owner.name, "named");
    assert.equal(q.owner.team, "Support");
    assert.equal(q.owner.team_label, "Helpful Hands Hangar");
    assert.equal(q.team, "Support");
    assert.equal(q.team_label, "Helpful Hands Hangar");
    assert.ok(!("queue_file" in q) || q.queue_file == null, "a plain hold has no queue file");
    assert.deepEqual(result.output.owner, q.owner);
    const j = deriveJourney(result, lines);
    assert.equal(j.human.reply.to?.employee_id ?? j.human.reply.to?.id, owner, "the reply is addressed to the owner");
    assert.equal(j.team, "Support");
    assert.equal(j.team_label, "Helpful Hands Hangar");
    assert.equal(j.reached_human.who.employee_id, owner);
    assert.ok(!("queue_file" in j.reached_human), "a plain hold writes no queue file, so the key is absent");
  });
}

test("s11: the FAQ auto reply is signed by Support with Support's own label, never Product's", async () => {
  const { result, lines } = await go("s11");
  const o = result.output;
  const j = deriveJourney(result, lines);
  assert.equal(j.team, "Support");
  assert.equal(j.team_label, "Helpful Hands Hangar");
  assert.equal(o.owner.employee_id, 15);
  assert.equal(o.owner.team, "Support");
  assert.equal(o.owner.team_label, "Helpful Hands Hangar");
  assert.equal(o.team, "Support");
  assert.equal(o.team_label, "Helpful Hands Hangar");
});

// ---- item 7: the live reading ----
// The live typed-gates call logs a SUCCESS line; sample logs "skipped". The fixture must hold for both.
const liveGates = async (ticket, facts, { trace }) => {
  trace.line({ step: "nvidia.model", agent_name: "Gates", action: "typed_gates", sponsor: "nvidia", input_summary: "g", output_summary: "live gates", status: "success", model: "openjev-test", gate_source: "openjev" });
  return { answers: { is_follow_up: 0.1, category: { choice: "other", confidence: 0.9 } }, model: "openjev-test", gate_source: "openjev", confidence: 0.9 };
};
const tokens = (lines) => lines.map((l) => `${l.step}:${l.status}:${l.branch_id ?? ""}`);
// the same matcher as scripts/scenario_proofs.mjs: ordered subsequence, a token ending in ":" matches any branch id
function missing(actual, expected) {
  let i = 0;
  for (const t of actual) if (i < expected.length && (t === expected[i] || (expected[i].endsWith(":") && t.startsWith(expected[i])))) i += 1;
  return expected.slice(i);
}
for (const [id, cell] of [["s05", "s05-product-hit"], ["s06", "s06-product-unanswered"], ["s11", "s11-other-faq-hit"]]) {
  test(`${id}: a live-shaped run (gates line is a success) carries the fixture tokens, and so does sample`, async () => {
    const seq = CELLS.find((c) => c.id === cell).sequence;
    const live = await go(id, { gates: liveGates });
    assert.equal(live.lines.find((l) => l.action === "typed_gates").status, "success", "the live reading reached the trace");
    assert.deepEqual(missing(tokens(live.lines), seq), [], `${id} live`);
    const sample = await go(id);
    assert.deepEqual(missing(tokens(sample.lines), seq), [], `${id} sample`);
  });
}

for (const id of ["s13", "s14"]) {
  test(`${id}: the empty-branch fixture tokens match whatever complaint branch the run takes`, async () => {
    const cell = CELLS.find((c) => c.id === (id === "s13" ? "s13-trustpilot-complaint" : "s14-direct-email-complaint"));
    assert.ok(cell.sequence.some((t) => t.endsWith(":")), "the cell uses prefix tokens");
    for (const extra of [{}, { gates: liveGates }]) {
      const r = await go(id, extra);
      assert.deepEqual(missing(tokens(r.lines), cell.sequence), [], `${id} ${Object.keys(extra).length ? "live" : "sample"}`);
    }
  });
}

// 2.1d: every decision names the person it waits for (or was sent on behalf of): output.owner {employee_id, name, role, team, team_label},
// the same object in queued_for.owner when there is a queue entry. And the s01 single-amount regression (one amount is never read as two).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { runMessage, msg } from "./helpers/route_run.mjs";

const THREADS = readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(0, 24);
const SHAPE = ["employee_id", "name", "role", "team", "team_label"];
const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "own-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "own-mem-")), quiet: true });

test("s01: one amount in a refund message is that amount, not double (80 GC for the Drift Boots: hold, under-floor, owner 15)", async () => {
  const { result, lines } = await runMessage(msg("I would like a refund of 80 GC for my Drift Boots, they are too small for my son.", "contact-form", "s01@email.com", { name: "Sam One", scenario: "refund" }), { as_of: "2026-10-25", run_id: "own-s01" });
  assert.equal(result.branch_id, "under-floor");
  assert.equal(result.output.decision, "hold");
  assert.equal(result.output.owner.employee_id, 15);
  assert.doesNotMatch(lines.find((l) => l.step === "planner.plan").output_summary, /summed/);
  assert.match(lines.find((l) => l.step === "branch").input_summary, /amount 80\b/);
});

test("the 24 threads: output.owner names a person on every decision, and queued_for carries the same object", async () => {
  for (const t of THREADS) {
    const r = await runTicket(t.thread_id, { run_id: `own-${t.thread_id}`, cfg: { ...config(), SAMPLE_MODE: "true" }, deps: dirs() });
    const o = r.output.owner;
    assert.ok(o && o.employee_id != null, `${t.thread_id} (${r.output.decision}) has an owner`);
    assert.deepEqual(Object.keys(o), SHAPE);
    if (r.output.queued_for) assert.deepEqual(r.output.queued_for.owner, o, t.thread_id);
  }
});

const MSGS = [
  ["plain hold", "I want a refund of 100 GC for my cracked saber", "contact-form", "refund", 15],
  ["over-limit approver", "I want a refund of 400 GC for my cracked saber", "email", "refund", 40],
  ["product hit (sent for Product)", "What is the primary material used in the Sovereign Arc Duellist?", "contact-form", null, 5],
  ["faq hit (sent for Support)", "Do you offer gift wrapping?", "chat", null, 15],
];
for (const [label, text, channel, scenario, id] of MSGS) {
  test(`message: ${label} names the owner ${id}`, async () => {
    const { result } = await runMessage(msg(text, channel, `own.${id}.${label.length}@email.com`, { name: "Own Er", ...(scenario ? { scenario } : {}) }), { as_of: "2026-10-25", run_id: `own-m-${label.length}` });
    assert.equal(result.output.owner.employee_id, id, `${label}: ${result.branch_id}/${result.output.decision}`);
    assert.ok(result.output.owner.name);
  });
}

test("the 14 demo scenarios: output.owner.employee_id is non-null on every one", async () => {
  const demo = JSON.parse(readFileSync(join(INBOX_ROOT, "public", "demo-scenarios.json"), "utf8"));
  const list = Array.isArray(demo) ? demo : demo.scenarios;
  assert.ok(list.length >= 14);
  for (const sc of list) {
    const input = { ...sc, from: sc.email };
    const { result } = await runMessage({ message: input.message, from: input.from, name: input.name, subject: input.subject, channel: input.channel, scenario: input.scenario }, { as_of: sc.as_of ?? input.as_of ?? "2026-10-25", run_id: `own-d-${sc.id ?? Math.random()}` });
    assert.ok(result.output.owner?.employee_id != null, `${sc.id}: ${result.branch_id}/${result.output.decision}`);
  }
});

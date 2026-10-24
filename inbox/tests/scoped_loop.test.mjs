// Scoped facts through runTicket in sample mode (CP2 Task 2.1): messages read only what their route needs; threads keep the full read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
const example = (n) => JSON.parse(readFileSync(join(INBOX_ROOT, "input_examples", `example_${n}.json`), "utf8")).input;
const mkDeps = () => ({ logsDir: mkdtempSync(join(tmpdir(), "sl-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "sl-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "sl-run-")), quiet: true });
async function go(run_id, input, { thread_id = null, as_of, d = mkDeps() } = {}) {
  const result = await runTicket(thread_id, { run_id, cfg, as_of: as_of ?? input?.as_of, input, deps: d });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines, d, q: lines.filter((l) => l.step === "zetaris.query").map((l) => l.action) };
}
const find = (lines, step, action) => lines.find((l) => l.step === step && (!action || l.action === action));
const count = (q, a) => q.filter((x) => x === a).length;
const msg = (message, scenario, as_of = "2026-10-20") => ({ message, from: "new.customer@example.com", name: "Rey Kanata", channel: "chat", ...(scenario ? { scenario } : {}), as_of });
const LEGACY_T02 = ["sql:thread", "sql:policy", "sql:responsibility", "sql:holiday", "sql:holiday", "sql:employee", "sql:employee", "sql:trust", "sql:wiki", "sql:thread_fingerprints"];
const DESK = "contact@jedipack.com";

test("vent (example_7): no policy, one holiday, one employee", async () => {
  const { result, q } = await go("sl-vent", example(7));
  assert.ok(!result.output.cited_rows.some((c) => String(c).startsWith("policy:")), JSON.stringify(result.output.cited_rows));
  assert.equal(count(q, "sql:policy"), 0);
  assert.equal(count(q, "sql:holidays"), 0);
  assert.equal(count(q, "sql:holiday"), 1);
  assert.equal(count(q, "sql:employee"), 1);
  assert.equal(result.branch_id, "complaint-vent");
  assert.equal(result.output.decision, "hold");
  assert.equal(result.output.queued_for.owner_id, 5);
});

test("calibration: a vent that mentions 400 USD is never over-limit", async () => {
  const { result } = await go("sl-cal", msg("I paid 400 USD for it and the box was dented, I am annoyed, just so you know", "complaint"));
  assert.ok(result.branch_id.startsWith("complaint-"), result.branch_id);
  assert.ok(!result.output.cited_rows.includes("policy:refund"));
  assert.equal(result.output.queued_for?.approval, undefined);
});

test("rfq (example_6): no policy read, owner 6", async () => {
  const { result, q } = await go("sl-rfq", example(6));
  assert.equal(count(q, "sql:policy"), 0);
  assert.equal(result.output.queued_for.owner_id, 6);
  assert.ok(result.output.cited_rows.includes("responsibility:rfq"));
});

test("refund 400 USD: policy read, over-limit, approver 3 (pinned)", async () => {
  const { result, q } = await go("sl-ref", msg("I want a refund of 400 USD for my cracked saber", "refund"));
  assert.ok(count(q, "sql:policy") >= 1);
  assert.equal(result.branch_id, "over-limit");
  assert.equal(result.output.queued_for.approval.approver_id, 3);
  assert.ok(result.output.cited_rows.includes("policy:refund"));
});

test("both approvers out on an over-limit refund: the contact desk", async () => {
  const { result, lines } = await go("sl-ref-out", msg("I want a refund of 400 USD for my cracked saber", "refund", "2026-10-09"));
  assert.equal(result.branch_id, "over-limit");
  assert.equal(result.output.decision, "escalate");
  assert.equal(result.output.queued_for.fallback_contact.email, DESK);
  assert.match(find(lines, "branch").output_summary, /routed to the default contact/);
  assert.ok(result.output.cited_rows.includes("contacts:default"));
  assert.ok(result.output.cited_rows.includes("policy:refund"));
});

test("stored thread T02, nobody in (2026-10-27): routed to the contact desk (einh's pick B)", async () => {
  const { result, q } = await go("sl-t02-out", null, { thread_id: "T02", as_of: "2026-10-27" });
  assert.equal(result.branch_id, "owner-out");
  assert.equal(result.output.decision, "escalate");
  assert.equal(result.output.queued_for.fallback_contact.email, DESK);
  assert.ok(result.output.cited_rows.includes("contacts:default"));
  const want = [...LEGACY_T02.slice(0, 7), "sql:contact", ...LEGACY_T02.slice(7)];
  assert.deepEqual(q, want);
});

test("a legacy-resolved message is scoped too", async () => {
  const { result, q } = await go("sl-repl", msg("please replace my cracked saber, it arrived broken", undefined));
  assert.equal(result.scenario, "legacy");
  assert.equal(count(q, "sql:policy"), 0);
  assert.equal(count(q, "sql:holidays"), 0);
  assert.ok(!result.output.cited_rows.some((c) => String(c).startsWith("policy:")));
});

test("both out (example_7, 2026-09-29): owner-out, contact desk, queue file, hard refusal, no retry", async () => {
  const input = { ...example(7), as_of: "2026-09-29" };
  const { result, lines, d } = await go("sl-both", input);
  assert.equal(result.output.decision, "escalate");
  assert.equal(result.branch_id, "owner-out");
  const qf = result.output.queued_for;
  assert.equal(qf.fallback_contact.email, DESK);
  assert.equal(qf.role, "default contact");
  assert.equal(qf.owner_id, 5);
  assert.equal(qf.backup_id, 6);
  assert.ok(result.output.cited_rows.includes("contacts:default"));
  assert.match(find(lines, "branch").output_summary, /routed to the default contact contact@jedipack\.com/);
  assert.match(find(lines, "escalate_or_fallback").output_summary, /escalated to the default contact/);
  const file = JSON.parse(readFileSync(join(d.memoryDir, "queue", "F1.json"), "utf8"));
  assert.equal(file.owner.fallback_contact.email, DESK);
  const risk = find(lines, "risk.signoff");
  assert.equal(risk.status, "refused");
  assert.equal(risk.retry_count, 0);
  assert.equal(find(lines, "retry").status, "skipped");
});

test("cold-start twin of both out: second run on the same memory decides the same", async () => {
  const input = { ...example(7), as_of: "2026-09-29" };
  const d = mkDeps();
  const a = await go("sl-twin-1", input, { d });
  const b = await go("sl-twin-2", input, { d });
  assert.equal(a.result.output.decision, "escalate");
  assert.equal(b.result.output.decision, a.result.output.decision);
  assert.notEqual(find(b.lines, "memory.read")?.output_summary, "empty (cold first run)");
});

test("legacy thread T02 keeps its exact query sequence", async () => {
  const { q } = await go("sl-t02", null, { thread_id: "T02" });
  assert.deepEqual(q, LEGACY_T02);
});

test("a declared scenario on a thread never scopes it", async () => {
  const { result, q, lines } = await go("sl-t02-q", { scenario: "question" }, { thread_id: "T02" });
  assert.equal(result.scenario, "question");
  // The facts read is the legacy one, whole; the question handler's own reads (faq, wiki, ...) follow it.
  assert.deepEqual(q.slice(0, LEGACY_T02.length), LEGACY_T02);
  const pol = lines.find((l) => l.step === "zetaris.query" && l.action === "sql:policy");
  assert.match(JSON.stringify(pol), /150/, "the refund limit is still read for a thread");
});

// The status-by-operation grid: all 24 authored outcomes in sample mode, plus the two recovery pairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { resetFaults } from "../src/adapters/zetaris.mjs";

const THREADS = readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(0, 24);
const SHAPES = JSON.parse(readFileSync(join(INBOX_ROOT, "tests", "fixtures", "trace_shapes.json"), "utf8"));

const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "grid-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "grid-mem-")), quiet: true });
const cfgOf = (extra = {}) => ({ ...config(), SAMPLE_MODE: "true", ...extra });
async function go(id, { d = dirs(), run_id = `grid-${id}`, extra } = {}) {
  const result = await runTicket(id, { run_id, cfg: cfgOf(extra), deps: d });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines, d };
}
const tokens = (lines) => lines.map((l) => `${l.step}:${l.status}`);
function assertSubsequence(actual, expected, label) {
  let i = 0;
  for (const t of actual) if (t === expected[i]) i += 1;
  assert.equal(i, expected.length, `${label}: expected order not found; matched ${i}/${expected.length}, next wanted ${expected[i]}; actual ${actual.join(" ")}`);
}

test("the grid: all 24 authored threads decide to their authored outcome", async () => {
  assert.equal(THREADS.length, 24);
  const rows = [];
  for (const t of THREADS) {
    const { result } = await go(t.thread_id);
    rows.push({ id: t.thread_id, authored: t.outcome, got: result.output.decision, branch_id: result.branch_id });
  }
  console.log("\nid  | authored | got      | branch_id");
  for (const r of rows) console.log(`${r.id.padEnd(3)} | ${r.authored.padEnd(8)} | ${r.got.padEnd(8)} | ${r.branch_id}${r.authored === r.got ? "" : "   <-- MISMATCH"}`);
  const bad = rows.filter((r) => r.authored !== r.got);
  console.log(`${rows.length - bad.length}/${rows.length} match`);
  assert.deepEqual(bad, []);
});

test("branch ids for the new rules", async () => {
  const want = { T04: "fact-block", T23: "fact-block", T06: "follow-up", T14: "follow-up", T17: "follow-up", T10: "under-floor", T24: "duplicate", T18: "send-ok", T16: "thank-you", T01: "misread" };
  for (const [id, b] of Object.entries(want)) assert.equal((await go(id)).result.branch_id, b, id);
});

test("fact-block escalates (T04, T23): Risk refuses 'fact may not leave', no draft, a queue entry for the owner; data-block does not escalate", async () => {
  for (const id of ["T04", "T23"]) {
    const { lines, result } = await go(id);
    const r = lines.find((l) => l.step === "risk.signoff");
    assert.equal(r.status, "refused");
    assert.match(r.output_summary, /fact may not leave/);
    assert.equal(result.output.decision, "escalate");
    assert.ok(!result.output.draft, `${id} has no draft`);
    assert.ok(existsSync(result.output.queued_for.queue_file), `${id} has a queue file`);
    const q = JSON.parse(readFileSync(result.output.queued_for.queue_file, "utf8"));
    assert.ok(q.critiques.some((c) => c.source === "Risk" && /fact may not leave/.test(c.reason)), "the critique is Risk's refusal");
    assert.ok(lines.filter((l) => l.step === "nvidia.model" && l.action !== "typed_gates").every((l) => l.status === "skipped"));
  }
  // data-block: only an unavailable check or a restricted fact in the message; it holds, no queue entry
  const facts = async (id, { trace }) => {
    const { factsForTicket } = await import("../src/queries.mjs");
    return { ...(await factsForTicket(id, { trace, cfg: cfgOf() })), disclosure_unknown: true };
  };
  const d = dirs();
  const r = await runTicket("T18", { run_id: "grid-T18-datablock", cfg: cfgOf(), deps: { ...d, facts } });
  assert.equal(r.branch_id, "data-block");
  assert.equal(r.output.decision, "hold");
  assert.ok(!r.output.queued_for, "data-block does not escalate");
  assert.ok(!r.output.draft);
});

test("T10 (Trustpilot complaint, severity 7) holds with a draft and cites the channel; no branch is keyed on a channel name", async () => {
  const { result } = await go("T10");
  assert.equal(result.output.decision, "hold");
  assert.ok(result.output.draft?.text);
  assert.ok(result.output.cited_rows.includes("channels:trustpilot"));
  assert.notEqual(result.branch_id, "public-channel");
});

test("no 24-thread run cites responsibility:fallback; every run cites its channel row", async () => {
  for (const t of THREADS) {
    const { result } = await go(t.thread_id);
    assert.ok(!result.output.cited_rows.includes("responsibility:fallback"), t.thread_id);
    assert.ok(result.output.cited_rows.includes(`channels:${t.channel}`), `${t.thread_id} cites channels:${t.channel}`);
  }
});

test("T21 and T22 (category other) read the 0.40 trust row", async () => {
  const { factsForTicket } = await import("../src/queries.mjs");
  for (const id of ["T21", "T22"]) {
    const f = await factsForTicket(id, { cfg: cfgOf() });
    assert.equal(f.category_weight, 0.4, id);
    assert.ok(f.cited_rows.includes("trust_ledger:other"));
    assert.ok(!f.notes.some((n) => /trust_ledger:missing/.test(n)));
  }
});

test("invariant: auto_reply implies decision send and a draft text, in every output of the 24", async () => {
  for (const t of THREADS) {
    const { result } = await go(t.thread_id);
    const o = result.output;
    assert.equal(typeof o.auto_reply, "boolean", t.thread_id);
    if (o.auto_reply) { assert.equal(o.decision, "send", t.thread_id); assert.ok(o.draft?.text, t.thread_id); }
    if (o.queued_for) assert.equal(o.queued_for.auto_reply, o.auto_reply, `${t.thread_id} queued_for agrees`);
    assert.equal(typeof o.trusted_to_send, "boolean");
    assert.equal(o.status, o.decision === "send" || o.decision === "close" ? "handled" : "open", t.thread_id);
    assert.ok(Array.isArray(o.cc) && Array.isArray(o.also));
  }
});

test("trusted_to_send is the trust floor as a boolean, beside the weight", async () => {
  assert.equal((await go("T18")).result.output.trusted_to_send, true);   // appreciation 0.84 >= 0.80
  assert.equal((await go("T02")).result.output.trusted_to_send, false);  // refund 0.55 < 0.80
});

test("T05 holds with 'no amount stated'; T24 close names the earlier thread", async () => {
  const t5 = await go("T05");
  assert.equal(t5.result.output.decision, "hold");
  assert.match(t5.lines.find((l) => l.step === "branch").output_summary, /no amount stated on a public channel \(channels:trustpilot\)/);
  const t24 = await go("T24");
  assert.equal(t24.result.output.decision, "close");
  assert.match(t24.result.output.reasons.join(" "), /T11/);
  assert.match(t24.lines.find((l) => l.step === "executor.act").output_summary, /T11/);
});

test("T03 with the owner out and the backup in escalates to the backup for approval (the hero shape)", async () => {
  const facts = async (id, { trace }) => {
    const { factsForTicket } = await import("../src/queries.mjs");
    const f = await factsForTicket(id, { trace, cfg: cfgOf() });
    return { ...f, owner_out: true, backup_out: false };
  };
  const d = dirs();
  const result = await runTicket("T03", { run_id: "grid-T03-hero", cfg: cfgOf(), deps: { ...d, facts } });
  assert.equal(result.output.decision, "escalate");
  assert.equal(result.branch_id, "over-limit");
  assert.equal(result.output.queued_for.approval.approver_id, result.output.queued_for.backup_id);
  const lines = readFileSync(join(d.logsDir, "trace-grid-T03-hero.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(tokens(lines).includes("risk.signoff:refused"), "round 1 refused");
});

test("owner and backup both out escalates", async () => {
  const facts = async (id, { trace }) => {
    const { factsForTicket } = await import("../src/queries.mjs");
    const f = await factsForTicket(id, { trace, cfg: cfgOf() });
    return { ...f, owner_out: true, backup_out: true };
  };
  const result = await runTicket("T02", { run_id: "grid-T02-bothout", cfg: cfgOf(), deps: { ...dirs(), facts } });
  assert.equal(result.output.decision, "escalate");
  assert.equal(result.branch_id, "owner-out");
});

// ---- first run vs second run (same memory dir) x four decisions ----
for (const [id, decision] of [["T18", "send"], ["T02", "hold"], ["T03", "escalate"], ["T16", "close"]]) {
  test(`grid: ${id} ${decision}, first run then second run reads the first run's memory`, async () => {
    const d = dirs();
    const a = await go(id, { d, run_id: `grid-${id}-1` });
    const b = await go(id, { d, run_id: `grid-${id}-2` });
    assert.equal(a.result.output.decision, decision);
    assert.equal(b.result.output.decision, decision);
    assert.deepEqual(a.result.memory.read, [], "first run reads nothing");
    assert.ok(a.result.memory.written.length >= 1);
    for (const m of a.result.memory.written) assert.ok(b.result.memory.read.includes(m), `second run read ${m}`);
    const mr = b.lines.find((l) => l.step === "memory.read");
    for (const m of a.result.memory.written) assert.ok((mr.memory_ids ?? []).includes(m));
  });
}

// ---- the two recovery pairs ----
test("demo-recovery: T02 with a real refused connection still holds, error then recovery from the cache", async () => {
  resetFaults();
  const shape = SHAPES["demo-recovery"];
  const { result, lines } = await go(shape.ticket, { run_id: "grid-demo-recovery", extra: { FAULT_ZETARIS_REFUSE_ONCE: "true" } });
  assert.equal(result.output.decision, shape.decision);
  assert.equal(result.status, "success");
  assert.ok(result.recovered?.length >= 1, "recovered[] lists the refusal");
  const i = lines.findIndex((l) => l.step === "zetaris.query" && l.status === "error");
  assert.ok(i >= 0, "zetaris.query error line");
  assert.match(lines[i].output_summary, /ECONNREFUSED|refused|UpstreamRefused/i);
  assert.equal(lines[i + 1].step, "recovery");
  assert.equal(lines[i + 1].status, "success");
  assert.match(lines[i + 1].output_summary, /answered from the cached rows/);
  assertSubsequence(tokens(lines), shape.sequence, "demo-recovery");
  resetFaults();
});

test("demo-misread: T01 escalates, queueForHuman file exists, critique needs_revision then escalate_or_fallback", async () => {
  const shape = SHAPES["demo-misread"];
  const { result, lines } = await go(shape.ticket, { run_id: "grid-demo-misread" });
  assert.equal(result.output.decision, shape.decision);
  assert.ok(existsSync(result.output.queued_for.queue_file), "queue file exists");
  const c = lines.findIndex((l) => l.step === "critique" && l.status === "needs_revision");
  const e = lines.findIndex((l) => l.step === "escalate_or_fallback" && l.status === "success");
  assert.ok(c >= 0 && e > c, "critique needs_revision precedes escalate_or_fallback");
  assertSubsequence(tokens(lines), shape.sequence, "demo-misread");
});

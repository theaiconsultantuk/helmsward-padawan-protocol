import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket, decideBranch, STEP_ORDER } from "../src/loop.mjs";

// ---- stubs: facts built from the authored threads, no Zetaris ----
const THREADS = Object.fromEntries(
  readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l)).map((t) => [t.thread_id, t]),
);
const WEIGHT = { refund: 0.55, replacement: 0.6, complaint: 0.62, question: 0.71, appreciation: 0.84, other: 0.4 };

function factsFor(id, patch = {}) {
  const t = { ...THREADS[id], ...patch };
  return {
    thread_id: id, category: t.category, amount_usd: t.amount_usd, policy_limit_usd: 150, category_weight: WEIGHT[t.category] ?? 0.4, floor: 0.8,
    owner_id: t.owner_id, backup_id: t.backup_id, owner_name: `Employee ${t.owner_id}`, backup_name: `Employee ${t.backup_id}`,
    owner_out: Boolean(t.owner_out), backup_out: Boolean(patch.backup_out), may_leave: t.may_leave, restricted_terms: ["card number"],
    cited_rows: [`threads_parquet:${id}`, `policy:${t.category}`, `trust_ledger:${t.category}`], received_at: t.received_at, as_of: String(t.received_at).slice(0, 10),
    subject: t.subject, body: t.body, sender_name: t.sender_name, sender_email: t.sender_email, channel: t.channel,
    follow_up_kind: t.follow_up_kind || null, follow_up_body: t.follow_up_body || null, parent_thread_id: t.parent_thread_id || null, ticket: t,
  };
}
const factsStub = (patch = {}) => async (id, { trace }) => {
  const f = factsFor(id, patch[id] ?? {});
  trace?.line({ step: "zetaris.query", agent_name: "Executor", action: "sql:thread", input_summary: "the thread row", output_summary: `1 rows: threads_parquet:${id}`, status: "success", sponsor: "zetaris" });
  return f;
};

const sampleCfg = () => config({ SAMPLE_MODE: "true" });
const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "loop-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "loop-mem-")) });

async function run(id, { d = dirs(), run_id = `t-${id}`, patch, extra = {}, cfg = sampleCfg() } = {}) {
  const result = await runTicket(id, { run_id, cfg, deps: { facts: factsStub(patch), quiet: true, ...d, ...extra } });
  const file = join(d.logsDir, `trace-${run_id}.jsonl`);
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines, d, file };
}
const pairs = (lines) => lines.map((l) => `${l.step}:${l.status}`);

function assertWholeTrace({ result, lines, file }) {
  assert.ok(existsSync(file), "log file exists");
  assert.equal(result.trace_id, result.run_id);
  for (const s of STEP_ORDER) assert.ok(lines.some((l) => l.step === s), `step ${s} present`);
  for (const l of lines) {
    assert.ok(["success", "needs_revision", "retrying", "error", "incomplete", "skipped", "refused"].includes(l.status));
    if (l.status === "skipped") assert.ok(l.output_summary === "gate not reached" || l.output_summary.startsWith("sample mode"), l.output_summary);
    if (l.step === "nvidia.model" && l.output_summary !== "gate not reached") assert.ok(l.model, `nvidia.model line carries a model: ${l.action}`);
  }
  assert.ok(lines.some((l) => l.step === "nvidia.model" && l.action === "typed_gates"), "typed gates line");
  assert.equal(lines.at(-1).step, "synthesis");
  assert.match(lines.at(-1).output_summary, new RegExp(`decision ${result.output.decision}`));
}

test("STEP_ORDER carries the 15 ids", () => {
  assert.equal(STEP_ORDER.length, 15);
  assert.equal(new Set(STEP_ORDER).size, 15);
});

test("decideBranch is pure and follows the stated precedence", () => {
  const f = (t, patch) => factsFor(t, patch);
  assert.equal(decideBranch(f("T01"), null, []).branch_id, "misread");
  assert.equal(decideBranch(f("T16"), null, []).branch_id, "thank-you");
  assert.equal(decideBranch(f("T03"), null, []).branch_id, "over-limit");
  assert.equal(decideBranch(f("T02", { backup_out: true }), null, []).branch_id, "owner-out");
  assert.equal(decideBranch(f("T02"), null, []).branch_id, "under-floor");
  assert.equal(decideBranch(f("T18"), null, []).branch_id, "send-ok");
});

test("T02: hold on under-floor, all 15 steps, then a second run reads the first run's memory", async () => {
  const d = dirs();
  const a = await run("T02", { d, run_id: "t-T02-a" });
  assertWholeTrace(a);
  assert.equal(a.result.output.decision, THREADS.T02.outcome);
  assert.equal(a.result.output.decision, "hold");
  assert.equal(a.result.branch_id, "under-floor");
  assert.ok(a.result.output.draft?.text, "hold carries the draft");
  assert.deepEqual(a.result.memory.read, []);
  assert.equal(a.lines.find((l) => l.step === "memory.read").output_summary, "empty (cold first run)");
  assert.equal(a.result.memory.written.length, 1);
  assert.ok(a.lines.find((l) => l.step === "escalate_or_fallback").status === "skipped");

  const b = await run("T02", { d, run_id: "t-T02-b" });
  assertWholeTrace(b);
  assert.deepEqual(b.result.memory.read, a.result.memory.written);
  const plan = b.lines.find((l) => l.step === "planner.plan");
  assert.match(plan.output_summary, /recalls this customer from an earlier run: the planner reused its decision context and re-read the rows through Zetaris \(amount /);
  assert.doesNotMatch(plan.output_summary, /skipped the facts chunk/);
  assert.match(plan.output_summary, new RegExp(a.result.memory.written[0]));
  assert.equal(b.result.output.decision, "hold");
});

test("T18: send, both critics pass on round 1, no retry", async () => {
  const t = await run("T18");
  assertWholeTrace(t);
  assert.equal(THREADS.T18.outcome, "send");
  assert.equal(t.result.output.decision, "send");
  assert.equal(t.result.branch_id, "send-ok");
  assert.equal(t.result.rounds.length, 1);
  assert.equal(t.lines.find((l) => l.step === "retry").status, "skipped");
  assert.equal(t.lines.find((l) => l.step === "critique").status, "success");
  assert.equal(t.lines.find((l) => l.step === "risk.signoff").status, "success");
});

test("T03: round 1 fails risk.signoff by construction, retry, revised draft, escalate (over the limit, both in)", async () => {
  const t = await run("T03");
  assertWholeTrace(t);
  assert.equal(THREADS.T03.outcome, "escalate");
  assert.equal(t.result.output.decision, "escalate");
  assert.equal(t.result.branch_id, "over-limit");
  const seq = pairs(t.lines);
  const at = (s) => seq.indexOf(s);
  assert.ok(at("risk.signoff:needs_revision") > -1, "round 1 risk.signoff needs_revision");
  assert.ok(at("critique:needs_revision") > -1);
  const order = ["memory.read:success", "planner.plan:success", "delegate:success", "zetaris.query:success", "executor.act:success",
    "meterless.engine:success", "branch:success", "nvidia.model:skipped", "critique:needs_revision", "risk.signoff:needs_revision", "retry:retrying"];
  let pos = -1;
  for (const o of order) { const i = seq.indexOf(o, pos + 1); assert.ok(i > pos, `${o} after position ${pos}: ${seq.join(" ")}`); pos = i; }
  assert.equal(seq.filter((s) => s.startsWith("planner.plan")).length, 2, "second planner.plan before the revised draft");
  const secondPlan = t.lines.map((l, i) => [l, i]).filter(([l]) => l.step === "planner.plan")[1][1];
  const retryAt = t.lines.findIndex((l) => l.step === "retry");
  const drafts = t.lines.map((l, i) => [l, i]).filter(([l]) => l.step === "nvidia.model" && /^draft/.test(l.action));
  assert.equal(drafts.length, 2);
  assert.ok(retryAt < secondPlan && secondPlan < drafts[1][1]);
  assert.equal(t.lines.find((l) => l.step === "retry").retry_count, 1);
  assert.equal(t.result.rounds.length, 2);
  assert.equal(t.result.rounds[0].risk.pass, false);
  assert.equal(t.result.rounds[1].risk.pass, true);
  const esc = t.lines.find((l) => l.step === "escalate_or_fallback");
  assert.equal(esc.status, "success");
  assert.ok(existsSync(t.result.output.queued_for.queue_file));
  assert.match(esc.output_summary, /T03\.json/);
});

test("hero shape: over the limit, owner out, backup in: round 1 needs_revision, round 2 holds for the backup", async () => {
  const t = await run("T03", { patch: { T03: { owner_out: true } } });
  assertWholeTrace(t);
  assert.equal(t.result.output.decision, "hold");
  assert.ok(t.lines.some((l) => l.step === "risk.signoff" && l.status === "needs_revision"));
  assert.equal(t.lines.find((l) => l.step === "escalate_or_fallback").status, "skipped");
  assert.match(t.result.output.draft.text, /not promising it/);
});

test("T01: misread escalates, queue file written, queueForHuman memory id in memory.write", async () => {
  const t = await run("T01");
  assertWholeTrace(t);
  assert.equal(THREADS.T01.outcome, "escalate");
  assert.equal(t.result.output.decision, "escalate");
  assert.equal(t.result.branch_id, "misread");
  assert.ok(existsSync(t.result.output.queued_for.queue_file));
  const q = JSON.parse(readFileSync(t.result.output.queued_for.queue_file, "utf8"));
  assert.ok(q.critiques.length >= 1);
  const esc = t.lines.find((l) => l.step === "escalate_or_fallback");
  const w = t.lines.find((l) => l.step === "memory.write");
  assert.deepEqual(esc.memory_ids.length, 1);
  assert.ok(w.memory_ids.includes(esc.memory_ids[0]), "memory.write names the queueForHuman id");
  assert.equal(w.memory_ids.length, 2);
  assert.equal(t.lines.find((l) => l.step === "retry").status, "skipped");
});

test("T16: a pure thank-you closes early; later gates are skipped, memory.write and synthesis run", async () => {
  const t = await run("T16");
  assertWholeTrace(t);
  assert.equal(THREADS.T16.outcome, "close");
  assert.equal(t.result.output.decision, "close");
  assert.equal(t.result.branch_id, "thank-you");
  for (const s of ["critique", "risk.signoff", "retry", "escalate_or_fallback"]) assert.equal(t.lines.find((l) => l.step === s).status, "skipped", s);
  assert.equal(t.lines.find((l) => l.step === "memory.write").status, "success");
});

test("live path with stubbed model: fenced JSON, JSON nudge, model ids, sponsor rules, evaluator JSON", async () => {
  const live = config({ SAMPLE_MODE: "false" });
  const seen = [];
  const replies = [
    "```json\n" + JSON.stringify({ reply_text: "We will refund 400 USD.", promises: { refund_amount: 400, replacement: false, other: null } }) + "\n```",
    "sorry, here is the thing",       // round 2, first try: not JSON
    JSON.stringify({ reply_text: "We cannot approve that amount today; Employee 4 will follow up.", promises: { refund_amount: null, replacement: false, other: null } }),
  ];
  const drafter = async (messages) => {
    seen.push(messages);
    return { text: replies.shift(), model: "nvidia/nemotron-test", route: "meterless/test", lane: seen.length === 3 ? "local-lane" : undefined };
  };
  const gates = async (ticket, facts, { trace }) => {
    trace.line({ step: "nvidia.model", agent_name: "Gates", action: "typed_gates", sponsor: "nvidia", input_summary: "g", output_summary: "stub gates", status: "success", model: "openjev-test", gate_source: "openjev" });
    return { answers: { is_follow_up: 0.1, category: { choice: "refund", confidence: 0.9 } }, model: "openjev-test", gate_source: "openjev", confidence: 0.9 };
  };
  const critic = async ({ draft }) => (draft.promises.refund_amount > 150 ? { pass: false, reason: "refund above the limit", model: "nvidia/nemotron-test" } : { pass: true, reason: "ok", model: "nvidia/nemotron-test" });
  const t = await run("T03", { cfg: live, extra: { drafter, gates, critic } });
  assertWholeTrace(t);
  const drafts = t.lines.filter((l) => l.step === "nvidia.model" && /^draft/.test(l.action));
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].model, "nvidia/nemotron-test");
  assert.equal(drafts[0].sponsor, "nvidia");
  assert.equal(drafts[0].status, "success");
  assert.equal(drafts[1].sponsor, undefined, "local lane: no sponsor");
  // the drafter prompt never carries the policy limit; the revised prompt carries both critiques
  assert.doesNotMatch(seen[0][1].content, /150/);
  assert.match(seen[1][1].content, /rejected/);
  assert.match(seen[2].at(-1).content, /valid JSON/); // the nudge is the revised round's second call
  assert.equal(t.result.output.decision, "escalate");
  assert.equal(t.result.agents.find((a) => a.name === "Drafter").model, "nvidia/nemotron-test");
});

test("a drafter failure logs error then recovery and the run still ends with a result", async () => {
  const live = config({ SAMPLE_MODE: "false" });
  const drafter = async () => { throw Object.assign(new Error("upstream down"), { name: "UpstreamTimeout" }); };
  const gates = async () => ({ answers: { is_follow_up: 0.1 }, model: "rules", gate_source: "rules", confidence: 0.5 });
  const t = await run("T18", { cfg: live, extra: { drafter, gates } });
  const seq = pairs(t.lines);
  assert.ok(seq.indexOf("nvidia.model:error") > -1);
  assert.equal(seq[seq.indexOf("nvidia.model:error") + 1], "recovery:success");
  assert.equal(t.result.output.decision, "escalate");
  assert.equal(t.result.status, "success");
  assert.equal(t.result.recovered[0].type, "UpstreamTimeout");
  for (const s of STEP_ORDER) assert.ok(t.lines.some((l) => l.step === s), s);
});

test("the whole run is capped at runTimeoutMs", async () => {
  const hang = () => new Promise(() => {});
  const t = await run("T02", { extra: { facts: hang, runTimeoutMs: 40 } });
  assert.equal(t.result.status, "error");
  assert.equal(t.result.error.type, "RunTimeout");
  assert.equal(t.result.output.decision, "escalate");
  assert.ok(t.lines.some((l) => l.step === "recovery" && l.status === "success"));
  assert.equal(t.lines.at(-1).step, "synthesis");
});

test("H4: an always-negative critic stops at exactly two rounds, then escalates; no third draft", async () => {
  const live = config({ SAMPLE_MODE: "false" });
  let drafts = 0;
  const drafter = async () => { drafts += 1; return { text: JSON.stringify({ reply_text: "Thanks, Employee 4 will follow up.", promises: { refund_amount: null, replacement: false, other: null } }), model: "nvidia/nemotron-test" }; };
  const critic = async () => ({ pass: false, reason: "still not right", model: "nvidia/nemotron-test" });
  const gates = async () => ({ answers: { is_follow_up: 0.1 }, model: "rules", gate_source: "rules", confidence: 0.5 });
  const t = await run("T18", { cfg: live, extra: { drafter, critic, gates } });
  const n = (step) => t.lines.filter((l) => l.step === step);
  assert.equal(drafts, 2, "exactly two draft calls");
  assert.equal(n("critique").length, 2);
  assert.equal(n("risk.signoff").length, 2);
  assert.equal(n("retry").length, 1);
  assert.equal(t.lines.filter((l) => l.step === "nvidia.model" && /^draft/.test(l.action)).length, 2);
  assert.equal(n("escalate_or_fallback").length, 1);
  assert.equal(n("escalate_or_fallback")[0].status, "success");
  assert.equal(t.result.output.decision, "escalate");
  assert.equal(t.result.rounds.length, 2);
});

test("H2: a failed queue write is said plainly: incomplete line, error then recovery, queue_file null, decision still escalate", async () => {
  const d = dirs();
  const memoryDir = join(d.memoryDir, "not-a-dir");
  writeFileSync(memoryDir, "i am a file");
  const hmem = { query: () => ({ memories: [], context: "" }), add: () => ({ id: "mem-x" }), queueForHuman: () => { throw new Error("ENOTDIR: queue write"); } };
  const t = await run("T01", { d: { ...d, memoryDir }, extra: { hmem } });
  const esc = t.lines.filter((l) => l.step === "escalate_or_fallback");
  const last = esc.at(-1);
  assert.equal(t.result.output.decision, "escalate");
  assert.equal(last.status, "incomplete");
  assert.match(last.output_summary, /queue write failed, both critiques are in this trace/);
  assert.doesNotMatch(last.output_summary, /stored in/);
  assert.equal(t.result.output.queued_for.queue_file, null);
  const i = t.lines.findIndex((l) => l.step === "escalate_or_fallback" && l.status === "error");
  assert.ok(i > -1 && t.lines[i + 1].step === "recovery" && t.lines[i + 1].status === "success", "error then recovery");
});

// The refund Reader on the live path (24 Oct 2026): replyLoop with the real hardRisk, a passing scripted critic and a scripted io.reader,
// plus two runTicket runs (the blocker regression, live; the sample-mode stand-in). Cases (a) to (j) of the plan's Task 2.3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { replyLoop, runTicket } from "../src/loop.mjs";
import { hardRisk } from "../src/gates.mjs";
import { refundRuleReason } from "../src/prompts.mjs";

// A toolbox like reply_loop.test.mjs, extended with io.reader and io.signal; the real hardRisk, a passing critic.
function toolbox({ f = {}, critiques, reader } = {}) {
  const lines = [];
  const L = (x) => { lines.push(x); return x; };
  const crits = critiques ? [...critiques] : null;
  const tb = {
    f: { thread_id: "X1", category: "complaint", owner_id: 5, backup_id: 6, owner_out: false, backup_out: false, may_leave: true, backup_name: "B", restricted_terms: [], ...f },
    ticket: { thread_id: "X1" },
    L,
    skipped: (step, why) => L({ step, status: "skipped", input_summary: why, output_summary: "gate not reached" }),
    fatal: (step, e) => { throw e; },
    S: { models: {}, memRead: [], rounds: [], draft: null, scoutRisk: "low", branch: { branch_id: "send-ok" }, recovered: [] },
    sampleOn: false, memCtx: "",
    hardRisk,
    maxRounds: 2,
    readerOn: true,
    io: {
      adapterTrace: { line: L },
      drafter: async () => ({ text: JSON.stringify({ reply_text: "draft", promises: { refund_amount: null, replacement: false, other: null } }), model: "stub/drafter" }),
      critic: async () => ({ ...(crits ? (crits.shift() ?? { pass: true, reason: "ok" }) : { pass: true, reason: "ok" }), model: "stub/critic" }),
      reader,
    },
  };
  return { tb, lines };
}
const scripted = (texts) => { let i = 0; return async () => ({ text: JSON.stringify({ reply_text: texts[Math.min(i++, texts.length - 1)], promises: { refund_amount: null, replacement: false, other: null } }), model: "stub/drafter" }); };
const answer = (o) => ({ text: JSON.stringify({ mentions_money_back: false, offers_money: false, customer_asks_refund: false, reason: "clean", ...o }), model: "stub/reader" });
// a reader that answers per call from a script and counts its calls
const readerScript = (answers) => { const fn = async () => answer(answers[Math.min(fn.calls++, answers.length - 1)]); fn.calls = 0; return fn; };
const seq = (lines) => lines.map((l) => `${l.step}:${l.status}`);
const riskLines = (lines) => lines.filter((l) => l.step === "risk.signoff");
const readerLines = (lines) => lines.filter((l) => l.agent_name === "RefundReader");

const VENT = { category: "complaint", amount: null, body: "the box was dented, I am annoyed, just so you know", cited_rows: ["threads_parquet:X1"] };
const QUESTION = { category: "question", policy_limit: 150, cited_rows: ["policy:refund"] };
const POLICY_QUOTE = "Refunds are handled by our refund owner within 14 days.";

test("(a) euphemism on a complaint: the reader's money catch refuses round 1 with (reader:) on the money reason, round 2 clean signs off", async () => {
  const reader = readerScript([{ mentions_money_back: true, offers_money: true, reason: "credit your account with 40 GC" }, {}]);
  const { tb, lines } = toolbox({ f: VENT, reader });
  tb.S.branch = { branch_id: "complaint-vent" };
  tb.io.drafter = scripted(["We will credit your account with 40 GC.", "We are sorry the box arrived dented and have noted it."]);
  const r = await replyLoop(tb, {});
  assert.equal(refundRuleReason({ ...tb.f }, { text: "We will credit your account with 40 GC.", promises: {} }), null, "the word test passes the euphemism");
  const first = riskLines(lines)[0];
  assert.equal(first.status, "needs_revision");
  assert.match(first.output_summary, /draft promises a refund on a complaint message/);
  assert.match(first.output_summary, /\(reader: credit your account with 40 GC\)/);
  assert.equal(lines.filter((l) => l.step === "retry").length, 1);
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 2);
  assert.equal(reader.calls, 2);
  assert.equal(riskLines(lines)[1].status, "success");
  assert.equal(tb.S.models.reader, "stub/reader");
});

for (const [label, body] of [
  ["(b) sarcasm", "Oh sure, like I'd ever see a refund from you lot. When does it ship?"],
  ["(c) cross-clause", "Don't get me wrong. A refund is the last thing I want. When does it ship?"],
]) {
  test(`${label} on a question: the word test lets the policy quote through, the reader refuses it with the RULE reason, round 2 rewritten`, async () => {
    const reader = readerScript([{ mentions_money_back: true, customer_asks_refund: false, reason: "the customer is not asking" }, {}]);
    const f = { ...QUESTION, body };
    const { tb, lines } = toolbox({ f, reader });
    tb.io.drafter = scripted([POLICY_QUOTE, "Your order ships within three days; the confirmation carries the date."]);
    assert.equal(refundRuleReason(tb.f, { text: POLICY_QUOTE, promises: {} }), null, "the word test passes the quote");
    const r = await replyLoop(tb, {});
    const first = riskLines(lines)[0];
    assert.equal(first.status, "needs_revision");
    assert.match(first.output_summary, /refund wording on a question message/);
    assert.match(first.output_summary, /\(reader: the customer is not asking\)/);
    assert.doesNotMatch(first.output_summary, /draft promises a refund/);
    assert.equal(r.rounds, 2);
    assert.equal(r.ok, true);
    assert.equal(r.draft.text, "Your order ships within three days; the confirmation carries the date.");
  });
}

test("(d) the word test refuses first: the reader is never called and the reasons are the word test's own", async () => {
  const reader = readerScript([{ mentions_money_back: true, offers_money: true }]);
  const { tb, lines } = toolbox({ f: { ...VENT, amount: 400 }, reader });
  tb.io.drafter = scripted(["We will refund your 400 GC."]);
  tb.maxRounds = 1;
  const r = await replyLoop(tb, {});
  assert.equal(reader.calls, 0);
  assert.equal(readerLines(lines).length, 0);
  assert.equal(r.ok, false);
  assert.match(riskLines(lines)[0].output_summary, /refund wording on a complaint message: refunds are mentioned only on refund requests/);
  assert.doesNotMatch(riskLines(lines)[0].output_summary, /reader:/);
});

test("(e) reader down: an error line and a recovery line, the word test stands, Risk signs off on round 1", async () => {
  const reader = async () => { throw Object.assign(new Error("reader refused"), { name: "UpstreamRefused" }); };
  const { tb, lines } = toolbox({ f: VENT, reader });
  tb.io.drafter = scripted(["We are sorry the box arrived dented and have noted it."]);
  const r = await replyLoop(tb, {});
  const rl = readerLines(lines);
  assert.equal(rl.length, 1);
  assert.equal(rl[0].status, "error");
  assert.match(rl[0].output_summary, /UpstreamRefused: reader refused/);
  const at = lines.indexOf(rl[0]);
  assert.equal(lines[at + 1].step, "recovery");
  assert.equal(riskLines(lines)[0].status, "success");
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 1);
  assert.equal(tb.S.recovered.length, 1);
});

test("(f) refund category: the reader is never called", async () => {
  const reader = readerScript([{ mentions_money_back: true, offers_money: true }]);
  const { tb, lines } = toolbox({ f: { category: "refund", amount: 100, policy_limit: 150, cited_rows: ["policy:refund"] }, reader });
  tb.io.drafter = scripted(["We will refund your 100 GC this week."]);
  await replyLoop(tb, {});
  assert.equal(reader.calls, 0);
  assert.equal(readerLines(lines).length, 0);
});

test("(g) kill switch: readerOn false logs one skipped line naming REFUND_READER=false and never calls the reader", async () => {
  const reader = readerScript([{ mentions_money_back: true, offers_money: true }]);
  const { tb, lines } = toolbox({ f: VENT, reader });
  tb.readerOn = false;
  tb.io.drafter = scripted(["We are sorry the box arrived dented and have noted it."]);
  const r = await replyLoop(tb, {});
  assert.equal(reader.calls, 0);
  const rl = readerLines(lines);
  assert.equal(rl.length, 1);
  assert.equal(rl[0].status, "skipped");
  assert.match(rl[0].output_summary, /REFUND_READER=false/);
  assert.equal(r.ok, true);
});

test("(h) the critic and the reader both land before the same round's Risk sign-off", async () => {
  const reader = readerScript([{}]);
  const { tb, lines } = toolbox({ f: VENT, reader });
  tb.io.drafter = scripted(["We are sorry the box arrived dented and have noted it."]);
  await replyLoop(tb, {});
  const crit = lines.findIndex((l) => l.step === "critique");
  const read = lines.findIndex((l) => l.agent_name === "RefundReader" && l.step === "nvidia.model");
  const risk = lines.findIndex((l) => l.step === "risk.signoff");
  assert.ok(crit > -1 && read > -1 && risk > -1);
  assert.ok(crit < risk, "critique before risk.signoff");
  assert.ok(read < risk, "reader before risk.signoff");
});

// ---- runTicket: (i) sample mode, (j) the blocker regression on the live path ----
const THREADS = Object.fromEntries(
  readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((t) => [t.thread_id, t]),
);
const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "rr-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "rr-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "rr-run-")), quiet: true });
const traceOf = (d, run_id) => readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("(i) sample mode through runTicket: one skipped RefundReader line (sample/rules), decision and branch unchanged, roster without a model", async () => {
  const input = JSON.parse(readFileSync(join(INBOX_ROOT, "input_examples", "example_7.json"), "utf8")).input;
  const d = dirs();
  const result = await runTicket(null, { run_id: "rr-sample", cfg: { ...config(), SAMPLE_MODE: "true" }, as_of: input.as_of, input, deps: d });
  const rl = readerLines(traceOf(d, "rr-sample"));
  assert.equal(rl.length, 1);
  assert.equal(rl[0].status, "skipped");
  assert.equal(rl[0].model, "sample/rules");
  assert.equal(result.branch_id, "complaint-vent");
  assert.equal(result.output.decision, "hold");
  const agent = result.agents.find((a) => a.name === "RefundReader");
  assert.ok(agent, "the roster lists RefundReader");
  assert.equal("model" in agent, false);
});

test("(j) the blocker: a critic that throws escalates the run while a slow reader is in flight; the last line is synthesis and no read_refund follows the escalation", async () => {
  const id = "T18";
  const t = THREADS[id];
  const facts = async (tid, { trace }) => {
    trace?.line({ step: "zetaris.query", agent_name: "Executor", action: "sql:thread", input_summary: "the thread row", output_summary: `1 rows: threads_parquet:${tid}`, status: "success", sponsor: "zetaris" });
    return {
      thread_id: tid, category: t.category, amount: t.amount, policy_limit: 150, category_weight: 0.84, floor: 0.8,
      owner_id: 4, backup_id: 5, owner_name: "Employee 4", backup_name: "Employee 5", owner_out: false, backup_out: false, may_leave: t.may_leave, restricted_terms: ["card number"],
      cited_rows: [`threads_parquet:${tid}`, "policy:appreciation", "trust_ledger:appreciation"], received_at: t.received_at, as_of: String(t.received_at).slice(0, 10),
      subject: t.subject, body: t.body, sender_name: t.sender_name, sender_email: t.sender_email, channel: t.channel, follow_up_kind: null, follow_up_body: null, parent_thread_id: null, ticket: t,
    };
  };
  const drafter = async () => ({ text: JSON.stringify({ reply_text: "Thank you, Employee 4 passes your words on.", promises: { refund_amount: null, replacement: false, other: null } }), model: "stub/drafter" });
  const critic = async () => { throw Object.assign(new Error("adapter down"), { name: "UpstreamRefused" }); };
  const gates = async () => ({ answers: { is_follow_up: 0.1 }, model: "rules", gate_source: "rules", confidence: 0.5 });
  let readerCalled = 0;
  const reader = () => new Promise((res) => { readerCalled += 1; setTimeout(() => res(answer({ mentions_money_back: true, offers_money: true, reason: "late catch" })), 300); });
  const d = dirs();
  const result = await runTicket(id, { run_id: "rr-blocker", cfg: config({ SAMPLE_MODE: "false" }), deps: { facts, drafter, critic, gates, reader, findDuplicate: async () => null, ledgerAdjust: async () => ({ affirmed: 0, rejected: 0 }), ...d } });
  await new Promise((r) => setTimeout(r, 450)); // a late line from the slow reader would land by now
  const lines = traceOf(d, "rr-blocker");
  assert.equal(readerCalled, 1);
  assert.equal(result.output.decision, "escalate");
  assert.equal(lines.at(-1).step, "synthesis");
  const esc = lines.findIndex((l) => l.step === "escalate_or_fallback" && l.status !== "skipped");
  assert.ok(esc > -1, "the escalation line exists");
  assert.equal(lines.slice(esc + 1).filter((l) => l.action === "read_refund").length, 0, "no read_refund line after the escalation");
});

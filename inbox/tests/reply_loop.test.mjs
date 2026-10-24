import { test } from "node:test";
import assert from "node:assert/strict";
import { replyLoop, overLimitRefusal } from "../src/loop.mjs";

// A stubbed toolbox: lines are collected, the drafter and the critic answer from scripts, Risk's hardRisk finds nothing.
function toolbox({ critiques = [{ pass: true, reason: "ok" }], f = {} } = {}) {
  const lines = [];
  const L = (x) => { lines.push(x); return x; };
  const drafts = [];
  const crits = [...critiques];
  const tb = {
    f: { thread_id: "X1", category: "question", owner_id: 1, backup_id: 2, owner_out: false, backup_out: false, may_leave: true, backup_name: "B", ...f },
    ticket: { thread_id: "X1" },
    L,
    skipped: (step, why) => L({ step, status: "skipped", input_summary: why, output_summary: "gate not reached" }),
    fatal: (step, e) => { throw e; },
    S: { models: {}, memRead: [], rounds: [], draft: null, scoutRisk: "low", branch: { branch_id: "send-ok" } },
    sampleOn: false, memCtx: "",
    hardRisk: () => ({ reasons: [] }),
    maxRounds: 2,
    io: {
      adapterTrace: { line: L },
      drafter: async (messages, o) => {
        drafts.push(messages);
        return { text: JSON.stringify({ reply_text: `draft ${drafts.length}`, promises: {} }), model: "stub/drafter" };
      },
      critic: async () => ({ ...(crits.shift() ?? { pass: false, reason: "no more" }), model: "stub/critic" }),
    },
  };
  return { tb, lines, drafts };
}
const seq = (lines) => lines.map((l) => `${l.step}:${l.status}`);

test("pass on round 1: no retry line, retry skipped", async () => {
  const { tb, lines } = toolbox();
  const r = await replyLoop(tb, { messagesFn: ({ critiques }) => [{ role: "user", content: `m${critiques.length}` }] });
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 1);
  assert.equal(r.retried, false);
  assert.equal(r.draft.text, "draft 1");
  assert.equal(r.crit.pass, true);
  assert.equal(r.risk.pass, true);
  assert.deepEqual(seq(lines), ["nvidia.model:success", "critique:success", "risk.signoff:success", "retry:skipped"]);
  assert.equal(tb.S.draft.text, "draft 1");
  assert.equal(tb.S.rounds.length, 1);
});

test("needs_revision then pass on round 2: one retry, one revised draft, the critiques reach messagesFn", async () => {
  const { tb, lines, drafts } = toolbox({ critiques: [{ pass: false, reason: "too vague" }, { pass: true, reason: "ok" }] });
  const r = await replyLoop(tb, { messagesFn: ({ critiques }) => [{ role: "user", content: `critiques ${critiques.length}` }] });
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 2);
  assert.equal(r.retried, true);
  assert.equal(r.draft.text, "draft 2");
  assert.deepEqual(drafts.map((m) => m[0].content), ["critiques 0", "critiques 2"]);
  assert.deepEqual(seq(lines), ["nvidia.model:success", "critique:needs_revision", "risk.signoff:success", "retry:retrying", "planner.plan:success",
    "nvidia.model:success", "critique:success", "risk.signoff:success"]);
  assert.equal(lines.find((l) => l.action === "draft_revised").retry_count, 1);
});

test("two negative rounds: ok false, rounds 2, one retry line, no further retry", async () => {
  const { tb, lines } = toolbox({ critiques: [{ pass: false, reason: "no" }, { pass: false, reason: "still no" }] });
  const r = await replyLoop(tb, {});
  assert.equal(r.ok, false);
  assert.equal(r.rounds, 2);
  assert.equal(r.retried, true);
  assert.equal(r.crit.reason, "still no");
  assert.equal(lines.filter((l) => l.step === "retry").length, 1);
  assert.deepEqual(seq(lines), ["nvidia.model:success", "critique:needs_revision", "risk.signoff:success", "retry:retrying", "planner.plan:success",
    "nvidia.model:success", "critique:needs_revision", "risk.signoff:success"]);
});

test("hard refusal on round 1: Risk refused, retry skipped, ok false, rounds 1", async () => {
  const { tb, lines } = toolbox();
  const seen = [];
  const r = await replyLoop(tb, { hardRefusal: (f, draft, n) => { seen.push([f.thread_id, draft.text, n]); return "needs a person"; } });
  assert.equal(r.ok, false);
  assert.equal(r.rounds, 1);
  assert.equal(r.retried, false);
  assert.equal(r.risk.hard, true);
  assert.deepEqual(r.risk.reasons, ["needs a person"]);
  assert.deepEqual(seen, [["X1", "draft 1", 1]]);
  assert.deepEqual(seq(lines), ["nvidia.model:success", "critique:success", "risk.signoff:refused", "retry:skipped"]);
  assert.match(lines.find((l) => l.step === "risk.signoff").output_summary, /^Refused: needs a person/);
  assert.match(lines.at(-1).input_summary, /hard fact/);
});

test("the default hardRefusal is the over-limit rule", async () => {
  const f = { amount_usd: 400, policy_limit_usd: 150, owner_id: 3, owner_name: "Employee 3" };
  assert.match(overLimitRefusal({ ...f }), /^amount 400 USD is over the 150 USD limit: needs approval by Employee 3/);
  assert.equal(overLimitRefusal({ ...f, owner_out: true, backup_out: true }), null);
  assert.equal(overLimitRefusal({ amount_usd: 100, policy_limit_usd: 150 }), null);
  const { tb, lines } = toolbox({ f });
  const r = await replyLoop(tb, {});
  assert.equal(r.ok, false);
  assert.equal(r.rounds, 1);
  assert.deepEqual(seq(lines), ["nvidia.model:success", "critique:success", "risk.signoff:refused", "retry:skipped"]);
  assert.match(lines.at(-1).input_summary, /amount needs approval/);
});

// einh, 24 Oct 2026: refunds are mentioned only on refund requests. A vent that names an amount, on the live path (the model's own words,
// the model critic passing): the real Risk refuses the wording on round 1, the draft is rewritten, and a draft that keeps it is never ok.
import { hardRisk } from "../src/gates.mjs";
const VENT = { category: "complaint", amount_usd: 400, policy_limit_usd: null, owner_id: 5, backup_id: 6, owner_out: false, backup_out: false, may_leave: true, restricted_terms: [] };
const scripted = (texts) => { let i = 0; return async () => ({ text: JSON.stringify({ reply_text: texts[Math.min(i++, texts.length - 1)], promises: { refund_amount: null, replacement: false, other: null } }), model: "stub/drafter" }); };

test("vent with an amount: a draft that promises the refund in words is refused by Risk on round 1 and rewritten; the retry names the rule", async () => {
  const { tb, lines } = toolbox({ critiques: [{ pass: true, reason: "ok" }, { pass: true, reason: "ok" }], f: VENT });
  tb.hardRisk = hardRisk;
  tb.S.branch = { branch_id: "complaint-vent" };
  tb.io.drafter = scripted(["We are so sorry. We will refund your 400 USD this week.", "We are sorry the box arrived dented and have noted it."]);
  const r = await replyLoop(tb, {});
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 2);
  assert.deepEqual(seq(lines), ["nvidia.model:success", "critique:success", "risk.signoff:needs_revision", "retry:retrying", "planner.plan:success",
    "nvidia.model:success", "critique:success", "risk.signoff:success"]);
  assert.match(lines.find((l) => l.step === "risk.signoff").output_summary, /refund wording on a complaint message: refunds are mentioned only on refund requests/);
  assert.match(lines.find((l) => l.step === "retry").output_summary, /mention a refund only on a refund request/);
  assert.equal(r.draft.text, "We are sorry the box arrived dented and have noted it.");
});

// einh's B (24 Oct 2026, verbatim "Questions may quote policy"), on the live path through replyLoop with the real hardRisk:
const QUESTION = { category: "question", policy_limit_usd: 150, cited_rows: ["policy:refund"], owner_id: 1, backup_id: 2, owner_out: false, backup_out: false, may_leave: true, restricted_terms: [] };
test("a question that does not ask about refunds, whose draft names one: refused on round 1 and rewritten", async () => {
  const { tb, lines } = toolbox({ critiques: [{ pass: true, reason: "ok" }, { pass: true, reason: "ok" }], f: { ...QUESTION, body: "How long does shipping take?" } });
  tb.hardRisk = hardRisk;
  tb.io.drafter = scripted(["Shipping takes three to five days, and we refund the difference when it is late.", "Shipping takes three to five days; your confirmation carries the estimate."]);
  const r = await replyLoop(tb, {});
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 2);
  assert.match(lines.find((l) => l.step === "risk.signoff").output_summary, /refund wording on a question message/);
  assert.equal(r.draft.text, "Shipping takes three to five days; your confirmation carries the estimate.");
});
test("a question that asks about refunds may quote the policy on round 1; money promised on it is still refused", async () => {
  const f = { ...QUESTION, body: "What is your refund policy for a saber that arrived late?" };
  const a = toolbox({ f }); a.tb.hardRisk = hardRisk;
  a.tb.io.drafter = scripted(["A refund at or under 150 USD can be approved by our refund owner; above that it goes to the manager."]);
  const ra = await replyLoop(a.tb, {});
  assert.equal(ra.ok, true); assert.equal(ra.rounds, 1);
  assert.deepEqual(seq(a.lines), ["nvidia.model:success", "critique:success", "risk.signoff:success", "retry:skipped"]);
  const b = toolbox({ critiques: [{ pass: true, reason: "ok" }, { pass: true, reason: "ok" }], f }); b.tb.hardRisk = hardRisk;
  b.tb.io.drafter = async () => ({ text: JSON.stringify({ reply_text: "We will refund you 50 USD today.", promises: { refund_amount: 50, replacement: false, other: null } }), model: "stub/drafter" });
  const rb = await replyLoop(b.tb, {});
  assert.equal(rb.ok, false);
  assert.match(b.lines.find((l) => l.step === "risk.signoff").output_summary, /draft promises a refund on a question message: money is promised only on refund requests/);
});

test("vent with an amount: a draft that keeps the refund wording on round 2 is never ok", async () => {
  const { tb, lines } = toolbox({ critiques: [{ pass: true, reason: "ok" }, { pass: true, reason: "ok" }], f: VENT });
  tb.hardRisk = hardRisk;
  tb.io.drafter = scripted(["We will refund your 400 USD.", "As said, a refund of 400 USD is on its way."]);
  const r = await replyLoop(tb, {});
  assert.equal(r.ok, false);
  assert.equal(r.rounds, 2);
  assert.deepEqual(lines.filter((l) => l.step === "risk.signoff").map((l) => l.status), ["needs_revision", "needs_revision"]);
});

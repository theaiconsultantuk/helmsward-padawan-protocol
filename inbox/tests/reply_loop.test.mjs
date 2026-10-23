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

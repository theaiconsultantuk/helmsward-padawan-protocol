// Codex review 29 (cc23bad), loop.mjs findings 1, 2 and 4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { runMessage, msg } from "./helpers/route_run.mjs";
import { replyLoop, sendEligible, APPROVAL_ACK, promisesMoney } from "../src/loop.mjs";

const CASES = Object.fromEntries(JSON.parse(readFileSync(join(INBOX_ROOT, "tests", "fixtures", "freetext_cases.json"), "utf8")).cases.map((c) => [c.id, c]));

// finding 1: no model call receives a restricted message
test("H16 card number: no gates, drafter, critic or reader call receives the digits; data-block; the skipped gate step is traced", async () => {
  const seen = [];
  const rec = (name, ret) => async (...args) => { seen.push({ name, text: JSON.stringify(args) }); return ret; };
  const c = CASES.H16;
  const { result, lines } = await runMessage(msg(c.message, c.channel, c.from, { name: c.name, subject: c.subject }), { run_id: "c29-h16", extra: {
    gates: rec("gates", { answers: {}, model: "stub", gate_source: "rules", confidence: 1 }),
    drafter: rec("drafter", { text: "x", model: "stub" }), critic: rec("critic", { pass: true, reason: "", model: "stub" }), reader: rec("reader", { text: "{}", model: "stub" }),
  } });
  assert.equal(result.branch_id, "data-block");
  assert.equal(result.output.decision, "hold");
  assert.equal(seen.length, 0, `model calls: ${seen.map((s) => s.name)}`);
  for (const s of seen) assert.doesNotMatch(s.text, /4111/);
  const g = lines.find((l) => l.agent_name === "Gates");
  assert.equal(g.status, "skipped");
  assert.match(g.output_summary, /restricted fact in the message/);
});

// finding 2
test("a Trustpilot appreciation message holds for the owner and cites channels:trustpilot", async () => {
  const { result } = await runMessage(msg("The saber is superb, thank you, five stars.", "trustpilot", "tp1@email.com", { name: "Tp One", subject: "Five stars" }), { run_id: "c29-tp" });
  assert.equal(result.output.decision, "hold");
  assert.equal(result.output.auto_reply, false);
  assert.ok(result.output.draft?.text, "draft kept");
  assert.match(result.output.reasons.join(" "), /channels:trustpilot: replies on this channel are sent by a person/);
});

test("sendEligible: needs a draft and a channel that is not autonomous_reply false", () => {
  assert.equal(sendEligible({ channel_autonomous: true }, { text: "hi" }), true);
  assert.equal(sendEligible({ channel_autonomous: null }, { text: "hi" }), true);
  assert.equal(sendEligible({ channel_autonomous: false }, { text: "hi" }), false);
  assert.equal(sendEligible({ channel_autonomous: true }, { text: "  " }), false);
});

// finding 4
test("a model that promises money twice on an over-limit amount: the attached draft is the approval acknowledgement", async () => {
  const f = { amount: 500, policy_limit: 100, owner_id: 1, owner_out: false, backup_out: false, sender_name: "Ann", cited_rows: [] };
  const promised = { text: "We will refund you 500 GC by Friday.", promises: { refund_amount: 500, replacement: false, other: null }, model: "stub" };
  const lines = [];
  let calls = 0;
  const S = { branch: { branch_id: "over-limit" }, models: {}, rounds: [], recovered: [], memRead: [], scoutRisk: "low" };
  const tb = { f, ticket: {}, L: (x) => lines.push(x), skipped: () => {}, fatal: (s, e) => { throw e; }, S, sampleOn: false, memCtx: "", maxRounds: 2, readerOn: false,
    hardRisk: () => ({ reasons: [] }),
    io: { drafter: async () => { calls += 1; return { text: JSON.stringify({ reply_text: promised.text, promises: promised.promises, cited_rows: [] }), model: "stub" }; },
      critic: async () => ({ pass: true, reason: "ok", model: "stub" }), reader: async () => ({ text: "{}", model: "stub" }), sampleDrafter: () => { throw new Error("no"); }, sampleCritic: () => ({ pass: true }), adapterTrace: { line: () => {} } } };
  const r = await replyLoop(tb);
  assert.equal(calls, 2, "first draft and the one rewrite both promised");
  assert.ok(!promisesMoney(r.draft, f), "attached draft promises no money");
  assert.match(r.draft.text, new RegExp(APPROVAL_ACK.slice(0, 40)));
  assert.equal(r.draft.promises.refund_amount, null);
  assert.ok(lines.some((l) => l.action === "draft_replaced"));
});

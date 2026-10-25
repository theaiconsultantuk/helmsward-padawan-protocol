// P3 (einh's board, 25 Oct 2026): a fixed over-limit reply uses the approval template, with no drafter, critic or revision call.
// The attached draft says routed for approval, promises no refund, amount or date, and passes promisesMoney with false.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket, replyLoop, OVER_LIMIT_LINE, promisesMoney } from "../src/loop.mjs";
import { hardRisk } from "../src/gates.mjs";
import { runMessage, msg } from "./helpers/route_run.mjs";

const THREADS = readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(0, 24);
const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "olw-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "olw-mem-")), quiet: true });
const cfg = () => ({ ...config(), SAMPLE_MODE: "true" });

// what a customer must never read in an over-limit reply
const forbidden = (text, amount) => {
  assert.doesNotMatch(text, /refund you|we will refund|\bwe'll refund/i, "no refund promise");
  assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b/, "no ISO date");
  assert.doesNotMatch(text, /\b(?:by|on|before|within)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|\d)/i, "no promised day");
  if (amount != null) assert.doesNotMatch(text, new RegExp(`(^|[^\\d.])${String(amount).replace(/\.0+$/, "")}(?:\\.0+)?(\\s*GC|[^\\d]|$)`), `no amount ${amount}`);
};

test("the 24 threads: every over-limit thread drafts 'routed for approval' and promises no refund, amount or date", async () => {
  let over = 0;
  for (const t of THREADS) {
    const d = dirs();
    const run_id = `olw-${t.thread_id}`;
    const r = await runTicket(t.thread_id, { run_id, cfg: cfg(), deps: d });
    if (r.branch_id !== "over-limit") continue;
    over += 1;
    const draft = r.output.queued_for?.approval ? r.output.draft : r.output.draft;
    assert.ok(draft?.text, `${t.thread_id} has a draft`);
    assert.match(draft.text, /routed for approval/, t.thread_id);
    assert.equal(draft.promises.refund_amount, null, t.thread_id);
    forbidden(draft.text, t.amount);
    const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.filter((l) => l.step === "retry" && l.status === "retrying").length, 0, `${t.thread_id}: a clean draft needs no rewrite`);
  }
  assert.ok(over >= 1, "the 24 threads hold at least one over-limit case");
});

test("hero T03 (as_of 2026-10-19): escalates to the Sales head 40; the draft says routed for approval with no amount or date", async () => {
  const r = await runTicket("T03", { run_id: "olw-hero", cfg: cfg(), as_of: "2026-10-19", deps: dirs() });
  assert.equal(r.branch_id, "over-limit");
  assert.equal(r.output.decision, "escalate");
  assert.equal(r.output.queued_for.approval.approver_id, 40);
  assert.match(r.output.draft.text, /routed for approval/);
  forbidden(r.output.draft.text, THREADS.find((t) => t.thread_id === "T03").amount);
});

test("an s03-shaped intake (refund 400 GC, as_of 2026-10-25): over the limit, the draft never carries the amount, 'refund you' or a date", async () => {
  const { result } = await runMessage(msg("I want a refund of 400 GC for order JP-1104, the hilt arrived broken.", "email", "s03@email.com", { name: "Sam Three" }), { as_of: "2026-10-25", run_id: "olw-s03" });
  assert.equal(result.branch_id, "over-limit");
  assert.equal(result.output.decision, "escalate");
  assert.match(result.output.draft.text, /routed for approval/);
  forbidden(result.output.draft.text, 400);
});

// ---- the rewrite round, with a stubbed model ----
function toolbox({ drafts, f }) {
  const lines = [];
  const L = (x) => { lines.push(x); return x; };
  const sent = [];
  const queue = [...drafts];
  const tb = {
    f: { thread_id: "X1", category: "refund", amount: 400, policy_limit: 150, owner_id: 40, owner_name: "Sales Head", backup_id: 41, owner_out: false, backup_out: false, may_leave: true, ...f },
    ticket: { thread_id: "X1", sender_name: "Ann" },
    L, skipped: (step, why) => L({ step, status: "skipped", input_summary: why, output_summary: "gate not reached" }), fatal: (s, e) => { throw e; },
    S: { models: {}, memRead: [], rounds: [], draft: null, scoutRisk: "low", branch: { branch_id: "over-limit" } },
    sampleOn: false, memCtx: "", hardRisk, maxRounds: 2, readerOn: false,
    io: {
      adapterTrace: { line: L },
      drafter: async (messages) => { sent.push(messages); return { text: JSON.stringify(queue.shift()), model: "stub/drafter" }; },
      critic: async () => ({ pass: true, reason: "ok", model: "stub/critic" }),
    },
  };
  return { tb, lines, sent };
}
const seq = (lines) => lines.map((l) => `${l.step}:${l.status}`);

for (const [label, drafts] of [
  ["a money-promising model", [{ reply_text: "We will refund 400 GC.", promises: { refund_amount: 400 } }]],
  ["repeated money promises", [{ reply_text: "We will refund 400 GC.", promises: { refund_amount: 400 } }, { reply_text: "We will refund 400 GC.", promises: { refund_amount: 400 } }]],
  ["a safe model", [{ reply_text: "Your request has been routed for approval.", promises: {} }]],
]) test(`fixed over-limit uses a template without calling ${label}`, async () => {
  const { tb, lines, sent } = toolbox({ drafts });
  const r = await replyLoop(tb);
  assert.equal(sent.length, 0, "P3: no draft or revision call");
  assert.equal(r.rounds, 1);
  assert.equal(r.retried, false);
  assert.equal(r.risk.hard, true);
  assert.equal(r.ok, false);
  assert.match(r.draft.text, /routed for approval/);
  assert.equal(promisesMoney(r.draft, tb.f), false);
  assert.ok(lines.some(l => l.source === "template"));
  assert.ok(lines.some(l => l.step === "critique" && l.status === "skipped"));
});

test("promisesMoney: the amount, a date, 'we will refund' and a promised refund_amount count; 'routed for approval' does not", () => {
  const f = { amount: 400 };
  assert.equal(promisesMoney({ text: "Your refund request is routed for approval. We are not promising an amount or a date yet.", promises: {} }, f), false);
  assert.equal(promisesMoney({ text: "We will refund you.", promises: {} }, f), true);
  assert.equal(promisesMoney({ text: "We will pay 400 back.", promises: {} }, f), true);
  assert.equal(promisesMoney({ text: "Expect it on 2026-10-30.", promises: {} }, f), true);
  assert.equal(promisesMoney({ text: "ok", promises: { refund_amount: 5 } }, f), true);
});

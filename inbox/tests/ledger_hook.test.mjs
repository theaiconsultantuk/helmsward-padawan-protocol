// The trust-ledger hook: the loop feeds the decisions table's affirm/reject counts into trustFloor's ledgerAdjust.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { runTicket, decideBranch } from "../src/loop.mjs";
import { TEMPLATES, validate, ledgerAdjustFor } from "../src/queries.mjs";

// a refund just above the floor: weight 0.82 vs floor 0.80, so two rejects (-0.10) push it under
const facts = () => ({
  thread_id: "T02", category: "refund", amount_usd: 40, policy_limit_usd: 150, category_weight: 0.82, floor: 0.8,
  owner_id: 3, backup_id: 4, owner_out: false, backup_out: false, may_leave: true, restricted_terms: [], cited_rows: ["threads_parquet:T02"],
  received_at: "2026-10-22T09:00:00Z", as_of: "2026-10-22", subject: "Refund for the saber", body: "Please refund me.", sender_name: "Lira Venn",
  sender_email: "lira.venn@example.com", channel: "email", follow_up_kind: null, ticket: { thread_id: "T02", category: "refund" },
});

test("(a) decideBranch: 2 rejects on refund lower the trust outcome against an empty ledger", () => {
  const empty = decideBranch(facts(), null, [], { ledgerAdjust: { affirmed: 0, rejected: 0 } });
  const rejected = decideBranch(facts(), null, [], { ledgerAdjust: { affirmed: 0, rejected: 2 } });
  assert.equal(empty.branch_id, "send-ok");
  assert.equal(rejected.branch_id, "under-floor");
  assert.match(rejected.why, /weight 0\.72 is under the floor 0\.8/);
  assert.equal(decideBranch(facts(), null, [], {}).branch_id, "send-ok", "no ledger given behaves as empty");
});

async function runLoop(deps) {
  const logsDir = mkdtempSync(join(tmpdir(), "ledger-logs-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ledger-mem-"));
  const factsStub = async (id, { trace }) => { trace?.line({ step: "zetaris.query", agent_name: "Executor", action: "sql:thread", input_summary: "the thread row", output_summary: "1 rows: threads_parquet:T02", status: "success", sponsor: "zetaris" }); return facts(); };
  const run_id = `ledger-${Math.random().toString(36).slice(2, 8)}`;
  const result = await runTicket("T02", { run_id, cfg: config({ SAMPLE_MODE: "true" }), deps: { facts: factsStub, findDuplicate: async () => null, quiet: true, logsDir, memoryDir, ...deps } });
  const lines = readFileSync(join(logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines };
}

test("(a) loop: a stubbed ledger of 2 rejects on refund moves the branch from send-ok to under-floor", async () => {
  const seen = [];
  const empty = await runLoop({ ledgerAdjust: async (c) => { seen.push(c); return { affirmed: 0, rejected: 0 }; } });
  const rejected = await runLoop({ ledgerAdjust: async () => ({ affirmed: 0, rejected: 2 }) });
  const branch = (r) => r.lines.find((l) => l.step === "branch").branch_id;
  assert.equal(branch(empty), "send-ok");
  assert.equal(branch(rejected), "under-floor");
  assert.deepEqual(seen, ["refund"]);
});

const afterError = (lines, pred) => {
  const i = lines.findIndex(pred);
  assert.ok(i > -1, "error line present");
  assert.equal(lines[i + 1].step, "recovery");
  assert.equal(lines[i + 1].status, "success");
  return lines[i + 1];
};
const held = (r, what) => {
  assert.equal(r.result.output.decision, "hold");
  assert.equal(r.result.branch_id, "data-block");
  const b = r.lines.find((l) => l.step === "branch");
  assert.equal(b.branch_id, "data-block");
  assert.match(b.output_summary, new RegExp(`${what} unavailable`));
  assert.equal(r.lines.at(-1).step, "synthesis");
};

test("(b) a failing ledger query holds the ticket (data-block), error line then recovery line", async () => {
  const r = await runLoop({ ledgerAdjust: async () => { throw Object.assign(new Error("zetaris down"), { name: "UpstreamRefused" }); } });
  held(r, "trust ledger");
  const rec = afterError(r.lines, (l) => l.step === "zetaris.query" && l.action === "sql:ledger_adjust" && l.status === "error");
  assert.match(rec.output_summary, /trust ledger unavailable/);
  assert.match(r.lines.find((l) => l.action === "sql:ledger_adjust").output_summary, /zetaris down/);
});

test("(b) a failing duplicate check holds the ticket (data-block), error line then recovery line", async () => {
  const r = await runLoop({ findDuplicate: async () => { throw Object.assign(new Error("dup lookup down"), { name: "UpstreamRefused" }); } });
  held(r, "duplicate check");
  const rec = afterError(r.lines, (l) => l.step === "zetaris.query" && l.action === "sql:thread_fingerprints" && l.status === "error");
  assert.match(rec.output_summary, /duplicate check unavailable/);
});

test("(b) disclosure_unknown holds the ticket (data-block) with a recovery line", async () => {
  const r = await runLoop({ facts: async (id, { trace }) => {
    trace.line({ step: "zetaris.query", agent_name: "Executor", action: "sql:wiki", input_summary: "what may leave", output_summary: "UpstreamRefused: wiki down", status: "error", sponsor: "zetaris" });
    return { ...facts(), disclosure_unknown: true };
  } });
  held(r, "disclosure policy");
  const rec = afterError(r.lines, (l) => l.action === "sql:wiki" && l.status === "error");
  assert.match(rec.output_summary, /disclosure policy unavailable/);
});

test("(b) with both checks fine the ticket still sends", async () => {
  const r = await runLoop({ ledgerAdjust: async () => ({ affirmed: 0, rejected: 0 }) });
  assert.equal(r.result.branch_id, "send-ok");
});

test("ledger_adjust template: whitelisted category only, counts mapped, empty table gives zeros", async () => {
  assert.throws(() => validate("ledger_adjust", { category: "refund' OR '1'='1" }), TypeError);
  assert.throws(() => validate("ledger_adjust", {}), TypeError);
  assert.match(TEMPLATES.ledger_adjust.sql({ category: "refund" }), /FROM JEDI_PACK\.decisions WHERE category = 'refund'/);
  const mk = (rows) => async () => ({ headers: ["verdict", "n"], rows, total: rows.length });
  assert.deepEqual(await ledgerAdjustFor("refund", { sqlRunImpl: mk([["affirm", 3], ["reject", "2"]]) }), { affirmed: 3, rejected: 2 });
  assert.deepEqual(await ledgerAdjustFor("refund", { sqlRunImpl: mk([]) }), { affirmed: 0, rejected: 0 });
});

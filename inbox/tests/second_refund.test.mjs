// "Second Refund Request from this client": einh's sentence, from earlier refund rows in Zetaris (prior_refunds, by email) and from H-MEM (keyed by email).
// Sample mode: the cached rows know the 24 authored threads; a fresh free-text client is only ever known to H-MEM, unless the store also holds the
// runtime intake rows, which the live store does and `liveLike` imitates below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { factsForTicket } from "../src/queries.mjs";
import { queryByName } from "../src/adapters/sample.mjs";
import { readIntake } from "../src/intake.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
const NOW = Date.parse("2026-10-25T10:00:00.000Z");
const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "sr-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "sr-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "sr-run-")), quiet: true });
const sentence = (n, ids) => `Second Refund Request from this client (${n} earlier: ${ids.join(", ")}).`;
const RECALL = (n) => `H-MEM recalls ${n} earlier decision(s) for this client.`;

// Zetaris as the live store behaves: prior_refunds also unions the runtime intake rows (refund category or scenario) of the same sender before this one.
const liveLike = (d) => (id, o) => factsForTicket(id, {
  ...o, cfg,
  sqlRunImpl: async (sql, opts) => {
    const r = queryByName(opts.name, opts.params, { cfg });
    if (opts.name !== "prior_refunds") return r;
    const mine = readIntake({ runtimeDir: d.runtimeDir }).filter((x) => String(x.sender_email).toLowerCase() === opts.params.email.toLowerCase()
      && x.thread_id !== opts.params.thread_id && x.scenario === "refund" && Date.parse(x.received_at) < Date.parse(opts.params.received_at));
    return { ...r, rows: [...r.rows, ...mine.map((x) => [x.thread_id, x.received_at, "intake_runtime"])], total: r.rows.length + mine.length };
  },
});

let n = 0;
async function ask(d, message, { from, name = "Fresh Client", scenario = "refund", as_of = "2026-10-25", ticks = 0, live = false } = {}) {
  n += 1;
  const run_id = `sr-${n}`;
  const result = await runTicket(null, { run_id, cfg, as_of, deps: { ...d, clock: () => NOW + ticks * 60000, ...(live ? { facts: liveLike(d) } : {}) }, input: { message, from, name, channel: "chat", scenario, as_of } });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines, o: result.output };
}
const go = async (id, d = dirs()) => {
  n += 1;
  const run_id = `sr-t-${n}`;
  const result = await runTicket(id, { run_id, cfg, deps: d });
  return { result, o: result.output, lines: readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
};

test("T02 counts 0 prior refunds and says nothing; T06 counts 1 (T02) and says einh's sentence", async () => {
  const a = await go("T02");
  const fa = await factsForTicket("T02", { cfg });
  assert.deepEqual(fa.prior_refunds, { count: 0, thread_ids: [] });
  assert.equal(a.o.memory_note, null);
  assert.ok(!JSON.stringify(a.lines).includes("Second Refund"));

  const fb = await factsForTicket("T06", { cfg });
  assert.deepEqual(fb.prior_refunds, { count: 1, thread_ids: ["T02"] });
  assert.ok(fb.cited_rows.includes("threads_json:T02"), "cites the earlier row");
  const b = await go("T06");
  assert.equal(b.o.memory_note, sentence(1, ["T02"]));
  assert.match(b.lines.find((l) => l.step === "planner.plan").output_summary, /Second Refund Request from this client \(1 earlier: T02\)\./);
});

test("the sentence is the same for any count of 1 or more, from the authored sender with the email in any case", async () => {
  const d = dirs();
  const a = await ask(d, "I want a refund of 400 GC for my cracked saber", { from: "LiraVenn@Email.com", name: "Lira Venn" });
  assert.equal(a.o.decision, "escalate");
  assert.equal(a.o.memory_note, sentence(2, ["T02", "T06"]));
  assert.equal(a.o.queued_for.memory_note, a.o.memory_note, "the queue entry carries it too");
  assert.match(a.lines.find((l) => l.step === "planner.plan").output_summary, /Second Refund Request from this client \(2 earlier: T02, T06\)\./);
  const one = await ask(dirs(), "I want a refund of 100 GC for my cracked saber", { from: "lira.nobody@email.com" });
  assert.equal(one.o.memory_note, null);
});

test("cold-start twin: F1 then F2 in the same dirs; F2 is recalled by email even under another name", async () => {
  const d = dirs();
  const f1 = await ask(d, "I want a refund of 100 GC for my cracked saber", { from: "twin.client@email.com", name: "Twin Client" });
  assert.equal(f1.o.memory_note, null, "a cold memory says nothing");
  assert.match(f1.lines.find((l) => l.step === "memory.read").output_summary, /empty \(cold first run\)/);
  const f2 = await ask(d, "Another refund please, 100 GC for the same saber", { from: "Twin.Client@email.com", name: "Someone Else", ticks: 5 });
  // F1 sits in the same runtime intake, so the Zetaris sentence is true too: the combined note
  assert.equal(f2.o.memory_note, `${sentence(1, ["F1"])} ${RECALL(1)}`);
  const mr = f2.lines.find((l) => l.step === "memory.read").output_summary;
  assert.match(mr, /recalled by the client's email twin\.client@email\.com/);
  const hm = JSON.parse(readFileSync(join(d.memoryDir, "state.json"), "utf8")).records;
  const recs = Array.isArray(hm) ? hm : Object.values(hm);
  assert.ok(recs.some((r) => (r.entities ?? []).includes("twin.client@email.com")), "memory writes carry the sender email, lower case");
});

test("both sources together: Zetaris says the sentence, H-MEM appends its own, in that order", async () => {
  const d = dirs();
  await ask(d, "I want a refund of 100 GC for my cracked saber", { from: "liravenn@email.com", name: "Lira Venn" });
  const b = await ask(d, "Again: a refund of 100 GC please", { from: "liravenn@email.com", name: "Lira Venn", ticks: 5 });
  assert.equal(b.o.memory_note, `${sentence(3, ["T02", "T06", "F1"])} ${RECALL(1)}`);
});

// status x operation: the second refund after a first that was escalated / held / sent
for (const [label, first, firstDecision, zetarisCount] of [
  ["escalated", "I want a refund of 400 GC for my cracked saber", "escalate", 1],
  ["held", "I want a refund of 100 GC for my cracked saber", "hold", 1],
  ["sent (a thank-you, no refund)", "Thank you so much, the saber you sent is wonderful and my son loves it!", "send", 0],
]) {
  test(`second refund after a first that was ${label}: H-MEM recalls it; the store counts it only if it was a refund`, async () => {
    const d = dirs();
    const email = `grid.${firstDecision}.${n}@email.com`;
    const scenario = firstDecision === "send" ? null : "refund"; // undefined would take the default
    const a = await ask(d, first, { from: email, scenario });
    assert.equal(a.o.decision, firstDecision, `first: ${a.result.branch_id}`);
    assert.equal(a.o.status, firstDecision === "send" ? "handled" : "open");
    const b = await ask(d, "I want a refund of 100 GC for my cracked saber, it is still broken", { from: email, ticks: 5, live: true }); // not the same words: identical text is a duplicate (P13/H13)
    assert.equal(b.o.decision, "hold", "the second refund is decided on its own amount");
    const want = [zetarisCount ? sentence(1, ["F1"]) : null, RECALL(1)].filter(Boolean).join(" ");
    assert.equal(b.o.memory_note, want);
    assert.equal(b.o.status, "open");
  });
}

test("an escalated second refund puts the sentence on the queue entry, not a second wording", async () => {
  const d = dirs();
  await ask(d, "I want a refund of 100 GC for my cracked saber", { from: "queue.client@email.com" });
  const b = await ask(d, "I want a refund of 400 GC for my cracked saber", { from: "queue.client@email.com", ticks: 5, live: true });
  assert.equal(b.o.decision, "escalate");
  assert.equal(b.o.queued_for.memory_note, `${sentence(1, ["F1"])} ${RECALL(1)}`);
  assert.equal(b.o.queued_for.memory_note, b.o.memory_note);
  assert.ok(b.o.cited_rows.includes("intake_runtime:F1"));
});

test("the current ticket is never counted: a refund from a client with no earlier rows has none", async () => {
  const f = await factsForTicket("T02", { cfg });
  assert.ok(!f.prior_refunds.thread_ids.includes("T02"));
  const g = await factsForTicket("T06", { cfg });
  assert.ok(!g.prior_refunds.thread_ids.includes("T06"));
});

test("only refund tickets read prior_refunds", async () => {
  const f = await factsForTicket("T07", { cfg });
  assert.equal(f.prior_refunds, null);
});

// Scoped facts through runTicket in sample mode (CP2 Task 2.1): messages read only what their route needs; threads keep the full read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { mentionsRefund } from "../src/prompts.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
// The shipped data never has an owner and its backup out on the same day (heads and 27 carry no holiday rows), so the "nobody in" routes run
// on a private copy of the sample caches with those people sent on holiday on the day: one holidays.json row each, no stale exact pair.
function cfgWithOut(pairs) {
  const dir = mkdtempSync(join(tmpdir(), "sl-sample-"));
  cpSync(join(INBOX_ROOT, "data", "sample"), dir, { recursive: true });
  const read = (n) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
  const all = read("holidays");
  const full = all.find((e) => Object.keys(e.params ?? {}).length === 0).result;
  for (const [id, date] of pairs) full.rows.push([String(id), date]);
  full.total = full.rows.length;
  writeFileSync(join(dir, "holidays.json"), JSON.stringify(all));
  const one = read("holiday").filter((e) => !pairs.some(([id, date]) => String(e.params?.employee_id) === String(id) && e.params?.date === date));
  writeFileSync(join(dir, "holiday.json"), JSON.stringify(one));
  return { ...cfg, SAMPLE_DIR: dir };
}
const example = (n) => JSON.parse(readFileSync(join(INBOX_ROOT, "input_examples", `example_${n}.json`), "utf8")).input;
const mkDeps = () => ({ logsDir: mkdtempSync(join(tmpdir(), "sl-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "sl-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "sl-run-")), quiet: true });
async function go(run_id, input, { thread_id = null, as_of, d = mkDeps(), cfg: runCfg = cfg } = {}) {
  const result = await runTicket(thread_id, { run_id, cfg: runCfg, as_of: as_of ?? input?.as_of, input, deps: d });
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
  assert.equal(result.output.queued_for.owner_id, 15);
});

test("calibration: a vent that mentions 400 GC is never over-limit", async () => {
  const { result } = await go("sl-cal", msg("I paid 400 GC for it and the box was dented, I am annoyed, just so you know", "complaint"));
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

test("refund 400 GC: policy read, over-limit, approver 40 (pinned)", async () => {
  const { result, q } = await go("sl-ref", msg("I want a refund of 400 GC for my cracked saber", "refund"));
  assert.ok(count(q, "sql:policy") >= 1);
  assert.equal(result.branch_id, "over-limit");
  assert.equal(result.output.queued_for.approval.approver_id, 40);
  assert.ok(result.output.cited_rows.includes("policy:refund"));
});

test("both approvers out on an over-limit refund: the contact desk", async () => {
  const { result, lines } = await go("sl-ref-out", msg("I want a refund of 400 GC for my cracked saber", "refund", "2026-10-09"), { cfg: cfgWithOut([[40, "2026-10-09"], [201, "2026-10-09"]]) });
  assert.equal(result.branch_id, "over-limit");
  assert.equal(result.output.decision, "escalate");
  assert.equal(result.output.queued_for.fallback_contact.email, DESK);
  assert.match(find(lines, "branch").output_summary, /routed to the default contact/);
  assert.ok(result.output.cited_rows.includes("contacts:default"));
  assert.ok(result.output.cited_rows.includes("policy:refund"));
});

test("stored thread T02, nobody in (2026-10-27): routed to the contact desk (einh's pick B)", async () => {
  const { result, q } = await go("sl-t02-out", null, { thread_id: "T02", as_of: "2026-10-27", cfg: cfgWithOut([[15, "2026-10-27"], [27, "2026-10-27"]]) });
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
  const { result, lines, d } = await go("sl-both", input, { cfg: cfgWithOut([[15, "2026-09-29"], [27, "2026-09-29"]]) });
  assert.equal(result.output.decision, "escalate");
  assert.equal(result.branch_id, "owner-out");
  const qf = result.output.queued_for;
  assert.equal(qf.fallback_contact.email, DESK);
  assert.equal(qf.role, "default contact");
  assert.equal(qf.owner_id, 15);
  assert.equal(qf.backup_id, 27);
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
  const out = cfgWithOut([[15, "2026-09-29"], [27, "2026-09-29"]]);
  const a = await go("sl-twin-1", input, { d, cfg: out });
  const b = await go("sl-twin-2", input, { d, cfg: out });
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

// Codex review 7, HIGH: a message resolved to legacy reads no policy row, so a refund promised in its draft has nothing behind it and is never signed.
test("a legacy-resolved message whose draft promises a refund is never sent", async () => {
  const d = { ...mkDeps(), sampleDrafter: (ticket) => ({ text: `Hello,\n\nWe will refund 400 GC.\n\nBest regards,\nJedi Pack Support`, model: "test/promiser", route: "sample", promises: { refund_amount: 400, replacement: false, other: null } }) };
  const { result, lines } = await go("sl-legacy-promise", msg("please replace my cracked saber, it arrived broken"), { d });
  assert.equal(result.scenario, "legacy");
  assert.notEqual(result.output.decision, "send");
  assert.ok(lines.some((l) => l.step === "risk.signoff" && /no policy limit behind it/.test(l.output_summary)), "Risk names the missing limit");
});

// Codex review 8, LOW: a missing backup is said as "no backup named", never "backup null".
test("owner out with no backup named: the branch reason names no absent employee", async () => {
  const { decideBranch } = await import("../src/loop.mjs");
  const b = decideBranch({ owner_id: 15, backup_id: null, owner_out: true, backup_out: true, as_of: "2026-01-27", category: "refund", ticket: {},
    fallback_contact: { email: "contact@jedipack.com", label: "Jedi Pack contact desk", cited: "contacts:default" } }, null, []);
  assert.equal(b.branch_id, "owner-out");
  assert.match(b.why, /owner 15 is out and no backup is named on 2026-01-27; routed to the default contact contact@jedipack.com/);
  assert.doesNotMatch(b.why, /null/);
});

// einh, 24 Oct 2026: refunds are mentioned only on refund requests (category). Through runTicket in sample mode, on the routes whose draft
// can be injected: the legacy route (deps.sampleDrafter) and the FAQ (canonical text).
const promiser = (texts) => { let i = 0; return () => ({ text: `Hello,\n\n${texts[Math.min(i++, texts.length - 1)]}\n\nBest regards,\nJedi Pack Support`, model: "test/promiser", route: "sample", promises: { refund_amount: null, replacement: false, other: null } }); };

test("a replacement message whose draft mentions a refund is refused on round 1 and rewritten; the clean draft is kept", async () => {
  const d = { ...mkDeps(), sampleDrafter: promiser(["We will look at a refund for the cracked saber.", "We will look at the cracked saber and a colleague will follow up."]) };
  const { result, lines } = await go("rc-rewritten", msg("please replace my cracked saber, it arrived broken"), { d });
  assert.equal(result.scenario, "legacy");
  const r1 = lines.find((l) => l.step === "risk.signoff" && l.retry_count === 0);
  assert.equal(r1.status, "needs_revision");
  assert.equal(lines.find((l) => l.step === "branch")?.input_summary.match(/category (\w+)/)?.[1], "replacement", "a replacement request keeps Scout's category");
  assert.match(r1.output_summary, /refund wording on a replacement message: refunds are mentioned only on refund requests/);
  assert.ok(lines.some((l) => l.step === "retry" && l.status === "retrying"), "the draft is rewritten");
  assert.equal(lines.find((l) => l.step === "risk.signoff" && l.retry_count === 1).status, "success");
  assert.ok(!mentionsRefund(result.output.draft, result.output.cited_rows), "the kept draft says nothing about a refund");
});

test("a replacement message whose drafts keep mentioning a refund is never sent", async () => {
  const d = { ...mkDeps(), sampleDrafter: promiser(["We will refund you for the cracked saber."]) };
  const { result, lines } = await go("rc-kept", msg("please replace my cracked saber, it arrived broken"), { d });
  assert.notEqual(result.output.decision, "send");
  assert.deepEqual(lines.filter((l) => l.step === "risk.signoff").map((l) => l.status), ["needs_revision", "needs_revision"]);
  assert.ok(lines.some((l) => l.step === "escalate_or_fallback" && l.status === "success"), "two negative rounds: a human takes it");
});

// einh's B (24 Oct 2026, verbatim "Questions may quote policy"): a question that itself asks about refunds may quote the policy.
test("the returns-and-refund FAQ on a question sends: the question asks about refunds, so the canonical text may name them", async () => {
  const { result, lines } = await go("rc-faq", msg("What is your returns and refund policy?"));
  assert.equal(result.branch_id, "faq-hit");
  assert.equal(result.output.decision, "send");
  assert.equal(lines.find((l) => l.step === "risk.signoff").status, "success");
  assert.ok(mentionsRefund(result.output.draft), "the sent FAQ text names refunds");
});

test("the refund-limit question is held for the question owner with the quoted policy as its draft", async () => {
  const { result, lines } = await go("rc-limit", msg("What is the refund limit for orders?", "question"));
  assert.equal(result.branch_id, "question-records");
  assert.equal(result.output.decision, "hold");
  assert.equal(result.output.queued_for.owner_id, 5);
  assert.equal(lines.find((l) => l.step === "risk.signoff").status, "success");
  assert.ok(mentionsRefund(result.output.draft, result.output.cited_rows), "the held draft quotes the refund policy");
});


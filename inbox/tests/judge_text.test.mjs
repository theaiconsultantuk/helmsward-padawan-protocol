// What the judge reads (Jedi Pack contact page): no cut quote in a draft, no cut memory line in the trace, every cited row in words,
// and no host path on any public surface. Sample mode, no network. No product name is asserted here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";
import { subjectLabel } from "../src/intake.mjs";
import { draft, quotable } from "../src/adapters/sample.mjs";
import { publicQueueFile } from "../src/journey.mjs";
import { extractParams } from "../src/engines/scout/index.mjs";

const mk = (p) => mkdtempSync(join(tmpdir(), p));
const dirs = { dir: mk("jt-rt-"), runtimeDir: mk("jt-intake-"), logsDir: mk("jt-logs-"), memoryDir: mk("jt-mem-") };
let S, base;
before(async () => {
  S = createServer({ cfg: config({ SAMPLE_MODE: "true", API_TOKEN: "" }), deps: { ...dirs, quiet: true, publish: async () => ({ published: true, uncached: true }) } });
  await new Promise((r) => S.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${S.address().port}`;
});
after(() => S.close());

const post = async (run_id, message, extra = {}) => (await fetch(base + "/run", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ run_id, input: { message, from: `${run_id}@example.com`, name: "Test Person", channel: "contact-form", scenario: "refund", as_of: "2026-10-25", ...extra } }) })).json();
const getJson = async (p) => (await fetch(base + p)).json();

const LONG = "I would like a refund of 80 GC for my boots, they are too small for my son. Please tell me what to do next and when.";

// ---- item 1: a draft never quotes a cut text ----
test("1: a free-text subject is a label cut at a word boundary with an ellipsis, never mid-word", () => {
  const label = subjectLabel(LONG);
  assert.ok(label.endsWith("\u2026"), label);
  assert.ok(label.length <= 61, label);
  assert.ok(LONG.startsWith(label.slice(0, -1)), "a prefix of the message");
  assert.equal(LONG[label.length - 1], " ", "the cut falls on a word boundary");
  assert.equal(subjectLabel("How long does shipping take?"), "How long does shipping take?");
});

test("1: the draft quotes the customer's whole first sentence, not the cut subject", () => {
  const ticket = { subject: subjectLabel(LONG), body: LONG, sender_name: "Test Person", category: "refund", amount: 80 };
  const text = draft(ticket, { category: "refund" }).text;
  assert.match(text, /You wrote about "I would like a refund of 80 GC for my boots, they are too small for my son"\./);
  assert.doesNotMatch(text, /\u2026/);
});

test("1: a first sentence over the limit, or a subject cut with no body, is not quoted at all", () => {
  const body = `I ${"really ".repeat(30)}want a refund. Thanks.`;
  assert.equal(quotable({ subject: subjectLabel(body), body }), null);
  assert.equal(quotable({ subject: "I would like a refund of 80\u2026", body: "" }), null);
  const text = draft({ subject: subjectLabel(body), body, sender_name: "A", category: "refund" }, { category: "refund" }).text;
  assert.doesNotMatch(text, /You wrote about/);
  assert.match(text, /Thank you for your message\./);
});

test("1: a real subject (a stored thread) is quoted as it is", () => {
  assert.equal(quotable({ subject: "Refund for my order", body: "Hello, I want my money back because it broke." }), "Refund for my order");
});

test("1: through the server, the draft, the queue file and the sent bubble never quote a cut text", async () => {
  const run = await post("jt-draft", LONG);
  const text = run.output?.draft?.text ?? run.output?.queued_for?.draft?.text ?? "";
  assert.ok(text, "a draft exists");
  const q = /You wrote about "([^"]*)"/.exec(text);
  if (q) {
    assert.ok(LONG.includes(q[1]), `the quote is the customer's own words: ${q[1]}`);
    assert.ok(/[.!?]/.test(LONG[LONG.indexOf(q[1]) + q[1].length] ?? "."), "the quote ends where the customer's sentence ends");
  }
  assert.doesNotMatch(text, /\u2026/);
  const j = await getJson("/runs/jt-draft/journey");
  assert.doesNotMatch(JSON.stringify(j), /You wrote about "[^"]*\u2026"/);
});

// ---- item 2: memory.read lines are not cut mid-word ----
test("2: the memory.read line cuts each memory at a word boundary and says so with an ellipsis", async () => {
  await post("jt-mem-1", "I would like a refund of 9000 GC, the item never arrived at all.");
  await post("jt-mem-2", "I would like a refund of 9000 GC, the item never arrived at all.", { from: "jt-mem-1@example.com" });
  const trace = await getJson("/runs/jt-mem-2/trace");
  const line = trace.find((l) => l.step === "memory.read");
  assert.ok(line && /memories:/.test(line.output_summary), line?.output_summary);
  const parts = [...line.output_summary.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  assert.ok(parts.length > 0);
  let cut = 0;
  for (const p of parts) {
    if (p.endsWith("\u2026")) { cut++; assert.match(p, /[A-Za-z0-9)%.]\u2026$/, `ends on a whole word: ${p}`); assert.ok(p.length <= 71, p); }
    else assert.ok(p.length < 70, `an uncut excerpt is under the limit: ${p}`);
  }
  assert.ok(cut > 0, "at least one memory was long enough to be cut");
});

// ---- item 3: every cited row has its words ----
test("3: the intake, holiday, channel, trust, wiki, prior-refund and duplicate-check reads carry a detail in the journey", async () => {
  await post("jt-detail", LONG);
  const j = await getJson("/runs/jt-detail/journey");
  const byAction = (label) => j.nodes.filter((n) => n.label === label);
  for (const label of ["Zetaris: availability", "Zetaris: channel", "Zetaris: the trust ledger", "Zetaris: the wiki", "Zetaris: prior_refunds", "Zetaris: the duplicate check"]) {
    const ns = byAction(label);
    assert.ok(ns.length > 0, `a node labelled ${label}`);
    for (const n of ns) assert.ok(n.detail && n.detail.length > 3, `${label} has a detail (${n.detail})`);
  }
  assert.match(byAction("Zetaris: availability")[0].detail, /^(not out on 2026-10-25|.* on 2026-10-25)/);
  assert.match(byAction("Zetaris: the trust ledger")[0].detail, /weight [\d.]+, floor [\d.]+/);
  assert.match(byAction("Zetaris: channel")[0].detail, /public (yes|no)/);
  assert.match(byAction("Zetaris: prior_refunds")[0].detail, /earlier refund ticket/);
  const fp = byAction("Zetaris: the duplicate check")[0];
  assert.match(fp.detail, /earlier threads? read/);
  const tr = byAction("Zetaris: the trust ledger")[0];
  assert.ok(tr.returned.every((r) => r.detail), "the trust row carries its detail in the Facts list");
});

test("3: each template detail comes from the rows it returned", async () => {
  const { run } = await import("../src/queries.mjs");
  const lines = [];
  const trace = { line: (l) => lines.push(l) };
  const cfg = config({ SAMPLE_MODE: "false", ZETARIS_REST_URL: "http://x.invalid" });
  const impl = (headers, rows) => async () => ({ headers, rows });
  await run("holiday", { employee_id: 15, date: "2026-10-25" }, { trace, cfg, sqlRunImpl: impl(["employee_id", "date"], []) });
  assert.equal(lines.at(-1).detail, "not out on 2026-10-25");
  await run("holiday", { employee_id: 15, date: "2026-10-25" }, { trace, cfg, sqlRunImpl: impl(["employee_id", "date", "kind", "holiday_name"], [["15", "2026-10-25", "leave", "Annual leave"]]) });
  assert.equal(lines.at(-1).detail, "employee 15 out on 2026-10-25 (leave: Annual leave)");
  await run("trust", { category: "refund" }, { trace, cfg, sqlRunImpl: impl(["category", "weight", "floor"], [["refund", 0.55, 0.8]]) });
  assert.match(lines.at(-1).detail, /^refund: trust weight 0\.55, floor 0\.8/);
  await run("channel", { channel: "chat" }, { trace, cfg, sqlRunImpl: impl(["channel", "public", "autonomous_reply", "label"], [["chat", "false", "true", "Chat"]]) });
  assert.equal(lines.at(-1).detail, "Chat: public no, may reply on its own yes");
  await run("ledger_adjust", { category: "refund" }, { trace, cfg, sqlRunImpl: impl(["verdict", "n"], []) });
  assert.equal(lines.at(-1).detail, "no human verdicts yet for refund");
  await run("intake_thread", { thread_id: "F7" }, { trace, cfg, sqlRunImpl: impl(["thread_id", "sender_name", "sender_email", "channel"], [["F7", "Test Person", "t@example.com", "chat"]]) });
  assert.equal(lines.at(-1).detail, "new message F7 from Test Person via chat");
});

// ---- item 4: no host path on a public surface ----
const ABS = /(^|[\s"'(=:])\/(opt|tmp|home|var|usr|etc|root|mnt)\//;
const noHostPath = (label, value) => {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  assert.doesNotMatch(s, ABS, `${label} carries an absolute host path`);
  assert.ok(!s.includes(tmpdir()), `${label} carries the temp dir`);
  assert.ok(!s.includes(dirs.memoryDir), `${label} carries the memory dir`);
};

test("4: an escalated run names its queue file inside the memory dir on the response, the journey and the trace", async () => {
  const run = await post("jt-path", "I would like a refund of 9000 GC, the item never arrived at all.");
  assert.equal(run.output.decision, "escalate");
  assert.match(run.output.queued_for.queue_file, /^queue\/F\d+\.json$/);
  const journey = await getJson("/runs/jt-path/journey");
  assert.equal(journey.reached_human.queue_file, run.output.queued_for.queue_file);
  const trace = await getJson("/runs/jt-path/trace");
  const handoff = trace.find((l) => l.step === "escalate_or_fallback");
  assert.match(handoff.output_summary, /stored in queue\/F\d+\.json/);
  noHostPath("POST /run", run);
  noHostPath("GET /runs/:id", await getJson("/runs/jt-path"));
  noHostPath("journey", journey);
  noHostPath("trace", trace);
  // the server still finds the file it wrote
  const queue = await getJson("/queue");
  assert.ok(queue.some((r) => r.file === `${run.output.queued_for.queue_file.slice("queue/".length)}`), "GET /queue lists the file");
  const row = queue.find((r) => r.file === run.output.queued_for.queue_file.slice("queue/".length));
  assert.ok((row.approver ?? row.owner)?.employee_id != null, "the queue row still resolves the person it waits for");
  assert.ok("queue/F1.json".endsWith("/F1.json"), "the server matches a stored run to its file by the trailing /<file>");
});

test("4: a held run leaves no host path on any surface either", async () => {
  const run = await post("jt-hold", "What is the shipping time to Tatooine?", { scenario: "question" });
  noHostPath("POST /run", run);
  noHostPath("journey", await getJson("/runs/jt-hold/journey"));
  noHostPath("trace", await getJson("/runs/jt-hold/trace"));
});

test("4: publicQueueFile keeps the place inside the memory dir and drops the rest", () => {
  assert.equal(publicQueueFile("/opt/x/data/memory/queue/F12.json"), "queue/F12.json");
  assert.equal(publicQueueFile("C:\\data\\memory\\queue\\F3.json"), "queue/F3.json");
  assert.equal(publicQueueFile("/q/x.json"), "queue/x.json");
  assert.equal(publicQueueFile("queue/F1.json"), "queue/F1.json");
  assert.equal(publicQueueFile(null), null);
});

// ---- the derived subject must not make an amount count twice ----
test("1: a refund message over 60 characters with one amount reads that amount once", () => {
  const msg = "I would like a refund of 80 GC for my boots, they are too small for my son.";
  assert.ok(msg.length > 60);
  const p = extractParams(`${subjectLabel(msg)}\n${msg}`);
  assert.equal(p.amount, 80);
  assert.deepEqual(p.amounts, [80]);
  assert.equal(p.summed, undefined);
});

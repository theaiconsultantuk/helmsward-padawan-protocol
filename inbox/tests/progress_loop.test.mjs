// Boundaries: early decisions equal final decisions, provider provenance survives wrappers, hooks cannot change outcomes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import * as loop from "../src/loop.mjs";
import { createProgressBoard, progressFromStored } from "../src/progress.mjs";
import { deriveJourney } from "../src/journey.mjs";
import { factsForTicket } from "../src/queries.mjs";
const mk = (p) => mkdtempSync(join(tmpdir(), `pc-${p}-`));
const dirs = () => ({ logsDir: mk("logs"), memoryDir: mk("mem"), runtimeDir: mk("rt"), decisionsDir: mk("dec"), quiet: true });
const sampleCfg = config({ SAMPLE_MODE: "true" });
const liveCfg = config({ SAMPLE_MODE: "false", NIGHTSHIFT_ROUTE_PRIMARY: "nvidia/nemotron-primary", REFUND_READER: "false", METERLESS_BASE_URL: "http://nightshift.test/v1", NIGHTSHIFT_ROUTE_FALLBACK: "meterless/local" });
const read = (p) => JSON.parse(readFileSync(join(INBOX_ROOT, p), "utf8"));
const threads = readFileSync(join(INBOX_ROOT, "data/synthetic/threads/threads.jsonl"), "utf8").trim().split("\n").map(JSON.parse).slice(0, 24);
const fixed = ["over-limit", "complaint-severe", "complaint-legal", "fact-block", "misread", "data-block", "follow-up", "duplicate", "thank-you"];
const draft = { text: JSON.stringify({ reply_text: "Your request has been routed for approval.", promises: { refund_amount: null, replacement: false, other: null } }), model: "nvidia/nemotron-x" };
const critic = async () => ({ pass: true, reason: "ok", model: "nvidia/nemotron-x" });
async function liveDeps() {
  const f = await factsForTicket("T03", { cfg: sampleCfg, as_of: "2026-10-19" });
  return { ...dirs(), facts: async () => f, gates: async () => ({ answers: {}, model: "rules", gate_source: "rules", confidence: 0.5 }), drafter: async () => draft, critic, findDuplicate: async () => null, ledgerAdjust: async () => ({ affirmed: 0, rejected: 0 }) };
}
const guard = (fn) => async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (url, o) => /^http:\/\/127\.0\.0\.1:\d+\//.test(String(url)) ? real(url, o) : Promise.reject(Object.assign(Error("no network"), { code: "ENETUNREACH" }));
  try { await fn(real); } finally { globalThis.fetch = real; }
};
test("early = final on 24 threads, 30 shape cells and 14 demos plus existing H16 data-block; event order in the buffered free-text path", async () => {
  const demos = read("public/demo-scenarios.json");
  const cells = read("tests/fixtures/scenario_shapes.json").cells;
  const h16 = read("tests/fixtures/freetext_cases.json").cases.find((c) => c.id === "H16");
  const cases = [{ input: { message: h16.message, from: h16.from, name: h16.name, subject: h16.subject, channel: h16.channel } }, ...threads.map((t) => ({ thread: t.thread_id })), ...cells, ...demos.map((d) => ({ input: { message: d.message, from: d.email ?? "visitor@example.com", name: d.name, channel: d.channel, scenario: d.scenario, as_of: d.as_of }, as_of: d.as_of }))];
  const seen = new Set();
  for (const [i, c] of cases.entries()) {
    const events = [], order = [];
    const runDirs = dirs();
    const r = await loop.runTicket(c.thread ?? null, { cfg: sampleCfg, run_id: `pc-sweep-${i}`, input: c.input, as_of: c.as_of, deps: { ...runDirs, onLine: (l) => order.push(l.step), onProgress: (e) => { events.push(e); order.push(e.kind === "work" ? e.purpose : "decided"); } } });
    const e = events.find((e) => e.kind === "decided");
    if (fixed.includes(r.branch_id) && (r.branch_id !== "over-limit" || r.output.queued_for?.approval)) {
      assert.ok(e, `${i} ${r.branch_id} has early decision`); seen.add(r.branch_id);
      assert.equal(e.early.decision, r.output.decision, `${i} ${r.branch_id}`); assert.deepEqual(r.decision_early, e.early);
    } else assert.equal(e, undefined, `${i} no early decision for ${r.branch_id}`);
    if (c.input && r.branch_id === "over-limit") {
      for (const purpose of ["intake", "gates", "facts"]) assert.ok(order.indexOf(purpose) >= 0 && order.indexOf(purpose) < order.indexOf("memory.read"), purpose);
      assert.ok(order.indexOf("branch") < order.indexOf("decided") && order.indexOf("decided") < order.indexOf("synthesis"));
    }
    if (i >= cases.length - demos.length) {
      const lines = readFileSync(join(runDirs.logsDir, r.log_file.split("/").pop()), "utf8").trim().split("\n").map(JSON.parse);
      const journey = deriveJourney(r, lines);
      assert.ok(journey.nodes.reduce((n, l) => n + (l.duration_ms ?? 0), 0) <= journey.wall_ms, `demo ${i}: node sum <= wall_ms`);
      assert.ok(journey.wall_ms <= r.execution_time_seconds * 1000 + 50, `demo ${i}: wall_ms <= execution time`);
    }
    assert.equal(r.provider?.mode, "sample"); assert.equal(r.provider.primary_used, null);
  }
  console.log(`early-decision branches covered: ${[...seen].sort().join(", ")}; not in fixtures: ${fixed.filter((b) => !seen.has(b)).join(", ") || "none"}`);
});
test("live stubs record primary, local fallback, mismatch, failed critique and exactly one default-critic fallback", guard(async () => {
  for (const kind of ["primary", "local", "mismatch", "failed", "default"]) {
    const deps = await liveDeps();
    const facts = await factsForTicket("T02", { cfg: sampleCfg });
    deps.facts = async () => facts; // P3: provider-call coverage belongs on a path that still drafts.
    if (kind === "local") deps.drafter = async () => ({ ...draft, model: "llama-local", lane: "local-lane", fallback: { reason: "UpstreamRefused", route: "local-lane" } });
    if (kind === "mismatch") deps.drafter = async () => ({ ...draft, model: "meterless/auto-pick" });
    if (kind === "failed") deps.critic = async () => { throw Object.assign(Error("/opt/private"), { name: "UpstreamTimeout" }); };
    if (kind === "default") {
      delete deps.critic; let n = 0;
      globalThis.fetch = async (url) => { assert.ok(String(url).startsWith("http://nightshift.test/")); n++; return n < 3 ? new Response("bad", { status: 503 }) : new Response(JSON.stringify({ model: "llama-x", choices: [{ message: { content: JSON.stringify({ pass: true, reason: "ok" }) } }] })); };
    }
    const r = await loop.runTicket("T02", { run_id: `pc-${kind}`, cfg: liveCfg, deps });
    assert.equal(r.provider?.primary_used, kind === "primary", kind);
    assert.equal(r.output.decision, kind === "failed" ? "escalate" : "hold");
    if (kind === "primary") assert.ok(r.provider.calls >= 2);
    if (kind === "local") assert.match(r.provider.fallback_reason, /^draft: Nightshift unreachable \(UpstreamRefused\)/);
    if (kind === "mismatch") assert.equal(r.provider.fallback_reason, "draft: primary route answered with meterless/auto-pick, not Nemotron");
    if (kind === "failed") assert.equal(r.provider.fallback_reason, "critique: failed (UpstreamTimeout); no answer");
    if (kind === "default") { assert.equal(r.provider.fallback_reason, "critique: primary failed (BadResponse HTTP 503); answered by meterless/local"); assert.equal(r.provider.calls, 2); }
  }
}));
test("throwing start, line and end listeners cannot alter a run; abandoned body emits no late decision", guard(async () => {
  const base = await liveDeps();
  const go = (extra, id) => loop.runTicket("T03", { run_id: id, cfg: liveCfg, deps: { ...base, ...dirs(), ...extra } });
  const clean = await go({}, "pc-clean");
  for (const onProgress of [() => { throw Error("listener"); }, () => () => { throw Error("end"); }]) {
    const r = await go({ onProgress, onLine: () => { throw Error("line"); } }, `pc-hook-${Math.random()}`);
    assert.equal(r.output.decision, clean.output.decision); assert.deepEqual(r.provider, clean.provider);
  }
  const events = []; const f = await base.facts();
  const r = await go({ runTimeoutMs: 20, facts: async () => { await new Promise((r) => setTimeout(r, 70)); return f; }, onProgress: (e) => events.push(e) }, "pc-abandoned");
  assert.equal(r.status, "error"); await new Promise((r) => setTimeout(r, 120)); assert.ok(!events.some((e) => e.kind === "decided"));
}));

// Build G changes buffered arrival to completion time; retain Build F restart parity.
// Review 57: timeout before either flush must remove only unpersisted previews.
test("timeout discards unflushed facts or gates and retains stored progress parity", async () => {
  for (const kind of ["facts", "gates"]) {
    const d = dirs(), board = createProgressBoard(), id = `g-timeout-${kind}`;
    board.start(id, { mode: "sample" });
    const stall = async (...args) => {
      const { trace } = args.at(-1);
      trace.line({ step: "zetaris.query", agent_name: "Executor", action: "sql:thread", input_summary: "unflushed", output_summary: "unflushed", status: "success" });
      await new Promise(() => {});
    };
    const result = await loop.runTicket("T03", { run_id: id, cfg: sampleCfg, deps: {
      ...d, runTimeoutMs: 30, [kind]: stall, onLine: (l) => board.line(id, l),
      onProgress: (e) => e.kind === "decided" ? board.decided(id, e.early) : undefined,
    } });
    assert.equal(result.status, "error", kind);
    assert.ok(board.get(id).steps.some((l) => l.label === "Zetaris: the thread"), `${kind}: preview was delivered`);
    board.finish(id, result);
    const lines = readFileSync(join(d.logsDir, `trace-${id}.jsonl`), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(board.get(id), progressFromStored(result, lines), `${kind}: no unpersisted steps survive finish`);
  }
});

test("slow buffered sample facts preserve ran/seen timing, direct timing and restart parity", async () => {
  const d = dirs(), board = createProgressBoard();
  const f = await factsForTicket("T03", { cfg: sampleCfg, as_of: "2026-10-19" });
  board.start("f-buffer", { mode: "sample" });
  const result = await loop.runTicket("T03", { run_id: "f-buffer", cfg: sampleCfg, deps: {
    ...d, facts: async (_id, { trace }) => {
      trace.line({ step: "zetaris.query", agent_name: "Executor", action: "sql:thread", input_summary: "thread", output_summary: "one row", status: "success" });
      await new Promise((r) => setTimeout(r, 350)); return f;
    }, onLine: (l) => board.line("f-buffer", l),
    onProgress: (e) => e.kind === "decided" ? board.decided("f-buffer", e.early) : undefined,
  } });
  board.finish("f-buffer", result);
  const done = board.get("f-buffer"), buffered = done.steps.find((l) => l.step === "zetaris.query");
  assert.ok(Math.abs(buffered.seen_s - buffered.ran_s) <= 0.2, "buffered arrival tracks execution");
  const direct = done.steps.find((l) => l.step === "memory.read");
  assert.ok(Math.abs(direct.seen_s - direct.ran_s) <= 0.2, "direct arrival tracks execution");
  const lines = readFileSync(join(d.logsDir, "trace-f-buffer.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(progressFromStored(result, lines), done, "disk retains both timings and early seen_s");
});

// Build G: a late disk flush is no longer a late progress arrival.
test("delayed live-stub facts flush does not journal a progress delay", guard(async () => {
  const deps = await liveDeps(), messages = [];
  const facts = await deps.facts();
  deps.facts = async (_id, { trace }) => {
    for (let i = 0; i < 2; i++) trace.line({ step: "zetaris.query", agent_name: "Executor", action: "sql:thread", input_summary: "PRIVATE-CONTENT", output_summary: "PRIVATE-NAME", status: "success" });
    await new Promise((r) => setTimeout(r, 10150)); return facts;
  };
  const realError = console.error; console.error = (s) => messages.push(s);
  try { await loop.runTicket("T03", { run_id: "f-delay", cfg: liveCfg, deps }); }
  finally { console.error = realError; }
  const diagnostics = messages.filter((s) => String(s).includes('"diagnostic":"progress_delay"')).map(JSON.parse);
  assert.deepEqual(diagnostics, []);
}));

// Review 57: delay delivery itself, using a virtual clock to avoid a real 10 s wait.
test("delayed board delivery journals one safe diagnostic with the original fields", guard(async () => {
  const deps = await liveDeps(), board = createProgressBoard({ now: () => Date.now() }), messages = [];
  const facts = await deps.facts(), realNow = Date.now, realError = console.error;
  let now = realNow(), delayed = false;
  Date.now = () => now; console.error = (s) => messages.push(s);
  board.start("g-delivery-delay", { mode: "live" });
  deps.facts = async (_id, { trace }) => {
    for (let i = 0; i < 2; i++) trace.line({ step: "zetaris.query", agent_name: "Executor", action: "sql:thread", input_summary: "PRIVATE-CONTENT", output_summary: "PRIVATE-NAME", status: "success" });
    return facts;
  };
  deps.onLine = (l, { buffered }) => {
    if (buffered && !delayed) { now += 10150; delayed = true; }
    board.line("g-delivery-delay", l);
  };
  try { await loop.runTicket("T03", { run_id: "g-delivery-delay", cfg: liveCfg, deps }); }
  finally { Date.now = realNow; console.error = realError; }
  const diagnostics = messages.filter((s) => String(s).includes('"diagnostic":"progress_delay"')).map(JSON.parse);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(Object.keys(diagnostics[0]).sort(), ["diagnostic", "flush", "ran_s", "run_id", "seen_s", "step"]);
  assert.ok(diagnostics[0].flush === "facts" && diagnostics[0].seen_s > diagnostics[0].ran_s + 10);
}));

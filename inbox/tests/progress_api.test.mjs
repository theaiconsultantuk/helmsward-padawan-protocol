// Boundaries: live polling before completion, safe read payloads, restart parity and admission failures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createServer, runs } from "../src/server.mjs";
import { createProgressBoard } from "../src/progress.mjs";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { factsForTicket } from "../src/queries.mjs";
const mk = (s) => mkdtempSync(join(tmpdir(), `pc-api-${s}-`));
const dirs = () => ({ dir: mk("dec"), runtimeDir: mk("rt"), logsDir: mk("logs"), memoryDir: mk("mem"), quiet: true, persistRuns: false, publish: async () => ({ published: true }) });
const cfg = (live = false) => config({ API_TOKEN: "", SAMPLE_MODE: live ? "false" : "true", NIGHTSHIFT_ROUTE_PRIMARY: "nvidia/nemotron-primary", REFUND_READER: "false" });
async function server({ live = false, deps = dirs(), board = createProgressBoard() } = {}) {
  const srv = createServer({ cfg: cfg(live), deps: { ...deps, progressBoard: board } });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { srv, base, board, get: (p) => fetch(base + p), post: (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) };
}
const latch = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function until(s, id, predicate) {
  const start = Date.now();
  while (Date.now() - start < 5000) { const r = await s.get(`/runs/${id}/progress`); const p = await r.json(); if (r.ok && predicate(p)) return p; await new Promise((r) => setTimeout(r, 5)); }
  assert.fail(`progress condition timed out for ${id}`);
}
const safe = (v) => { const s = JSON.stringify(v); for (const p of ["/opt/", "/home/", "/Users/", "/tmp/", tmpdir(), INBOX_ROOT]) assert.ok(!s.includes(p), `payload leaks ${p}: ${s.slice(0, 160)}`); assert.doesNotMatch(s, /[A-Za-z]:\\\\/); };
async function sweep(s, id) { for (const p of [`/runs/${id}`, `/runs/${id}/trace`, `/runs/${id}/journey`, `/runs/${id}/progress`, "/queue", "/runs", "/health"]) { const r = await s.get(p); assert.equal(r.status, 200, p); safe(await r.json()); } }
const guarded = (fn) => async () => {
  const real = globalThis.fetch; globalThis.fetch = (url, o) => /^http:\/\/127\.0\.0\.1:\d+\//.test(String(url)) ? real(url, o) : Promise.reject(Object.assign(Error("no network"), { code: "ENETUNREACH" }));
  try { await fn(); } finally { globalThis.fetch = real; }
};
const drafted = { text: JSON.stringify({ reply_text: "Your request has been routed for approval.", promises: { refund_amount: null, replacement: false, other: null } }), model: "nvidia/nemotron-x" };
async function liveDeps() {
  const facts = await factsForTicket("T03", { cfg: cfg(), as_of: "2026-10-19" });
  return { ...dirs(), facts: async () => facts, gates: async () => ({ answers: {}, model: "rules", gate_source: "rules", confidence: 0.5 }), findDuplicate: async () => null, ledgerAdjust: async () => ({ affirmed: 0, rejected: 0 }), drafter: async () => drafted, critic: async () => ({ pass: true, reason: "ok", model: "nvidia/nemotron-x" }), nightshiftStatus: async () => ({ state: "offline", models: [], ms: 1 }) };
}
test("slow live stubs expose early escalation, then increasing steps during critique; reused and busy ids cannot reset progress", guarded(async () => {
  const D = latch(), C = latch(); const deps = await liveDeps();
  deps.drafter = async () => { await D.promise; return drafted; }; deps.critic = async () => { await C.promise; return { pass: true, reason: "ok", model: "nvidia/nemotron-x" }; };
  const s = await server({ live: true, deps }); let pending, second;
  try {
    pending = s.post("/run", { run_id: "c-slow", input: { thread_id: "T03" } });
    const first = await until(s, "c-slow", (p) => p.decision_early && p.working.some((w) => w.agent === "Drafter"));
    assert.equal(first.state, "running"); assert.equal(first.decision, null);
    assert.equal(first.decision_early.decision, "escalate"); assert.equal(first.decision_early.branch_id, "over-limit"); assert.equal(first.decision_early.draft_pending, true);
    assert.deepEqual(first.working.map(({ agent, label, engine }) => ({ agent, label, engine })), [{ agent: "Drafter", label: "Drafter writing", engine: "Nemotron" }]);
    assert.equal((await s.post("/run", { run_id: "c-slow", input: { thread_id: "T03" } })).status, 409);
    assert.deepEqual((await (await s.get("/runs/c-slow/progress")).json()).decision_early, first.decision_early);
    second = s.post("/run", { run_id: "c-second", input: { thread_id: "T03" } }); await until(s, "c-second", (p) => p.working.length > 0);
    assert.equal((await s.post("/run", { run_id: "c-refused", input: { thread_id: "T03" } })).status, 503); assert.equal((await s.get("/runs/c-refused/progress")).status, 404);
    D.resolve(); const mid = await until(s, "c-slow", (p) => p.working.some((w) => w.agent === "Evaluator"));
    assert.equal(mid.state, "running"); assert.ok(mid.steps.length > first.steps.length); assert.ok(mid.steps.some((l) => l.step === "nvidia.model" && l.agent === "Drafter"));
    C.resolve(); const response = await pending; assert.equal(response.status, 200); const run = await response.json(); assert.equal(run.output.decision, "escalate");
    await second; const done = await (await s.get("/runs/c-slow/progress")).json(); assert.equal(done.state, "done"); assert.equal(done.decision, "escalate"); assert.deepEqual(done.working, []); assert.deepEqual(done.decision_early, first.decision_early);
    assert.equal((await (await s.get("/runs/c-slow/progress")).json()).elapsed_s, done.elapsed_s); await sweep(s, "c-slow");
  } finally { D.resolve(); C.resolve(); await Promise.allSettled([pending, second]); s.srv.close(); }
}));
test("health primary down is safe and passive fallback is reported; sample never probes and a hanging first probe is capped", guarded(async () => {
  const deps = await liveDeps(); deps.drafter = async () => ({ ...drafted, model: "llama-x", lane: "local-lane", fallback: { route: "local-lane", reason: "UpstreamRefused" } });
  const s = await server({ live: true, deps });
  try { const h = await (await s.get("/health")).json(); assert.equal(h.ok, true); assert.equal(h.primary?.reachable, false); assert.equal(h.primary.fallback_in_use, true);
    const r = await (await s.post("/run", { run_id: "c-fallback", input: { thread_id: "T03" } })).json(); assert.equal(r.provider?.primary_used, false); assert.match(r.provider.fallback_reason, /^draft:/);
    assert.equal((await (await s.get("/health")).json()).primary.last_fallback_reason, r.provider.fallback_reason);
  } finally { s.srv.close(); }
  let probes = 0; const sample = await server({ deps: { ...dirs(), nightshiftStatus: () => { probes++; } } });
  try { assert.equal((await (await sample.get("/health")).json()).primary?.mode, "sample"); assert.equal(probes, 0); } finally { sample.srv.close(); }
  const cold = await server({ live: true, deps: { ...dirs(), healthFirstWaitMs: 30, nightshiftStatus: () => new Promise(() => {}) } });
  try { const t = Date.now(); assert.equal((await (await cold.get("/health")).json()).primary?.reachable, null); assert.ok(Date.now() - t < 1000); } finally { cold.srv.close(); }
}));
test("all fourteen demo scenarios have path-free read routes", guarded(async () => {
  const s = await server();
  try { const list = await (await s.get("/demo/scenarios")).json();
    for (const d of list) {
      const client = await (await s.get(`/demo/client${["s04", "s10"].includes(d.id) ? `?scenario=${d.id}` : ""}`)).json();
      const res = await s.post("/run", { run_id: `c-demo-${d.id}`, input: { message: d.message, from: client.email, name: client.name, channel: d.channel, scenario: d.scenario, as_of: d.as_of } });
      assert.equal(res.status, 200, d.id); safe(await res.json()); await sweep(s, `c-demo-${d.id}`);
    }
  } finally { s.srv.close(); }
}));
test("finished board and disk-derived progress agree, including elapsed time and early decision; missing trace and evicted entry work", async () => {
  const deps = { ...dirs(), persistRuns: true }; const s = await server({ deps });
  try {
    const res = await s.post("/run", { run_id: "c-disk", input: { thread_id: "T03", as_of: "2026-10-19" } }); assert.equal(res.status, 200);
    const run = await res.json();
    for (const value of [run, await (await s.get("/runs/c-disk")).json(), await (await s.get("/runs/c-disk/journey")).json()]) {
      assert.ok(typeof value.wall_ms === "number" && value.wall_ms >= 0 && value.wall_ms <= run.execution_time_seconds * 1000 + 50, "wall_ms survives the served boundary");
    }
    const board = await (await s.get("/runs/c-disk/progress")).json(); runs.clear();
    const reloaded = await server({ deps });
    try {
      for (const path of ["/runs/c-disk", "/runs/c-disk/journey"]) assert.equal((await (await reloaded.get(path)).json()).wall_ms, run.wall_ms, "wall_ms survives persistence");
      const restored = await (await reloaded.get("/runs/c-disk/progress")).json(); assert.equal(restored.state, "done"); assert.deepEqual(restored, board);
      unlinkSync(join(deps.logsDir, basename(run.log_file))); const missing = await (await reloaded.get("/runs/c-disk/progress")).json(); assert.deepEqual(missing.steps, []);
    } finally { reloaded.srv.close(); }
    const evicted = await server({ deps: { ...deps, persistRuns: false }, board: createProgressBoard({ cap: 0 }) });
    try { const r = await evicted.post("/run", { run_id: "c-evicted", input: { thread_id: "T02" } }); assert.equal(r.status, 200); assert.equal((await (await evicted.get("/runs/c-evicted/progress")).json()).state, "done"); } finally { evicted.srv.close(); }
  } finally { s.srv.close(); }
});
test("progress operation grid: unknown, invalid, ask, non-GET and crashed run", async () => {
  const deps = dirs(); const s = await server({ deps });
  try {
    assert.equal((await s.get("/runs/c-unknown/progress")).status, 404);
    assert.equal((await s.post("/run", { run_id: "c-invalid", input: {} })).status, 400); assert.equal((await s.get("/runs/c-invalid/progress")).status, 404);
    const ask = await (await s.post("/ask", { question: "What is the refund limit?" })).json(); const r = await s.get(`/runs/${ask.run_id}/progress`); assert.equal(r.status, 404); assert.match((await r.json()).error.message, /progress exists for \/run runs only/);
    assert.equal((await s.post("/runs/c-unknown/progress", {})).status, 405);
  } finally { s.srv.close(); }
  const file = join(mk("bad"), "file"); writeFileSync(file, "file"); const bad = await server({ deps: { ...dirs(), logsDir: file } });
  try { assert.equal((await bad.post("/run", { run_id: "c-crash", input: { thread_id: "T02" } })).status, 500); const p = await (await bad.get("/runs/c-crash/progress")).json(); assert.equal(p.state, "done"); assert.equal(p.status, "error"); } finally { bad.srv.close(); }
});

// Review 51: legacy early decisions must satisfy the nullable field contract on both read routes.
test("old stored early decisions expose seen_s null on result and progress reads", async () => {
  const deps = { ...dirs(), persistRuns: true };
  const early = { decision: "escalate", branch_id: "over-limit", why: "over limit", draft_pending: true, at_s: 1.2 };
  mkdirSync(join(deps.runtimeDir, "runs"), { recursive: true });
  writeFileSync(join(deps.runtimeDir, "runs", "f-old.json"), JSON.stringify({ result: { run_id: "f-old", output: { decision: "escalate" }, decision_early: early, execution_time_seconds: 2, status: "success" } }));
  const s = await server({ deps });
  try {
    for (const path of ["/runs/f-old", "/runs/f-old/progress"]) assert.deepEqual((await (await s.get(path)).json()).decision_early, { seen_s: null, ...early });
  } finally { runs.delete("f-old"); s.srv.close(); }
});

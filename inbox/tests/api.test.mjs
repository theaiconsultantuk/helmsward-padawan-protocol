// The HTTP API in sample mode: ephemeral port, temp runtime/logs/memory dirs, publish() stubbed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";
import { parseCsv, setVerdict, appendDecision, localCounters, ledgerAdjust } from "../src/decisions.mjs";

const dir = mkdtempSync(join(tmpdir(), "api-runtime-"));
const logsDir = mkdtempSync(join(tmpdir(), "api-logs-"));
const memoryDir = mkdtempSync(join(tmpdir(), "api-mem-"));
const publishes = [];
let server, base;

before(async () => {
  server = createServer({
    cfg: config({ SAMPLE_MODE: "true" }),
    deps: { dir, logsDir, memoryDir, quiet: true, publish: async (o) => { publishes.push(o.dir); return { published: true, uncached: true }; } },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const rows = () => parseCsv(readFileSync(join(dir, "decisions.csv"), "utf8"));

test("GET /sources lists at least 15 sources with measured fields", async () => {
  const r = await get("/sources");
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.ok(list.length >= 15, `got ${list.length}`);
  for (const s of list) assert.deepEqual(Object.keys(s).sort(), ["format", "live", "name", "rows", "table"]);
  assert.ok(list.some((s) => s.table === "decisions"));
});

test("GET /intake is the contact-form array", async () => {
  const r = await get("/intake");
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.ok(Array.isArray(list) && list.length >= 5);
  assert.ok(list[0].submission_id && list[0].message);
});

test("POST /ask answers the refund question with cited rows", async () => {
  const r = await post("/ask", { question: "Can I get a refund on my lightsaber?" });
  assert.equal(r.status, 200);
  const a = await r.json();
  assert.equal(a.intent, "refund.request");
  assert.ok(a.cited_rows.includes("policy:refund"));
  assert.match(a.answer, /150/);
  assert.ok(a.run_id && a.trace_id);
  // an ask has a stored trace too
  const t = await (await get(`/runs/${a.run_id}/trace`)).json();
  assert.ok(t.some((l) => l.step === "synthesis"));
});

test("POST /ask 400 on a missing or non-string question and on bad JSON", async () => {
  assert.equal((await post("/ask", {})).status, 400);
  assert.equal((await post("/ask", { question: "   " })).status, 400);
  assert.equal((await post("/ask", { question: 5 })).status, 400);
  assert.equal((await post("/ask", "{nope")).status, 400);
});

test("/run stores the result, the trace, a decision row, and /feedback rewrites the row", async () => {
  const r = await post("/run", { run_id: "api-t1", input: { thread_id: "T02" } });
  assert.equal(r.status, 200);
  const run = await r.json();
  assert.equal(run.status, "success");

  const stored = await (await get("/runs/api-t1")).json();
  assert.deepEqual(stored, run);
  const trace = await (await get("/runs/api-t1/trace")).json();
  assert.ok(Array.isArray(trace) && trace.length >= 10);
  assert.ok(trace.every((l) => l.run_id === "api-t1"));
  assert.equal(trace.at(-1).step, "synthesis");

  const row = rows().find((x) => x.run_id === "api-t1");
  assert.deepEqual({ ...row, ts: "x" }, { run_id: "api-t1", thread_id: "T02", category: "refund", decision: run.output.decision, verdict: "", delta: "", ts: "x" });
  assert.equal((await (await get("/counters")).json()).affirmed, 0);

  const f = await post("/feedback", { run_id: "api-t1", verdict: "affirm", note: "good call" });
  assert.equal(f.status, 200);
  const fb = await f.json();
  assert.equal(fb.verdict, "affirm");
  assert.equal(fb.delta, 0.05);
  assert.equal(fb.published, true);
  const after = rows().find((x) => x.run_id === "api-t1");
  assert.equal(after.verdict, "affirm");
  assert.equal(after.delta, "0.05");
  assert.ok(publishes.length >= 2, "publish ran after the run and after the feedback");

  const c = await (await get("/counters")).json();
  assert.equal(c.affirmed, 1);
  assert.equal(c[run.output.decision], 1);
  assert.deepEqual(ledgerAdjust("refund", { dir }), { affirmed: 1, rejected: 0 });

  const rj = await (await post("/feedback", { run_id: "api-t1", verdict: "reject" })).json();
  assert.equal(rj.delta, -0.05);
  assert.deepEqual(localCounters({ dir }).rejected, 1);
});

test("404 and 400 paths", async () => {
  assert.equal((await get("/runs/nope")).status, 404);
  assert.equal((await get("/runs/nope/trace")).status, 404);
  assert.equal((await post("/feedback", { run_id: "nope", verdict: "affirm" })).status, 404);
  assert.equal((await post("/feedback", { run_id: "api-t1", verdict: "maybe" })).status, 400);
  assert.equal((await post("/feedback", { verdict: "affirm" })).status, 400);
  assert.equal((await post("/feedback", { run_id: "api-t1", verdict: "affirm", note: 3 })).status, 400);
  assert.equal((await get("/nothing")).status, 404);
  assert.equal((await get("/run")).status, 405);
  assert.equal((await post("/sources", {})).status, 405);
  assert.equal((await post("/run", { input: { thread_id: "T9999" } })).status, 404);
});

test("GET /openapi.yaml serves the YAML file", async () => {
  const r = await get("/openapi.yaml");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /yaml/);
  const text = await r.text();
  assert.match(text, /^openapi: 3\.0/);
  for (const p of ["/health", "/sources", "/intake", "/run", "/ask", "/runs/{id}", "/runs/{id}/trace", "/feedback", "/counters", "/openapi.yaml"]) {
    assert.ok(text.includes(`\n  ${p}:`), `openapi.yaml documents ${p}`);
  }
});

test("CORS: every JSON answer and the preflight carry the open origin", async () => {
  assert.equal((await get("/health")).headers.get("access-control-allow-origin"), "*");
  assert.equal((await get("/runs/nope")).headers.get("access-control-allow-origin"), "*");
  const pre = await fetch(base + "/feedback", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
});

test("decisions file: header, upsert by run_id, atomic rewrite, quoted fields", async () => {
  const d = mkdtempSync(join(tmpdir(), "api-dec-"));
  await appendDecision({ run_id: "a", thread_id: "T01", category: "refund", decision: "hold" }, { dir: d });
  await appendDecision({ run_id: "a", thread_id: "T01", category: "refund", decision: "send" }, { dir: d });
  await appendDecision({ run_id: "b", thread_id: "T02", category: 'we said "hi", ok', decision: "escalate" }, { dir: d });
  assert.equal(readFileSync(join(d, "decisions.csv"), "utf8").split("\n")[0], "run_id,thread_id,category,decision,verdict,delta,ts");
  const all = parseCsv(readFileSync(join(d, "decisions.csv"), "utf8"));
  assert.equal(all.length, 2);
  assert.equal(all.find((x) => x.run_id === "a").decision, "send");
  assert.equal(all.find((x) => x.run_id === "b").category, 'we said "hi", ok');
  assert.equal(await setVerdict("zzz", "affirm", null, { dir: d }), null);
  await assert.rejects(setVerdict("a", "meh", null, { dir: d }), TypeError);
  assert.equal(localCounters({ dir: d }).queued, 1);
});

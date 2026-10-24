// The HTTP API in sample mode: ephemeral port, temp runtime/logs/memory dirs, publish() stubbed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";
import { publish, parseCsv, readDecisions, setVerdict, appendDecision, localCounters, ledgerAdjust } from "../src/decisions.mjs";

const dir = mkdtempSync(join(tmpdir(), "api-runtime-"));
const runtimeDir = mkdtempSync(join(tmpdir(), "api-intake-"));
const logsDir = mkdtempSync(join(tmpdir(), "api-logs-"));
const memoryDir = mkdtempSync(join(tmpdir(), "api-mem-"));
const publishes = [];
let server, base;

before(async () => {
  server = createServer({
    cfg: config({ API_TOKEN: "",  SAMPLE_MODE: "true" }),
    deps: { dir, runtimeDir, logsDir, memoryDir, quiet: true, publish: async (o) => { publishes.push(o.dir); return { published: true, uncached: true }; } },
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

test("a sample-forced /run on a LIVE server records no decision and publishes nothing", async () => {
  const ldir = mkdtempSync(join(tmpdir(), "api-live-runtime-"));
  const livePublishes = [];
  const live = createServer({
    cfg: config({ API_TOKEN: "",  SAMPLE_MODE: "false" }),
    deps: { dir: ldir, logsDir, memoryDir, quiet: true, publish: async () => { livePublishes.push(1); return { published: true, uncached: true }; } },
  });
  await new Promise((r) => live.listen(0, "127.0.0.1", r));
  try {
    const lb = `http://127.0.0.1:${live.address().port}`;
    const r = await fetch(lb + "/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: "api-live-sample", input: { thread_id: "T02" }, options: { sample_mode: true } }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "success");
    await new Promise((r2) => setTimeout(r2, 100));
    assert.deepEqual(readDecisions({ dir: ldir }), []);
    assert.equal(livePublishes.length, 0);
  } finally { live.close(); }
});

// publish() with docker and tar stubbed: only the UNCACHE failure kind varies
const fakeTar = () => ({ stdout: {}, on(ev, cb) { if (ev === "close") setImmediate(() => cb(0)); } });
const publishWith = (err) => publish({
  dir, cfg: config({ API_TOKEN: "",  SAMPLE_MODE: "false" }), run: async () => {}, spawnImpl: fakeTar,
  runSql: async () => { if (err) throw err; },
});

test("publish: a missing-table UNCACHE failure is the quiet first publish", async () => {
  const r = await publishWith(Object.assign(new Error("Table decisions not found"), { name: "BadResponse" }));
  assert.deepEqual(r, { published: true, uncached: false });
});

test("publish: an HTTP 500 on UNCACHE is reported, not swallowed", async () => {
  const r = await publishWith(Object.assign(new Error("zetaris: HTTP 500"), { name: "BadResponse" }));
  assert.equal(r.published, true);
  assert.equal(r.uncached, false);
  assert.match(r.error, /^BadResponse: zetaris: HTTP 500/);
});

test("publish: a clean UNCACHE reports uncached true and no error", async () => {
  assert.deepEqual(await publishWith(null), { published: true, uncached: true });
});

const MSG = { from: "a@example.com", channel: "chat", as_of: "2026-10-20" };

test("POST /run takes a free-text FAQ question: scenario, branch, send, the FAQ answer", async () => {
  const r = await post("/run", { run_id: "msg-faq", input: { ...MSG, message: "How long does shipping take?" } });
  assert.equal(r.status, 200);
  const run = await r.json();
  assert.equal(run.status, "success");
  assert.equal(run.scenario, "question");
  assert.equal(run.branch_id, "faq-hit");
  assert.equal(run.output.decision, "send");
  assert.match(run.output.draft.text, /Shipping time depends/);
  assert.equal(run.input.kind, "message");
  assert.match(run.input.thread_id, /^F\d+$/);
  const stored = await (await get("/runs/msg-faq")).json();
  assert.deepEqual(stored, run);
  assert.equal(stored.scenario, "question");
  assert.ok(stored.resolved_how);
});

test("POST /run free-text RFQ escalates to the sales owner with cited product rows", async () => {
  const r = await post("/run", { run_id: "msg-rfq", input: { ...MSG, from: "buyer@example.com", scenario: "rfq", message: "Incoming RFQ for price difference between ordering 100000 Vanta Arc Trainers and 100" } });
  assert.equal(r.status, 200);
  const run = await r.json();
  assert.equal(run.scenario, "rfq");
  assert.equal(run.output.decision, "escalate");
  assert.equal(run.output.queued_for.owner_id, 6);
  const att = run.output.queued_for.attachments;
  assert.ok(att.prices.length <= 1);
  assert.ok(att.cited.includes("products:FS-B01"), JSON.stringify(att.cited));
});

test("POST /run 400 names the bad message field", async () => {
  const bad = async (patch, re) => {
    const r = await post("/run", { input: { ...MSG, message: "How long does shipping take?", ...patch } });
    assert.equal(r.status, 400, JSON.stringify(patch).slice(0, 80));
    const b = await r.json();
    assert.equal(b.error.type, "BadRequest");
    assert.match(b.error.message, re);
  };
  await bad({ channel: "sms" }, /channel/);
  await bad({ message: "x".repeat(4001) }, /message/);
  await bad({ message: "   " }, /message/);
  await bad({ as_of: "yesterday" }, /as_of/);
  await bad({ scenario: "quote" }, /scenario/);
  await bad({ from: "" }, /from/);
  await bad({ subject: 5 }, /subject/);
});

test("POST /run 409 on a reused run_id, both roads", async () => {
  const body = { run_id: "msg-dup", input: { ...MSG, message: "How long does shipping take?" } };
  assert.equal((await post("/run", body)).status, 200);
  const again = await post("/run", body);
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.type, "Conflict");
  assert.equal((await post("/run", { run_id: "api-t1", input: { thread_id: "T02" } })).status, 409);
});

test("free-text run gets a decision row with its F id and takes /feedback", async () => {
  const run = await (await get("/runs/msg-faq")).json();
  const f = await post("/feedback", { run_id: "msg-faq", verdict: "affirm" });
  assert.equal(f.status, 200);
  const row = rows().find((x) => x.run_id === "msg-faq");
  assert.equal(row.thread_id, run.input.thread_id);
  assert.match(row.thread_id, /^F\d+$/);
  assert.equal(row.verdict, "affirm");
});

test("a token in a message never comes back from /runs/:id or its trace", async () => {
  const token = "sk-test-" + "x".repeat(40);
  const r = await post("/run", { run_id: "msg-secret", input: { ...MSG, message: `How long does shipping take? my key is ${token}` } });
  assert.equal(r.status, 200);
  await r.text();
  const a = await (await get("/runs/msg-secret")).text();
  const t = await (await get("/runs/msg-secret/trace")).text();
  assert.ok(!a.includes(token), "run body masked");
  assert.ok(!t.includes(token), "trace body masked");
});

// ---- GET /runs, /runs/:id/journey, /queue ----
const TOKEN = "sk-test-" + "x".repeat(40);

test("GET /runs lists runs newest first with the list fields, and honours limit", async () => {
  const r = await get("/runs");
  assert.equal(r.status, 200);
  const list = await r.json();
  const iFaq = list.findIndex((x) => x.run_id === "msg-faq");
  const iRfq = list.findIndex((x) => x.run_id === "msg-rfq");
  assert.ok(iFaq >= 0 && iRfq >= 0 && iRfq < iFaq, "rfq ran after faq, so it is listed first");
  for (const x of list) {
    assert.deepEqual(Object.keys(x).sort(), ["at", "branch_id", "decision", "execution_time_seconds", "kind", "run_id", "scenario", "thread_id"]);
    assert.ok(["run", "ask"].includes(x.kind));
    assert.ok(Number.isFinite(Date.parse(x.at)), x.at);
  }
  for (let i = 1; i < list.length; i++) assert.ok(Date.parse(list[i - 1].at) >= Date.parse(list[i].at), "newest first");
  assert.equal(list[iRfq].scenario, "rfq");
  assert.equal(list[iRfq].decision, "escalate");
  assert.equal(list[iFaq].decision, "send");
  assert.ok(list.some((x) => x.kind === "ask"), "the earlier /ask is listed as kind ask");
  const one = await (await get("/runs?limit=1")).json();
  assert.equal(one.length, 1);
  assert.equal(one[0].run_id, list[0].run_id);
});

test("GET /runs rejects a limit outside 1 to 200", async () => {
  for (const q of ["0", "201", "-1", "abc", "1.5"]) {
    const r = await get(`/runs?limit=${q}`);
    assert.equal(r.status, 400, q);
    assert.equal((await r.json()).error.type, "BadRequest");
  }
  assert.equal((await get("/runs?limit=200")).status, 200);
});

test("the three /runs routes stay apart: list, one run, its journey", async () => {
  const list = await (await get("/runs")).json();
  assert.ok(Array.isArray(list));
  const one = await (await get("/runs/msg-faq")).json();
  assert.equal(one.run_id, "msg-faq");
  assert.ok(!Array.isArray(one) && one.output);
  const j = await (await get("/runs/msg-faq/journey")).json();
  assert.ok(Array.isArray(j.nodes) && j.human);
  assert.equal((await get("/runs/msg-faq/other")).status, 404);
  assert.equal((await post("/runs", {})).status, 405);
  assert.equal((await post("/queue", {})).status, 405);
});

test("GET /runs/:id/journey derives the journey from the stored result and its trace", async () => {
  for (const [id, kind] of [["msg-faq", "auto_reply"], ["msg-rfq", "escalation"]]) {
    const r = await get(`/runs/${id}/journey`);
    assert.equal(r.status, 200, id);
    const j = await r.json();
    const trace = await (await get(`/runs/${id}/trace`)).json();
    assert.equal(j.nodes.length, trace.length, id);
    assert.equal(j.human.reply.kind, kind, id);
    for (const n of j.nodes) for (const c of n.retained) assert.ok(n.consulted.includes(c), `${id} node ${n.n}: ${c}`);
    if (id === "msg-rfq") {
      assert.equal(j.reached_human.who.employee_id, 6);
      assert.ok(j.nodes.some((n) => n.reached_human));
    }
  }
  const gone = await get("/runs/nope/journey");
  assert.equal(gone.status, 404);
  assert.equal((await gone.json()).error.type, "NotFound");
});

test("GET /queue lists the escalated RFQ with its owner, draft flag and critiques", async () => {
  const r = await get("/queue");
  assert.equal(r.status, 200);
  const q = await r.json();
  assert.ok(Array.isArray(q) && q.length >= 1);
  const rfq = await (await get("/runs/msg-rfq")).json();
  const row = q.find((x) => x.ticket_id === rfq.input.thread_id);
  assert.ok(row, JSON.stringify(q).slice(0, 300));
  const who = row.approver ?? row.owner;
  assert.equal(who.employee_id, 6);
  assert.ok(typeof who.name === "string" && who.name.length > 0, JSON.stringify(who));
  assert.equal(row.has_draft, true);
  assert.ok(Array.isArray(row.critiques));
  assert.ok(row.file.endsWith(".json") && Number.isFinite(Date.parse(row.mtime)));
});

test("GET /queue is [] when the queue directory is absent", async () => {
  const empty = createServer({ cfg: config({ API_TOKEN: "",  SAMPLE_MODE: "true" }), deps: { dir, runtimeDir, logsDir, memoryDir: mkdtempSync(join(tmpdir(), "api-emptymem-")), quiet: true, publish: async () => ({ published: true }) } });
  await new Promise((res) => empty.listen(0, "127.0.0.1", res));
  try {
    const q = await (await fetch(`http://127.0.0.1:${empty.address().port}/queue`)).json();
    // held runs from the shared runs map may be listed; no queue-file rows may be
    assert.ok(q.every((x) => x.kind === "held"), JSON.stringify(q).slice(0, 200));
  } finally { empty.close(); }
});

test("a token in a message is absent from /runs, the journey and /queue", async () => {
  const r = await post("/run", { run_id: "msg-secret2", input: { ...MSG, from: "buyer@example.com", scenario: "rfq", message: `Incoming RFQ for price difference between ordering 100000 Vanta Arc Trainers and 100, key ${TOKEN}` } });
  assert.equal(r.status, 200);
  await r.text();
  for (const p of ["/runs", "/runs/msg-secret2/journey", "/queue"]) {
    const body = await (await get(p)).text();
    assert.ok(!body.includes(TOKEN), `${p} masked`);
  }
});

test("(a) two concurrent message runs with different run ids get two distinct F ids; a concurrent reused run id is a 409", async () => {
  const mk = (id) => post("/run", { run_id: id, input: { ...MSG, message: "How long does shipping take?" } });
  const [a, b] = await Promise.all([mk("conc-a"), mk("conc-b")]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const ia = (await a.json()).input.thread_id, ib = (await b.json()).input.thread_id;
  assert.match(ia, /^F\d+$/); assert.match(ib, /^F\d+$/);
  assert.notEqual(ia, ib);
  const [c, d] = await Promise.all([mk("conc-same"), mk("conc-same")]);
  assert.deepEqual([c.status, d.status].sort(), [200, 409]);
});

test("GET /queue names the owner from the queue file, even after the runs map is cleared", async () => {
  const { runs } = await import("../src/server.mjs");
  const run = await (await get("/runs/msg-rfq")).json();
  const file = JSON.parse(readFileSync(join(memoryDir, "queue", `${run.input.thread_id}.json`), "utf8"));
  assert.equal(file.owner.owner_id, 6);
  assert.equal(file.scenario, "rfq");
  const saved = [...runs.entries()];
  runs.clear();
  try {
    const q = await (await get("/queue")).json();
    const row = q.find((x) => x.ticket_id === run.input.thread_id);
    assert.equal(row.owner.employee_id, 6);
    assert.match(row.owner.name, /Tomas Keller/);
  } finally { for (const [k, v] of saved) runs.set(k, v); }
});

// ---- S5.3 review fixes (20, 21, 17) ----
import { runs } from "../src/server.mjs";
import { writeFileSync as _wf } from "node:fs";

test("(20) /queue lists a hold with no draft, has_draft false, with its recommendation", async () => {
  runs.set("synthetic-withheld", { run_id: "synthetic-withheld", status: "success", scenario: "customer_service",
    input: { thread_id: "F-withheld" },
    output: { decision: "hold", draft: null, recommendation: "Call the customer; the draft was withheld.",
      queued_for: { owner_id: "E1", owner_name: "Ana", queue_file: null } } });
  const q = await (await get("/queue")).json();
  const row = q.find((x) => x.run_id === "synthetic-withheld");
  assert.ok(row, "the withheld hold is listed");
  assert.equal(row.has_draft, false);
  assert.match(row.recommendation, /Call the customer/);
  runs.delete("synthetic-withheld");
});

test("(21) a run_id whose trace file exists on disk is refused 409, even when the runs map no longer holds it", async () => {
  _wf(join(logsDir, "trace-evicted-1.jsonl"), "{}\n");
  const r = await post("/run", { run_id: "evicted-1", input: { thread_id: "T02" } });
  assert.equal(r.status, 409);
});

test("(17) the stored result keeps memory, so the journey marks written memory ids as retained", async () => {
  const r = await post("/run", { run_id: "api-mem1", input: { thread_id: "T02" } });
  const run = await r.json();
  assert.ok(run.memory && Array.isArray(run.memory.written), "memory is on the response");
  const stored = await (await get("/runs/api-mem1")).json();
  assert.deepEqual(stored, run);
  const j = await (await get("/runs/api-mem1/journey")).json();
  const w = j.nodes.find((n) => n.step === "memory.write");
  if (w && w.consulted.length) {
    assert.ok(run.memory.written.length > 0);
    assert.deepEqual(w.retained, w.consulted);
  } else {
    assert.ok(Array.isArray(run.memory.written));
  }
});

test("API_TOKEN set: POST needs the bearer header, GET /health and the pages stay open", async () => {
  const srv = createServer({ cfg: config({ API_TOKEN: "",  SAMPLE_MODE: "true", API_TOKEN: "t-0001-test" }), deps: { dir, runtimeDir, logsDir, memoryDir: mkdtempSync(join(tmpdir(), "api-token-")), quiet: true, publish: async () => ({ published: true }) } });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${b}/health`)).status, 200);
    assert.equal((await fetch(`${b}/`)).status, 200);
    const body = JSON.stringify({ run_id: "tok-1", input: { thread_id: "T02" } });
    const no = await fetch(`${b}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(no.status, 401);
    assert.equal((await no.json()).error.type, "Unauthorized");
    const wrong = await fetch(`${b}/run`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer nope" }, body });
    assert.equal(wrong.status, 401);
    const ok = await fetch(`${b}/run`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t-0001-test" }, body });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).status, "success");
  } finally { await new Promise((r) => srv.close(r)); }
});

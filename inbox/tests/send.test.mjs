// POST /runs/{id}/send: the status x operation grid, through the real server in sample mode with temp dirs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { config } from "../src/config.mjs";
import { INBOX_ROOT } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";

const mk = (n) => mkdtempSync(join(tmpdir(), `send-${n}-`));
const dir = mk("rt"), logsDir = mk("logs"), memoryDir = mk("mem");
let server, base;

async function boot(token = "") {
  const s = createServer({
    cfg: config({ API_TOKEN: token, SAMPLE_MODE: "true" }),
    deps: { dir, runtimeDir: dir, logsDir, memoryDir, quiet: true, publish: async () => ({ published: true, uncached: true }) },
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return s;
}
before(async () => { server = await boot(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

const get = (p) => fetch(base + p);
const post = (p, body, headers = {}) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const run = async (run_id, input) => {
  const r = await post("/run", { run_id, input });
  assert.equal(r.status, 200);
  return r.json();
};
const send = (id, body = {}, headers = {}) => post(`/runs/${id}/send`, body, headers);
const qfile = (j) => resolve(INBOX_ROOT, j.queue_file);
const LEGAL = { message: "This is unacceptable. I will sue you and contact my lawyer unless you refund my order immediately.", from: "angry@example.com", channel: "email", scenario: "complaint" };
const RFQ = { message: "Incoming RFQ for price difference between ordering 100000 Arc Blade Trainers and 100", from: "buyer@example.com", channel: "chat", scenario: "rfq" };

test("(a) a hold with a draft: handled, one queue file, one /queue row, journey carries sent (cold start)", async () => {
  // T02 is a hold; sample mode writes no queue file for it, so this is also case (i)
  const run1 = await run("snd-a", { thread_id: "T02" });
  assert.equal(run1.output.decision, "hold");
  assert.ok(!existsSync(join(memoryDir, "queue", "T02.json")), "a hold writes no queue file of its own");
  const before = await (await get("/queue")).json();
  assert.ok(before.some((x) => x.kind === "held" && x.ticket_id === "T02" && x.status === null), JSON.stringify(before));
  const r = await send("snd-a");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.run_id, "snd-a");
  assert.equal(j.ticket_id, "T02");
  assert.equal(j.status, "handled");
  assert.equal(j.sent.status, "handled");
  assert.ok(j.sent.by && j.sent.by.length > 0);
  assert.match(j.sent.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(j.sent.body, run1.output.draft.text);
  // the file the response names exists under the test's memoryDir and holds the cold-start ticket fields
  assert.equal(qfile(j), join(memoryDir, "queue", "T02.json"));
  const q = JSON.parse(readFileSync(join(memoryDir, "queue", "T02.json"), "utf8"));
  assert.equal(q.ticket.status, "handled");
  assert.equal(q.sent.by, j.sent.by);
  assert.equal(q.ticket.thread_id, "T02");
  assert.equal(q.ticket.sender_email, run1.input.from);
  assert.equal(q.ticket.body, run1.input.text);
  assert.equal(q.ticket.channel, run1.input.channel);
  assert.deepEqual(q.critiques, []);
  assert.equal(q.ticket.draft.text, run1.output.draft.text);
  // exactly one row for the ticket, from the file, with the status
  const rows = (await (await get("/queue")).json()).filter((x) => x.ticket_id === "T02");
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].status, "handled");
  assert.equal(rows[0].sent_at, j.sent.at);
  assert.equal(rows[0].kind, undefined);
  const jr = await (await get("/runs/snd-a/journey")).json();
  assert.equal(jr.sent.status, "handled");
  assert.equal(jr.sent.by, j.sent.by);
  assert.equal(jr.sent.queue_file, j.queue_file);
  assert.equal(jr.ticket_status, "handled");
  assert.equal(jr.status, "handled");
});

test("(b) an escalation without approval: follow_up, and the existing queue file is merged, not replaced", async () => {
  const run1 = await run("snd-b", LEGAL);
  assert.equal(run1.output.decision, "escalate");
  assert.equal(run1.output.courtesy_reply, true);
  assert.ok(!run1.output.queued_for.approval);
  const file = run1.output.queued_for.queue_file;
  assert.ok(existsSync(file));
  const before = JSON.parse(readFileSync(file, "utf8"));
  const r = await send("snd-b", { by: "Soren Adey" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, "follow_up");
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(after.critiques, before.critiques);
  assert.deepEqual(after.owner, before.owner);
  assert.equal(after.recommendation, before.recommendation);
  assert.ok(before.recommendation, "the legal file carries a recommendation");
  assert.deepEqual(after.escalation, before.escalation);
  assert.equal(after.queuedAt, before.queuedAt);
  assert.equal(after.ticket.status, "follow_up");
  assert.equal(after.sent.status, "follow_up");
  const jr = await (await get("/runs/snd-b/journey")).json();
  assert.equal(jr.ticket_status, "follow_up");
  const rows = (await (await get("/queue")).json()).filter((x) => x.file === `${j.ticket_id}.json`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "follow_up");
});

test("(b) the free-text RFQ also escalates without approval: follow_up", async () => {
  const run1 = await run("snd-rfq", RFQ);
  assert.equal(run1.output.decision, "escalate");
  assert.ok(!run1.output.queued_for.approval);
  const j = await (await send("snd-rfq")).json();
  assert.equal(j.status, "follow_up");
});

test("(b2) an escalation with approval (T03): handled, by defaults to the approver", async () => {
  const run1 = await run("snd-b2", { thread_id: "T03" });
  assert.equal(run1.output.decision, "escalate");
  assert.ok(run1.output.queued_for.approval);
  const r = await send("snd-b2");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, "handled");
  assert.equal(j.sent.by, run1.output.queued_for.approval.approver_name);
});

test("(c) sending the same run again is a 409", async () => {
  const r = await send("snd-a");
  assert.equal(r.status, 409);
  const b = await r.json();
  assert.equal(b.error.type, "Conflict");
  assert.match(b.error.message, /already sent at/);
});

test("(d) a send decision cannot be sent", async () => {
  const run1 = await run("snd-d", { message: "How long does shipping take?", from: "a@example.com", channel: "chat" });
  assert.equal(run1.output.decision, "send");
  const r = await send("snd-d");
  assert.equal(r.status, 400);
  assert.match((await r.json()).error.message, /this run decided send/);
});

test("(e) an unknown run is a 404", async () => {
  const r = await send("no-such-run");
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.type, "NotFound");
});

test("(f) text over 4000 characters, or by over 120, is a 400", async () => {
  const r = await send("snd-b2", { text: "x".repeat(4001) });
  assert.equal(r.status, 400);
  assert.equal((await send("snd-b2", { by: "y".repeat(121) })).status, 400);
  assert.equal((await send("snd-b2", { text: "   " })).status, 400);
});

test("(g) by from the body wins over the owner; body text replaces the draft", async () => {
  // the same legal message twice closes as a repeat, so this one is worded differently and from another sender
  const run1 = await run("snd-g", { ...LEGAL, message: "My lawyer will be in touch about the damaged order I received; this is a legal matter now.", from: "other@example.com" });
  assert.equal(run1.output.decision, "escalate");
  const rg = await send("snd-g", { by: "  Priya Raman ", text: " A custom reply. " });
  const j = await rg.json();
  assert.equal(rg.status, 200, JSON.stringify(j) + run1.input.thread_id);
  assert.equal(j.sent.by, "Priya Raman");
  assert.equal(j.sent.body, "A custom reply.");
  assert.notEqual(j.sent.by, run1.output.queued_for.owner_name);
});

test("(h) with API_TOKEN set: no header 401, right header 200, GET is 405", async () => {
  const s = await boot("t");
  const b = `http://127.0.0.1:${s.address().port}`;
  try {
    const H = { "Content-Type": "application/json", Authorization: "Bearer t" };
    const r0 = await fetch(`${b}/run`, { method: "POST", headers: H, body: JSON.stringify({ run_id: "snd-h", input: { ...LEGAL, message: "My solicitor will write to you about the faulty trainers; this is now a formal legal complaint.", from: "auth@example.com" } }) });
    assert.equal(r0.status, 200);
    const noAuth = await fetch(`${b}/runs/snd-h/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noAuth.status, 401);
    assert.match((await noAuth.json()).error.message, /\/runs\/\{id\}\/send/);
    const bad = await fetch(`${b}/runs/snd-h/send`, { method: "POST", headers: { ...H, Authorization: "Bearer nope" }, body: "{}" });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${b}/runs/snd-h/send`, { method: "POST", headers: H, body: "{}" });
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${b}/runs/snd-h/send`)).status, 405);
  } finally { s.close(); }
});

test("(i) a second run of an already-sent ticket is a 409: the queue file, not the run id, is the record (the cold start itself is case (a))", async () => {
  const run1 = await run("snd-i", { thread_id: "T02" });
  assert.equal(run1.output.decision, "hold");
  assert.equal((await send("snd-i")).status, 409);
});

// A fresh server with its own temp dirs, so these cases do not share the queue files of the grid above.
async function bootFresh(publish) {
  const d = mk("fresh-rt"), l = mk("fresh-logs"), m = mk("fresh-mem");
  const s = createServer({
    cfg: config({ API_TOKEN: "", SAMPLE_MODE: "true" }),
    deps: { dir: d, runtimeDir: d, logsDir: l, memoryDir: m, quiet: true, publish },
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s.address().port}`;
  const p = (path, body) => fetch(b + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { s, b, p, m };
}

test("(j) a re-escalation of a sent thread keeps `sent` and ticket.status: both runs then answer 409", async () => {
  const f = await bootFresh(async () => ({ published: true, uncached: true }));
  try {
    assert.equal((await f.p("/run", { run_id: "re-A", input: { thread_id: "T03" } })).status, 200);
    assert.equal((await f.p("/runs/re-A/send", {})).status, 200);
    const sentFile = JSON.parse(readFileSync(join(f.m, "queue", "T03.json"), "utf8"));
    assert.equal(sentFile.ticket.status, "handled");
    // the same thread escalates again as run B: the queue file is rewritten
    const rb = await f.p("/run", { run_id: "re-B", input: { thread_id: "T03" } });
    assert.equal(rb.status, 200);
    assert.equal((await rb.json()).output.decision, "escalate");
    const after = JSON.parse(readFileSync(join(f.m, "queue", "T03.json"), "utf8"));
    assert.deepEqual(after.sent, sentFile.sent, "the re-escalation dropped the send marker");
    assert.equal(after.ticket.status, "handled");
    assert.equal((await f.p("/runs/re-A/send", {})).status, 409);
    assert.equal((await f.p("/runs/re-B/send", {})).status, 409);
    const ja = await (await fetch(`${f.b}/runs/re-A/journey`)).json();
    assert.ok(ja.sent && ja.sent.status === "handled", JSON.stringify(ja.sent));
  } finally { f.s.close(); }
});

test("(k) a publish that never resolves does not hold a send: it still answers 200 promptly", async () => {
  const f = await bootFresh(() => new Promise(() => {}));
  try {
    // the run itself may also publish; give it the time a stuck publish would be given, then send
    await Promise.race([
      f.p("/run", { run_id: "hang-A", input: { thread_id: "T03" } }),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    const t0 = Date.now();
    const r = await Promise.race([f.p("/runs/hang-A/send", {}), new Promise((res) => setTimeout(() => res(null), 4000))]);
    assert.ok(r, "the send did not answer within 4s while a publish never resolves");
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 4000);
  } finally { f.s.close(); }
});

// The legal-threat complaint through runTicket in sample mode (scenario 9): Support owns the customer, Legal is told, the heads are in copy,
// a courtesy reply is drafted, and the send (Plan 2) is what later marks follow-up: here the status stays open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { parseCsv } from "../src/csv.mjs";
import { runMessage, msg, dirs, assertAutoReplyInvariant } from "./helpers/route_run.mjs";

const [h, ...rows] = parseCsv(readFileSync(join(INBOX_ROOT, "data", "synthetic", "employees.csv"), "utf8"));
const EMAIL = Object.fromEntries(rows.map((r) => [Number(r[h.indexOf("employee_id")]), r[h.indexOf("email")]]));
const LEGAL = "The Emitter Hilt split open in my hands and I have spoken to my lawyer. If I do not hear from you I will sue.";
const send = (text, channel = "email", from = "angry@example.com", extra = {}, opts = {}) => runMessage(msg(text, channel, from, { name: "Rex Dow", ...extra }), opts);

test("legal threat: complaint-legal escalates to Support (15) with Legal's default owner (203) also told and the heads of Support (7) and Legal (202) in copy", async () => {
  const { result, lines } = await send(LEGAL);
  const o = result.output;
  assert.equal(result.scenario, "complaint");
  assert.equal(result.branch_id, "complaint-legal");
  assert.equal(o.decision, "escalate");
  assert.equal(o.queued_for.owner_id, 15);
  assert.equal(o.team, "Support");
  assert.deepEqual(o.also.map((p) => p.id), [203]);
  assert.deepEqual(o.also.map((p) => [p.name, p.role]), [["Mara Quillfeather", "Legal Counsel"]]);
  assert.deepEqual(o.cc.map((p) => p.id), [7, 202]);
  assert.deepEqual(o.cc.map((p) => [p.name, p.role]), [["Mei-Ling Zhao", "Head of Support"], ["Ilsa Wrenmoor", "Head of Legal"]]);
  for (const p of o.cc) assert.equal(p.email, EMAIL[p.id], `cc ${p.id} email is the employees.csv row`);
  // the offline sample cache holds no employees row for 203: the email is absent, never invented (the live read or a rebuilt cache fills it)
  assert.ok([null, EMAIL[203]].includes(o.also[0].email));
  assert.deepEqual(Object.keys(o.cc[0]), ["id", "name", "role", "email"]);
  assert.equal(o.courtesy_reply, true);
  assert.equal(o.queued_for.courtesy_reply, true);
  assert.equal(o.status, "open");
  assert.notEqual(o.status, "follow_up", "follow-up is set by the send, not by the routing");
  assert.equal(o.auto_reply, false);
  assert.equal(o.recommendation, "courtesy reply now, Legal reviews; the send marks follow-up");
  assert.match(o.reasons[0], /legal threat/);
  assert.equal(o.queued_for.escalation.legal, true);
  for (const c of ["responsibility:legal", "companyhierarchy:7", "companyhierarchy:202", "companyhierarchy:203"]) assert.ok(o.cited_rows.includes(c), `cites ${c}`);
  assertAutoReplyInvariant(assert, result, "legal");
  // the courtesy draft: Support's template, the situation named, signed by Support, no refund, amount, date promise
  assert.match(o.draft.text, /^Hello Rex Dow,\n\nWe are sorry to read what happened with your Emitter Hilt\. We are looking into it now and will come back to you within two working days\.\n\nBest regards,\nJedi Pack Support team$/);
  assert.deepEqual(o.draft.promises, { refund_amount: null, replacement: false, other: null });
  assert.ok(!/refund|replace|lawyer|legal/i.test(o.draft.text), "the courtesy reply does not answer the threat");
  // no model call: the template is the draft
  assert.match(lines.find((l) => l.step === "nvidia.model" && l.status === "skipped" && /courtesy/.test(l.output_summary ?? "")).output_summary, /no model call/);
  assert.equal(lines.find((l) => l.step === "risk.signoff").status, "success");
  const esc = lines.find((l) => l.step === "escalate_or_fallback");
  assert.match(esc.output_summary, /Legal's default owner Mara Quillfeather \(Legal Counsel, 203\)/);
  assert.match(esc.output_summary, /in copy .*\(Head of Support, 7\).*\(Head of Legal, 202\)/);
});

test("the queue file carries cc, also, status and the courtesy flag", async () => {
  const { result } = await send(LEGAL);
  const q = JSON.parse(readFileSync(result.output.queued_for.queue_file, "utf8"));
  assert.deepEqual(q.cc.map((p) => p.id), [7, 202]);
  assert.deepEqual(q.also.map((p) => p.id), [203]);
  assert.equal(q.status, "open");
  assert.equal(q.courtesy_reply, true);
  assert.equal(q.owner.owner_id, 15);
  assert.ok(q.ticket.draft.text.includes("We are sorry to read"));
  assert.equal(q.scenario, "complaint");
});

test("the same email threatens twice (status x operation): both escalate legal, F1 then F2, both open, same people told", async () => {
  const d = dirs();
  const a = await send(LEGAL, "email", "repeat@example.com", {}, { d, run_id: "leg1" });
  const b = await send(`${LEGAL} This is my second message.`, "email", "repeat@example.com", {}, { d, run_id: "leg2" });
  assert.equal(a.result.input.thread_id, "F1");
  assert.equal(b.result.input.thread_id, "F2");
  for (const r of [a, b]) {
    assert.equal(r.result.branch_id, "complaint-legal");
    assert.equal(r.result.output.decision, "escalate");
    assert.equal(r.result.output.status, "open");
    assert.equal(r.result.output.courtesy_reply, true);
    assert.deepEqual(r.result.output.cc.map((p) => p.id), [7, 202]);
  }
  const qa = JSON.parse(readFileSync(a.result.output.queued_for.queue_file, "utf8"));
  const qb = JSON.parse(readFileSync(b.result.output.queued_for.queue_file, "utf8"));
  assert.notEqual(a.result.output.queued_for.queue_file, b.result.output.queued_for.queue_file, "each thread has its own queue file");
  assert.equal(qa.status, "open"); assert.equal(qb.status, "open");
});

test("a legal threat on Trustpilot: legal wins over the channel, the channel row is still cited", async () => {
  const { result } = await send("I will take legal action over the scuffed Drift Boots.", "trustpilot", "tp@example.com", { name: "Lena Kor" });
  assert.equal(result.branch_id, "complaint-legal");
  assert.equal(result.output.decision, "escalate");
  assert.ok(result.output.cited_rows.includes("channels:trustpilot"));
  assert.match(result.output.draft.text, /with your Drift Boots\./);
  assert.equal(result.output.courtesy_reply, true);
});

test("a mild injury (scenario 8) is not legal: complaint-genuine holds for Support with the draft, nobody in copy, no courtesy flag", async () => {
  const { result } = await send("This is unacceptable: the hot emitter of my Arc Blade Trainer gave my son a small burn.", "email", "parent@example.com", { name: "Dana Orr" });
  const o = result.output;
  assert.equal(result.scenario, "complaint");
  assert.equal(result.branch_id, "complaint-genuine");
  assert.equal(o.decision, "hold");
  assert.equal(o.queued_for.owner_id, 15);
  assert.ok(o.draft.text.length > 0);
  assert.deepEqual(o.cc, []);
  assert.deepEqual(o.also, []);
  assert.equal(o.courtesy_reply, undefined);
  assert.equal(o.status, "open");
  assert.equal(o.auto_reply, false);
});

test("unsafe alone (score 10, no lawyer/legal/sue/court words) is the severe route, not legal", async () => {
  const { result } = await send("The hilt feels unsafe and I am furious, never again.", "chat", "u@example.com", { name: "Uma Lo" });
  assert.equal(result.branch_id, "complaint-severe");
  assert.equal(result.output.courtesy_reply, undefined);
  assert.deepEqual(result.output.cc, []);
});

test("a Trustpilot complaint that is not severe (scenario 13) holds for Support with a draft", async () => {
  const { result } = await send("The Drift Boots arrived scuffed and I am disappointed. Posting my honest review here.", "trustpilot", "tp@example.com", { name: "Lena Kor" });
  assert.equal(result.output.decision, "hold");
  assert.match(result.branch_id, /^complaint-(genuine|vent)$/);
  assert.equal(result.output.queued_for.owner_id, 15);
  assert.ok(result.output.draft.text);
  assert.ok(result.output.cited_rows.includes("channels:trustpilot"));
});

test("cold-start twin: a legal threat in fresh dirs and in reused dirs routes the same", async () => {
  const fresh = await send(LEGAL);
  const d = dirs();
  await send("How long does shipping take?", "chat", "q@example.com", {}, { d, run_id: "pre" });
  const warm = await send(LEGAL, "email", "angry@example.com", {}, { d, run_id: "warm" });
  assert.equal(warm.result.input.thread_id, "F2");
  for (const k of ["decision", "status", "courtesy_reply", "team"]) assert.equal(warm.result.output[k], fresh.result.output[k], k);
  assert.deepEqual(warm.result.output.cc, fresh.result.output.cc);
  assert.deepEqual(warm.result.output.also, fresh.result.output.also);
});

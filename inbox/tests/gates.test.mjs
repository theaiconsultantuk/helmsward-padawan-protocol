import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { Trace } from "../src/trace.mjs";
import { typedGates, trustFloor, hardRisk } from "../src/gates.mjs";
import { withMockFetch, mockRefused } from "./helpers/mock_fetch.mjs";

const cfg = config({ OPENJEV_BASE_URL: "http://openjev.test", OPENJEV_API_KEY: "test-key-not-real", SAMPLE_MODE: "false" });
const isOj = (u) => u.endsWith("/v1/systemone");
const T02 = { thread_id: "T02", subject: "Refund for order JP-1042", body: "Please refund order JP-1042. The hilt color is not what I ordered. The charge was 40.00 USD.", category: "refund", amount_usd: 40, sender_email: "lira.venn@example.com" };
const T01 = { thread_id: "T01", subject: "The saber arrived cracked", body: "The saber arrived cracked and I am asking you to replace it.", follow_up_body: "You misunderstood me. Do not send a refund.", follow_up_kind: "misread", category: "replacement" };
const facts02 = { thread_id: "T02", category: "refund", amount_usd: 40, policy_limit_usd: 150, category_weight: 0.55, floor: 0.8, owner_out: true, backup_out: false, may_leave: true, restricted_terms: [] };
const mk = (o) => ({ model: "openjev-0.1", answers: {
  is_follow_up: 0.02, category: { choice: "refund", probabilities: {}, confidence: 0.97 },
  urgency: { score: 0.4, legend: {}, confidence: 0.8 }, tone: { score: 0.8, legend: {}, confidence: 0.7 }, asks_for_money: 0.99, ...o } });
const trace = () => Trace.open("gates-test", { logsDir: mkdtempSync(join(tmpdir(), "gates-")), stdout: false, secrets: [] });

test("T02: money asked, category refund, sent as typed questions without emails, trust under floor", async () => {
  const t = trace(); let sent;
  const g = await withMockFetch([{ match: isOj, reply: (u, i) => { sent = JSON.parse(i.body); return { status: 200, body: mk() }; } }],
    () => typedGates(T02, facts02, { trace: t, cfg }));
  assert.equal(g.gate_source, "openjev");
  assert.ok(g.answers.asks_for_money >= 0.5);
  assert.equal(g.answers.category.choice, "refund");
  assert.deepEqual(Object.keys(sent.questions), ["is_follow_up", "category", "urgency", "tone", "asks_for_money"]);
  assert.equal(typeof sent.questions.is_follow_up.criteria, "object");
  assert.ok(!JSON.stringify(sent).includes("example.com"));
  const l = t.lines[0];
  assert.equal(l.step, "nvidia.model"); assert.equal(l.status, "success"); assert.equal(l.sponsor, "nvidia");
  assert.equal(l.model, "openjev-0.1 (openjev-0.1)"); assert.equal(l.gate_source, "openjev");
  const tf = trustFloor(facts02, g);
  assert.equal(tf.weight, 0.55); assert.equal(tf.floor, 0.8); assert.equal(tf.under, true); assert.equal(tf.category, "refund");
});

test("T01 follow_up_body is read as a follow-up", async () => {
  let sent;
  const g = await withMockFetch([{ match: isOj, reply: (u, i) => { sent = JSON.parse(i.body); return { status: 200, body: mk({ is_follow_up: { type: "noul", noul: 0.95 }, category: { choice: "replacement", confidence: 0.9 } }) }; } }],
    () => typedGates(T01, {}, { cfg }));
  assert.ok(g.answers.is_follow_up >= 0.5);
  assert.ok(sent.state.includes("You misunderstood me"));
});

test("OpenJev refused: rules fallback, confidence 0.5, no throw, success line names the error", async () => {
  const t = trace();
  const g = await withMockFetch(() => { throw mockRefused(); }, () => typedGates(T02, facts02, { trace: t, cfg }));
  assert.equal(g.gate_source, "rules"); assert.equal(g.confidence, 0.5);
  assert.equal(t.lines[0].status, "success"); assert.equal(t.lines[0].gate_source, "rules");
  assert.match(t.lines[0].output_summary, /UpstreamRefused/);
});

test("sample mode: no call, skipped line", async () => {
  const t = trace();
  const g = await withMockFetch(() => { throw new Error("must not call"); }, () => typedGates(T02, facts02, { trace: t, cfg, sampleMode: true }));
  assert.equal(g.gate_source, "rules");
  assert.equal(t.lines[0].status, "skipped"); assert.match(t.lines[0].output_summary, /sample mode/);
});

test("trustFloor: low-confidence category falls back to facts.category; ledgerAdjust +2 lifts by 0.10", () => {
  const low = { answers: { category: { choice: "complaint", confidence: 0.5 } } };
  assert.equal(trustFloor(facts02, low).category, "refund");
  const hi = { answers: { category: { choice: "complaint", confidence: 0.9 } } };
  assert.equal(trustFloor(facts02, hi).category, "complaint");
  assert.equal(trustFloor(facts02, low, { ledgerAdjust: { affirmed: 2, rejected: 0 } }).weight, 0.65);
  assert.equal(trustFloor({ ...facts02, category_weight: 0.98 }, low, { ledgerAdjust: { affirmed: 2, rejected: 0 } }).weight, 1);
});

test("hardRisk: over the limit, both out, may not leave, draft promise", () => {
  const over = hardRisk({ ...facts02, amount_usd: 400, owner_out: false });
  assert.equal(over.hard, true); assert.ok(over.reasons.includes("amount 400 over the policy limit 150"));
  assert.ok(hardRisk({ ...facts02, backup_out: true }).reasons.includes("owner and backup both out"));
  assert.ok(hardRisk({ ...facts02, may_leave: false }).reasons.includes("fact may not leave"));
  assert.ok(hardRisk({ ...facts02, restricted_terms: ["JP-1042"] }, { text: "your order jp-1042" }).hard);
  assert.ok(hardRisk(facts02, { promises: { refund_amount: 400 } }).reasons.includes("draft promises refund above the limit"));
  assert.equal(hardRisk({ ...facts02, owner_out: false }).hard, false);
});

// ---- severityGate (S2.2)
import { severityGate } from "../src/gates.mjs";
import { SEVERITY_QUESTION } from "../src/prompts.mjs";
const SEV = { thread_id: "C1", subject: "Cracked twice", body: "never again", channel: "chat" };

test("SEVERITY_QUESTION: a score question with 10 levels", () => {
  assert.equal(SEVERITY_QUESTION.type, "score"); assert.equal(SEVERITY_QUESTION.criteria.length, 10);
});

test("severityGate: openjev answer 9 with the nvidia.model line", async () => {
  const t = trace(); let sent;
  const g = await withMockFetch([{ match: isOj, reply: (u, i) => { sent = JSON.parse(i.body); return { status: 200, body: { model: "openjev-0.1", answers: { severity: { score: 8, confidence: 0.8 } } } }; } }],
    () => severityGate(SEV, {}, "3 earlier threads", { trace: t, cfg, kind: "genuine" }));
  assert.equal(g.score, 9); assert.equal(g.gate_source, "openjev"); assert.equal(g.confidence, 0.8);
  assert.deepEqual(Object.keys(sent.questions), ["severity"]); assert.match(sent.state, /kind: genuine/);
  assert.equal(t.lines[0].action, "severity_gate"); assert.equal(t.lines[0].status, "success"); assert.equal(t.lines[0].agent_name, "Severity");
});

test("severityGate: score is round(index) + 1, clamped", async () => {
  for (const [raw, want] of [[8.2, 9], [7.4, 8], [0, 1], [9.9, 10]]) {
    const g = await withMockFetch([{ match: isOj, reply: () => ({ status: 200, body: { model: "openjev-0.1", answers: { severity: { score: raw, legend: {}, confidence: 0.7 } } } }) }],
      () => severityGate(SEV, {}, "", { cfg, kind: "genuine" }));
    assert.equal(g.score, want); assert.equal(g.raw, raw); assert.equal(g.gate_source, "openjev");
  }
});

test("severityGate: a 500 falls back to rules at 0.5 with an error line then a success line", async () => {
  const t = trace();
  const g = await withMockFetch([{ match: isOj, reply: () => ({ status: 500, body: { error: "boom" } }) }],
    () => severityGate(SEV, {}, "", { trace: t, cfg, kind: "genuine" }));
  assert.equal(g.gate_source, "rules"); assert.equal(g.confidence, 0.5); assert.equal(g.model, "rules"); assert.equal(g.score, 9);
  assert.deepEqual(t.lines.map((l) => l.step + ":" + l.status), ["nvidia.model:error", "recovery:success", "nvidia.model:success"]);
  assert.match(t.lines[1].output_summary, /severity by rules at confidence 0\.5/);
});

test("S5.3-7: an aborted signal stops severityGate fast, with one fetch and no fallback call", async () => {
  const ac = new AbortController();
  let calls = 0;
  const fetchImpl = (u, init) => { calls += 1; return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))); };
  const p = severityGate(SEV, {}, "", { trace: trace(), cfg, kind: "genuine", fetchImpl, signal: ac.signal });
  setTimeout(() => ac.abort(new Error("RunTimeout")), 10);
  const t0 = Date.now();
  await assert.rejects(p);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(calls, 1);
});

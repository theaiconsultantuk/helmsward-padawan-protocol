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
const T02 = { thread_id: "T02", subject: "Refund for order JP-1042", body: "Please refund order JP-1042. The hilt color is not what I ordered. The charge was 40.00 GC.", category: "refund", amount: 40, sender_email: "lira.venn@example.com" };
const T01 = { thread_id: "T01", subject: "The saber arrived cracked", body: "The saber arrived cracked and I am asking you to replace it.", follow_up_body: "You misunderstood me. Do not send a refund.", follow_up_kind: "misread", category: "replacement" };
const facts02 = { thread_id: "T02", category: "refund", amount: 40, policy_limit: 150, category_weight: 0.55, floor: 0.8, owner_out: true, backup_out: false, may_leave: true, restricted_terms: [] };
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
  const over = hardRisk({ ...facts02, amount: 400, owner_out: false });
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
  assert.deepEqual(Object.keys(sent.questions), ["severity", "legal_threat"]); assert.match(sent.state, /kind: genuine/);
  assert.equal(t.lines[0].action, "severity_gate"); assert.equal(t.lines[0].status, "success"); assert.equal(t.lines[0].agent_name, "Severity");
});

test("severityGate: legal_threat parsed (yes, no, missing falls to the code rule); kind echoed", async () => {
  const ask = async (legal_threat, ticket = SEV, kind = "genuine") => withMockFetch([{ match: isOj, reply: () => ({ status: 200, body: { model: "openjev-0.1", answers: { severity: { score: 9, confidence: 0.8 }, ...(legal_threat === undefined ? {} : { legal_threat }) } } }) }],
    () => severityGate(ticket, {}, "", { cfg, kind }));
  const yes = await ask(0.9); assert.equal(yes.legal, true); assert.equal(yes.kind, "genuine"); assert.equal(yes.score, 10);
  assert.equal((await ask({ noul: 0.1 })).legal, false);
  assert.equal((await ask(undefined, { ...SEV, body: "my lawyer will write" })).legal, true);
  assert.equal((await ask(undefined)).legal, false);
});

test("severityGate (sample/fallback): legal from the legal words only; channel_public kind; injury alone holds", async () => {
  const run = (body, kind = "vent", extra = {}) => severityGate({ thread_id: "S", subject: "x", body, channel: "chat" }, extra, "", { cfg, sampleMode: true, kind });
  const a = await run("I will sue you"); assert.equal(a.legal, true); assert.equal(a.score, 10);
  const b = await run("it cut my hand badly"); assert.equal(b.legal, false); assert.equal(b.score, 6);
  const c = await run("the box was dented, I am annoyed", "channel_public"); assert.equal(c.kind, "channel_public"); assert.ok(c.score <= 8);
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

// einh, 24 Oct 2026: refunds are mentioned only on refund requests (category); his pick B: questions may quote policy. Outside the refund
// category Risk and the sample critic refuse a promise of money on every category and refund wording on every category but a question that
// itself asks about refunds; the approval limit stays a refund-category rule.
test("hardRisk and the sample critic: money promised outside the refund category is refused; refund wording too, unless a question asks about refunds", async () => {
  const sample = await import("../src/adapters/sample.mjs");
  const base = { may_leave: true, restricted_terms: [], owner_out: false, backup_out: false };
  const says = (text, refund_amount = null) => ({ text, promises: { refund_amount, replacement: false, other: null } });
  const RULE = /refund wording on a (complaint|question|replacement|non-refund) message: refunds are mentioned only on refund requests/;
  const MONEY = /draft promises a refund on a (complaint|question|replacement|non-refund) message: money is promised only on refund requests/;
  // a vent that names an amount reads no policy row: the draft's words alone are refused
  const vent = { ...base, category: "complaint", amount: 400, policy_limit: null, body: "the box was dented and I paid 400 GC, just so you know" };
  assert.match(hardRisk(vent, says("We are sorry. We will refund your 400 GC.")).reasons.join("; "), RULE);
  assert.deepEqual(hardRisk(vent, says("We are sorry. We will refund your 400 GC.", 400)).reasons,
    ["draft promises a refund with no policy limit behind it", "draft promises a refund on a complaint message: money is promised only on refund requests"]);
  assert.equal(sample.critique(says("We will refund you in full."), vent).pass, false);
  assert.match(sample.critique(says("We will refund you in full."), vent).reason, RULE);
  // a vent whose customer asks for money back: still a complaint, still refused (only a question may quote)
  assert.match(hardRisk({ ...vent, body: "I want my money back, 400 GC, this is a disgrace" }, says("A refund is not something we can promise here.")).reasons.join("; "), RULE);
  // a question that does not ask about refunds, whose draft names one: refused; a promise of money on it: refused as money
  const q = { ...base, category: "question", policy_limit: 150, body: "How long does shipping take?" };
  assert.match(hardRisk(q, says("We can refund you 50 GC.", 50)).reasons.join("; "), MONEY);
  assert.equal(sample.critique(says("We can refund you 50 GC.", 50), q).pass, false);
  assert.match(hardRisk(q, says("Thank you; a colleague will reimburse the difference.")).reasons.join("; "), RULE);
  // a question that asks about refunds may quote the policy (einh's B); money is still not promised on it
  const qr = { ...q, body: "What is the refund limit for orders?" };
  assert.deepEqual(hardRisk(qr, says("From our records: a refund at or under 150 GC can be approved by our refund owner.")).reasons, []);
  assert.equal(sample.critique(says("A refund at or under 150 GC can be approved by our refund owner."), qr).pass, true);
  assert.match(hardRisk(qr, says("We will refund you 50 GC.", 50)).reasons.join("; "), MONEY);
  assert.match(hardRisk(qr, { text: "See our policy.", promises: { refund_amount: null, replacement: false, other: "a refund of the difference" } }).reasons.join("; "), MONEY);
  assert.equal(sample.critique(says("We will refund you 50 GC.", 50), qr).pass, false);
  // an incidental or negated mention is not a question about refunds (Codex review 16); a real one is, even beside a negation
  for (const t of ["How long does shipping take? I'm not asking about refunds.", "How long does shipping take? I'm not asking you about refunds.", "I wouldn\u2019t\u2019ve asked for a refund; when will my replacement ship?", "I don\u2019t want a refund, how long does shipping take?", "We won\u2019t need a refund; when does it ship?", "I didn\u2019t ask for a refund; when will my replacement ship?", "We haven\u2019t asked about any refund, where is the order?", "It wasnt a refund query, just the colour options.", "Nothing about a refund here: which stands fit the saber?", "I am not at all interested in any kind of refund here, just the shipping time.", "No refund question, just the shipping time please.", "I don't want a refund, how long does shipping take?", "Without a refund in mind: when does it ship?"]) {
    assert.match(hardRisk({ ...q, body: t }, says("Refunds are handled by our refund owner.")).reasons.join("; "), RULE, t);
    assert.equal(sample.critique(says("Refunds are handled by our refund owner."), { ...q, body: t }).pass, false, t);
  }
  for (const t of ["What is your refund policy?", "Can I get a refund if it arrives late?", "Do you reimburse shipping on returns?", "Is money back possible after 30 days?", "Don't refund me yet, but what is the policy on refunds?"]) {
    assert.deepEqual(hardRisk({ ...q, body: t }, says("Refunds are handled by our refund owner.")).reasons, [], t);
  }
  // the follow-up body counts as the customer's words on a follow-up
  assert.deepEqual(hardRisk({ ...q, follow_up_kind: "follow-up", follow_up_body: "and what about refunds?" }, says("Refunds are handled by our refund owner.")).reasons, []);
  assert.match(hardRisk({ ...base, category: "replacement", policy_limit: 150, body: "please replace it" }, { text: "ok", promises: { refund_amount: null, replacement: true, other: "refund of the shipping fee" } }).reasons.join("; "), MONEY);
  assert.match(hardRisk({ ...base, policy_limit: null, body: "hello" }, says("We will refund you.")).reasons.join("; "), /non-refund message/);
  // the row ids the sample twin cites in its reply are removed before the word test, each exactly as cited and only when cited (facts.cited_rows)
  const qc = { ...q, cited_rows: ["policy:refund", "wiki_refund_policy:1", "refund_policy:x"] };
  assert.deepEqual(hardRisk(qc, says("Thank you for getting in touch (policy rows: policy:refund, wiki_refund_policy:1, refund_policy:x).")).reasons, []);
  assert.equal(sample.critique(says("Thank you for getting in touch (policy rows: policy:refund)."), qc).pass, true);
  assert.match(hardRisk(q, says("See policy:refund for details.")).reasons.join("; "), RULE, "an id that was not cited is read as words");
  assert.match(hardRisk(qc, says("Thank you (policy rows: policy:refund, we will refund you).")).reasons.join("; "), RULE, "words hidden inside a citation count");
  // the word test is normalised (Codex review 14): a colon, Markdown emphasis, a hyphen inside the word, an accent
  for (const t of ["Refunds are not possible here.", "Refund: unavailable.", "We offer no _refund_ on this.", "A re-fund is not on the table.", "No money-back here.", "Une réfund n'est pas possible.", "We will reimburse you."]) {
    assert.match(hardRisk(q, says(t)).reasons.join("; "), RULE, t);
    assert.equal(sample.critique(says(t), q).pass, false, t);
  }
  assert.equal(sample.critique(says("Thank you for getting in touch (policy rows: policy:refund)."), qc).pass, true);
  // the refund category keeps its limit rules and nothing else
  assert.deepEqual(hardRisk(facts02, says("We will refund 40 GC.", 40)).reasons, []);
  assert.deepEqual(hardRisk({ ...facts02, owner_out: false }, says("We will refund 400 GC.", 400)).reasons, ["draft promises refund above the limit"]);
  assert.equal(sample.critique(says("We will refund 40 GC.", 40), facts02).pass, true);
  // a draft with no refund in it passes on any category
  assert.deepEqual(hardRisk(vent, says("We are sorry the box arrived dented and have noted it.")).reasons, []);
});

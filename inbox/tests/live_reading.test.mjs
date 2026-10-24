// einh: "I dont want these to be hardcoded, I want the agent to ACTUALLY work this way".
// Scenarios 8, 10 and 12 routed right on the sample reading and wrong on the live one (cp6-live-2326): the live models read the same
// messages differently. Here each runs through the real loop twice, once with the sample reading and once with the gate and severity
// answers the live receipts show, and must land on the same branch, decision and owner. A test that only runs the sample reading proves nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { runMessage, msg } from "./helpers/route_run.mjs";
import { withMockFetch } from "./helpers/mock_fetch.mjs";
import { seams, mildInjury, resolveScenario } from "../src/scenarios.mjs";
import { severityGate } from "../src/gates.mjs";

const DEMO = Object.fromEntries(JSON.parse(readFileSync(join(INBOX_ROOT, "public", "demo-scenarios.json"), "utf8")).map((d) => [d.id, d]));
const asInput = (d) => msg(d.message, d.channel, d.email, { name: d.name, scenario: d.scenario });

// the typed gates exactly as the live trace printed them (trace-s08/s10/s12-live.jsonl): `category complaint (1)`, `complaint (0.74)`, `question (1)`
const liveGates = (category, confidence, seen = []) => async (ticket) => seen.push({ category, confidence, body: ticket.body }) && ({
  answers: { is_follow_up: 0, category: { choice: category, confidence }, urgency: { score: 1, legend: "", confidence: 0.5 }, tone: { score: 1, legend: "", confidence: 0.5 }, asks_for_money: 0 },
  model: "openjev-0.1 (live)", gate_source: "openjev", confidence: 0.9,
});
// the severity read through the REAL severityGate with OpenJev answering the raw score the live trace printed (8.97 -> severity 10, 2.2 -> severity 3)
const withLiveSeverity = async (raw, fn, legal_threat = 0.05) => {
  const real = seams.severityGate;
  seams.severityGate = (ticket, facts, wline, opts) => withMockFetch(
    [{ match: (u) => /systemone/.test(u), reply: () => ({ status: 200, body: { model: "openjev-0.1", answers: { severity: { score: raw, confidence: 0.98 }, legal_threat } } }) }],
    () => real(ticket, facts, wline, { ...opts, sampleMode: false, cfg: { ...opts.cfg, OPENJEV_BASE_URL: "http://openjev.test", OPENJEV_API_KEY: "x" } }));
  try { return await fn(); } finally { seams.severityGate = real; }
};
const summary = ({ result }) => ({ scenario: result.scenario, branch: result.branch_id, decision: result.output.decision, owner: result.output.queued_for?.owner_id, draft: Boolean(result.output.draft), team: result.output.team, status: result.output.status, auto: result.output.auto_reply });

const EXPECT = {
  s08: { branch: "complaint-genuine", decision: "hold", owner: 15, draft: true, team: "Support", status: "open", auto: false },
  s10: { branch: "delivery-suspended", decision: "send", owner: undefined, draft: true, team: "Support", status: "handled", auto: true },
  s12: { branch: "other-unanswered", decision: "hold", owner: 15, draft: false, team: "Support", status: "open", auto: false },
};
const pick = (s) => Object.fromEntries(Object.keys(EXPECT.s08).map((k) => [k, s[k]]));
const same = (got, want, label) => assert.deepEqual(pick({ ...got, branch: got.branch }), want, label);

test("the sample reading routes s08, s10 and s12 as the scenarios say", async () => {
  for (const id of ["s08", "s10", "s12"]) same(summary(await runMessage(asInput(DEMO[id]))), EXPECT[id], id);
});

test("s08 on the LIVE reading (severity 10 'legal or safety', category complaint 1): a self-described small burn is a genuine complaint, held with a draft, the note names the burn", async () => {
  const live = await withLiveSeverity(8.974968625499631, () => runMessage(asInput(DEMO.s08), { extra: { gates: liveGates("complaint", 1) } }));
  same(summary(live), EXPECT.s08, "s08 live");
  const sev = live.lines.find((l) => l.action === "severity_gate");
  assert.match(sev.output_summary, /severity 10 \(10 legal or safety\)/, "the live severity reading really reached the branch");
  assert.equal(sev.gate_source, "openjev");
  const o = live.result.output;
  assert.match(o.recommendation, /safety report, small burn/);
  assert.match(o.reasons.join(" "), /a safety report: the customer names a small burn/);
  assert.ok(o.draft?.text);
});

test("s10 on the LIVE reading (category complaint 0.74): an order id and a delivery word take the delivery road before the gate's complaint read", async () => {
  const seen = [];
  const live = await withLiveSeverity(2.2, () => runMessage(asInput(DEMO.s10), { extra: { gates: liveGates("complaint", 0.74, seen) } }));
  same(summary(live), EXPECT.s10, "s10 live");
  // the supplied reading was consumed: the loop asked the gates about this message and got complaint 0.74 ...
  assert.ok(seen.length >= 1 && seen.every((x) => x.category === "complaint" && x.confidence === 0.74 && /JP-1001/.test(x.body)), JSON.stringify(seen));
  // ... and that reading alone is what the old order turned into a complaint: the gate-category complaint check (choice complaint, confidence >= 0.6) came before the
  // delivery road, so with Scout reading order.question and no cue words the old resolver returned complaint. The sample reading of the same message is not a complaint,
  // so this test is red on the old order and could not pass on the sample gates by accident.
  const sampleGate = (await import("../src/adapters/sample.mjs")).gates({ thread_id: "x", subject: "", body: DEMO.s10.message, channel: "contact-form" }).answers.category;
  assert.ok(!(sampleGate.choice === "complaint" && sampleGate.confidence >= 0.6), `sample gates read ${sampleGate.choice} ${sampleGate.confidence}`);
  assert.ok(seen[0].category === "complaint" && seen[0].confidence >= 0.6, "the old resolver's complaint check would have fired on this reading");
  assert.match(live.result.output.draft.text, /Deliveries to Alderaan are currently suspended/);
  assert.equal(live.result.resolved_how, "scout");
});

test("s12 on the LIVE reading (category question 1): no product, no FAQ hit, nothing in the records is the other road, not the product owner", async () => {
  const live = await runMessage(asInput(DEMO.s12), { extra: { gates: liveGates("question", 1) } });
  same(summary(live), EXPECT.s12, "s12 live");
  assert.match(live.result.output.reasons.join(" "), /names no product/);
  assert.ok(live.lines.some((l) => l.step === "escalate_or_fallback" && l.status === "skipped"));
  assert.ok(!live.lines.some((l) => /question-unanswered/.test(JSON.stringify(l))), "no trace line speaks of the question road");
});

test("a mild injury is the customer's own words: a legal threat, a missing qualifier or a hospital keeps the severity rule", async () => {
  assert.equal(mildInjury("the hot emitter gave my son a small burn"), "small burn");
  assert.equal(mildInjury("a minor cut on his finger"), "minor cut");
    assert.ok(mildInjury("the burn on his hand was minor"));
  assert.equal(mildInjury("the hot emitter gave my son a burn"), null);
  // negation and non-injury uses keep the severity rule
  for (const t of ["it was not a small burn, it hurt my son badly", "he got no small burn, thank goodness, only his hand hurt", "never a minor cut on his finger, it was deep",
    "your small price cut is an insult", "a small cut in the budget for my son's party", "a slight discount cut, I hurt nothing", "a small price cut on my son's order",
    "the little burn mark on the carpet", "a small burn"]) assert.equal(mildInjury(t), null, t);
  assert.equal(mildInjury("a small burn and I have spoken to my lawyer"), null);
  assert.equal(mildInjury("a small burn, we went to the hospital"), null);
  // an injury with no mild qualifier on the live severity 10 stays complaint-severe: escalated, not held
  const sev = await withLiveSeverity(8.97, () => runMessage(msg("The hot emitter of my Vanta Arc Trainer gave my son a burn on his hand.", "email", "burn.case@email.com", { name: "Bo Case", scenario: "complaint" }), { extra: { gates: liveGates("complaint", 1) } }));
  assert.equal(sev.result.branch_id, "complaint-severe");
  assert.equal(sev.result.output.decision, "escalate");
  // a legal threat still wins over a small burn
  const legal = await withLiveSeverity(8.97, () => runMessage(msg("A small burn from my Vanta Arc Trainer, and I will sue.", "email", "sue.case@email.com", { name: "Sue Case", scenario: "complaint" }), { extra: { gates: liveGates("complaint", 1) } }), 0.95);
  assert.equal(legal.result.branch_id, "complaint-legal");
});

test("an order id with a delivery word is a delivery question before a gate's complaint read; a safety cue or Scout's own complaint still wins", () => {
  const gates = { answers: { category: { choice: "complaint", confidence: 0.74 } } };
  const dec = { intent: { primary: { id: "order.question" }, confidence: 0.9 } };
  const text = "Where is my order JP-1001? It was meant to arrive weeks ago.";
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec, gates, text }), { scenario: "delivery", how: "scout" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec, gates, text: `${text} A small burn on my son.` }), { scenario: "complaint", how: "cues" });
  assert.deepEqual(resolveScenario({ kind: "message", decided: dec, gates, text: "I want to complain about the service." }), { scenario: "complaint", how: "gates" });
});

test("the severity seam is the real gate unless a test swaps it", () => {
  assert.equal(seams.severityGate, severityGate);
});

test("a delivery enquiry that also complains about something else keeps the complaint road, even on a gate's complaint 0.74", async () => {
  const gates = { answers: { category: { choice: "complaint", confidence: 0.74 } } };
  const dec = { intent: { primary: { id: "order.question" }, confidence: 0.9 } };
  for (const extra of ["Your staff insulted me and I want an apology.", "The box was damaged too.", "I also want a refund.", "Your rep was rude."]) {
    assert.deepEqual(resolveScenario({ kind: "message", decided: dec, gates, text: `Where is my order JP-1001? ${extra}` }), { scenario: "complaint", how: "gates" }, extra);
  }
  const seen = [];
  const r = await runMessage(msg("Where is my order JP-1001? Your staff were rude to me.", "contact-form", "cass.holm@example.com", { name: "Cass Holm" }), { extra: { gates: liveGates("complaint", 0.74, seen) } });
  assert.equal(r.result.scenario, "complaint");
  assert.notEqual(r.result.output.auto_reply, true);
  assert.notEqual(r.result.output.decision, "send");
});

test("a question that names a product by SKU id names a product: it is not re-routed to the other road", async () => {
  const q = "Do you ship FS-A01 to Naboo on Sundays?";
  const r = await runMessage(msg(q, "chat", "sku.asker@email.com", { name: "Sku Asker", scenario: "free_text" }), { extra: { gates: liveGates("question", 1) } });
  assert.notEqual(r.result.branch_id, "other-unanswered", r.result.branch_id);
  // the same question with no SKU is the other road
  const none = await runMessage(msg("Do you ship to Naboo on Sundays?", "chat", "sku.asker2@email.com", { name: "Sku Asker", scenario: "free_text" }), { extra: { gates: liveGates("question", 1) } });
  assert.equal(none.result.branch_id, "other-unanswered");
});

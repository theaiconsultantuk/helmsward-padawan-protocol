// Tests for the refund Reader (24 Oct 2026): parse, phrase list, the verdict grid, the never-unlocks invariant, and readRefund's offline paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReaderJson, REDRESS_WORDS, sampleRead, refundReaderReason, readRefund } from "../src/refund_reader.mjs";
import { mentionsRefund, refundRuleReason, normalizeReply } from "../src/prompts.mjs";

// fixtures copied from tests/gates.test.mjs 127-168 (not imported)
const says = (text, refund_amount = null) => ({ text, promises: { refund_amount, replacement: false, other: null } });
const RULE = /refund wording on a (complaint|question|replacement|non-refund) message: refunds are mentioned only on refund requests/;
const MONEY = /draft promises a refund on a (complaint|question|replacement|non-refund) message: money is promised only on refund requests/;
const base = { cited_rows: [] };
const vent = { ...base, category: "complaint", body: "the box was dented and I paid 400 USD, just so you know" };
const q = { ...base, category: "question", body: "How long does shipping take?" };
const qAsk = { ...base, category: "question", body: "What is your refund policy?" };
const qNeg = { ...base, category: "question", body: "I'm not asking you about refunds, how long does shipping take?" };
const qSarcasm = { ...base, category: "question", body: "Oh sure, I just LOVE hearing about refunds. When does it ship?" };
const rd = (o) => ({ mentions_money_back: false, offers_money: false, customer_asks_refund: false, reason: "stub", ...o });
const lineSink = () => { const lines = []; return { lines, L: (o) => lines.push(o) }; };
const stubReader = (impl) => { const calls = []; const reader = async (m, o) => { calls.push({ m, o }); return impl(m, o); }; return { reader, calls }; };
const ok = (read, extra = {}) => ({ text: JSON.stringify(read), model: "nemotron/test", ...extra });

test("parseReaderJson: fenced JSON and prose around JSON parse; a missing boolean or a string boolean is null", () => {
  const j = JSON.stringify(rd({ mentions_money_back: true, reason: "  it says credit " }));
  assert.deepEqual(parseReaderJson("```json\n" + j + "\n```"), rd({ mentions_money_back: true, reason: "it says credit" }), "fenced");
  assert.deepEqual(parseReaderJson("Here you go: " + j + " done."), rd({ mentions_money_back: true, reason: "it says credit" }), "prose around");
  assert.equal(parseReaderJson('{"mentions_money_back": true, "offers_money": false, "reason": "x"}'), null, "missing customer_asks_refund");
  assert.equal(parseReaderJson('{"mentions_money_back": "true", "offers_money": false, "customer_asks_refund": false, "reason": "x"}'), null, 'string "true"');
  assert.equal(parseReaderJson('{"mentions_money_back": true, "offers_money": false, "customer_asks_refund": false}'), null, "missing reason");
  assert.equal(parseReaderJson("not json"), null);
});

test("REDRESS_WORDS and sampleRead: redress wording hits, a credit card and goodwill do not, a cited row id is not a mention", () => {
  for (const t of ["We can credit your account.", "Here is a voucher for you.", "We will cover the cost of shipping.", "We zullen het terugbetalen.", "Wir veranlassen die Rückerstattung.", "A gift card is on its way.", "You get a discount.", "We waive the fee."]) {
    assert.ok(REDRESS_WORDS.test(normalizeReply(t)), `hit expected: ${t}`);
    assert.equal(sampleRead(says(t), vent).mentions_money_back, true, `sampleRead mentions: ${t}`);
  }
  for (const t of ["Please check the credit card on file.", "We will make it right.", "We will look after you, goodwill is our policy."]) {
    assert.equal(REDRESS_WORDS.test(normalizeReply(t)), false, `no hit expected: ${t}`);
    assert.equal(sampleRead(says(t), vent).mentions_money_back, false, `sampleRead clean: ${t}`);
  }
  // a cited row id carrying the word does not count
  const cited = { ...vent, cited_rows: ["policy:refund"] };
  assert.equal(sampleRead(says("As in policy:refund, your saber ships Monday."), cited).mentions_money_back, false, "cited policy:refund");
  assert.equal(mentionsRefund(says("As in policy:refund, your saber ships Monday."), ["policy:refund"]), false);
  const s = sampleRead(says("We can credit your account."), vent);
  assert.equal(s.offers_money, false);
  assert.equal(s.model, "sample/rules");
  assert.match(s.reason, /^code rules: credit/);
  assert.equal(sampleRead(says("Plain reply."), vent).reason, "code rules: no redress wording");
  // contract drift: whatever the word test reads as a mention, the sample reader reads as a mention
  for (const [f, d] of [[vent, says("We will refund you.")], [q, says("Refunds are handled by our owner.")], [q, says("Money-back is possible.")], [vent, says("Thanks.", 40)]]) {
    assert.ok(refundRuleReason(f, d) !== null, `word test refuses: ${d.text}`);
    assert.equal(sampleRead(d, f).mentions_money_back, true, `sampleRead follows the word test: ${d.text}`);
  }
});

test("refundReaderReason grid: category x reader answer x word test", () => {
  const all = [rd(), rd({ mentions_money_back: true }), rd({ offers_money: true }), rd({ mentions_money_back: true, offers_money: true, customer_asks_refund: true })];
  for (const r of all) assert.equal(refundReaderReason({ ...base, category: "refund", body: "refund please" }, says("We will refund you."), r), null, `refund category: ${JSON.stringify(r)}`);
  assert.equal(refundReaderReason(vent, says("ok"), null), null, "no read");
  const credit = says("You will get a store credit.");
  const c = refundReaderReason(vent, credit, rd({ mentions_money_back: true, reason: "says credit" }));
  assert.match(c, RULE, `complaint + mentions: ${credit.text}`);
  assert.match(c, /\(reader: says credit\)$/);
  const o = refundReaderReason(vent, credit, rd({ mentions_money_back: true, offers_money: true, reason: "will get" }));
  assert.match(o, MONEY, `complaint + offers: ${credit.text}`);
  assert.match(o, /\(reader: will get\)/);
  assert.match(refundReaderReason(vent, credit, rd({ offers_money: true })), MONEY, "offers alone is enough");
  // question + mentions + both ask -> allowed
  const quote = says("Refunds under 150 USD can be approved.");
  assert.equal(refundReaderReason(qAsk, quote, rd({ mentions_money_back: true, customer_asks_refund: true })), null, `question asked: ${qAsk.body}`);
  // sarcasm: the reader says the customer did not ask
  assert.match(refundReaderReason(qAsk, quote, rd({ mentions_money_back: true, customer_asks_refund: false })), RULE, "reader says not asked");
  assert.match(refundReaderReason(qSarcasm, says("You will get a voucher."), rd({ mentions_money_back: true, customer_asks_refund: false })), RULE, qSarcasm.body);
  // the reader cannot unlock what the word test refused
  assert.match(refundReaderReason(qNeg, quote, rd({ mentions_money_back: true, customer_asks_refund: true })), RULE, `reader says asked, word test says not: ${qNeg.body}`);
  // question + customer asked (both) + offers -> MONEY
  assert.match(refundReaderReason(qAsk, quote, rd({ mentions_money_back: true, offers_money: true, customer_asks_refund: true })), MONEY, "asked question + offers");
  // nothing mentioned
  assert.equal(refundReaderReason(vent, says("We will make it right."), rd()), null, "nothing mentioned");
  // the word test's own hit still counts when the model says false
  assert.match(refundReaderReason(vent, says("Refunds exist."), rd()), RULE, "model false but word test hits");
});

test("readRefund never unlocks: a draft the word test refuses is not_needed, the reader is not called, no line is logged", async () => {
  const refused = [
    [vent, says("We are sorry. We will refund your 400 USD.")],
    [q, says("Thank you; a colleague will reimburse the difference.")],
    [qNeg, says("Refunds are handled by our refund owner.")],
    [vent, { text: "ok", promises: { refund_amount: null, replacement: false, other: "a refund of the difference" } }],
  ];
  for (const [facts, draft] of refused) {
    assert.ok(refundRuleReason(facts, draft) !== null, `fixture must be refused: ${draft.text}`);
    for (let bits = 0; bits < 8; bits++) {
      const answer = rd({ mentions_money_back: !!(bits & 1), offers_money: !!(bits & 2), customer_asks_refund: !!(bits & 4) });
      const { reader, calls } = stubReader(() => ok(answer));
      const { lines, L } = lineSink();
      const r = await readRefund({ draft, facts, io: { reader }, L, branch: "b" });
      const tag = `${draft.text} / ${JSON.stringify(answer)}`;
      assert.equal(r.status, "not_needed", tag);
      assert.equal(r.reason, null, tag);
      assert.equal(calls.length, 0, `reader not called: ${tag}`);
      assert.equal(lines.length, 0, `no line: ${tag}`);
    }
  }
  // a refund-category message and a failed draft are skipped too
  const { reader, calls } = stubReader(() => ok(rd()));
  const { lines, L } = lineSink();
  assert.equal((await readRefund({ draft: says("ok"), facts: { ...base, category: "refund", body: "refund" }, io: { reader }, L })).status, "not_needed");
  assert.equal((await readRefund({ draft: { failed: true, text: "" }, facts: vent, io: { reader }, L })).status, "not_needed");
  assert.equal(calls.length + lines.length, 0);
});

test("readRefund live: success line, sponsor, local lane, the call options, retry_count", async () => {
  const draft = says("You will get a store credit.");
  const { reader, calls } = stubReader(() => ok(rd({ mentions_money_back: true, offers_money: true, reason: "will get credit" })));
  const { lines, L } = lineSink();
  const ac = new AbortController();
  const r = await readRefund({ draft, facts: vent, io: { reader, adapterTrace: "T", signal: ac.signal }, L, branch: "br1", round: 2 });
  assert.equal(r.status, "success");
  assert.equal(r.model, "nemotron/test");
  assert.match(r.reason, MONEY);
  assert.deepEqual(r.read.offers_money, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].o.purpose, "refund_read");
  assert.equal(calls[0].o.trace, "T");
  assert.ok(calls[0].o.signal, "a signal is handed to the reader");
  assert.equal(calls[0].m[0].role, "system");
  assert.match(calls[0].m[1].content, /Draft reply:\nYou will get a store credit\./);
  assert.equal(lines.length, 1);
  const l = lines[0];
  assert.equal(l.step, "nvidia.model");
  assert.equal(l.agent_name, "RefundReader");
  assert.equal(l.action, "read_refund");
  assert.equal(l.status, "success");
  assert.equal(l.model, "nemotron/test");
  assert.equal(l.gate_source, "nightshift");
  assert.equal(l.sponsor, "nvidia");
  assert.equal(l.retry_count, 1);
  assert.equal(l.branch_id, "br1");
  assert.match(l.output_summary, /^mentions yes, offers yes, customer asks no; will get credit$/);
  assert.ok(!JSON.stringify(l).includes("store credit"), "the draft text is not logged");
  // local lane: no sponsor
  const local = stubReader(() => ok(rd(), { lane: "local-lane" }));
  const s2 = lineSink();
  const r2 = await readRefund({ draft: says("Fine."), facts: vent, io: { reader: local.reader }, L: s2.L });
  assert.equal(r2.reason, null);
  assert.equal(s2.lines[0].status, "success");
  assert.ok(!("sponsor" in s2.lines[0]), "local-lane carries no sponsor");
  assert.equal(s2.lines[0].retry_count, 0);
});

test("readRefund offline paths: sampleOn, enabled false, sample stand-in from the reader, not_wired", async () => {
  const draft = says("We can credit your account.");
  const a = lineSink();
  const sr = await readRefund({ draft, facts: vent, sampleOn: true, L: a.L, branch: "b" });
  assert.equal(a.lines.length, 1);
  assert.equal(a.lines[0].status, "skipped");
  assert.equal(a.lines[0].model, "sample/rules");
  assert.equal(a.lines[0].gate_source, "rules");
  assert.equal(a.lines[0].agent_name, "RefundReader");
  assert.match(a.lines[0].output_summary, /^sample mode: rules reader, no model call; mentions yes, offers no, customer asks no; code rules: credit/);
  assert.equal(sr.status, "skipped");
  assert.equal(sr.model, "sample/rules");
  assert.match(sr.reason, RULE);

  const b = lineSink();
  const off = stubReader(() => ok(rd()));
  const or = await readRefund({ draft, facts: vent, io: { reader: off.reader }, enabled: false, L: b.L });
  assert.deepEqual(or, { reason: null, read: null, model: null, status: "skipped" });
  assert.equal(off.calls.length, 0);
  assert.equal(b.lines.length, 1);
  assert.equal(b.lines[0].output_summary, "REFUND_READER=false: reader off, the word test stands");
  assert.equal(b.lines[0].status, "skipped");

  // the reader answers { sample: true, text: null }: behaves as the stand-in
  for (const answer of [{ sample: true, text: null }, { text: null }]) {
    const c = lineSink();
    const st = stubReader(() => answer);
    const r = await readRefund({ draft, facts: vent, io: { reader: st.reader }, L: c.L });
    assert.equal(r.status, "skipped", JSON.stringify(answer));
    assert.equal(r.model, "sample/rules", JSON.stringify(answer));
    assert.match(r.reason, RULE);
    assert.equal(c.lines.length, 1);
    assert.equal(c.lines[0].model, "sample/rules");
    assert.equal(c.lines[0].status, "skipped");
  }

  // no reader function: not_wired, no line
  for (const io of [undefined, {}, { reader: "nope" }]) {
    const d = lineSink();
    const r = await readRefund({ draft, facts: vent, io, L: d.L });
    assert.deepEqual(r, { reason: null, read: null, model: null, status: "not_wired" });
    assert.equal(d.lines.length, 0);
  }
});

test("readRefund failures: a thrown error and bad JSON log error + recovery, the word test stands, recovered gets one entry each", async () => {
  const draft = says("You will get a store credit.");
  const recovered = [];
  const e1 = lineSink();
  const thrower = stubReader(() => { throw Object.assign(new Error("x"), { name: "UpstreamRefused" }); });
  const r1 = await readRefund({ draft, facts: vent, io: { reader: thrower.reader }, L: e1.L, branch: "b", recovered });
  assert.equal(r1.reason, null);
  assert.equal(r1.status, "error");
  assert.equal(e1.lines.length, 2);
  assert.equal(e1.lines[0].status, "error");
  assert.equal(e1.lines[0].gate_source, "nightshift");
  assert.equal(e1.lines[0].output_summary, "UpstreamRefused: x");
  assert.deepEqual([e1.lines[1].step, e1.lines[1].agent_name, e1.lines[1].action, e1.lines[1].input_summary, e1.lines[1].output_summary, e1.lines[1].status],
    ["recovery", "Planner", "recover", "after RefundReader error", "word test stands", "success"]);
  assert.deepEqual(recovered, [{ step: "nvidia.model", type: "UpstreamRefused", message: "x" }]);

  const e2 = lineSink();
  const bad = stubReader(() => ({ text: "not json", model: "m" }));
  const r2 = await readRefund({ draft, facts: vent, io: { reader: bad.reader }, L: e2.L, recovered });
  assert.equal(r2.reason, null);
  assert.equal(e2.lines.length, 2);
  assert.match(e2.lines[0].output_summary, /no valid JSON/);
  assert.equal(e2.lines[1].step, "recovery");
  assert.equal(recovered.length, 2, "one recovered entry per failure");
  assert.deepEqual(recovered[1], { step: "nvidia.model", type: "BadResponse", message: "reader returned no valid JSON" });
});

test("readRefund abort: an aborted signal rethrows, never fails open, and writes no line", async () => {
  const draft = says("You will get a store credit.");
  const mkAbort = () => Object.assign(new Error("aborted"), { name: "AbortError" });
  // the run's signal
  const ac = new AbortController();
  ac.abort();
  const a = lineSink();
  await assert.rejects(readRefund({ draft, facts: vent, io: { reader: async () => { throw mkAbort(); }, signal: ac.signal }, L: a.L }), { name: "AbortError" });
  assert.equal(a.lines.length, 0);
  // the round's signal
  const ac2 = new AbortController();
  ac2.abort();
  const b = lineSink();
  const rec = [];
  await assert.rejects(readRefund({ draft, facts: vent, io: { reader: async () => { throw mkAbort(); } }, signal: ac2.signal, L: b.L, recovered: rec }), { name: "AbortError" });
  assert.equal(b.lines.length, 0);
  assert.equal(rec.length, 0);
  // both signals reach the reader as one bound signal that is aborted
  const ac3 = new AbortController();
  const ac4 = new AbortController();
  let seen;
  const c = lineSink();
  await readRefund({ draft: says("Fine."), facts: vent, io: { reader: async (m, o) => { seen = o.signal; return ok(rd()); }, signal: ac3.signal }, signal: ac4.signal, L: c.L });
  assert.equal(seen.aborted, false);
  ac4.abort();
  assert.equal(seen.aborted, true, "the round's signal aborts the bound signal");
});

test("readRefund caps a 400-character reason at 120 in the line, the returned read and the Risk reason; whitespace collapses", async () => {
  const long = "word ".repeat(80); // 400 chars
  const draft = says("You will get a store credit.");
  const { reader } = stubReader(() => ok(rd({ mentions_money_back: true, reason: long })));
  const { lines, L } = lineSink();
  const r = await readRefund({ draft, facts: vent, io: { reader }, L });
  assert.ok(r.read.reason.length <= 120, `read.reason ${r.read.reason.length}`);
  assert.ok(r.read.reason.endsWith("…"));
  assert.match(r.reason, RULE);
  const m = /\(reader: (.*)\)$/.exec(r.reason);
  assert.ok(m && m[1].length <= 120, "suffix reason capped");
  assert.ok(lines[0].output_summary.length < 120 + 80, "the line carries the capped reason");
  assert.ok(!lines[0].output_summary.includes(long.trim()), "the full 400 characters are not in the line");
  const ws = await readRefund({ draft, facts: vent, io: { reader: stubReader(() => ok(rd({ mentions_money_back: true, reason: "a\n\n  b\t c" }))).reader }, L: () => {} });
  assert.equal(ws.read.reason, "a b c");
});

test("readRefund grid row: question + customer asked (both reads) + offers_money true -> the MONEY reason", async () => {
  const { reader } = stubReader(() => ok(rd({ mentions_money_back: true, offers_money: true, customer_asks_refund: true, reason: "we will refund you" })));
  const draft = says("From our records you will get a store credit.");
  assert.equal(refundRuleReason(qAsk, draft), null, "the word test lets this one through: the reader is what catches it");
  const r = await readRefund({ draft, facts: qAsk, io: { reader }, L: () => {} });
  assert.equal(r.status, "success");
  assert.match(r.reason, MONEY, draft.text);
});

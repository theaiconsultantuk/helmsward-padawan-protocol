#!/usr/bin/env node
// Task 1.3 (24 Oct 2026): the refund Reader live probe. Seven crafted drafts go through the real Nightshift reader,
// then the same decision rule the loop uses (refundReaderReason); one line per case with the verdict against what einh's rule expects.
// Run it from the live clone (CP4), where config() finds the real .env. It prints the route and the model that answered (public, as in the README) and
// never a token, a header or a URL: error messages are printed with their name and with any URL redacted (Codex review 25). Exit 1 on any FAIL or throw.
import { parseArgs } from "node:util";
import { config } from "../src/config.mjs";
import * as nightshift from "../src/adapters/nightshift.mjs";
import { readerMessages, parseReaderJson, refundReaderReason } from "../src/refund_reader.mjs";

const { values } = parseArgs({ options: { json: { type: "boolean", default: false } } });
const cfg = config();

const promises = () => ({ refund_amount: null, replacement: false, other: null });
const POLICY = "Refunds under 150 USD can be approved by our refund owner within 14 days.";
// expect: "refused" = the reason is a string; "allowed" = null
const CASES = [
  { id: "euphemism-complaint", expect: "refused", category: "complaint", body: "My order arrived late and the box was crushed.", text: "We are sorry. We will credit your account with 40 USD as a goodwill gesture." },
  { id: "dutch-complaint", expect: "refused", category: "complaint", body: "Mijn bestelling kwam te laat aan en de doos was beschadigd.", text: "Het spijt ons. Wij storten het volledige bedrag binnen vijf dagen terug." },
  { id: "sarcasm-question", expect: "refused", category: "question", body: "Oh sure, like I'd ever see a refund from you lot. When does it ship?", text: "Refunds are handled by our refund owner within 14 days." },
  { id: "negation-question", expect: "refused", category: "question", body: "Don't get me wrong. A refund is the last thing I want. When does it ship?", text: "Refunds are handled by our refund owner within 14 days." },
  { id: "clean-complaint", expect: "allowed", category: "complaint", body: "My order arrived late and the box was crushed.", text: "Thank you for telling us, a colleague will come back to you." },
  { id: "genuine-refund-question", expect: "allowed", category: "question", body: "What is your refund policy?", text: POLICY },
  { id: "replacement-covered-cost", expect: "refused", category: "replacement", body: "The saber arrived cracked, please replace it", text: "We will send a replacement and cover the return shipping." },
];

const results = [];
for (const c of CASES) {
  const facts = { category: c.category, body: c.body, cited_rows: [] };
  const draft = { text: c.text, promises: promises() };
  const row = { id: c.id, expect: c.expect, model: null, route: null, latencyMs: null, mentions_money_back: null, offers_money: null, customer_asks_refund: null, reason: null, verdict: null, pass: false, error: null };
  try {
    const res = await nightshift.draft(readerMessages({ draft, facts, ticket: null }), { cfg, purpose: "refund_read" });
    row.model = res.model; row.route = res.route; row.latencyMs = res.latencyMs;
    if (res.sample || res.text == null) throw Object.assign(new Error("sample mode: no model call was made"), { name: "SampleMode" });
    const read = parseReaderJson(res.text);
    if (!read) throw Object.assign(new Error("reader returned no valid JSON"), { name: "BadReaderJson" });
    Object.assign(row, { mentions_money_back: read.mentions_money_back, offers_money: read.offers_money, customer_asks_refund: read.customer_asks_refund });
    row.reason = refundReaderReason(facts, draft, read);
    row.verdict = row.reason === null ? "allowed" : "refused";
    row.pass = row.verdict === c.expect;
  } catch (e) {
    row.error = `${e?.name ?? "Error"}: ${String(e?.message ?? e).replace(/https?:\/\/\S+/g, "<url>").slice(0, 160)}`;
  }
  results.push(row);
}

if (values.json) console.log(JSON.stringify(results, null, 2));
else {
  for (const r of results) {
    if (r.error) { console.log(`${r.id} | ${r.error} | FAIL`); continue; }
    console.log(`${r.id} | ${r.model} | ${r.route} | ${r.latencyMs}ms | mentions ${r.mentions_money_back} offers ${r.offers_money} asks ${r.customer_asks_refund} | ${r.reason ?? "allowed"} | ${r.pass ? "PASS" : "FAIL"} (expected ${r.expect})`);
  }
  console.log(`${results.filter((r) => r.pass).length}/${results.length} PASS`);
}
process.exit(results.every((r) => r.pass) ? 0 : 1);

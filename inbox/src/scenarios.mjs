// Scenario routing for a free-text message: which scenario it is, and the question and RFQ handlers.
// Each handler is two phases (the loop wires them, S1.3a):
//   probe(tb)      -> { branch_id, why, cited, data, lines }   lookups only; their trace lines are returned, never written
//   act(tb, probe) -> { decision, reasons, draft?, queued?, recommendation?, attachments?, cited }
// tb is the loop's toolbox ({ f, ticket, inputText, L, skipped, escalate, replyLoop, hardRisk, queries, o, cfg, decided, ... }).
import { tokens, extractParams } from "./engines/scout/index.mjs";
import { rowsForIntent } from "./ask.mjs";
import { draftMessages, complaintReadMessages, parseComplaintReadJson, recommendationMessages, parseRecommendationJson, fillQuote, fillCourtesy, NUDGE } from "./prompts.mjs";
import { severityGate } from "./gates.mjs";
import { getWorld, toObjects, complaintContext, worldLine, mentionedProducts } from "./engines/world-model/world.mjs";
import * as sample from "./adapters/sample.mjs";
import { stampedBuffer } from "./trace_buffer.mjs";

// The one seam a test uses to feed the complaint road a LIVE severity reading while the rest of the run stays on the sample data (tests/live_reading.test.mjs).
// Production never touches it.
export const seams = { severityGate };

export const SCENARIOS = ["refund", "question", "rfq", "complaint", "free_text"];
export const TOPIC_OF = { refund: "refund", question: "question", rfq: "rfq", complaint: "complaint", customer_service: "customer_service", product: "product", delivery: "delivery", other: "other" };
// What a scenario's facts gather may read beyond the ticket row, the owner chain, the trust row and the what-may-leave page.
// `legacy` is absent on purpose: a typed message resolved to legacy gets `[]` from the loop (scoped, no borrowed limit); a stored thread passes no needs and keeps the full read.
export const FACT_NEEDS = { refund: ["limit"], question: [], rfq: [], complaint: [], customer_service: [], product: [], delivery: [], other: [] };

const one = (s, n = 160) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const NO_PROMISES = () => ({ refund_amount: null, replacement: false, other: null });

// words that put a message about an order id on the delivery road
const DELIVERY_WORDS = /\b(deliver\w*|order|shipping|shipped|ship|where is|track\w*|parcel|package|arriv\w*)\b/i;
const ORDER_ID = /\bJP-\d{4}\b/i;
// a question about what a product is, made of or costs, with or without the product named
const PRODUCT_WORDS = /\b(made of|made from|made out of|material|materials|specs?|specifications?|dimensions?|weigh\w*|price|cost|costs|how much|lead time)\b/i;
const COMPLAINT_CUES = /\b(lawyer|lawyers|attorney|solicitor|legal action|sue|sued|suing|court|burn|burns|burning|burned|burnt|injur\w*|hurt|hurts|hurting|unsafe|split open|furious|unacceptable|never again|worst|disgusting|terrible|nobody (?:replied|answered))\b/i;
// the cues that put ANY message on the complaint road, whatever intent Scout read: a legal threat, an injury, an unsafe product
const SAFETY_CUES = /\b(lawyer|lawyers|attorney|solicitor|legal action|sue|sued|suing|court|burn|burns|burning|burned|burnt|injur\w*|hurt|hurts|hurting|unsafe|split open)\b/i;
// a complaint about something other than where the parcel is
const OTHER_COMPLAINT = /\b(staff|rude\w*|insult\w*|apolog\w*|refund\w*|money back|reimburs\w*|compensat\w*|broke\w*|damag\w*|defect\w*|faulty|wrong|missing|disappoint\w*|complain\w*|ignor\w*|manager|scuff\w*|dent\w*|crushed|cracked|poor service|bad service)\b/i;
// The one RFQ test (einh, 25 Oct 2026, "simplest rule"): a quote / quotation / RFQ / bulk / wholesale word in the message. Nothing else makes a message an RFQ except a declared rfq scenario:
// every other price or count question ("How much for 51 Strand Emitter Hilts?") takes the product or question road, whatever Scout read.
const RFQ_WORD = /\b(quotes?|quotations?|rfqs?|bulk|wholesale)\b/i;
const lookupRows = (productHit) => (productHit?.all ?? (productHit?.row ? [productHit] : [])).map((f) => f.row).filter(Boolean);
// a message about the customer's own purchase or account: a person has to look at it (the customer-service road)
const ACCOUNT_WORDS = /\b(order|orders|bought|purchase\w*|deliver\w*|address|account|invoice|parcel|package|shipment|payment|subscription|password|cancel\w*|change)\b/i;

// kind: "thread" | "message". A thread run with nothing declared is the loop exactly as today.
// text and productHit (the message and the catalogue match, both read by the loop before this call) are optional: without them the product and delivery roads are not taken.
export function resolveScenario({ kind, declared = null, decided = null, gates = null, faqHit = null, text = null, productHit = null } = {}) {
  if (declared && declared !== "free_text") return { scenario: declared, how: "declared" };
  if (kind === "thread") return { scenario: "legacy", how: "thread" };
  let id = decided?.intent?.primary?.id ?? "GENERAL";
  const T = String(text ?? "");
  const conf = decided?.intent?.confidence ?? 0;
  const cat = gates?.answers?.category;
  // safety first, for every intent: a refund or a quote that threatens a lawyer or names an injury is a complaint, and Legal reads it
  if (SAFETY_CUES.test(String(text ?? ""))) return { scenario: "complaint", how: "cues" };
  // a quote word inside a complaint ("Your quote is unacceptable") is a complaint; the complaint cues are read first only for a message that carries the RFQ word, everything else keeps its later precedence
  if (RFQ_WORD.test(T) && COMPLAINT_CUES.test(T)) return { scenario: "complaint", how: "cues" };
  // the one RFQ rule, the same for an rfq.request read and for every other read: the word is in the message (a quote naming an order is still an RFQ). An rfq.request read without the word is only a read, "What is the Vanta Arc Trainer made of?" shares a noun with an example.
  if (RFQ_WORD.test(T)) return { scenario: "rfq", how: "scout" };
  if (id === "rfq.request" && text != null) id = "GENERAL";
  else if (id === "rfq.request") return { scenario: "rfq", how: "scout" };
  // a pure product question ("What is the Cracked Core Recycling Pouch made of?", "...etiquette cards...") is a product question even when a word of the product's own name reads as a refund or a replacement:
  // take the product's name and aliases out of the text, and if what is left asks what it is made of or costs and carries no refund, return, order or account word, the catalogue row answers it
  if (["refund.request", "replacement.request", "appreciation", "follow_up"].includes(id) && productHit && PRODUCT_WORDS.test(T) && T.includes("?")) {
    let rest = T.toLowerCase();
    for (const r of lookupRows(productHit)) for (const n of [r.name, ...String(r.aliases ?? "").split(";")]) if (n) rest = rest.replace(new RegExp("(?<![a-z0-9])" + String(n).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:e?s)?(?![a-z0-9])", "g"), " ");
    if (!/\b(refund\w*|return\w*|replace\w*|exchange\w*|money back|bought|ordered|received|arrived|my|broke\w*|damag\w*|faulty|wrong|missing)\b/.test(rest) && !ACCOUNT_WORDS.test(rest) && !ORDER_ID.test(T) && !COMPLAINT_CUES.test(rest) && !SAFETY_CUES.test(rest) && !OTHER_COMPLAINT.test(rest)) return { scenario: "product", how: "scout" };
  }
  if (id === "refund.request") return { scenario: "refund", how: "scout" };
  if (id === "complaint") return { scenario: "complaint", how: "scout" };
  // a legal threat, an injury or fury is a complaint even when the message also names a product or an order: a person reads it, no catalogue row answers it
  if (COMPLAINT_CUES.test(String(text ?? ""))) return { scenario: "complaint", how: "cues" };
  // an order id plus a delivery word: the order and the planet's shipping rule answer it (before the FAQ's "where is my order").
  // It is read before a gate-category complaint: a live gate may call "it was meant to arrive weeks ago" a complaint (0.74), but the order row answers it.
  // Safety cues and the complaint cues have already gone by, so a delivery question that threatens or names an injury never gets here.
  const oid = ORDER_ID.test(String(text ?? "")) || ORDER_ID.test(String(decided?.parameters?.id ?? ""));
  // only a PURE delivery enquiry overrides a gate's complaint read: a message that also complains about something else (staff, an apology, a refund, a damaged item) stays a complaint
  if (cat?.choice === "complaint" && cat.confidence >= 0.6 && OTHER_COMPLAINT.test(String(text ?? ""))) return { scenario: "complaint", how: "gates" };
  if (oid && DELIVERY_WORDS.test(String(text ?? "")) && !["replacement.request", "appreciation", "follow_up"].includes(id)) return { scenario: "delivery", how: "scout" };
  if (cat?.choice === "complaint" && cat.confidence >= 0.6) return { scenario: "complaint", how: "gates" };
  // a product named (by name or alias) or a material/spec/price question: the catalogue row answers it
  if ((id === "order.question" || id === "GENERAL") && (productHit || PRODUCT_WORDS.test(String(text ?? "")))) return { scenario: "product", how: "scout" };
  if (id === "order.question" || (cat?.choice === "question" && cat.confidence >= 0.6)) return { scenario: "question", how: id === "order.question" ? "scout" : "gates" };
  // a question the FAQ answers is not a thank-you, whatever word ("gift") Scout read as appreciation
  if (id === "appreciation" && faqHit && String(text ?? "").includes("?")) return { scenario: "question", how: "faq" };
  if (id === "replacement.request" || id === "appreciation" || id === "follow_up") return { scenario: "legacy", how: "scout" };
  if (id === "other" || (cat?.choice === "other" && cat.confidence >= 0.6)) return { scenario: "other", how: id === "other" ? "scout" : "gates" };
  if (faqHit) return { scenario: "question", how: "faq" };          // the data is searched before anyone is bothered
  // free text with no intent: nothing about the customer's own purchase or account means nothing in the records is likely to answer it (the FAQ is searched first by the other road)
  if (typeof text === "string" && text.trim() && decided?.risk?.level !== "block" && !ACCOUNT_WORDS.test(text)) return { scenario: "other", how: conf < 0.4 ? "none" : "unrouted" };
  return { scenario: "customer_service", how: conf < 0.4 ? "none" : "unrouted" };
}

// ---- pure matchers (one tokenizer: Scout's tokens()) ----

// score = (sum over shared tokens of 1, or 0.5 when negated) / |tokens(question)|, shared = tokens(text) ∩ (tokens(question) ∪ tokens(keywords));
// a hit is the top row, score >= 0.6, >= 2 shared tokens. P13/H05: a negation (not, no, never, don't, do not) within 3 words before a
// matched keyword halves that keyword's contribution, so "I do not want my money back, I want the blade replaced" misses the refund FAQ.
const NEGATION = /^(?:not|no|never|dont|don't|don’t|cannot|cant|can't|can’t|nothing|without)$/;
export function negatedTokens(text) {
  const words = String(text ?? "").toLowerCase().split(/[^\p{L}\p{N}'’]+/u).filter(Boolean);
  const out = new Set();
  words.forEach((w, i) => {
    if (!words.slice(Math.max(0, i - 3), i).some((p) => NEGATION.test(p))) return;
    for (const tk of tokens(w)) out.add(tk);
  });
  return out;
}

export function matchFaq(text, faqRows) {
  const t = new Set(tokens(text));
  const neg = negatedTokens(text);
  let best = null;
  for (const row of faqRows ?? []) {
    const q = new Set(tokens(row.question));
    if (!q.size) continue;
    const pool = new Set([...q, ...tokens(row.keywords)]);
    const shared = [...t].filter((w) => pool.has(w));
    const negated = shared.filter((w) => neg.has(w));
    const score = (shared.length - negated.length / 2) / q.size;
    if (!best || score > best.score) best = { row, score, shared, ...(negated.length ? { negated } : {}) };
  }
  return best && best.score >= 0.6 && best.shared.length >= 2 ? best : null;
}

// products whose name tokens all appear in the text
export function matchProducts(text, productRows) {
  const t = new Set(tokens(text));
  return (productRows ?? []).filter((p) => { const n = tokens(p.name); return n.length > 0 && n.every((w) => t.has(w)); });
}

// The product a message is about, from the product_lookup rows ({ sku, name, aliases }): the name's tokens all in the text, or an alias's.
// A name match outranks an alias match, then the more tokens matched wins; two equally good products are ambiguous (null, with the skus listed).
export function matchProductLookup(text, lookupRows) {
  // "pouches" stems to "pouche": the -es plural of a -ch/-sh/-x/-ss word also counts as the singular
  const t = new Set(tokens(text).flatMap((w) => (/(?:ch|sh|x|ss)e$/.test(w) ? [w, w.slice(0, -1)] : [w])));
  const found = [];
  for (const p of lookupRows ?? []) {
    const n = tokens(p.name);
    if (n.length && n.every((w) => t.has(w))) { found.push({ row: p, via: "name", n: n.length }); continue; }
    const best = String(p.aliases ?? "").split(";").map((a) => tokens(a)).filter((a) => a.length && a.every((w) => t.has(w))).sort((a, b) => b.length - a.length)[0];
    if (best) found.push({ row: p, via: "alias", n: best.length });
  }
  found.sort((a, b) => (a.via === b.via ? 0 : a.via === "name" ? -1 : 1) || b.n - a.n || (a.row.sku < b.row.sku ? -1 : 1));
  const top = found.filter((x) => x.via === found[0]?.via && x.n === found[0]?.n);
  return { all: found, hit: top.length === 1 ? top[0] : null, ambiguous: top.length > 1 ? top.map((x) => x.row.sku) : [] };
}

// the inner text of every [[blank: …]] marker
export function blanks(text) {
  return [...String(text ?? "").matchAll(/\[\[blank:\s*([^\]]*?)\s*\]\]/gi)].map((m) => m[1]);
}

// ---- shared probe helpers ----

// A buffering trace: lines are held, ready for the loop to write after the branch line.
function buffer(tb, branch) {
  const lines = stampedBuffer();
  const o = { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}), trace: { line: (x) => lines.push(branch ? { ...x, branch_id: branch } : x) } };
  return { lines, o };
}
const idsIn = (lines) => lines.flatMap((l) => (l.step === "zetaris.query" && l.status === "success" ? (/rows: (.*)$/.exec(l.output_summary ?? "")?.[1] ?? "").split(", ").filter((x) => x && x !== "none") : []));

// who owns a topic: the facts' owner when the ticket is already that topic, else the responsibility row (+ names), looked up in probe.
async function ownerOf(tb, topic, o) {
  const f = tb.f ?? {};
  if (f.category === topic && f.owner_id != null) {
    return { owner_id: f.owner_id, backup_id: f.backup_id, owner_name: f.owner_name, backup_name: f.backup_name, role: `${topic} owner`, looked_up: false, owner_team: f.owner_team ?? null };
  }
  const r = (await tb.queries.run("responsibility", { topic }, o)).objects[0];
  if (!r) return { owner_id: null, backup_id: null, role: `${topic} owner`, looked_up: true };
  const empOf = async (id) => {
    try { return (await tb.queries.run("employee", { employee_id: Number(id) }, o)).objects[0]; } catch { return undefined; }
  };
  const nameOf = (e) => (e ? `${e.given_name} ${e.family_name}` : undefined);
  const owner_id = Number(r.owner_id), backup_id = Number(r.backup_id);
  const oe = await empOf(owner_id);
  const be = await empOf(backup_id);
  return { owner_id, backup_id, owner_name: nameOf(oe), backup_name: nameOf(be), role: `${topic} owner`, looked_up: true, owner_team: oe?.team ?? null };
}

// the real Risk sign-off line over a code-made draft
// the team (and its label) of the person a hold waits for, from that person's own hierarchy row: a hold re-routed away from the ticket's own owner wears the new owner's team
async function teamOf(tb, owner) {
  if (owner?.owner_id == null) return {};
  try {
    const h = await personOf(tb, owner.owner_id, { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
    return h?.team ? { team: h.team, team_label: h.team_label ?? null } : (owner.owner_team ? { team: owner.owner_team } : {});
  } catch { return owner.owner_team ? { team: owner.owner_team } : {}; }
}

function signoff(tb, branch, draft) {
  const hr = tb.hardRisk(tb.f ?? {}, draft);
  const reasons = hr.reasons ?? [];
  const pass = reasons.length === 0;
  tb.L({ step: "risk.signoff", agent_name: "Risk", action: "risk_signoff", sponsor: "meterless", branch_id: branch, retry_count: 0,
    input_summary: `${branch} draft vs facts`, output_summary: pass ? "Signed off." : `Not signed: ${reasons.join("; ")}`, status: pass ? "success" : "needs_revision" });
  return { pass, reasons };
}
const skipLine = (tb, step, text) => tb.skipped(step, text, { output_summary: text });

// ---- question ----

const sentences = (s) => one(s, 400);

// The records quote for the sample draft: the page that shares the most words with the question, at most two of its sentences
// (the ones that share words), never a sentence with a restricted term and never a prohibition list ("may not include …").
export function quoteFromRecords(wiki, question, restricted = []) {
  const qt = new Set(tokens(question));
  const overlap = (s) => tokens(s).filter((w) => qt.has(w)).length;
  const bad = (s) => /\b(may not|must not|cannot|never)\b/i.test(s) || restricted.some((t) => t && s.toLowerCase().includes(String(t).toLowerCase()));
  let best = null;
  for (const w of wiki ?? []) {
    const sents = String(w.text ?? "").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    const kept = sents.map((t, i) => ({ t, i, n: overlap(t) })).filter((x) => x.n > 0 && !bad(x.t));
    const total = kept.reduce((a, x) => a + x.n, 0);
    if (kept.length && (!best || total > best.total)) best = { page: w.page, kept, total };
  }
  if (!best) return null;
  const pick = [...best.kept].sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
  return { page: best.page, text: pick.map((x) => x.t).join(" ") };
}

async function probeQuestion(tb) {
  const text = tb.inputText ?? "";
  const { lines: ro, o } = buffer(tb, null);
  const faqRows = (await tb.queries.run("faq", {}, o)).objects;
  const hit = matchFaq(text, faqRows);
  if (hit) {
    return { branch_id: "faq-hit", why: `FAQ ${hit.row.faq_id} matches (score ${hit.score.toFixed(2)}, shared: ${hit.shared.join(", ")}); FAQ text is canonical, the floor gates model drafts`,
      cited: [`faq:${hit.row.faq_id}`], data: { faq: hit, faqRows: faqRows.length }, lines: ro.map((x) => ({ ...x, branch_id: "faq-hit" })) };
  }
  // miss: the wiki page, the policy rows and the customer's ticket
  const collected = stampedBuffer();
  const rtrace = { line: (x) => { collected.push(x); return x; } };
  const { data, rows } = await rowsForIntent("order.question", tb.f?.sender_email ?? null, { ...o, trace: rtrace });
  const qt = new Set(tokens(text));
  const shares2 = (s) => tokens(s).filter((w) => qt.has(w)).length >= 2;
  const candidates = [
    ...(rows.wiki ?? []).map((w) => `${w.page ?? ""} ${w.text ?? ""}`),
    ...(rows.policy ?? []).map((p) => `${p.topic ?? ""} ${p.limit_amount ?? ""}`),
    ...(rows.ticket ? [`${rows.ticket.subject ?? ""} ${rows.ticket.category ?? ""}`] : []),
  ];
  // a question about refunds or replacements also reads that topic's policy and wiki rows (the limit lives there)
  const topic = /refund|money back/i.test(text) ? "refund.request" : /replac/i.test(text) ? "replacement.request" : null;
  if (topic) {
    // owner names are a nicety rowsForIntent reads and tolerates missing: their error lines are not this branch's failures
    const quiet = { line: (x) => (x.status === "error" && /employee/.test(String(x.action)) ? x : rtrace.line(x)) };
    const more = await rowsForIntent(topic, null, { ...o, trace: quiet });
    rows.policy = more.rows.policy ?? rows.policy; rows.category = more.rows.category ?? rows.category;
    rows.wiki = [...(more.rows.wiki ?? []), ...(rows.wiki ?? [])];
  }
  const cited = [...new Set(idsIn(collected))];
  const checked = `the FAQ (${faqRows.length} rows), ${rows.wiki?.length ?? 0} wiki page(s)${rows.policy?.length ? ", the policy rows" : ""}${rows.ticket ? ", the customer's ticket" : ""}`;
  const answerable = candidates.some(shares2);
  // A question that names no product, matches no FAQ row and shares nothing with the records is not a product owner's question: it takes the other road
  // (Support's default owner, a hold, no draft), whatever the models read it as. The question road's unanswered branch stays for product-scoped questions,
  // and for a caller who declared the scenario "question" (the caller's choice stands; only a resolved message is re-routed).
  let namesProduct = true;
  if (!answerable && tb.scenario?.how !== "declared") {
    try {
      const lookup = (await tb.queries.run("product_lookup", {}, o)).objects;
      // a product is named by its name, an alias or its SKU id (FS-A01)
      namesProduct = matchProductLookup(text, lookup).all.length > 0 || lookup.some((x) => x.sku && new RegExp(`(?<![\\w-])${String(x.sku).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(text));
    } catch { namesProduct = true; }
  }
  if (!answerable && !namesProduct) {
    const oo = await ownerOf(tb, "other", o);
    return { branch_id: "other-unanswered", why: `nothing in the records answers this and it names no product; checked ${checked}`,
      cited: oo.looked_up ? ["responsibility:other"] : [], data: { owner: oo, faqRows: faqRows.length, rows, records: data, checked }, lines: [...ro, ...collected].map((x) => ({ ...x, branch_id: "other-unanswered" })) };
  }
  const owner = answerable ? null : await ownerOf(tb, "question", o);
  const branch_id = answerable ? "question-records" : "question-unanswered";
  const lines = [...ro, ...collected].map((x) => ({ ...x, branch_id }));
  return { branch_id, why: answerable ? `no FAQ match; the records (${cited.join(", ") || "none"}) share two words with the question` : `no FAQ match and no record shares two words with the question; checked ${checked}`,
    cited: answerable ? cited : [], data: { faq: null, faqRows: faqRows.length, rows, records: data, checked, owner }, lines };
}

// The FAQ's canonical answer, sent by itself on behalf of Support (no model: FAQ text is canonical, the floor gates model drafts).
async function actFaqHit(tb, p) {
  const B = p.branch_id;
  const { row } = p.data.faq;
  skipLine(tb, "nvidia.model", "FAQ canonical text, no model call");
  skipLine(tb, "critique", "canonical FAQ answer, nothing to evaluate");
  // the reply is sent for the team of the person responsible for customer service (that owner's row); "Support" only when the row is absent
  const ownerHint = await ownerOf(tb, "customer_service", { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
  const team = ownerHint.owner_team ?? "Support";
  const draft = { text: sample.frame(tb.ticket ?? tb.f, row.answer, { team, onBehalf: true }), promises: NO_PROMISES(), model: "faq/canonical" };
  const sig = signoff(tb, B, draft);
  skipLine(tb, "retry", "canonical FAQ text: a rewrite cannot change it");
  if (!sig.pass) {
    const owner = await ownerOf(tb, "question", { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
    tb.escalate([{ source: "Risk", reason: sig.reasons.join("; ") }], `FAQ ${row.faq_id} answer not signed off: ${sig.reasons.join("; ")}`, {}, { owner, draft });
    return { decision: "escalate", reasons: sig.reasons, draft, queued: owner, cited: p.cited };
  }
  tb.skipped("escalate_or_fallback", "FAQ answer sent; nothing to escalate");
  // the card names the person responsible for the team the reply was sent for (the customer_service default owner)
  return { decision: "send", reasons: [`FAQ ${row.faq_id} answers it; ${p.why}`], draft, cited: p.cited, auto_reply: true, team, ownerHint };
}

async function actQuestion(tb, p) {
  if (p.branch_id === "other-unanswered") return actOther(tb, p);
  const B = p.branch_id;
  if (B === "faq-hit") return actFaqHit(tb, p);
  if (B === "question-records") {
    const rows = p.data.rows;
    const messagesFn = ({ critiques }) => {
      const m = draftMessages({ ticket: tb.ticket, facts: { ...tb.f, cited_rows: [...(tb.f?.cited_rows ?? []), ...p.cited] }, memoryContext: tb.memCtx, critiques });
      const last = m.length - 1;
      m[last] = { ...m[last], content: m[last].content.replace(/Return the JSON object now\.$/, `Records (the only facts you may use):\n${JSON.stringify(rows)}\n\nReturn the JSON object now.`) };
      return m;
    };
    const quote = quoteFromRecords(rows.wiki, tb.inputText ?? "", tb.f?.restricted_terms ?? []);
    const sampleDraftFn = () => ({
      text: sample.frame(tb.ticket ?? tb.f, `From our records${quote?.page ? ` ("${quote.page}")` : ""}: ${quote ? sentences(quote.text) : "see the cited rows"}`),
      promises: NO_PROMISES(), model: "sample/rules",
    });
    const r = await tb.replyLoop(tb, { messagesFn, sampleDraftFn, branch: B });
    const draft = { text: r.draft.text, promises: r.draft.promises, model: r.draft.model };
    if (!r.ok) {
      const rounds = tb.S.rounds ?? [];
      const critiques = rounds.flatMap((x) => [{ round: x.n, source: "Evaluator", pass: x.critique.pass, reason: x.critique.reason }, { round: x.n, source: "Risk", pass: x.risk.pass, reason: x.risk.reasons.join("; ") || "signed off" }]);
      const reason = r.risk.hard ? `hard fact Risk cannot rewrite: ${r.risk.reasons.join("; ")}` : `two negative rounds: ${one(r.crit.reason)} | ${r.risk.reasons.join("; ")}`;
      tb.escalate(critiques, reason);
      return { decision: "escalate", reasons: [reason], draft, cited: p.cited };
    }
    tb.skipped("escalate_or_fallback", "both critics passed; a hold waits for a person");
    const owner = await ownerOf(tb, "question", { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
    return { decision: "hold", reasons: [`${p.why}. Both critics passed; the reply waits for the question owner with the draft attached`], draft, queued: owner, cited: p.cited };
  }
  // question-unanswered
  skipLine(tb, "nvidia.model", "question-unanswered: no draft");
  skipLine(tb, "critique", "question-unanswered: no draft to critique");
  skipLine(tb, "risk.signoff", "question-unanswered: nothing to sign");
  skipLine(tb, "retry", "question-unanswered: a rewrite cannot change it");
  const owner = p.data.owner;
  const recommendation = `not in the FAQ or the records; checked: ${p.data.checked}`;
  tb.escalate([{ source: "Planner", reason: recommendation }], `question-unanswered: ${recommendation}`, {}, { owner, recommendation });
  return { decision: "escalate", reasons: [recommendation], queued: owner, recommendation, cited: [] };
}

// ---- RFQ ----

const said = (q) => (q.length === 0 ? "the quantity asked" : q.length === 1 ? String(q[0]) : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`);

async function probeRfq(tb) {
  const text = tb.inputText ?? "";
  const { lines, o } = buffer(tb, "rfq");
  const params = tb.decided?.parameters;
  const quantities = Array.isArray(params?.quantities) ? params.quantities : extractParams(text).quantities ?? [];
  const products = (await tb.queries.run("products", {}, o)).objects;
  const matched = matchProducts(text, products);
  const prices = [];
  for (const m of matched) {
    const r = (await tb.queries.run("product_price", { sku: m.sku }, o)).objects[0];
    if (r) prices.push(r);
  }
  const owner = await ownerOf(tb, "rfq", o);
  // a quote needs ONE product in the catalogue and ONE quantity; two quantities ("the price difference between 100000 and 100") stay the acknowledgement road
  if (!matched.length) {
    try {
      const hit = matchProductLookup(text, (await tb.queries.run("product_lookup", {}, o)).objects).hit;
      if (hit) { const r = (await tb.queries.run("product_price", { sku: hit.row.sku }, o)).objects[0]; if (r) { matched.push(r); prices.push(r); } }
    } catch { /* the acknowledgement road below stands */ }
  }
  if (matched.length === 1 && prices.length === 1) {
    const qty = quantities.length === 1 ? quantities[0] : quantities.length === 0 ? quantityBeforeProduct(text, prices[0].name) : null;
    if (Number.isInteger(qty) && qty > 0) {
      const quote = await probeQuote(tb, { o, lines, qty, price: prices[0], owner });
      if (quote) return quote;
    }
  }
  const ids = prices.map((x) => `products:${x.sku}`);
  const q = said(quantities);
  // what stopped the quote: say it from the message, never deny the pricing rows
  const manyNums = quantities.length > 1 ? quantities : (text.replace(/\bJP-\d{4}\b/gi, " ").match(/(?<![\w.-])\d[\d,]*(?![\w-])/g) ?? []);
  const missing = prices.length > 1 ? `more than one product matched (${prices.map((x) => x.name).join(", ")})`
    : manyNums.length > 1 ? `the message names more than one quantity (${said(manyNums)}) and which one to price is not clear`
    : quantities.length === 0 && !Number.isInteger(quantityBeforeProduct(text, prices[0]?.name)) ? "no quantity was stated for it"
    : "the quantity could not be read as one whole number";
  const recommendation = prices.length
    ? `The records hold a unit price for ${prices.map((x) => `${x.name} (${Number(x.unit_price)} ${x.currency ?? "GC"}, minimum ${Number(x.min_order_qty)})`).join(" and for ")}; ${missing}; a quote cannot be composed from this message. Sales to quote.`
    : `Quantities asked: ${q}; no product in the records matches; sales to identify.`;
  return { branch_id: "rfq", why: `request for a quote: ${prices.length ? `${prices.map((x) => x.name).join(", ")} found` : "no product matched"}, quantities ${quantities.join(", ") || "none stated"}; sales quotes, prices attached`,
    cited: [...ids, ...(owner.looked_up ? ["responsibility:rfq"] : [])],
    data: { quantities, products: matched, prices, owner, recommendation, ids }, lines };
}

async function actRfq(tb, p) {
  if (p.data.quote) return actQuote(tb, p);
  const { quantities, products, prices, owner, recommendation, ids } = p.data;
  const B = p.branch_id;
  skipLine(tb, "nvidia.model", "acknowledgement template, no model call");
  skipLine(tb, "critique", "template, nothing to evaluate");
  // a quantity that equals a unit price would put a price in the draft: say it without numbers
  const safeQ = quantities.filter((n) => !prices.some((x) => String(Number(x.unit_price)) === String(n)));
  const ack = sample.acknowledgement(tb.ticket ?? tb.f, { quantities: safeQ.length === quantities.length ? quantities : [] });
  const draft = { text: ack.text, promises: ack.promises, model: ack.model };
  const sig = signoff(tb, B, draft);
  skipLine(tb, "retry", "template: a rewrite cannot change it");
  const attachments = { prices, quantities, products, cited: ids };
  const reason = `rfq: ${recommendation}${sig.pass ? "" : ` (acknowledgement not signed off: ${sig.reasons.join("; ")})`}`;
  tb.escalate(sig.pass ? [] : [{ source: "Risk", reason: sig.reasons.join("; ") }], reason, {}, { owner, draft: sig.pass ? draft : null, attachments, recommendation });
  return { decision: "escalate", reasons: [reason], draft: sig.pass ? draft : undefined, queued: owner, recommendation, attachments, cited: p.cited };
}


// ---- bulk quote (P29): tiers AND parts. The quote is composed from rows; a human sends it. ----

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === "" || v == null ? NaN : Number(v));
const cut = (v) => round2(v).toFixed(2);

// "50 Vanta Arc Trainers": the integer written directly before the product's name (Scout counts a quantity only before a unit word)
function quantityBeforeProduct(text, name) {
  const words = String(name ?? "").split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return null;
  // two numbers in the message ("the difference between 100000 Vanta Arc Trainers and 100") is a comparison, not an order
  if ((String(text ?? "").match(/(?<![\w.-])\d[\d,]*(?![\w-])/g) ?? []).length !== 1) return null;
  const m = new RegExp(`(?<![\\w.,-])(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\s*x)?\\s+(?:of\\s+(?:the\\s+)?)?${words.join("\\s+")}s?\\b`, "i").exec(String(text ?? ""));
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

// A person for a queue entry: { id, name, role, email, team }. Name and role from the hierarchy (it answers for the CEO and Legal),
// the email from employees (a row missing there leaves email null, never invented).
async function personOf(tb, id, o) {
  const one1 = async (name) => { try { return (await tb.queries.run(name, { employee_id: Number(id) }, o)).objects[0] ?? null; } catch { return null; } };
  const h = await one1("hierarchy");
  const e = await one1("employee");
  return { id: Number(id), name: h?.name ?? (e ? `${e.given_name} ${e.family_name}` : null), role: h?.role ?? e?.role ?? null, email: e?.email ?? null, team: h?.team ?? e?.team ?? null, team_label: h?.team_label ?? null, manager_id: h?.manager_id != null ? Number(h.manager_id) : null };
}
const headOf = async (tb, team, o) => {
  const r = (await tb.queries.run("team_head", { team }, o)).objects[0];
  return r ? personOf(tb, Number(r.employee_id), o) : null;
};

async function probeQuote(tb, { o, lines, qty, price, owner }) {
  const run = (n, params, why) => tb.queries.run(n, params, why ? { ...o, why } : o);
  const tiers = (await run("bulk_tiers", {}, "volume tiers: the tier is picked by quantity")).objects;
  const tierRow = tiers.find((t) => qty >= num(t.min_qty) && (Number.isNaN(num(t.max_qty)) || qty <= num(t.max_qty))) ?? null;
  const discount = tierRow ? Number(tierRow.discount_pct) : 0;
  const unit = round2(Number(price.unit_price) * (1 - discount / 100));
  const total = round2(unit * qty);
  const lead = Number(price.lead_days);
  const parts = (await run("bom", { sku: price.sku }, `parts of ${price.sku}: needed for ${qty} units against stock`)).objects.map((b) => {
    const needed = Number(b.qty_per_unit) * qty, stock = Number(b.stock);
    return { part_id: b.part_id, part_name: b.part_name, needed, stock, short: needed > stock };
  });
  const short = parts.filter((x) => x.short);
  let limit = null;
  try { const pr = (await run("policy", { topic: "rfq" }, "the quote limit")).objects[0]; limit = pr ? Number(pr.limit_amount) : null; } catch { limit = null; }
  const over = limit != null && Number.isFinite(limit) && total > limit;
  const quote = { sku: price.sku, quantity: qty, tier: tierRow?.tier ?? "list", unit_price: unit, discount_pct: discount, total, currency: "GC", parts };
  // over the limit: the Sales head approves, the CEO when the head is out that day
  let approver = null, headOut = false;
  const cited = [`products:${price.sku}`, ...(tierRow ? [`bulk_pricing:${tierRow.tier}`] : []), ...parts.map((x) => `bom:${price.sku}:${x.part_id}`), ...(limit != null ? ["policy:rfq"] : []), ...(owner.looked_up ? ["responsibility:rfq"] : [])];
  if (over) {
    const head = await headOf(tb, "Sales", o);
    if (head) {
      cited.push(`companyhierarchy:${head.id}`);
      const day = tb.f?.as_of ?? tb.o?.as_of;
      if (day) {
        try {
          headOut = (await run("holiday", { employee_id: head.id, date: day }, `Sales head ${head.id}: in on ${day}?`)).objects.length > 0;
          cited.push(`holiday_2026:${head.id}@${day}`);
        } catch { headOut = false; }
      }
      approver = headOut && head.manager_id != null ? await personOf(tb, head.manager_id, o) : head;
      if (approver) cited.push(`companyhierarchy:${approver.id}`);
      approver = approver && { ...approver, head, headOut };
    }
  }
  // the backup for an over-limit approval is the approver's manager: its team comes from that hierarchy row
  let backupTeam = null;
  if (over && approver && !headOut && approver.manager_id != null) {
    try { backupTeam = (await run("hierarchy", { employee_id: approver.manager_id }, `approver ${approver.id}'s manager ${approver.manager_id}: team`)).objects[0]?.team ?? null; } catch { backupTeam = null; }
  }
  const partsText = parts.map((x) => `${x.part_name} ${x.needed} of ${x.stock}${x.short ? " (short)" : ""}`).join(", ");
  const branch_id = over ? "rfq-quote-over-limit" : short.length ? "rfq-quote-stock" : "rfq-quote";
  const shortText = short.map((x) => `${x.part_name} (${x.part_id}) is short by ${x.needed - x.stock}: needs ${x.needed}, stock ${x.stock}`).join("; ");
  const why = `quote for ${qty} x ${price.name}: tier ${quote.tier} (${discount}% off), unit ${cut(unit)} GC, total ${cut(total)} GC, lead ${lead} days; parts ${partsText || "none listed"}`
    + (over ? `; the total is over the ${limit} GC quote limit, ${approver ? `${approver.name ?? `employee ${approver.id}`} (${approver.role ?? "approver"}) approves${headOut ? ` because the Sales head ${approver.head.id} is out on ${tb.f?.as_of ?? tb.o?.as_of}` : ""}` : "no Sales head row: the quote owner stands"}` : "")
    + (short.length ? `; ${shortText}` : "");
  return { branch_id, why, cited, data: { quote, quote_name: price.name, lead, limit, over, short, shortText, approver, owner, backupTeam }, lines: lines.map((x) => ({ ...x, branch_id })) };
}

async function actQuote(tb, p) {
  const { quote, quote_name, lead, limit, over, short, shortText, approver, owner } = p.data;
  const B = p.branch_id;
  skipLine(tb, "nvidia.model", `${B}: the quote is filled from the tier, the price and the parts, no model call`);
  skipLine(tb, "critique", "composed from the rows, nothing to evaluate");
  const body = fillQuote({ product: quote_name, quantity: quote.quantity, tier: `${quote.tier} (${quote.discount_pct}% off)`, unit_price: cut(quote.unit_price), total: cut(quote.total), lead_days: lead, parts: quote.parts })
    + (over ? "\nBecause of its size this quote is routed for approval before it is confirmed." : "");
  // the team of the quote owner's row; "Sales" only when that row is absent (last-resort fallback)
  const draft = { text: sample.frame(tb.ticket ?? tb.f, body, { team: owner?.owner_team ?? "Sales" }), promises: NO_PROMISES(), model: "template/quote" };
  const sig = signoff(tb, B, draft);
  skipLine(tb, "retry", "composed from the rows: a rewrite cannot change it");
  const attachments = { quote, cited: p.cited };
  const recommendation = over
    ? `The quote total ${cut(quote.total)} GC is over the ${limit} GC quote limit: ${approver?.name ?? "the Sales head"} approves it${short.length ? `; also ${shortText}` : ""}.`
    : short.length ? `Hold the quote: ${shortText}. Sales confirms the part with production before the quote goes out.`
    : `Quote ready: ${quote.quantity} x ${quote_name}, tier ${quote.tier}, ${cut(quote.total)} GC. Sales checks it and sends it.`;
  if (!sig.pass) {
    const reason = `${p.why}; the quote draft was not signed off: ${sig.reasons.join("; ")}`;
    tb.escalate([{ source: "Risk", reason: sig.reasons.join("; ") }], reason, {}, { owner, attachments, recommendation });
    return { decision: "escalate", reasons: [reason], queued: owner, recommendation, attachments, cited: p.cited };
  }
  if (over && approver) {
    const ap = { kind: "quote_total", amount: quote.total, limit, approver_id: approver.id, approver_name: approver.name };
    const o2 = { owner_id: approver.id, backup_id: approver.headOut ? null : approver.manager_id, owner_name: approver.name, backup_name: null, role: approver.role, team: approver.team, team_label: approver.team_label };
    const reason = `${p.why}`;
    tb.escalate([{ source: "Policy", reason: `quote total ${cut(quote.total)} GC is over the ${limit} GC limit: needs approval by ${approver.name ?? `employee ${approver.id}`}` }], reason, {},
      { approval: ap, draft, owner: o2, attachments, recommendation, team: approver.team, team_label: approver.team_label, backup_team: approver.headOut ? null : (p.data.backupTeam ?? "Executive") /* "Executive" only when the approver's manager row is absent */ });
    return { decision: "escalate", reasons: [reason], draft, queued: o2, recommendation, attachments, cited: p.cited };
  }
  tb.skipped("escalate_or_fallback", `${B}: a human sends quotes; the hold waits for the quote owner`);
  return { decision: "hold", reasons: [`${p.why}. Held for the quote owner with the draft attached; a human sends quotes`], draft, queued: owner, recommendation, attachments, cited: p.cited };
}

// ---- complaint ----

const NO_HISTORY = () => ({ text: "no earlier threads for this sender", provenance: [], summary: { earlier_threads: 0, complaints: 0, public_before: false, product_complaints: {} }, customer_id: null, skus: [] });

async function probeComplaint(tb) {
  const f = tb.f ?? {};
  // one buffer: the world_threads / products / reviews / owner query lines (and their adapter recoveries) join the probe's own lines in order
  const { lines, o } = buffer(tb, null);
  const ticket = { ...(tb.ticket ?? {}), subject: f.subject ?? tb.ticket?.subject ?? "", body: tb.inputText ?? f.body ?? "", channel: f.channel ?? tb.ticket?.channel,
    thread_id: f.thread_id, sender_name: f.sender_name ?? tb.ticket?.sender_name, sender_email: f.sender_email };
  const rows = {};
  let products = [];
  let ctx = NO_HISTORY();
  let wline = "no world context";
  try {
    for (const k of ["world_threads", "products", "reviews"]) rows[k] = (await tb.queries.run(k, {}, o)).objects;
    products = toObjects(rows.products);
    const dir = process.env.WORLD_MODEL_DIR;
    const worldStart = Date.now();
    const world = await getWorld({ rows, ...(dir ? { storage: "local", persistDir: dir } : {}) });
    const mentioned = mentionedProducts(`${ticket.subject} ${ticket.body}`, products).map((p) => (typeof p === "object" ? p.sku : p));
    ctx = complaintContext(world, { sender_email: f.sender_email, skus: mentioned, thread_id: f.thread_id, channel: f.channel });
    wline = worldLine(world, ctx);
    lines.push({ step: "meterless.engine", agent_name: "WorldModel", action: "world_context", started_at: worldStart, sponsor: "meterless",
      input_summary: `history of ${f.sender_email ?? "the sender"} and ${ctx.skus.length ? ctx.skus.join(", ") : "no product"}`,
      output_summary: wline, memory_ids: ctx.provenance.map((p) => p.id), status: "success" });
  } catch (e) {
    lines.push({ step: "meterless.engine", agent_name: "WorldModel", action: "world_context", input_summary: "meterless.engine failed", output_summary: `${e?.name ?? "Error"}: ${one(e?.message, 200)}`, status: "error" },
      { step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after meterless.engine error", output_summary: "world context unavailable, read by text alone", status: "success" });
  }
  // the Nemotron read
  const readLine = (model, read, extra = {}) => {
    const { local, ...rest } = extra;
    lines.push({ step: "nvidia.model", agent_name: "Reader", action: "read_complaint", ...(local ? {} : { sponsor: "nvidia" }), model,
      input_summary: `complaint read for ${f.thread_id ?? "ticket"}`, output_summary: `kind ${read.kind}, face_risk ${read.face_risk}: ${one(read.reasoning, 120)}`, status: "success", ...rest });
  };
  let read;
  const twin = () => sample.complaintRead(ticket, { worldText: ctx.text });
  const sampleLine = (r, extra = {}) => readLine(r.model ?? "sample/rules", r, { status: "skipped", output_summary: `sample mode: rules read (${r.model ?? "sample/rules"}), no model call; kind ${r.kind}, face_risk ${r.face_risk}: ${one(r.reasoning, 100)}`, ...extra });
  if (tb.sampleOn) {
    read = twin();
    sampleLine(read);
  } else {
    try {
      const messages = complaintReadMessages({ ticket, worldText: ctx.text, provenanceIds: ctx.provenance.map((p) => p.id) });
      let res = await tb.io.drafter(messages, { purpose: "complaint_read", trace: tb.io.adapterTrace, signal: tb.io.signal });
      if (res.sample || res.text == null) { read = twin(); sampleLine(read); }
      else {
        let models = null;
        try { read = parseComplaintReadJson(res.text); } catch {
          const first = res.model;
          res = await tb.io.drafter([...messages, { role: "assistant", content: String(res.text) }, { role: "user", content: NUDGE }], { purpose: "complaint_read", trace: tb.io.adapterTrace, signal: tb.io.signal });
          models = `models: ${first}, then ${res.model}`;
          read = parseComplaintReadJson(res.text);
        }
        readLine(res.model, read, { local: res.lane === "local-lane", ...(models ? { output_summary: `kind ${read.kind}, face_risk ${read.face_risk}: ${one(read.reasoning, 100)} (${models})` } : {}) });
      }
    } catch (e) {
      lines.push({ step: "nvidia.model", agent_name: "Reader", action: "read_complaint", sponsor: "nvidia", input_summary: "nvidia.model failed", output_summary: `${e?.name ?? "Error"}: ${one(e?.message, 200)}`, status: "error" },
        { step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after nvidia.model error", output_summary: "complaint read unavailable, rules read used", status: "success" });
      read = twin();
      readLine(read.model ?? "sample/rules", read, { input_summary: "rules read after the model failed" });
    }
  }
  // severity (the gate logs its own line through the shim)
  const endSev = tb.progress?.work?.("severity") ?? (() => {});
  let sev;
  try { sev = await seams.severityGate(ticket, { ...f, repeat: ctx.summary.earlier_threads > 0, publicChannel: f.channel_public === true }, wline,
    { trace: { line: (x) => lines.push(x) }, cfg: tb.cfg, sampleMode: tb.sampleOn, kind: read.kind, signal: tb.io?.signal });
  } finally { endSev({}); }
  // a legal threat wins over the channel and over plain severity: the severity read says legal, or a score of 10 on lawyer/legal/sue words
  const legal = sev.legal === true || (sev.score >= 10 && LEGAL_TEXT.test(`${ticket.subject} ${ticket.body}`));
  // a self-described mild injury is a genuine complaint whatever the severity model scored it: a person still owns it, the draft is attached, and the note names the injury
  const mild = legal ? null : mildInjury(`${ticket.subject} ${ticket.body}`);
  const sevCls = legal ? "complaint-legal" : mild ? "complaint-genuine" : sev.score >= 9 ? "complaint-severe" : read.kind === "genuine" ? "complaint-genuine" : "complaint-vent";
  const owner = await ownerOf(tb, "complaint", o);
  const cited = ["world_threads", ...ctx.skus.map((p) => `products:${p}`), ...(owner.looked_up ? ["responsibility:complaint"] : [])];
  let legalRoute = null;
  if (legal) {
    // Support owns the customer, Legal is told with it: the legal default owner (responsibility legal), and the heads of Support and Legal in copy
    const lo = await ownerOf(tb, "legal", o);
    const [supportHead, legalHead, alsoP] = [await headOf(tb, "Support", o), await headOf(tb, "Legal", o), lo.owner_id != null ? await personOf(tb, lo.owner_id, o) : null];
    const strip = ({ id, name, role, email }) => ({ id, name, role, email });
    legalRoute = { also: alsoP ? [strip(alsoP)] : [], cc: [supportHead, legalHead].filter(Boolean).map(strip) };
    cited.push("responsibility:legal", ...[supportHead, legalHead, alsoP].filter(Boolean).map((x) => `companyhierarchy:${x.id}`));
  }
  // a refund asked inside the complaint stays visible: the amount the customer names goes in the reasons for the person who reads it
  const asked = /\b(refund\w*|money back|reimburs\w*)\b/i.test(`${ticket.subject} ${ticket.body}`) ? amountsIn(`${ticket.subject} ${ticket.body}`) : null;
  const refundNote = asked ? `; the customer also asks for a refund${asked.length ? ` (${asked.join(", ")} GC named)` : ""}, which the refund owner decides after the complaint is read` : "";
  const hist = ctx.summary.earlier_threads ? `${ctx.summary.earlier_threads} earlier thread${ctx.summary.earlier_threads === 1 ? "" : "s"} on record` : "no earlier threads";
  return { branch_id: sevCls, why: `severity ${sev.score} (${sev.legend}), the customer reads as ${read.kind} (${hist}); ${sevCls === "complaint-legal" ? "a legal threat: a courtesy reply now, Support owns it and Legal reviews" : sevCls === "complaint-severe" ? "a person handles it" : sevCls === "complaint-genuine" ? (mild ? `a safety report: the customer names a ${mild}; the owner gets the draft and the handling note` : "the owner gets the draft and the handling note") : "a calm acknowledgement closes it"}${refundNote}`,
    cited, data: { ctx, read, severity: sev, owner, legalRoute, products, mild }, lines: lines.map((x) => ({ ...x, branch_id: sevCls })) };
}

const LEGAL_TEXT = /lawyer|attorney|legal|sue\b|court/i;
// A self-described mild injury: a minor qualifier right before the injury ("a small burn", "slight bruise"), or the injury called minor ("the burn was minor").
// The customer's own words decide it, not the severity model: a live severity read can score "a small burn" 10 (legal or safety).
// A legal word, or anything that says it was not mild (hospital, stitches, permanent), keeps the severity rule.
const INJURY = "burns?|burned|burnt|cuts?|bruises?|bruised|scratch(?:es|ed)?|grazes?|grazed|blisters?|nicks?|scrapes?|stings?|rash";
const MILD_INJURY_BEFORE = new RegExp(`\\b(?:small|minor|slight|little|mild|tiny|light|superficial)\\s+(?:[a-z]+\\s+)?(${INJURY})\\b`, "i");
const MILD_INJURY_AFTER = new RegExp(`\\b(${INJURY})(?:\\s+(?:on|to|in)\\s+(?:his|her|my|the|their)\\s+[a-z]+)?\\s+(?:was|is|were|looks?|seems?)\\s+(?:only\\s+|just\\s+|quite\\s+|very\\s+)?(?:small|minor|slight|mild|superficial)\\b`, "i");
const NOT_MILD = /\b(hospital|a&e|emergency|stitches|surgery|ambulance|paramedic|fracture\w*|broken bone|third.degree|scar\w*|permanent\w*|disfigur\w*|serious\w*|severe\w*)\b/i;
// words that put the injury word to a person or a body part ("a small burn on his hand"); without one the word may be a price cut or a burn mark on a carpet
const PERSON_OR_BODY = /\b(son|daughter|child|children|kid|kids|boy|girl|baby|wife|husband|partner|brother|sister|hand|hands|finger|fingers|thumb|palm|wrist|arm|arms|leg|legs|knee|elbow|foot|feet|toe|toes|face|skin|neck|shoulder|chest|me|him|her|hurt|injur\w*|wound\w*)\b/i;
// between the qualifier and the injury word, a word that makes it something else ("small price cut", "minor hair cut")
const NOT_INJURY_NOUN = /^(price|prices|pricing|discount|budget|tax|rate|rates|cost|costs|hair|paper|power|fabric|cloth|corner|corners|tax|profit|margin|staff|job|jobs)$/i;
const NEGATOR = /\b(not|no|never|none|without|isn['’]?t|wasn['’]?t|weren['’]?t|aren['’]?t|didn['’]?t|doesn['’]?t|don['’]?t|hardly|nothing)\b/i;
const negatedBefore = (t, index) => {
  const sentence = t.slice(0, index).split(/[.!?;\n]/).pop();
  return NEGATOR.test(sentence.trim().split(/\s+/).slice(-4).join(" "));
};
// An affirmative description of an actual injury to a person. Negation before the qualifier or the injury ("not a small burn"), a non-injury use of the word
// ("small price cut", "a cut in the budget") and a sentence with no person or body part in it are all not mild injuries.
export function mildInjury(text) {
  const t = String(text ?? "");
  if (LEGAL_TEXT.test(t) || NOT_MILD.test(t)) return null;
  for (const re of [new RegExp(MILD_INJURY_BEFORE.source, "gi"), new RegExp(MILD_INJURY_AFTER.source, "gi")]) {
    for (const m of t.matchAll(re)) {
      const sentence = t.slice(0, m.index).split(/[.!?;\n]/).pop() + t.slice(m.index).split(/[.!?;\n]/)[0];
      const between = m[0].split(/\s+/);
      if (between.length === 3 && NOT_INJURY_NOUN.test(between[1])) continue;
      if (negatedBefore(t, m.index)) continue;
      if (new RegExp(`\\b(?:${INJURY})\\s+(?:in|on|to|of)\\s+(?:the\\s+)?(?:price|prices|cost|budget|rate|rates|bill|tax)\\b`, "i").test(t.slice(m.index))) continue;
      if (!PERSON_OR_BODY.test(sentence)) continue;
      return m[0].replace(/\s+/g, " ").toLowerCase();
    }
  }
  return null;
}

// The courtesy reply of a legal threat: a template, no model, Support's name on it. It acknowledges and promises nothing; Legal reviews the case.
async function actLegal(tb, p) {
  const B = p.branch_id;
  const { ctx, read, severity: sev, owner, legalRoute, products } = p.data;
  skipLine(tb, "nvidia.model", `${B}: the courtesy reply is a template, no model call`);
  skipLine(tb, "critique", "template, nothing to evaluate");
  const text = tb.inputText ?? "";
  const named = ctx.skus.map((k) => (products ?? []).find((x) => x.sku === k)?.name).filter(Boolean)[0];
  const order = ORDER_ID.exec(text)?.[0];
  const situation = order ? `your order ${order.toUpperCase()}` : named ? `your ${named}` : "your order";
  // Support owns the customer: the team of the complaint owner's row; "Support" only when that row is absent
  const draft = { text: sample.frame(tb.ticket ?? tb.f, fillCourtesy({ situation }), { team: owner?.owner_team ?? "Support" }), promises: NO_PROMISES(), model: "template/courtesy" };
  const sig = signoff(tb, B, draft);
  skipLine(tb, "retry", "template: a rewrite cannot change it");
  const recommendation = "courtesy reply now, Legal reviews; the send marks follow-up";
  const escalation = { severity: sev.score, kind: read.kind, legal: true, reasoning: read.reasoning, handle: read.handle, world: ctx.provenance.map((x) => x.id) };
  const reason = `${p.why}; escalated to ${owner.owner_name ?? `employee ${owner.owner_id}`} (Support) and ${legalRoute.also.map((x) => x.name ?? x.id).join(", ") || "Legal"} (Legal), heads in copy`;
  const crit = [{ source: "Severity", reason: `severity ${sev.score}: legal threat; Legal reviews, Support sends the courtesy reply` }, ...(sig.pass ? [] : [{ source: "Risk", reason: sig.reasons.join("; ") }])];
  const who = (x) => `${x.name ?? `employee ${x.id}`} (${x.role ?? "?"}, ${x.id})`;
  const line = { output_summary: `escalated to owner ${owner.owner_id} (Support) and Legal's default owner ${legalRoute.also.map(who).join(", ") || "?"}, in copy ${legalRoute.cc.map(who).join(" and ")}; a courtesy reply is drafted, Legal reviews, the send marks follow-up; draft and critiques stored in the queue file` };
  tb.escalate(crit, reason, line, { owner, draft: sig.pass ? draft : null, recommendation, escalation, also: legalRoute.also, cc: legalRoute.cc, status: "open", courtesy_reply: true });
  return { decision: "escalate", reasons: [reason], draft: sig.pass ? draft : undefined, queued: owner, recommendation, cited: p.cited, also: legalRoute.also, cc: legalRoute.cc, status: "open", courtesy_reply: true };
}

async function actComplaint(tb, p) {
  if (p.branch_id === "complaint-legal") return actLegal(tb, p);
  const B = p.branch_id;
  const { ctx, read, severity: sev, owner, mild } = p.data;
  const severe = B === "complaint-severe";
  const messagesFn = ({ critiques }) => {
    const m = draftMessages({ ticket: tb.ticket, facts: tb.f, memoryContext: tb.memCtx, critiques });
    const last = m.length - 1;
    const extra = [`How to handle it: ${read.handle || "acknowledge and pass to the owner"}`, `The company's record of this customer: ${ctx.text}`,
      ...(mild ? [`The customer reports a minor injury (${mild}): acknowledge it plainly and say a person will follow up.`] : []),
      B === "complaint-vent" ? "The customer is venting: write a calm acknowledgement, promise nothing." : "Acknowledge the problem and say a person will follow up; promise no refund, replacement or date."].join("\n");
    m[last] = { ...m[last], content: m[last].content.replace(/Return the JSON object now\.$/, `${extra}\n\nReturn the JSON object now.`) };
    return m;
  };
  const sampleDraftFn = () => ({
    text: sample.frame(tb.ticket ?? tb.f, B === "complaint-vent"
      ? "Thank you for letting us know. We are sorry the order did not arrive as you hoped, and we have noted it."
      : sample.genuineComplaintBody(tb.ticket ?? tb.f)), // 2.1d: an injury is named (adapters/sample.mjs)
    promises: NO_PROMISES(), model: "sample/rules" });
  const r = await tb.replyLoop(tb, { messagesFn, sampleDraftFn, branch: B, hardRefusal: severe ? () => `severity ${sev.score}: a person handles it` : undefined });
  const draft = { text: r.draft.text, promises: r.draft.promises, model: r.draft.model };
  const critiques = (tb.S.rounds ?? []).flatMap((x) => [{ round: x.n, source: "Evaluator", pass: x.critique.pass, reason: x.critique.reason }, { round: x.n, source: "Risk", pass: x.risk.pass, reason: x.risk.reasons.join("; ") || "signed off" }]);
  const escalation = { severity: sev.score, kind: read.kind, reasoning: read.reasoning, handle: read.handle, world: ctx.provenance.map((x) => x.id) };
  if (severe) {
    const reason = `${p.why}; Risk refused the draft on round 1, escalated with the draft attached`;
    tb.escalate(critiques, reason, {}, { owner, draft, recommendation: read.handle, escalation });
    return { decision: "escalate", reasons: [reason], draft, queued: owner, recommendation: read.handle, cited: p.cited };
  }
  if (!r.ok) {
    const reason = r.risk.hard ? `hard fact Risk cannot rewrite: ${r.risk.reasons.join("; ")}` : `two negative rounds: ${one(r.crit.reason)} | ${r.risk.reasons.join("; ")}`;
    tb.escalate(critiques, reason, {}, { owner, draft, escalation });
    return { decision: "escalate", reasons: [reason], draft, queued: owner, cited: p.cited };
  }
  tb.skipped("escalate_or_fallback", "both critics passed; a hold waits for a person");
  const recommendation = B === "complaint-vent" ? "vent: a calm reply closes it; no action" : `${mild ? `safety report, ${mild} (self-described as mild): ` : ""}${read.handle || "a person owns this and repairs it"}`;
  return { decision: "hold", reasons: [`${p.why}. Both critics passed; the reply waits for the complaint owner with the draft attached`], draft, queued: owner, recommendation, cited: p.cited };
}

// ---- customer service (the default when nothing else fits; a person gets a head start) ----

// every amount the text names (a currency sign or code beside a number)
const amountsIn = (text) => [...String(text ?? "").matchAll(/(?:[$€£]\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:gc|usd|eur|dollars?|euros?|[$€£]))/gi)]
  .map((m) => Number(String(m[1] ?? m[2]).replace(/,(?=\d{3}\b)/g, "").replace(/[.,]$/, ""))).filter(Number.isFinite);

// the draft's blanks, completed: every marker in the text is in the list (missing ones are added, not failed)
function completeBlanks(text, listed = []) {
  const out = listed.map((b, i) => ({ id: b.id ?? `blank-${i + 1}`, what: b.what }));
  for (const w of blanks(text)) if (!out.some((b) => b.what.toLowerCase() === w.toLowerCase())) out.push({ id: `blank-${out.length + 1}`, what: w });
  return out;
}

async function probeCustomerService(tb) {
  const f = tb.f ?? {};
  const text = tb.inputText ?? "";
  const { lines, o } = buffer(tb, "customer-service");
  const collected = stampedBuffer();
  const rtrace = { line: (x) => { collected.push(x); return x; } };
  const cand = (tb.decided?.candidates ?? []).filter((c) => c.intent !== "GENERAL").slice(0, 3);
  const conf = tb.decided?.intent?.confidence ?? 0;
  const faqRows = (await tb.queries.run("faq", {}, o)).objects;
  const top = cand[0]?.intent ?? "GENERAL";
  const email = String(f.sender_email ?? "").trim();
  const { rows } = await rowsForIntent(top, email || null, { ...o, trace: rtrace });
  lines.push(...collected.map((x) => ({ ...x, branch_id: "customer-service" })));
  const cited = [...new Set(idsIn(collected))];
  // the world context, when we know who is writing
  let worldText = "", wline = "sender unknown: no world context";
  if (email) {
    const ticket = { ...(tb.ticket ?? {}), subject: f.subject ?? "", body: text, channel: f.channel, thread_id: f.thread_id, sender_email: email };
    try {
      const wrows = {};
      for (const k of ["world_threads", "products", "reviews"]) wrows[k] = (await tb.queries.run(k, {}, o)).objects;
      const dir = process.env.WORLD_MODEL_DIR;
      const worldStart = Date.now();
      const world = await getWorld({ rows: wrows, ...(dir ? { storage: "local", persistDir: dir } : {}) });
      const mentioned = mentionedProducts(text, toObjects(wrows.products)).map((p) => (typeof p === "object" ? p.sku : p));
      const ctx = complaintContext(world, { sender_email: email, skus: mentioned, thread_id: f.thread_id, channel: f.channel });
      worldText = ctx.text; wline = worldLine(world, ctx);
      lines.push({ step: "meterless.engine", agent_name: "WorldModel", action: "world_context", started_at: worldStart, sponsor: "meterless", branch_id: "customer-service",
        input_summary: `history of ${email}`, output_summary: wline, memory_ids: ctx.provenance.map((p) => p.id), status: "success" });
    } catch (e) {
      lines.push({ step: "meterless.engine", agent_name: "WorldModel", action: "world_context", input_summary: "meterless.engine failed", output_summary: `${e?.name ?? "Error"}: ${one(e?.message, 200)}`, status: "error", branch_id: "customer-service" },
        { step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after meterless.engine error", output_summary: "world context unavailable, read by text alone", status: "success", branch_id: "customer-service" });
    }
  }
  const owner = await ownerOf(tb, "customer_service", o);
  const pages = (rows.wiki ?? []).map((w) => w.page).filter(Boolean);
  const topText = cand.slice(0, 2).map((c) => `${c.intent} ${Number(c.score).toFixed(1)}`).join(", ") || "none";
  return { branch_id: "customer-service",
    why: `no intent cleared the band (confidence ${Number(conf).toFixed(2)}; top ${topText}); the FAQ (${faqRows.length} rows) was searched, no match`,
    cited: [...cited, ...(owner.looked_up ? ["responsibility:customer_service"] : [])],
    data: { candidates: cand, rows, worldText, pages, faqRows: faqRows.length, owner }, lines };
}

async function actCustomerService(tb, p) {
  const B = p.branch_id;
  const f = tb.f ?? {};
  const { candidates, rows, worldText, pages, faqRows, owner } = p.data;
  const ticket = { ...(tb.ticket ?? {}), subject: f.subject ?? tb.ticket?.subject ?? "", body: tb.inputText ?? f.body ?? "", sender_name: f.sender_name ?? tb.ticket?.sender_name };
  const limit = f.policy_limit ?? (rows.policy?.[0]?.limit_amount != null ? Number(rows.policy[0].limit_amount) : null);
  const twin = () => sample.recommendation(ticket, { candidates, pages, faqRows });
  const callLine = (model, rec, extra = {}) => {
    const { local, ...rest } = extra;
    tb.L({ step: "nvidia.model", agent_name: "Recommender", action: "recommend", ...(local ? {} : { sponsor: "nvidia" }), model, branch_id: B,
      input_summary: `recommendation and draft for ${f.thread_id ?? "ticket"}`, output_summary: `recommendation ${rec.recommendation.length} chars; draft ${rec.draft.length} chars; ${rec.blanks.length} blank(s)`, status: "success", ...rest });
  };
  const recommend = async (critiques) => {
    const messages = recommendationMessages({ ticket, facts: f, candidates, gates: tb.gates, rows, worldText, memories: tb.memCtx, critiques });
    let firstModel = null;
    try {
      let res = await tb.io.drafter(messages, { purpose: "recommendation", trace: tb.io.adapterTrace, signal: tb.io.signal });
      if (res.sample || res.text == null) { const r = twin(); callLine(r.model, r, { status: "skipped", output_summary: `sample mode: rules recommender (${r.model}), no model call` }); return { ...r, model: r.model }; }
      let rec;
      let models = null;
      try { rec = parseRecommendationJson(res.text); } catch {
        firstModel = res.model;
        res = await tb.io.drafter([...messages, { role: "assistant", content: String(res.text) }, { role: "user", content: NUDGE }], { purpose: "recommendation", trace: tb.io.adapterTrace, signal: tb.io.signal });
        models = `models: ${firstModel}, then ${res.model}`;
        rec = parseRecommendationJson(res.text);
      }
      callLine(res.model, rec, { local: res.lane === "local-lane", ...(models ? { output_summary: `recommendation ${rec.recommendation.length} chars; draft ${rec.draft.length} chars; ${rec.blanks.length} blank(s); ${models}` } : {}) });
      return { ...rec, model: res.model };
    } catch (e) {
      tb.L({ step: "nvidia.model", agent_name: "Recommender", action: "recommend", sponsor: "nvidia", branch_id: B, input_summary: "nvidia.model failed", output_summary: `${e?.name ?? "Error"}: ${one(e?.message, 200)}${firstModel ? ` (first model ${firstModel}, nudge failed)` : ""}`, status: "error" });
      tb.L({ step: "recovery", agent_name: "Planner", action: "recover", branch_id: B, input_summary: "after nvidia.model error", output_summary: "rules recommendation used", status: "success" });
      const r = twin(); callLine(r.model, r, { input_summary: "rules recommendation after the model failed" }); return r;
    }
  };
  const build = (rec) => ({ text: rec.draft, promises: NO_PROMISES(), model: rec.model, blanks: completeBlanks(rec.draft, rec.blanks) });
  const check = (draft) => {
    const hr = tb.hardRisk(f, draft);
    const reasons = [...hr.reasons];
    const bad = amountsIn(draft.text).filter((a) => limit == null || a > limit);
    if (bad.length) reasons.push(`draft names an amount (${bad.join(", ")}) ${limit == null ? "with no limit to support it" : `over the ${limit} GC limit`}`);
    return reasons;
  };
  const max = tb.maxRounds ?? 2;
  let rec = await recommend([]);
  let draft = build(rec);
  let n = 1, crit, riskReasons;
  for (;;) {
    try {
      crit = tb.sampleOn ? tb.io.sampleCritic(draft, f) : await tb.io.critic({ draft, facts: f, ticket, trace: tb.io.adapterTrace });
    } catch (e) {
      crit = { pass: false, reason: `evaluator unavailable: ${one(e?.message, 120)}`, model: "none" };
    }
    tb.S.models.evaluator = crit.model;
    tb.L({ step: "critique", agent_name: "Evaluator", action: "critique_draft", target_agent: "Planner", model: crit.model, branch_id: B, retry_count: n - 1,
      input_summary: `round ${n} draft, ${draft.text.length} chars`, output_summary: `${crit.pass ? "Pass" : "Fail"}. ${one(crit.reason)}`, status: crit.pass ? "success" : "needs_revision", memory_ids: tb.S.memRead });
    riskReasons = check(draft);
    const rpass = riskReasons.length === 0;
    tb.L({ step: "risk.signoff", agent_name: "Risk", action: "risk_signoff", sponsor: "meterless", branch_id: B, retry_count: n - 1,
      input_summary: `round ${n} draft vs facts`, output_summary: rpass ? "Signed off." : `Refused: ${riskReasons.join("; ")}`, status: rpass ? "success" : "refused" });
    tb.S.rounds.push({ n, critique: crit, risk: { pass: rpass, reasons: riskReasons, hard: !rpass } });
    if ((crit.pass && rpass) || !rpass || n >= max) break;   // a Risk refusal is hard: no second draft, the first is withheld
    const both = [`Evaluator: ${crit.reason}`, `Risk: ${riskReasons.join("; ") || "signed off"}`];
    tb.L({ step: "retry", agent_name: "Planner", action: "retry_round", target_agent: "Recommender", branch_id: B, retry_count: n, input_summary: `round ${n} negative`,
      output_summary: `${both.join(" | ")}. Next draft must fix both`, status: "retrying", memory_ids: tb.S.memRead });
    rec = await recommend(both);
    draft = build(rec);
    n += 1;
  }
  if (n === 1) skipLine(tb, "retry", "round 1 passed");
  tb.S.models.drafter = rec.model;
  const withheld = riskReasons.length > 0;
  tb.skipped("escalate_or_fallback", "customer service holds with the recommendation; nothing is escalated");
  const reasons = withheld
    ? [`draft withheld: ${one(riskReasons.join("; "), 140)}; customer service holds with the recommendation. ${p.why}`]
    : [`${p.why}. ${crit.pass ? "Both critics passed" : `Evaluator not convinced (${one(crit.reason, 80)})`}; customer service holds with the draft attached`];
  return { decision: "hold", reasons, ...(withheld ? {} : { draft }), queued: owner, recommendation: rec.recommendation, cited: p.cited };
}

// ---- product (the catalogue row answers; no model, in live mode too) ----

const unit = (v) => { const n = Number(v); return Number.isFinite(n) ? String(n) : String(v ?? ""); };
const specPairs = (specs) => String(specs ?? "").split(";").map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf("="); return i < 0 ? null : [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }).filter(Boolean);

// What the row can say about what was asked: [{ field, sentence }], composed from the row alone.
export function answerFromRow(text, row) {
  const t = String(text ?? "");
  const T = new Set(tokens(t));
  const name = row.name;
  const out = [];
  if (row.material && /\b(made of|made from|made out of|material|materials|built from|constructed)\b|\bwhat\b.*\bmade\b/i.test(t)) out.push({ field: "material", sentence: `The ${name} is made of ${row.material}.` });
  const pairs = specPairs(row.specs);
  const keyed = pairs.filter(([k]) => { const kt = tokens(k.replace(/[_-]/g, " ")); return kt.length > 0 && kt.every((w) => T.has(w)); });
  for (const [k, v] of keyed) out.push({ field: `specs.${k}`, sentence: `The ${name} ${k} is ${v}.` });
  if (!keyed.length && pairs.length && /\b(specs?|specifications?|dimensions?)\b/i.test(t)) out.push({ field: "specs", sentence: `The ${name} specifications: ${pairs.map(([k, v]) => `${k} ${v}`).join(", ")}.` });
  if (row.unit_price !== undefined && row.unit_price !== "" && /\b(price|priced|cost|costs|how much)\b/i.test(t)) out.push({ field: "unit_price", sentence: `The ${name} costs ${unit(row.unit_price)} ${row.currency || "GC"}.` });
  if (row.lead_days !== undefined && row.lead_days !== "" && /\blead\b|how long (does|will|would|is the wait|to (ship|arrive|get))|take to (ship|arrive)|how (many days|soon)/i.test(t)) out.push({ field: "lead_days", sentence: `The ${name} has a lead time of ${unit(row.lead_days)} days.` });
  return out;
}

// Every thing the customer asked about, split into the parts the row answers and the parts it does not (Codex review 13).
// A clause that asks something (a question word or auxiliary first) and that answerFromRow cannot answer from the row is unanswered:
// "waterproof", "colour", "size" ... map to no column or spec key, so they are never silently dropped from a reply that answers the rest.
const ASKS = /^(?:and\s+|also\s+|but\s+|plus\s+)?(?:is|are|was|does|do|did|can|could|will|would|has|have|what|what's|whats|which|how|where|when|who)\b/i;
export function requestedAttributes(text, row) {
  const answers = answerFromRow(text, row);
  const nameToks = new Set(tokens(row?.name ?? ""));
  const clauses = String(text ?? "").split(/[?.;!,]|\band\b|\bbut\b|\bplus\b|\bas well as\b/i).map((c) => c.trim()).filter(Boolean);
  const unanswered = [];
  for (const c of clauses) {
    if (!ASKS.test(c)) continue;
    if (answerFromRow(c, row).length) continue;
    // a clause whose only content is the product's name or a pronoun asks nothing more
    if (!tokens(c).some((w) => !nameToks.has(w))) continue;
    unanswered.push(c);
  }
  return { answers, unanswered };
}

async function probeProduct(tb) {
  const text = tb.inputText ?? "";
  const { lines: ro, o } = buffer(tb, null);
  const lookup = (await tb.queries.run("product_lookup", {}, o)).objects;
  const m = matchProductLookup(text, lookup);
  const fin = (branch_id, why, cited, data) => ({ branch_id, why, cited, data, lines: ro.map((x) => ({ ...x, branch_id })) });
  if (!m.hit) {
    const owner = await ownerOf(tb, "product", o);
    return fin("product-unanswered", m.ambiguous.length ? `the question fits more than one product (${m.ambiguous.join(", ")}); not in the catalogue row of any one of them` : "no product in the catalogue matches the question; not in the catalogue row",
      owner.looked_up ? ["responsibility:product"] : [], { owner, sku: null, answers: [] });
  }
  const sku = m.hit.row.sku;
  const row = (await tb.queries.run("product_by_sku", { sku }, o)).objects[0];
  const { answers, unanswered } = row ? requestedAttributes(text, row) : { answers: [], unanswered: [] };
  if (answers.length && unanswered.length) {
    // part of the question is in the row, part is not: nothing is sent; the owner answers the whole question
    const owner = await ownerOf(tb, "product", o);
    return fin("product-unanswered", `${row.name} is in the catalogue (products:${sku}) and the row answers ${answers.map((a) => a.field).join(", ")}, but not everything asked: ${unanswered.map((u) => `"${one(u, 80)}"`).join("; ")} is not in the catalogue row`,
      [`products:${sku}`, ...(owner.looked_up ? ["responsibility:product"] : [])], { owner, sku, answers: [], rowAnswers: answers.map((a) => a.field), unanswered });
  }
  if (answers.length) {
    return fin("product-hit", `the catalogue row products:${sku} (${row.name}, matched by ${m.hit.via}) answers it: ${answers.map((a) => a.field).join(", ")}; composed from the row, no model call`,
      [`products:${sku}`], { sku, row, answers, owner: null });
  }
  const owner = await ownerOf(tb, "product", o);
  return fin("product-unanswered", `${row?.name ?? sku} is in the catalogue (products:${sku}), but no field of its row answers what was asked`,
    [`products:${sku}`, ...(owner.looked_up ? ["responsibility:product"] : [])], { owner, sku, answers: [] });
}

async function actProduct(tb, p) {
  const B = p.branch_id;
  if (B === "product-hit") {
    skipLine(tb, "nvidia.model", "product-hit: the answer is composed from the catalogue row, no model call");
    skipLine(tb, "critique", "composed from the row, nothing to evaluate");
    const body = p.data.answers.map((a) => a.sentence).join(" ");
    // sent for the team of the product owner's row; "Product" only when that row is absent (last-resort fallback)
    const owner = await ownerOf(tb, "product", { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
    const team = owner.owner_team ?? "Product";
    const draft = { text: sample.frame(tb.ticket ?? tb.f, body, { team, onBehalf: true }), promises: NO_PROMISES(), model: "catalogue/row" };
    const sig = signoff(tb, B, draft);
    skipLine(tb, "retry", "composed from the row: a rewrite cannot change it");
    if (!sig.pass) {
      tb.escalate([{ source: "Risk", reason: sig.reasons.join("; ") }], `product answer not signed off: ${sig.reasons.join("; ")}`, {}, { owner, draft });
      return { decision: "escalate", reasons: sig.reasons, draft, queued: owner, cited: p.cited };
    }
    tb.skipped("escalate_or_fallback", "product answer sent; nothing to escalate");
    return { decision: "send", reasons: [p.why], draft, cited: p.cited, auto_reply: true, team };
  }
  skipLine(tb, "nvidia.model", "product-unanswered: no draft");
  skipLine(tb, "critique", "product-unanswered: no draft to critique");
  skipLine(tb, "risk.signoff", "product-unanswered: nothing to sign");
  skipLine(tb, "retry", "product-unanswered: a rewrite cannot change it");
  tb.skipped("escalate_or_fallback", "the product owner answers; nothing is escalated");
  const recommendation = `not in the catalogue row${p.data.sku ? ` of ${p.data.sku}` : ""}${p.data.unanswered?.length ? ` (${p.data.unanswered.map((u) => `"${one(u, 80)}"`).join("; ")}; the row does answer ${p.data.rowAnswers.join(", ")})` : ""}; the product owner answers the customer`;
  return { decision: "hold", reasons: [`${p.why}. Held for the product owner, no draft`], queued: p.data.owner, recommendation, cited: p.cited };
}

// ---- delivery (the order and the planet's shipping rule answer) ----

async function probeDelivery(tb) {
  const text = tb.inputText ?? "";
  const { lines: ro, o } = buffer(tb, null);
  const order_id = (ORDER_ID.exec(text)?.[0] ?? String(tb.decided?.parameters?.id ?? "")).toUpperCase();
  const fin = (branch_id, why, cited, data) => ({ branch_id, why, cited, data, lines: ro.map((x) => ({ ...x, branch_id })) });
  const order = /^JP-\d{4}$/.test(order_id) ? (await tb.queries.run("order", { order_id }, o)).objects[0] : undefined;
  if (!order) {
    const owner = await ownerOf(tb, "delivery", o);
    return fin("delivery-unknown", `order ${order_id || "(none)"} is not in the records; a person checks it`, owner.looked_up ? ["responsibility:delivery"] : [], { order_id, owner });
  }
  // The order answers only its own customer: the sender's email must be the email of the order's customer.
  // Anyone else gets a hold for a person, with nothing of the order (status, planet, rule) in the reasons, the trace or the output.
  const sender = String(tb.f?.sender_email ?? "").trim().toLowerCase();
  let owns = false;
  if (sender && order.customer_id) {
    const c = (await tb.queries.run("customer_by_email", { email: sender }, o)).objects;
    owns = c.some((x) => String(x.customer_id) === String(order.customer_id));
  }
  if (!owns) {
    const owner = await ownerOf(tb, "customer_service", o);
    // the order lookup's trace line carries the row's own words (quantity, status, planet) in `detail`: it is dropped here, the id line stays
    for (let i = 0; i < ro.length; i++) if (ro[i].action === "sql:order") { const { detail, ...rest } = ro[i]; ro[i] = rest; }
    return fin("delivery-not-owner", `order ${order_id} does not belong to the sender; a person checks it, nothing about the order is sent`, owner.looked_up ? ["responsibility:customer_service"] : [], { order_id, owner });
  }
  const planet = String(order.shipping_planet ?? "");
  const rule = planet ? (await tb.queries.run("shipping_rule", { planet }, o)).objects[0] : undefined;
  const cited = [`orders:${order.order_id}`, ...(rule ? [`shipping_rules:${rule.planet}`] : [])];
  const suspended = String(rule?.status ?? "").toLowerCase() === "suspended";
  return fin(suspended ? "delivery-suspended" : "delivery-status",
    suspended ? `order ${order.order_id} ships to ${planet}, where deliveries are suspended (shipping_rules:${rule.planet}); the rule's note answers it` : `order ${order.order_id} is ${order.status}, shipping to ${planet}${rule ? ` (rule ${rule.planet}: ${rule.status})` : ""}`,
    cited, { order, rule, planet });
}

async function actDelivery(tb, p) {
  const B = p.branch_id;
  if (B === "delivery-unknown") {
    skipLine(tb, "nvidia.model", "delivery-unknown: no draft");
    skipLine(tb, "critique", "delivery-unknown: no draft to critique");
    skipLine(tb, "risk.signoff", "delivery-unknown: nothing to sign");
    skipLine(tb, "retry", "delivery-unknown: a rewrite cannot change it");
    tb.skipped("escalate_or_fallback", "the delivery owner checks the order; nothing is escalated");
    return { decision: "hold", reasons: [`${p.why}. Held for the delivery owner, no draft`], queued: p.data.owner, recommendation: `order ${p.data.order_id || "(none)"} not found; ask the customer for the order reference`, cited: p.cited };
  }
  if (B === "delivery-not-owner") {
    skipLine(tb, "nvidia.model", "delivery-not-owner: no draft");
    skipLine(tb, "critique", "delivery-not-owner: no draft to critique");
    skipLine(tb, "risk.signoff", "delivery-not-owner: nothing to sign");
    skipLine(tb, "retry", "delivery-not-owner: a rewrite cannot change it");
    tb.skipped("escalate_or_fallback", "Support checks the sender against the order; nothing is escalated");
    return { decision: "hold", reasons: [`${p.why}. Held for Support, no draft`], queued: p.data.owner, recommendation: `the sender is not the customer on order ${p.data.order_id}; Support checks who is asking before anything about the order is shared`, cited: p.cited, ...(await teamOf(tb, p.data.owner)) };
  }
  const { order, rule, planet } = p.data;
  skipLine(tb, "nvidia.model", `${B}: the answer is composed from the order and the shipping rule, no model call`);
  skipLine(tb, "critique", "composed from the rows, nothing to evaluate");
  const note = String(rule?.note ?? "").trim();
  const body = B === "delivery-suspended"
    ? `${note || `Deliveries to ${planet} are currently suspended.`} Your order ${order.order_id} is held for now; our team will contact you as soon as deliveries to ${planet} resume.`
    : `Your order ${order.order_id} is currently ${order.status}, shipping to ${planet}.${note ? ` ${note}` : ""}`;
  // sent for the team of the customer_service owner's row; "Support" only when that row is absent
  const ownerHint = await ownerOf(tb, "customer_service", { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
  const team = ownerHint.owner_team ?? "Support";
  const draft = { text: sample.frame(tb.ticket ?? tb.f, body, { team, onBehalf: true }), promises: NO_PROMISES(), model: "orders/rows" };
  const sig = signoff(tb, B, draft);
  skipLine(tb, "retry", "composed from the rows: a rewrite cannot change it");
  if (!sig.pass) {
    const owner = await ownerOf(tb, "delivery", { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
    tb.escalate([{ source: "Risk", reason: sig.reasons.join("; ") }], `delivery answer not signed off: ${sig.reasons.join("; ")}`, {}, { owner, draft });
    return { decision: "escalate", reasons: sig.reasons, draft, queued: owner, cited: p.cited };
  }
  tb.skipped("escalate_or_fallback", "delivery answer sent; nothing to escalate");
  return { decision: "send", reasons: [p.why], draft, cited: p.cited, auto_reply: true, team, ownerHint };
}

// ---- other (the FAQ first, else a person; never a guess) ----

async function probeOther(tb) {
  const text = tb.inputText ?? "";
  const { lines: ro, o } = buffer(tb, null);
  const faqRows = (await tb.queries.run("faq", {}, o)).objects;
  const hit = matchFaq(text, faqRows);
  if (hit) {
    return { branch_id: "faq-hit", why: `FAQ ${hit.row.faq_id} matches (score ${hit.score.toFixed(2)}, shared: ${hit.shared.join(", ")}); FAQ text is canonical, the floor gates model drafts`,
      cited: [`faq:${hit.row.faq_id}`], data: { faq: hit, faqRows: faqRows.length }, lines: ro.map((x) => ({ ...x, branch_id: "faq-hit" })) };
  }
  const owner = await ownerOf(tb, "other", o);
  return { branch_id: "other-unanswered", why: `nothing in the records answers this; checked the FAQ (${faqRows.length} rows), no match`,
    cited: owner.looked_up ? ["responsibility:other"] : [], data: { owner, faqRows: faqRows.length }, lines: ro.map((x) => ({ ...x, branch_id: "other-unanswered" })) };
}

async function actOther(tb, p) {
  if (p.branch_id === "faq-hit") return actFaqHit(tb, p);
  skipLine(tb, "nvidia.model", "other-unanswered: no draft");
  skipLine(tb, "critique", "other-unanswered: no draft to critique");
  skipLine(tb, "risk.signoff", "other-unanswered: nothing to sign");
  skipLine(tb, "retry", "other-unanswered: a rewrite cannot change it");
  tb.skipped("escalate_or_fallback", "a person answers; nothing is escalated");
  return { decision: "hold", reasons: [`${p.why}. Held for the owner, no draft`], queued: p.data.owner, recommendation: "nothing in the records answers this; a person replies", cited: p.cited, ...(await teamOf(tb, p.data.owner)) };
}

export const handleCustomerService = { probe: probeCustomerService, act: actCustomerService };

export const handleComplaint = { probe: probeComplaint, act: actComplaint };

export const handleQuestion = { probe: probeQuestion, act: actQuestion };
export const handleRfq = { probe: probeRfq, act: actRfq };
export const handleProduct = { probe: probeProduct, act: actProduct };
export const handleDelivery = { probe: probeDelivery, act: actDelivery };
export const handleOther = { probe: probeOther, act: actOther };
export const HANDLERS = { question: handleQuestion, rfq: handleRfq, complaint: handleComplaint, customer_service: handleCustomerService, product: handleProduct, delivery: handleDelivery, other: handleOther };

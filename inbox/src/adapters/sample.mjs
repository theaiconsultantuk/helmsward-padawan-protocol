// Deterministic no-network stand-ins for Zetaris queries, the drafter, the critics and the gates.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../config.mjs";
import { readCsv } from "../csv.mjs";
import { intakeRefundRows, readIntake } from "../intake.mjs";
import { runLocal } from "../queries.mjs";
import { ACKNOWLEDGEMENT_TEMPLATE, SEVERITY_LEVELS, refundRuleReason, signOff } from "../prompts.mjs";

const MODEL = "sample/rules";

export function sampleDir(cfg = config()) {
  return cfg.SAMPLE_DIR ?? `${INBOX_ROOT}/data/sample`;
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// The SQL's second prior_refunds branch counts the RUNTIME intake refunds (data/runtime/intake.csv) with the same rules as the stored threads.
// Merge them into an offline answer (idempotent: a thread already in the rows is not added twice); no file or no runtimeDir = unchanged.
export function withRuntimeRefunds(r, params, runtimeDir) {
  if (!runtimeDir || !r) return r;
  let intake = [];
  try { intake = readIntake({ runtimeDir }); } catch { return r; } // an unreadable file is no evidence
  const add = intakeRefundRows(intake, params);
  if (!add.length) return r;
  const have = new Set((r.rows ?? []).map((x) => `${x[2] ?? "threads_json"}:${x[0]}`));
  const rows = [...(r.rows ?? []), ...add.filter((x) => !have.has(`${x[2]}:${x[0]}`))]
    .sort((x, y) => Date.parse(x[1]) - Date.parse(y[1]) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return { ...r, headers: r.headers?.length ? r.headers : ["thread_id", "received_at", "src"], rows, total: rows.length };
}

// The holiday table as the offline twin reads it: the synthetic CSV beside the sample dir (cfg.SYNTHETIC_DIR overrides), or null when absent.
function holidayCsv(cfg) {
  const f = join(cfg.SYNTHETIC_DIR ?? join(sampleDir(cfg), "..", "synthetic"), "holiday-2026.csv");
  return existsSync(f) ? readCsv(f) : null;
}

// opts.runtimeDir (optional): also count that dir's runtime intake refunds in prior_refunds, as the SQL does.
export function queryByName(name, params = {}, { cfg = config(), runtimeDir } = {}) {
  if (typeof name !== "string" || !/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`bad query name: ${JSON.stringify(name)}`);
  const entries = JSON.parse(readFileSync(`${sampleDir(cfg)}/${name}.json`, "utf8"));
  const exact = entries.find((e) => same(e.params ?? {}, params));
  if (!exact && name === "holiday") {
    // No cached pair: derive the answer as live would. Through the holiday template's own local() on the CSV (company-wide rows, all four columns);
    // without the CSV, from the cached full table by the same rule (a blank employee_id is a company-wide day).
    const csv = holidayCsv(cfg);
    if (csv) {
      try { return { ...runLocal("holiday", params, { holiday_2026: csv }), timeUsed: 0 }; } catch (e) { if (!(e instanceof TypeError)) throw e; }
    }
    const all = JSON.parse(readFileSync(`${sampleDir(cfg)}/holidays.json`, "utf8")).find((e) => same(e.params ?? {}, {}));
    const src = all?.result ?? {};
    const rows = (src.rows ?? src.data ?? []).filter((r) => (r[0] === null || r[0] === undefined || r[0] === "" || String(r[0]) === String(params.employee_id)) && r[1] === params.date);
    return { headers: src.headers ?? ["employee_id", "date"], rows, total: rows.length, timeUsed: 0 };
  }
  // The new exhaustive caches (CP1) answer what live answers for a key they were not asked about, instead of failing:
  const lc = (v) => String(v ?? "").toLowerCase();
  const shape = (src, rows) => ({ headers: src?.headers ?? [], rows, total: rows.length, timeUsed: 0 });
  if (!exact && name === "prior_refunds") {
    // A new intake has its own thread id and time: take the sender's SENTINEL entry (all their refund threads, thread F0, year 2099)
    // and apply the SQL's filter: a different thread, received strictly before this one. No sentinel = no refund thread = no rows.
    const all = entries.find((e) => lc(e.params?.email) === lc(params.email) && e.params?.thread_id === "F0")?.result;
    const rows = (all?.rows ?? []).filter((r) => r[0] !== params.thread_id && Date.parse(r[1]) < Date.parse(params.received_at));
    return withRuntimeRefunds({ ...shape(all ?? entries[0]?.result, rows), headers: (all ?? entries[0]?.result)?.headers ?? ["thread_id", "received_at", "src"] }, params, runtimeDir);
  }
  if (!exact && name === "shipping_rule") {
    const own = entries.find((e) => lc(e.params?.planet) === lc(params.planet)) ?? entries.find((e) => e.params?.planet === "default");
    if (own) return shape(own.result, own.result.rows ?? []);
  }
  if (!exact && ["customer_by_email", "order", "hierarchy", "team_head", "product_by_sku", "bom"].includes(name)) {
    const ci = entries.find((e) => same(Object.fromEntries(Object.entries(e.params ?? {}).map(([k, v]) => [k, lc(v)])), Object.fromEntries(Object.entries(params).map(([k, v]) => [k, lc(v)]))));
    return shape((ci ?? entries.find((e) => e.result?.headers?.length))?.result, ci ? ci.result.rows : []); // an unknown key: zero rows, as live
  }
  if (exact && name === "prior_refunds" && runtimeDir) return withRuntimeRefunds({ ...exact.result, rows: exact.result.rows ?? [], timeUsed: 0 }, params, runtimeDir);
  const hit = exact
    ?? entries.find((e) => same(e.params ?? {}, {}));
  if (!hit) throw new Error(`no cached rows for ${name} ${JSON.stringify(canon(params))}`);
  const r = hit.result ?? {};
  const rows = r.rows ?? r.data ?? [];
  return { headers: r.headers ?? [], rows, total: r.total ?? rows.length, timeUsed: 0 };
}

// What a draft may quote back to the customer: a real subject as it is, or, when the subject is only the start of the message
// (a free-text intake derives it), the customer's whole first sentence. Never a cut text: a long sentence, or a subject that was
// cut with no message to complete it, is not quoted at all.
const QUOTE_MAX = 120;
export function quotable(ticket) {
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const subject = clean(ticket?.subject);
  const body = clean(ticket?.body);
  const stem = subject.replace(/\u2026$/, "").trim();
  const derived = Boolean(stem) && Boolean(body) && body.startsWith(stem) && (subject !== stem || body.length > stem.length);
  let text = subject;
  if (derived) {
    // A sentence boundary is certain only when the word before the full stop is not an abbreviation or an initial ("Mr.", "Dr.", "St.", "e.g.", "J.").
    // When it is not certain, the whole message is quoted if it fits the limit, else nothing (the length check below).
    const ABBR = /^(?:mr|mrs|ms|mx|dr|prof|st|sr|jr|vs|etc|no|nr|inc|ltd|co|fig|approx|e\.g|i\.e|a\.m|p\.m)$/i;
    const re = /([^\s]*?)([.!?])(?=\s|$)/g;
    let end = -1, uncertain = false, m;
    while ((m = re.exec(body))) {
      const word = m[1].replace(/^[("'\u201c]+/, "");
      if (m[2] === "." && (ABBR.test(word) || /^[A-Za-z]$/.test(word))) { uncertain = true; break; }
      end = m.index + m[0].length;
      break;
    }
    text = uncertain || end < 0 ? body : body.slice(0, end);
  } else if (subject.endsWith("\u2026")) return null;
  text = text.replace(/[.!?]+$/, "").trim();
  return text && text.length <= QUOTE_MAX ? text : null;
}

const REFUND = /refund|money back|my money|reimburse/i;
const REPLACE = /replacement|replace|broken|damaged|cracked/i;

// opts.overLimit (true when the refund is over the policy limit; 2.1d wires it from the loop): the draft says the request is
// routed for approval and promises no refund, amount or date.
export function draft(ticket, facts, { seed = "correct", overLimit = false, thanksRequest = false } = {}) {
  const cat = facts.category ?? ticket.category;
  // The rows the draft rests on travel in the result's cited_rows and the trace, never in the customer's text (a draft printed "holiday_2026:15@2026-10-22" to a customer; Dean, 24 Oct).
  const hi = `Hello${ticket.sender_name ? ` ${ticket.sender_name}` : ""},`;
  // an over-limit reply never quotes the subject: a free-text subject is the body's first 60 characters and can carry the amount or a date
  const quoted = overLimit ? null : quotable(ticket);
  const ask = thanksRequest ? "Thank you for your kind words." : overLimit ? "Thank you for your message." : quoted ? `You wrote about "${quoted}".` : "Thank you for your message.";
  const promises = { refund_amount: null, replacement: false, other: null };
  let mid;
  if (thanksRequest) {
    mid = "You also asked us for something, and we have passed it on: a colleague will look at it and come back to you.";
  } else if (overLimit && (cat === "refund" || seed === "revised")) {
    mid = "Your refund request is routed for approval. We are not promising an amount or a date yet, and a colleague will follow up with you.";
  } else if (seed === "revised") {
    const lim = facts.policy_limit == null ? "We are not promising anything today" : `We cannot approve an amount above our limit of ${facts.policy_limit} GC, so we are not promising it today`;
    mid = `${lim}. ${facts.backup ?? "A colleague"} will follow up with you.`;
  } else if (seed === "misread" && cat === "replacement") {
    promises.refund_amount = ticket.amount ?? null;
    mid = ticket.amount == null ? "We are looking into your refund request." : `We will refund ${ticket.amount} GC.`;
  } else if (cat === "refund") {
    promises.refund_amount = ticket.amount ?? null;
    mid = ticket.amount == null ? "We are looking into your refund request." : `We will refund ${ticket.amount} GC.`;
  } else if (cat === "replacement") {
    promises.replacement = true;
    mid = "We will send you a replacement.";
  } else {
    mid = "Thank you for getting in touch.";
  }
  return { text: frame(ticket, `${ask} ${mid}`), model: MODEL, route: "sample", promises };
}

// The body of a genuine-complaint sample draft, composed from the ticket: an injury is named and taken seriously; anything else
// keeps the generic apology. No refund, replacement, amount or date is promised either way.
const INJURY = /\b(burn(?:t|ed|s)?|injur(?:y|ed|ies)|hurt|cut|shock(?:ed)?|bruis(?:e|ed)|blister(?:s|ed)?|sting|fire|smoke|hospital)\b/i;
const NOUN = { burnt: "burn", burned: "burn", burns: "burn", injured: "injury", injuries: "injury", shocked: "shock", bruised: "bruise", blisters: "blister", blistered: "blister" };
export function genuineComplaintBody(ticket) {
  const m = INJURY.exec(`${ticket?.subject ?? ""} ${ticket?.body ?? ""}`);
  if (!m) return "Thank you for telling us, and we are sorry. This matters to us, and a colleague will look at it personally and come back to you.";
  const w = m[1].toLowerCase();
  const what = NOUN[w] ?? w;
  return `We are very sorry to hear about the ${what}. We take product safety seriously, and our Support team will contact you personally about it.`;
}

export function critique(d, facts) {
  const rr = refundRuleReason(facts, d);
  if (rr) return { pass: false, reason: rr, model: MODEL };
  const amt = d.promises?.refund_amount;
  if (typeof amt === "number" && facts.policy_limit == null) {
    return { pass: false, reason: `promises a refund of ${amt} GC with no policy limit behind it`, model: MODEL };
  }
  if (typeof amt === "number" && amt > facts.policy_limit) {
    return { pass: false, reason: `promises a refund above the limit in policy row ${(facts.cited_rows ?? [])[0] ?? "?"}: ${amt} > ${facts.policy_limit} GC`, model: MODEL };
  }
  const low = String(d.text ?? "").toLowerCase();
  const leak = (facts.restricted_terms ?? []).find((t) => t && low.includes(String(t).toLowerCase()));
  if (leak) return { pass: false, reason: `names a fact that may not leave: ${leak}`, model: MODEL };
  if (facts.owner_out && facts.backup_out) return { pass: false, reason: "nobody available: owner and backup are both out", model: MODEL };
  return { pass: true, reason: "within limit, nothing restricted, someone available", model: MODEL };
}

export function gates(ticket) {
  const text = `${ticket.subject ?? ""} ${ticket.body ?? ""}`;
  const money = REFUND.test(text) || /\$|\bgc\b|usd|eur|\bcharge/i.test(text) && /refund|back/i.test(text);
  let category = { choice: "question", confidence: 0.5 };
  if (REFUND.test(text)) category = { choice: "refund", confidence: 0.5 };
  else if (REPLACE.test(text)) category = { choice: "replacement", confidence: 0.5 };
  else if (/thank|thanks|love/i.test(text)) category = { choice: "appreciation", confidence: 0.5 };
  else if (/\?|\b(how|when|where)\b/i.test(text)) category = { choice: "question", confidence: 0.5 };
  else if (/disappointed|unacceptable|angry|furious/i.test(text)) category = { choice: "complaint", confidence: 0.5 };
  const angry = /disappointed|unacceptable|angry|furious/i.test(text);
  const followUp = Boolean(ticket.follow_up_kind) || /earlier reply|your last email|you said/i.test(text);
  return {
    answers: {
      is_follow_up: followUp ? 0.9 : 0.1,
      category,
      urgency: { score: /urgent|asap|today|immediately/i.test(text) ? 4 : 2, legend: "1 low .. 5 critical" },
      tone: { score: angry ? 4 : 2, legend: "1 calm .. 5 hostile" },
      asks_for_money: money ? 0.9 : 0.1,
    },
    model: MODEL, gate_source: "rules", confidence: 0.5,
  };
}

// The ONE greeting and sign-off every sample reply wears. team defaults to Support; onBehalf adds the automatic-reply line, and is
// only for replies composed from rows (never model drafts, which a human sends).
export function frame(ticket, body, { team = "Support", onBehalf = false } = {}) {
  const sign = signOff(team);
  return `Hello${ticket?.sender_name ? ` ${ticket.sender_name}` : ""},\n\n${body}\n\n${sign}${onBehalf ? `\nSent automatically on behalf of the ${team} team.` : ""}`;
}

// The RFQ acknowledgement: ACKNOWLEDGEMENT_TEMPLATE filled with the quantities. Code, no model call; never a price.
export function acknowledgement(ticket, { quantities = [] } = {}) {
  const q = quantities.map(String);
  const said = q.length === 0 ? "the quantity you asked about" : q.length === 1 ? q[0] : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`;
  return { text: frame(ticket, ACKNOWLEDGEMENT_TEMPLATE.replace("{quantities}", said)), model: "template/acknowledgement", route: "template", promises: { refund_amount: null, replacement: false, other: null } };
}

// Complaint handler twins (S2.2): deterministic keyword reads.
export function complaintRead(ticket, { worldText = "" } = {}) {
  const text = `${ticket?.subject ?? ""} ${ticket?.body ?? ""}`;
  const genuine = /unacceptable|never again|lawyer|review|public|twice|again|everyone/i.test(text);
  return {
    kind: genuine ? "genuine" : "vent",
    face_risk: genuine,
    reasoning: genuine ? "The message names a concrete failure, a repeat or a public audience." : "The customer is upset but names no concrete harm to repair.",
    handle: genuine ? "A person should own this, repair the failure and answer the customer directly." : "A calm acknowledgement is enough; there is nothing to repair.",
    model: "sample/rules",
  };
}

// The legal read in code: only the words of a legal threat (injury alone is not one).
export const LEGAL_WORDS = /lawyer|attorney|legal action|sue\b|court/i;
export const legalThreat = (ticket) => LEGAL_WORDS.test(`${ticket?.subject ?? ""} ${ticket?.body ?? ""}`);

// Injury is split from legal (auditor fold 3): legal words score 10; injury alone is a genuine 6 that holds with a draft; the
// public-channel and repeat bumps are capped at 8 so a plain Trustpilot complaint never escalates by channel alone.
export function severity(ticket, { kind = "vent", repeat = false, publicChannel = false } = {}) {
  const text = `${ticket?.subject ?? ""} ${ticket?.body ?? ""}`;
  const legal = legalThreat(ticket);
  const pub = publicChannel || kind === "channel_public";
  let score;
  if (/lawyer|attorney|legal|sue\b|court|unsafe/i.test(text)) score = 10;
  else if (/never again|everyone/i.test(text)) score = 9;
  else {
    score = /injur|cut|hurt|burn|furious|disgusting|worst|terrible/i.test(text) ? 6 : /annoyed|disappointed/i.test(text) ? 4 : 3;
    if (pub) score += 4;
    if (repeat) score += 2;
    score = Math.min(8, score);
  }
  score = Math.max(1, Math.min(10, score));
  return { score, legend: SEVERITY_LEVELS[score - 1], legal };
}

// Customer-service twin (S3.1): a rules recommendation and a draft with two [[blank: …]] markers. No model call.
export function recommendation(ticket, { candidates = [], pages = [], faqRows = 0 } = {}) {
  const top = candidates.slice(0, 3).map((c) => `${c.intent} (${Number(c.score).toFixed(1)})`).join(", ") || "none";
  const seen = pages.length ? `see the wiki page${pages.length === 1 ? "" : "s"} ${pages.map((p) => `"${p}"`).join(", ")}` : "no wiki page applies";
  const text = `${ticket?.subject ?? ""} ${ticket?.body ?? ""}`;
  const address = /address/i.test(text);
  const body = address
    ? "Thank you for getting in touch. A colleague will look at your order [[blank: order number]] and, once it is checked, update the delivery address to [[blank: new delivery address]]."
    : "Thank you for getting in touch. A colleague will look at your order [[blank: order number]] and come back to you about [[blank: what the customer wants changed]].";
  const ds = [...body.matchAll(/\[\[blank:\s*([^\]]*?)\s*\]\]/g)].map((m, i) => ({ id: `blank-${i + 1}`, what: m[1] }));
  return {
    recommendation: `no clear intent; top candidates ${top}; nothing in the FAQ${faqRows ? ` (${faqRows} rows searched)` : ""}; ${seen}. A person confirms the order and what the customer wants changed, then finishes the draft.`,
    draft: frame(ticket, body), blanks: ds, model: "sample/rules",
  };
}

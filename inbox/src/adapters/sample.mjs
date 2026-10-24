// Deterministic no-network stand-ins for Zetaris queries, the drafter, the critics and the gates.
import { readFileSync } from "node:fs";
import { config, INBOX_ROOT } from "../config.mjs";
import { ACKNOWLEDGEMENT_TEMPLATE, SEVERITY_LEVELS, refundRuleReason } from "../prompts.mjs";

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

export function queryByName(name, params = {}, { cfg = config() } = {}) {
  if (typeof name !== "string" || !/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`bad query name: ${JSON.stringify(name)}`);
  const entries = JSON.parse(readFileSync(`${sampleDir(cfg)}/${name}.json`, "utf8"));
  const exact = entries.find((e) => same(e.params ?? {}, params));
  if (!exact && name === "holiday") {
    // No cached pair: derive the per-employee answer from the full table, as live would.
    const all = JSON.parse(readFileSync(`${sampleDir(cfg)}/holidays.json`, "utf8")).find((e) => same(e.params ?? {}, {}));
    const src = all?.result ?? {};
    const rows = (src.rows ?? src.data ?? []).filter((r) => String(r[0]) === String(params.employee_id) && r[1] === params.date);
    return { headers: src.headers ?? ["employee_id", "date"], rows, total: rows.length, timeUsed: 0 };
  }
  const hit = exact
    ?? entries.find((e) => same(e.params ?? {}, {}));
  if (!hit) throw new Error(`no cached rows for ${name} ${JSON.stringify(canon(params))}`);
  const r = hit.result ?? {};
  const rows = r.rows ?? r.data ?? [];
  return { headers: r.headers ?? [], rows, total: r.total ?? rows.length, timeUsed: 0 };
}

const REFUND = /refund|money back|my money|reimburse/i;
const REPLACE = /replacement|replace|broken|damaged|cracked/i;

export function draft(ticket, facts, { seed = "correct" } = {}) {
  const cat = facts.category ?? ticket.category;
  const rows = (facts.cited_rows ?? []).join(", ");
  const cite = rows ? ` (policy rows: ${rows})` : "";
  const hi = `Hello${ticket.sender_name ? ` ${ticket.sender_name}` : ""},`;
  const ask = `You wrote about "${ticket.subject}".`;
  const promises = { refund_amount: null, replacement: false, other: null };
  let mid;
  if (seed === "revised") {
    const lim = facts.policy_limit_usd == null ? "We are not promising anything today" : `We cannot approve an amount above our limit of ${facts.policy_limit_usd} USD${cite}, so we are not promising it today`;
    mid = `${lim}${facts.policy_limit_usd == null ? cite : ""}. ${facts.backup ?? "A colleague"} will follow up with you.`;
  } else if (seed === "misread" && cat === "replacement") {
    promises.refund_amount = ticket.amount_usd ?? null;
    mid = ticket.amount_usd == null ? `We are looking into your refund request${cite}.` : `We will refund ${ticket.amount_usd} USD${cite}.`;
  } else if (cat === "refund") {
    promises.refund_amount = ticket.amount_usd ?? null;
    mid = ticket.amount_usd == null ? `We are looking into your refund request${cite}.` : `We will refund ${ticket.amount_usd} USD${cite}.`;
  } else if (cat === "replacement") {
    promises.replacement = true;
    mid = `We will send you a replacement${cite}.`;
  } else {
    mid = `Thank you for getting in touch${cite}.`;
  }
  return { text: `${hi}\n\n${ask} ${mid}\n\nBest regards,\nJedi Pack Support`, model: MODEL, route: "sample", promises };
}

export function critique(d, facts) {
  const rr = refundRuleReason(facts, d);
  if (rr) return { pass: false, reason: rr, model: MODEL };
  const amt = d.promises?.refund_amount;
  if (typeof amt === "number" && facts.policy_limit_usd == null) {
    return { pass: false, reason: `promises a refund of ${amt} USD with no policy limit behind it`, model: MODEL };
  }
  if (typeof amt === "number" && amt > facts.policy_limit_usd) {
    return { pass: false, reason: `promises a refund above the limit in policy row ${(facts.cited_rows ?? [])[0] ?? "?"}: ${amt} > ${facts.policy_limit_usd} USD`, model: MODEL };
  }
  const low = String(d.text ?? "").toLowerCase();
  const leak = (facts.restricted_terms ?? []).find((t) => t && low.includes(String(t).toLowerCase()));
  if (leak) return { pass: false, reason: `names a fact that may not leave: ${leak}`, model: MODEL };
  if (facts.owner_out && facts.backup_out) return { pass: false, reason: "nobody available: owner and backup are both out", model: MODEL };
  return { pass: true, reason: "within limit, nothing restricted, someone available", model: MODEL };
}

export function gates(ticket) {
  const text = `${ticket.subject ?? ""} ${ticket.body ?? ""}`;
  const money = REFUND.test(text) || /\$|usd|eur|\bcharge/i.test(text) && /refund|back/i.test(text);
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

// The greeting and sign-off every sample reply wears (same two lines as draft()).
export function frame(ticket, body) {
  return `Hello${ticket?.sender_name ? ` ${ticket.sender_name}` : ""},\n\n${body}\n\nBest regards,\nJedi Pack Support`;
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
    model: "sample-rules",
  };
}

export function severity(ticket, { kind = "vent", repeat = false, publicChannel = false } = {}) {
  const text = `${ticket?.subject ?? ""} ${ticket?.body ?? ""}`;
  let score;
  if (/lawyer|unsafe|injur/i.test(text)) score = 10;
  else if (/never again|everyone/i.test(text)) score = 9;
  else {
    score = /furious|disgusting|worst|terrible/i.test(text) ? 6 : /annoyed|disappointed/i.test(text) ? 4 : 3;
    if (publicChannel) score += 4;
    if (repeat) score += 2;
  }
  score = Math.max(1, Math.min(10, score));
  return { score, legend: SEVERITY_LEVELS[score - 1] };
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
    draft: frame(ticket, body), blanks: ds, model: "sample-rules",
  };
}

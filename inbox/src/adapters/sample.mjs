// Deterministic no-network stand-ins for Zetaris queries, the drafter, the critics and the gates.
import { readFileSync } from "node:fs";
import { config, INBOX_ROOT } from "../config.mjs";
import { ACKNOWLEDGEMENT_TEMPLATE } from "../prompts.mjs";

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
  const hit = entries.find((e) => same(e.params ?? {}, params))
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
  const hi = `Hello ${ticket.sender_name},`;
  const ask = `You wrote about "${ticket.subject}".`;
  const promises = { refund_amount: null, replacement: false, other: null };
  let mid;
  if (seed === "revised") {
    mid = `We cannot approve an amount above our limit of ${facts.policy_limit_usd} USD${cite}, so we are not promising it today. ${facts.backup ?? "A colleague"} will follow up with you.`;
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
  const amt = d.promises?.refund_amount;
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
  return `Hello ${ticket?.sender_name ?? "there"},\n\n${body}\n\nBest regards,\nJedi Pack Support`;
}

// The RFQ acknowledgement: ACKNOWLEDGEMENT_TEMPLATE filled with the quantities. Code, no model call; never a price.
export function acknowledgement(ticket, { quantities = [] } = {}) {
  const q = quantities.map(String);
  const said = q.length === 0 ? "the quantity you asked about" : q.length === 1 ? q[0] : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`;
  return { text: frame(ticket, ACKNOWLEDGEMENT_TEMPLATE.replace("{quantities}", said)), model: "template/acknowledgement", route: "template", promises: { refund_amount: null, replacement: false, other: null } };
}

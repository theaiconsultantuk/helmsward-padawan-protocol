// Typed gates (OpenJev), the trust floor and the hard-risk check. No dependencies.
import { config, sampleMode as isSampleMode } from "./config.mjs";
import { systemone } from "./adapters/openjev.mjs";
import * as sample from "./adapters/sample.mjs";
import { SEVERITY_QUESTION, LEGAL_QUESTION, refundRuleReason } from "./prompts.mjs";

const CATEGORIES = ["refund", "replacement", "question", "complaint", "appreciation"];

// Real schema (openjev/api.py): noul criteria is {true,false}; choice criteria is a dict; score criteria is a list of levels.
export const GATE_QUESTIONS = {
  is_follow_up: {
    type: "noul", instructions: "Is this message a follow-up to an earlier reply from us (the customer refers to what we said before)?",
    criteria: { true: "the customer refers to an earlier reply or says we misunderstood", false: "a first message on this matter" },
  },
  category: {
    type: "choice", instructions: "What does the customer actually want?",
    criteria: {
      refund: "the customer asks for their money back", replacement: "the customer asks for the item to be replaced or repaired",
      question: "the customer asks a general question", complaint: "the customer complains without asking for money or a replacement",
      appreciation: "the customer says thanks or praises us",
    },
  },
  urgency: { type: "score", instructions: "How soon must this be handled?", criteria: ["can wait", "this week", "today"] },
  tone: { type: "score", instructions: "How upset is the customer?", criteria: ["calm", "annoyed", "furious"] },
  asks_for_money: {
    type: "noul", instructions: "Does the customer ask for money back or a payment?",
    criteria: { true: "the message asks for a refund or payment", false: "it does not ask for money" },
  },
};

function factsSummary(facts = {}) {
  const parts = [];
  if (facts.owner_out !== undefined) parts.push(`owner ${facts.owner_out ? "out" : "in"}`);
  if (facts.backup_out !== undefined) parts.push(`backup ${facts.backup_out ? "out" : "in"}`);
  if (facts.policy_limit != null) parts.push(`policy limit ${facts.policy_limit} GC`);
  if (facts.category_weight != null) parts.push(`category weight ${facts.category_weight}`);
  return parts.join("; ");
}

const num = (v) => (typeof v === "number" ? v : typeof v === "object" && v !== null ? (v.noul ?? v.p ?? v.probability) : Number(v));

function normalize(a) {
  const p = num(a?.is_follow_up), m = num(a?.asks_for_money);
  const c = a?.category, u = a?.urgency, t = a?.tone;
  if (![p, m].every((x) => typeof x === "number" && Number.isFinite(x))) throw Object.assign(new Error("noul answer missing"), { name: "BadResponse" });
  if (!c || typeof c.choice !== "string" || !Number.isFinite(c.confidence)) throw Object.assign(new Error("choice answer missing"), { name: "BadResponse" });
  if (!u || !Number.isFinite(u.score) || !t || !Number.isFinite(t.score)) throw Object.assign(new Error("score answer missing"), { name: "BadResponse" });
  return {
    answers: {
      is_follow_up: p,
      category: { choice: c.choice, confidence: c.confidence },
      urgency: { score: u.score, legend: u.legend ?? "0 can wait, 1 this week, 2 today", confidence: u.confidence },
      tone: { score: t.score, legend: t.legend ?? "0 calm, 1 annoyed, 2 furious", confidence: t.confidence },
      asks_for_money: m,
    },
    confidences: [Math.max(p, 1 - p), c.confidence, u.confidence ?? 0.5, t.confidence ?? 0.5, Math.max(m, 1 - m)],
  };
}

const r2 = (x) => Math.round(x * 100) / 100;
function oneLine(a) {
  return `is_follow_up ${r2(a.is_follow_up)}; category ${a.category.choice} (${r2(a.category.confidence)}); urgency ${r2(a.urgency.score)}; tone ${r2(a.tone.score)}; asks_for_money ${r2(a.asks_for_money)}`;
}

export async function typedGates(ticket, facts = {}, { trace = null, cfg = config(), sampleMode = isSampleMode(cfg), fetchImpl, signal } = {}) {
  const log = (f) => trace?.line({ step: "nvidia.model", agent_name: "Gates", action: "typed_gates", sponsor: "nvidia", input_summary: `typed gates for ${ticket.thread_id ?? "ticket"}`, ...f });
  const fallback = (status, why) => {
    const g = sample.gates(ticket);
    log({ status, model: g.model, confidence: 0.5, gate_source: "rules", output_summary: `${why}; code rules: ${oneLine(g.answers)}` });
    return { answers: g.answers, model: g.model, gate_source: "rules", confidence: 0.5 };
  };
  if (sampleMode) return fallback("skipped", "sample mode, OpenJev not called");
  try {
    const fs = factsSummary(facts);
    const state = `Subject: ${ticket.subject ?? ""}\n\n${ticket.follow_up_body || ticket.body || ""}${ticket.follow_up_body && ticket.body ? `\n\n(original message: ${ticket.body})` : ""}${fs ? `\n\nFacts: ${fs}` : ""}`;
    const r = await systemone(state, GATE_QUESTIONS, { cfg, ...(fetchImpl ? { fetchImpl } : {}), ...(signal ? { signal } : {}) });
    const { answers, confidences } = normalize(r.answers);
    if (!CATEGORIES.includes(answers.category.choice)) throw Object.assign(new Error(`unknown category ${answers.category.choice}`), { name: "BadResponse" });
    const confidence = confidences.reduce((s, x) => s + x, 0) / confidences.length;
    const model = `openjev-0.1 (${r.model})`;
    log({ status: "success", model, confidence, gate_source: "openjev", output_summary: oneLine(answers) });
    return { answers, model, gate_source: "openjev", confidence };
  } catch (e) {
    if (signal?.aborted) throw e;
    return fallback("success", `OpenJev failed (${e.name ?? "Error"})`);
  }
}

// Severity 0..10 (S2.2): one OpenJev score question; score = round(index into the 10 levels) + 1.
// Returns { score, legend, confidence, model, gate_source, legal: boolean, kind }. `legal` is the typed legal_threat yes/no read
// (OpenJev), or the code rule sample.LEGAL_WORDS when OpenJev is skipped or does not answer it; `kind` echoes the input kind
// ("vent" | "genuine" | "channel_public"; channel_public makes the sample fallback treat the ticket as on a public channel).
export async function severityGate(ticket, facts = {}, worldLine = "", { trace = null, cfg = config(), sampleMode = isSampleMode(cfg), fetchImpl, kind = "vent", signal } = {}) {
  const log = (f) => trace?.line({ step: "nvidia.model", agent_name: "Severity", action: "severity_gate", sponsor: "nvidia", input_summary: `severity for ${ticket.thread_id ?? "ticket"}`, ...f });
  const done0 = (r, skipped = false) => {
    const body = `severity ${r.score} (${r.legend}), raw ${r.raw ?? "n/a"}, confidence ${r.confidence}, source ${r.gate_source}`;
    log({ status: skipped ? "skipped" : "success", model: r.model, confidence: r.confidence, gate_source: r.gate_source, output_summary: skipped ? `sample mode, OpenJev not called; severity by code rules (sample.severity): ${body}` : body });
    return r;
  };
  const done = (r, skipped = false) => done0({ ...r, legal: Boolean(r.legal), kind }, skipped);
  const fallback = (skipped = false) => {
    const s = sample.severity(ticket, { kind, repeat: facts.repeat === true, publicChannel: facts.publicChannel === true || ticket.channel === "trustpilot" || kind === "channel_public" });
    return done({ score: s.score, legend: s.legend, confidence: 0.5, model: "rules", gate_source: "rules", legal: s.legal }, skipped);
  };
  if (sampleMode) return fallback(true);
  try {
    const state = `Subject: ${ticket.subject ?? ""}\n\n${ticket.body ?? ""}${worldLine ? `\n\nRecord: ${worldLine}` : ""}\n\nkind: ${kind}`;
    const r = await systemone(state, { severity: SEVERITY_QUESTION, legal_threat: LEGAL_QUESTION }, { cfg, ...(fetchImpl ? { fetchImpl } : {}), ...(signal ? { signal } : {}) });
    const a = r.answers?.severity;
    if (!a || !Number.isFinite(a.score)) throw Object.assign(new Error("severity answer missing"), { name: "BadResponse" });
    const score = Math.min(10, Math.max(1, Math.round(a.score) + 1));
    const lp = num(r.answers?.legal_threat);
    const legal = Number.isFinite(lp) ? lp >= 0.5 : sample.legalThreat(ticket);
    const served = typeof r.model === "string" && r.model && r.model !== "openjev-latest" ? ` (${r.model})` : "";
    return done({ score, raw: a.score, legend: SEVERITY_QUESTION.criteria[score - 1], confidence: Number.isFinite(a.confidence) ? a.confidence : 0.5, model: `openjev-0.1${served}`, gate_source: "openjev", legal });
  } catch (e) {
    if (signal?.aborted) throw e;
    log({ status: "error", model: "openjev-0.1", gate_source: "openjev", output_summary: `OpenJev failed (${e.name ?? "Error"}): ${e.message}` });
    trace?.line({ step: "recovery", agent_name: "Severity", action: "recover", input_summary: "after severity_gate error", output_summary: "severity by rules at confidence 0.5", status: "success" });
    return fallback();
  }
}

export function trustFloor(facts, gates, { ledgerAdjust = { affirmed: 0, rejected: 0 } } = {}) {
  const c = gates?.answers?.category;
  const category = c && c.confidence >= 0.6 ? c.choice : facts.category;
  const raw = (facts.category_weight ?? 0) + 0.05 * (ledgerAdjust.affirmed ?? 0) - 0.05 * (ledgerAdjust.rejected ?? 0);
  const weight = Math.round(Math.min(1, Math.max(0, raw)) * 1e6) / 1e6;
  const floor = facts.floor ?? 0.80;
  return { weight, floor, under: weight < floor, category };
}

// Dean X16, einh's pick "Allow known amounts" (25 Oct 2026): refund text may name only ticket, customer or policy amounts.
const NUMBER_WORDS = Object.fromEntries([
  ..."one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ").map((word, i) => [word, i + 1]),
  ..."thirty forty fifty sixty seventy eighty ninety".split(" ").map((word, i) => [word, (i + 3) * 10]),
]);
// Review 46: recognise number-like tokens first, then parse strictly. Unsupported scales and malformed digits fail closed.
const WORD_TOKEN = `(?:${Object.keys(NUMBER_WORDS).join("|")}|hundred|thousand|million|billion|trillion|zillion)[\\p{L}]*`;
const DIGIT_TOKEN = "[\\p{L}]*\\d[\\p{L}\\d.,+-]*(?:[ \\u00a0\\u2009\\u202f]+\\d[\\p{L}\\d.,+-]*)*";
const AMOUNT_TOKEN = `(?:${DIGIT_TOKEN}|${WORD_TOKEN}(?:[ -]+(?:and[ -]+)?${WORD_TOKEN})*)`;
const GC_UNIT = "(?:gc|galactic credits?)";
export const GC_AMOUNT = new RegExp(`(?<![\\p{L}\\p{N}_])(?:(${AMOUNT_TOKEN})\\s*${GC_UNIT}\\b|${GC_UNIT}\\s*(${AMOUNT_TOKEN})(?![\\p{L}\\p{N}_]))`, "giu");

function smallWordAmount(words) {
  let value = 0;
  if (words[0] === "hundred") { value = 100; words = words.slice(1); }
  else if (words[1] === "hundred" && NUMBER_WORDS[words[0]] <= 9) {
    value = NUMBER_WORDS[words[0]] * 100; words = words.slice(2);
  }
  if (value && words[0] === "and") words = words.slice(1);
  if (!words.length) return value;
  const first = NUMBER_WORDS[words[0]], second = NUMBER_WORDS[words[1]];
  if (words.length === 1 && first) return value + first;
  if (words.length === 2 && first >= 20 && first % 10 === 0 && second >= 1 && second <= 9) return value + first + second;
  return null;
}

function parseGCAmount(raw) {
  if (/\d/.test(raw)) {
    const text = raw.replace(/\.$/, "");
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,3}(?:[ \u00a0\u2009\u202f]\d{3})+)(?:\.\d+)?$/.test(text)) return null;
    const value = Number(text.replace(/[, \u00a0\u2009\u202f]/g, ""));
    return Number.isFinite(value) ? value : null;
  }
  const words = raw.toLowerCase().split(/[ -]+/);
  const thousand = words.indexOf("thousand");
  if (thousand < 0) return smallWordAmount(words);
  if (words.lastIndexOf("thousand") !== thousand) return null;
  const head = thousand ? smallWordAmount(words.slice(0, thousand)) : 1;
  let tailWords = words.slice(thousand + 1);
  if (tailWords[0] === "and") tailWords = tailWords.slice(1);
  const tail = smallWordAmount(tailWords);
  return head == null || tail == null ? null : head * 1000 + tail;
}
const gcAmounts = (s) => [...String(s ?? "").matchAll(GC_AMOUNT)].map((m) => parseGCAmount(m[1] ?? m[2]));

export function hardRisk(facts, draft = null) {
  const reasons = [];
  const limit = facts.policy_limit;
  if (facts.amount != null && limit != null && facts.amount > limit) reasons.push(`amount ${facts.amount} over the policy limit ${limit}`);
  const low = String(draft?.text ?? "").toLowerCase();
  const leaked = (facts.restricted_terms ?? []).find((t) => t && low.includes(String(t).toLowerCase()));
  if (facts.may_leave === false) reasons.push("fact may not leave");
  else if (leaked) reasons.push(`fact may not leave: ${leaked}`);
  if (facts.owner_out && facts.backup_out) reasons.push("owner and backup both out");
  if (draft?.promises?.refund_amount != null && limit != null && draft.promises.refund_amount > limit) reasons.push("draft promises refund above the limit");
  // a ticket whose scenario reads no policy row has no limit: a refund promised there has nothing behind it (Codex review 7, HIGH)
  if (draft?.promises?.refund_amount != null && limit == null) reasons.push("draft promises a refund with no policy limit behind it");
  if (facts.category === "refund" || draft?.promises?.refund_amount != null) {
    const known = new Set([facts.amount, facts.policy_limit].filter((x) => x != null).map(Number));
    for (const text of [facts.body, facts.follow_up_body, facts.subject]) for (const x of gcAmounts(text)) if (x != null) known.add(x);
    const amounts = [...gcAmounts(draft?.text), ...gcAmounts(typeof draft?.promises?.other === "string" ? draft.promises.other : "")];
    const foreign = amounts.find((x) => x == null || !known.has(x));
    if (foreign !== undefined) reasons.push(`draft names ${foreign == null ? "an unparseable GC amount" : `${foreign} GC`}, not the ticket amount (${facts.amount ?? "none"})`);
  }
  // refunds are mentioned only on refund requests (einh, 24 Oct 2026; questions may quote the policy): the reason, or null, from one place
  const rr = refundRuleReason(facts, draft);
  if (rr) reasons.push(rr);
  return { hard: reasons.length > 0, reasons };
}

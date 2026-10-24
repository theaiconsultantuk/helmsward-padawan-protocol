// Scout Intent engine core: sense -> interpret -> route -> recommend.
// Stage 1 is pure rules (lexical). Confidence is the winner's share of matched weight.
import fs from "node:fs";
import { issueContract } from "./contract.mjs";
import * as policy from "./policy.mjs";

const STOP = new Set(("a an the and or of to in on at for with from by is are was were be been it its this that these those " +
  "me my i we you our your us do does did can could would should will what whats how about so as if into over any all some " +
  "there their them then than but not no up out has have had get got").split(" "));

const stem = (w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y"
  : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export function tokens(text) {
  return String(text ?? "").toLowerCase().replace(/‮/g, " ").replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/).filter(Boolean)
    .filter((w) => !STOP.has(w)).map(stem);
}
function grams(toks) {
  const bi = [];
  for (let i = 0; i + 1 < toks.length; i++) bi.push(toks[i] + " " + toks[i + 1]);
  return { uni: toks, bi };
}

const W_EX_UNI = 2, W_EX_BI = 3, W_DESC = 1, W_ID = 2.5, BI_MULT = 2;

function buildTerms(intent) {
  const uni = new Map(), bi = new Map();
  const put = (m, t, w) => { if ((m.get(t) ?? 0) < w) m.set(t, w); };
  for (const ex of intent.examples ?? []) {
    const g = grams(tokens(ex));
    g.uni.forEach((t) => put(uni, t, W_EX_UNI));
    g.bi.forEach((t) => put(bi, t, W_EX_BI));
  }
  const d = grams(tokens(intent.description));
  d.uni.forEach((t) => put(uni, t, W_DESC));
  tokens(String(intent.id).replace(/[._-]/g, " ")).forEach((t) => put(uni, t, W_ID));
  return { uni, bi };
}

const QTY_UNIT = "items?|units?|pcs|pieces?|x|sabers?|hilts?|belts?|holsters?|stands?|robes?";
const QTY_CONNECT = "and|or|vs\\.?|versus|to";
const QTY_NUM = /(?<![\w$€£.-])(?:\d{1,3}(?:[, .]\d{3})+|\d+)(?!(?!x\b)[\w-])(?![.,]\d)/g;
const QTY_COUNTED = new RegExp(`^\\s+(?:[\\w-]+\\s+){0,2}?(?:${QTY_UNIT})\\b`, "i");
const QTY_AFTER_UNIT = new RegExp(`^(?:\\s+(?:[\\w-]+\\s+){0,2}?(?:${QTY_UNIT}))?\\s+(?:${QTY_CONNECT})\\s+$`, "i");
const QTY_BARE = new RegExp(`^\\s+(?:${QTY_CONNECT})\\s+$`, "i");

// Quantities: integers counted by a unit or product word, plus bare integers joined to a counted one.
// Money amounts ("100 GC", "$100") are not quantities.
export function extractQuantities(s) {
  const nums = [];
  for (const m of s.matchAll(QTY_NUM)) {
    const end = m.index + m[0].length;
    if (/[$€£]\s*$/.test(s.slice(0, m.index))) continue;
    if (/^\s?[kKmM]?\s?(?:GC|USD|EUR|GBP|dollars?|euros?)\b/i.test(s.slice(end))) continue;
    nums.push({ start: m.index, end, value: parseInt(m[0].replace(/[, .]/g, ""), 10), counted: QTY_COUNTED.test(s.slice(end)) });
  }
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < nums.length - 1; i++) {
      const a = nums[i], b = nums[i + 1];
      if (a.counted === b.counted) continue;
      const gap = s.slice(a.end, b.start);
      if (a.counted ? QTY_AFTER_UNIT.test(gap) : QTY_BARE.test(gap)) {
        (a.counted ? b : a).counted = true; changed = true;
      }
    }
  }
  return [...new Set(nums.filter((n) => n.counted).map((n) => n.value))];
}

export function extractParams(prompt) {
  const p = {}, s = String(prompt ?? "");
  const MONEY = /([$€£])\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?|(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\s?(GC|USD|EUR|GBP|dollars?|euros?)\b/g;
  const one = (m) => ({
    num: parseFloat((m[2] ?? m[4]).replace(/,/g, "")) * ((m[3] ?? m[5] ?? "").toLowerCase() === "k" ? 1e3 : (m[3] ?? m[5] ?? "").toLowerCase() === "m" ? 1e6 : 1),
    cur: { "$": "USD", "€": "EUR", "£": "GBP" }[m[1] ?? m[6]] ?? String(m[1] ?? m[6]).toUpperCase().replace(/^DOLLARS?$/, "USD").replace(/^EUROS?$/, "EUR"),
  });
  // the loop's prompt is "subject\nbody"; a free-text subject is the body's first 60 characters, so its amounts are the body's own and count once
  const nl = s.indexOf("\n"), head = nl > 0 ? s.slice(0, nl).trim() : "", rest = nl > 0 ? s.slice(nl + 1) : s;
  const found = [...(head && rest.includes(head) ? rest : s).matchAll(MONEY)].map(one);
  if (found.length) {
    p.amount = found[0].num;
    p.currency = found[0].cur;
    // P13/H17: a message that lists two or more amounts in one currency and never says "total" asks for their sum (the model read only the first)
    p.amounts = found.map((f) => f.num);
    if (found.length >= 2 && !/\btotal\b/i.test(s) && found.every((f) => f.cur === found[0].cur)) {
      p.amount = Math.round(found.reduce((a, f) => a + f.num, 0) * 100) / 100;
      p.summed = found.length;
    }
    if (/over|above|more than|at least/i.test(s)) p.valueMin = p.amount; else p.value = p.amount;
  }
  const iso = s.match(/\b\d{4}-\d{2}-\d{2}\b/);
  const nat = s.match(/\b(today|tomorrow|yesterday|(?:next|this|last)\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:mon|tues|wednes|thurs|fri|satur|sun)day|next week|next month|this week)\b/i);
  if (iso) p.date = iso[0]; else if (nat) p.date = nat[0].toLowerCase();
  const id = s.match(/\b[A-Z]{1,5}-\d{1,8}\b|\b[A-Z]\d{2,}\b/);
  if (id) p.id = id[0];
  const em = s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  if (em) p.email = em[0];
  const q = s.match(/"([^"]+)"|“([^”]+)”/);
  if (q) p.quoted = q[1] ?? q[2];
  const cnt = s.match(/\b(\d{1,3})\s+(?:[\w-]+\s+){0,2}?(deals?|renewals?|accounts?|emails?|contacts?|items?|leads?|databases?)\b/i);
  if (cnt) p.count = parseInt(cnt[1], 10);
  p.quantities = extractQuantities(s);
  const acct = s.match(/\b(?:the\s+)?([A-Z][A-Za-z0-9]+)\s+(?:deal|renewal|account)\b/);
  if (acct && !/^(Show|Find|The|Give|Move|Pull|What|Draft|Send)$/.test(acct[1])) p.account = acct[1];
  const stage = s.match(/\b(negotiation|closed-won|closed-lost|prospecting|proposal|discovery|qualification)\b/i);
  if (stage) p.stage = stage[1].toLowerCase();
  const ch = s.match(/\b(email|call|slack)s?\b/i);
  if (ch && /draft|write|email/i.test(s)) p.channel = ch[1].toLowerCase();
  return p;
}

const PROFILE = { low: "fast", medium: "balanced", high: "deep" };

export class Scout {
  constructor({ intentRegistry, policyPack, secret, guard } = {}) {
    let reg = intentRegistry;
    try { if (typeof reg === "string") reg = JSON.parse(fs.readFileSync(reg, "utf8")); } catch { reg = null; }
    reg = reg ?? { version: 1, intents: [] };
    this.registryVersion = reg.version ?? 1;
    this.intents = reg.intents ?? [];
    this.general = this.intents.find((i) => i.id === "GENERAL") ?? { id: "GENERAL", capabilities: [], riskClass: "low", roles: ["*"] };
    this.terms = new Map(this.intents.filter((i) => i.id !== "GENERAL").map((i) => [i.id, buildTerms(i)]));
    // document frequency over intents: shared terms discriminate less
    this.df = new Map();
    for (const { uni, bi } of this.terms.values()) for (const t of [...uni.keys(), ...bi.keys()]) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.policyPack = Array.isArray(policyPack) ? policyPack : policyPack ? [policyPack] : ["default"];
    this.secret = secret ?? process.env.SCOUT_SECRET ?? "dev-secret";
    this.guard = guard ?? policy.guard;
  }

  sense(prompt) {
    const g = grams(tokens(prompt));
    const n = this.terms.size || 1;
    const idf = (t) => 1 + Math.log(n / (this.df.get(t) ?? 1)) * 0.5;
    const scores = [];
    for (const intent of this.intents) {
      if (intent.id === "GENERAL") continue;
      const { uni, bi } = this.terms.get(intent.id);
      let s = 0;
      for (const t of new Set(g.uni)) if (uni.has(t)) s += uni.get(t) * idf(t);
      for (const t of new Set(g.bi)) if (bi.has(t)) s += bi.get(t) * idf(t) * BI_MULT;
      if (s > 0) scores.push({ intent: intent.id, score: s });
    }
    scores.sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent));
    const total = scores.reduce((a, c) => a + c.score, 0);
    const confidence = total > 0 ? scores[0].score / total : 0;
    return { scores, confidence };
  }

  async decide({ prompt, user, surface } = {}) {
    const traceId = "trace-" + Math.random().toString(36).slice(2, 10);
    try { return this._decide(prompt, user, surface, traceId); }
    catch (err) { return this._fallback(user, surface, traceId); }
  }

  _decide(prompt, user, surface, traceId) {
    const { scores, confidence } = this.sense(prompt);
    const winner = scores.length && confidence >= 0.40
      ? this.intents.find((i) => i.id === scores[0].intent) : this.general;
    const params = extractParams(prompt);
    const toolPlan = (winner.capabilities ?? []).map((c) => ({ capability: c, tool: c, input: { prompt: String(prompt ?? ""), ...params } }));
    const riskClass = winner.riskClass ?? "low";
    const g = this.guard(String(prompt ?? ""), { user, surface, intent: winner, packs: this.policyPack }) ?? { level: "low", flags: [] };
    const blocked = g.level === "block";
    const risk = { level: g.level ?? "low", flags: g.flags ?? [], redactions: g.redactions ?? [], approvals: g.approvals ?? [] };
    const clarification = blocked ? false : (confidence < 0.40 || (riskClass === "high" && confidence < 0.95));
    const candidates = [...scores.map((s) => ({ intent: s.intent, score: s.score })), { intent: "GENERAL", score: 0 }];
    return this._finish({ winner, conf: confidence, params, toolPlan: blocked ? [] : toolPlan, risk, riskClass, clarification, candidates, user, surface, traceId, alternates: scores.slice(1, 4).map((s) => s.intent) });
  }

  _finish({ winner, conf, params, toolPlan, risk, riskClass, clarification, candidates, user, surface, traceId, alternates = [] }) {
    const executionContract = issueContract({
      traceId,
      intent: { primary: { id: winner.id }, parameters: params, confidence: conf, alternates },
      risk,
      toolPlan,
      modelProfile: PROFILE[riskClass] ?? "fast",
      scope: { user: user?.id ?? null, surface: surface ?? "chat", capabilities: toolPlan.map((t) => t.capability) },
      registryVersion: this.registryVersion,
      policyPackVersion: `${this.policyPack[0]}@1`,
      secret: this.secret,
    });
    return { executionContract, candidates, risk, toolPlan, clarification, intent: { primary: { id: winner.id }, confidence: conf }, parameters: params, overrides: [] };
  }

  _fallback(user, surface, traceId) {
    return this._finish({
      winner: this.general, conf: 0, params: {}, toolPlan: [], risk: { level: "low", flags: ["engine-error"] }, riskClass: "low",
      clarification: true, candidates: [{ intent: "GENERAL", score: 0 }], user, surface, traceId,
    });
  }
}

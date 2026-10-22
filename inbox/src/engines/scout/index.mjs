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

export function extractParams(prompt) {
  const p = {}, s = String(prompt ?? "");
  const money = s.match(/([$€£])\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?|(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\s?(USD|EUR|GBP|dollars?|euros?)\b/);
  if (money) {
    const num = parseFloat((money[2] ?? money[4]).replace(/,/g, ""));
    const suf = (money[3] ?? money[5] ?? "").toLowerCase();
    const cur = money[1] ?? money[6];
    p.amount = num * (suf === "k" ? 1e3 : suf === "m" ? 1e6 : 1);
    p.currency = { "$": "USD", "€": "EUR", "£": "GBP" }[cur] ?? String(cur).toUpperCase().replace(/^DOLLARS?$/, "USD").replace(/^EUROS?$/, "EUR");
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

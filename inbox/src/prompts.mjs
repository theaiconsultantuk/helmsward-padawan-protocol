// Prompt builders and strict-JSON parsers for the reply loop's two model calls: the drafter and the evaluator.
// The drafter never sees the policy limit: the limit enters through the critics, by design (draft, then two critics).

export const NUDGE = "Your last answer was not valid JSON. Return only the JSON object, with no prose and no code fence.";

// Refunds are mentioned only on refund requests (einh, 24 Oct 2026: "refunds should only be mentioned in the context of refund requests
// (category)"; his pick B the same day: "Questions may quote policy"). Outside the refund category a draft that PROMISES money (refund_amount,
// or "other" naming a refund) is refused on every category; refund WORDING in the reply is refused too, except on a question whose own text asks
// about refunds, which may quote the policy (the FAQ "returns and refund policy", "what is the refund limit"). Risk (hardRisk) and the sample
// critic apply it, the drafter and the evaluator are told the same, so such a draft is rewritten on the retry or the ticket is held or
// escalated. The approval limit stays a refund-category rule.
// A draft mentions a refund when its promises say so (refund_amount set, or "other" naming one) or its words do. The text is read as words:
// the row ids the sample twin cites in its reply ("policy:refund", "wiki_refund_policy:1") are removed first, each exactly as cited and only
// when cited, then accents, Markdown emphasis and hyphens inside words are normalised, so "Refund:", "_refund_", "re-fund", "money-back"
// and "réfund" all count (Codex review 14). Risk's word test is the guarantee; the Evaluator is told the same rule as a second reader.
export const REFUND_WORDS = /refund|money ?back|reimburs/;
export function normalizeReply(text, cited = []) {
  let s = String(text ?? "");
  for (const id of cited ?? []) if (id) s = s.split(String(id)).join(" ");
  // typographic apostrophes become the plain one, so "don’t" stays one word (Codex review 20)
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019\u02bc\u2032]/g, "'").replace(/[*_~`]/g, " ").replace(/(\p{L})[-\u2010-\u2015](?=\p{L})/gu, "$1").toLowerCase();
}
export function mentionsRefund(draft, cited = draft?.cited_rows ?? []) {
  const p = draft?.promises ?? {};
  return p.refund_amount != null || REFUND_WORDS.test(normalizeReply(p.other)) || REFUND_WORDS.test(normalizeReply(draft?.text ?? draft?.reply_text, cited));
}
export const refundOutOfCategory = (category) => `refund wording on a ${category ?? "non-refund"} message: refunds are mentioned only on refund requests`;
export const refundPromisedOutOfCategory = (category) => `draft promises a refund on a ${category ?? "non-refund"} message: money is promised only on refund requests`;
// The customer's own words ask about refunds (the message, or the follow-up body on a follow-up): a refund word with no negation earlier in
// its own clause (clauses end at . ? ! ; , and "but"). "What is your refund policy?" asks; "I'm not asking you about refunds" and "no refund
// question, just shipping" do not (Codex reviews 16 and 18). A message that both negates and asks ("don't refund me yet, but what is the
// policy on refunds?") asks, because the asking clause carries no negation.
// a negation token: the bare words, every contraction carrying "n't" (apostrophes are canonical by now; "wouldn't've" included), and the
// apostrophe-less typings of the common auxiliaries
const NEGATION = /^(?:not|no|never|without|nor|neither|none|nothing|cannot|\w+n't(?:'\w+)*|(?:do|does|did|is|are|was|were|wo|ca|could|should|would|have|has|had|need|must|ai)nt)$/;
const REFUND_TOKEN = (w, next) => /^(?:refund|reimburs)/.test(w) || (w === "money" && next === "back");
export function refundAsked(facts) {
  const clauses = normalizeReply(requestText(facts ?? {}, facts?.ticket)).split(/[.?!;,]|\bbut\b/);
  return clauses.some((c) => {
    const words = c.split(/[^a-z0-9']+/).filter(Boolean);
    return words.some((w, i) => REFUND_TOKEN(w, words[i + 1]) && !words.slice(0, i).some((x) => NEGATION.test(x)));
  });
}
// The reason Risk and the sample critic give, or null. facts.category is the message's category; facts.cited_rows the row ids its reply may cite.
export function refundRuleReason(facts, draft) {
  const cat = facts?.category;
  if (cat === "refund") return null;
  const p = draft?.promises ?? {};
  if (p.refund_amount != null || REFUND_WORDS.test(normalizeReply(p.other))) return refundPromisedOutOfCategory(cat);
  if (!REFUND_WORDS.test(normalizeReply(draft?.text ?? draft?.reply_text, facts?.cited_rows ?? []))) return null;
  if (cat === "question" && refundAsked(facts)) return null; // einh's B: a question that asks about refunds may quote the policy
  return refundOutOfCategory(cat);
}

export const signOff = (team = "Support") => `Best regards,\nFarstrand ${team} team`;

export const DRAFTER_SYSTEM = [
  "You write the customer reply for the Jedi Pack support inbox.",
  "End the reply with exactly this sign-off, on its own lines: " + JSON.stringify(signOff()) + ". Never sign as Jedi Pack.",
  "Answer what the customer actually asked, in a short, polite email, using only the facts you are given.",
  "Promise money only when the Category is refund. Mention a refund only on a refund request, or when the customer's question itself asks about refunds; on any other message do not mention refunds or money back.",
  "Return strict JSON and nothing else, in exactly this shape:",
  '{"reply_text": string, "promises": {"refund_amount": number|null, "replacement": boolean, "other": string|null}}',
  "promises states what the reply commits us to: refund_amount is the amount you promise to refund (null if none),",
  "replacement is true if you promise a replacement, other is any further commitment (null if none).",
].join("\n");

export const EVALUATOR_SYSTEM = [
  "You are the Evaluator for the Jedi Pack support inbox. You vet one draft reply against the facts.",
  "Fail the draft if it promises money on a message whose Category is not refund, mentions a refund on a message that is not a refund request",
  "(a question that itself asks about refunds may quote the policy), promises a refund above the policy limit,",
  "commits to anything the cited facts do not support, names a fact that may not leave the company,",
  "or promises help from a person who is out with no one covering.",
  "Return strict JSON and nothing else, in exactly this shape:",
  '{"pass": boolean, "reason": string}',
  "reason is one sentence the planner can apply to the next draft.",
].join("\n");

const line = (k, v) => (v === undefined || v === null || v === "" ? null : `${k}: ${v}`);

// exported 24 Oct for the refund Reader (src/refund_reader.mjs), which reads the same customer text the drafter and the Evaluator see
export function requestText(facts, ticket) {
  const t = ticket ?? facts?.ticket ?? {};
  const kind = facts?.follow_up_kind ?? t.follow_up_kind;
  return kind ? (facts?.follow_up_body ?? t.follow_up_body ?? facts?.body ?? t.body ?? "") : (facts?.body ?? t.body ?? "");
}

// Facts the drafter may see: the request and who is available. No policy limit.
function draftFacts(facts) {
  const who = (id, name, out) => (id == null ? null : `${name ?? `employee ${id}`} (employee ${id}) is ${out ? "out" : "in"}`);
  return [
    line("Category", facts.category),
    line("Amount asked", facts.amount == null ? null : `${facts.amount} GC`),
    line("Owner", who(facts.owner_id, facts.owner_name, facts.owner_out)),
    line("Backup", who(facts.backup_id, facts.backup_name, facts.backup_out)),
    line("Policy rows cited", (facts.cited_rows ?? []).join(", ")),
  ].filter(Boolean).join("\n");
}

export function draftMessages({ ticket, facts, memoryContext = "", critiques = [] } = {}) {
  const t = ticket ?? facts?.ticket ?? {};
  const parts = [
    line("Customer", facts?.sender_name ?? t.sender_name),
    line("Subject", facts?.subject ?? t.subject),
    `Customer message:\n${requestText(facts ?? {}, t)}`,
    `Facts:\n${draftFacts(facts ?? {})}`,
  ];
  if (memoryContext) parts.push(`Memory from earlier runs:\n${memoryContext}`);
  if (critiques.length) {
    parts.push(`Your previous draft was rejected. Both critics said:\n${critiques.map((c, i) => `${i + 1}. ${c}`).join("\n")}\nWrite a revised draft that fixes every point.`);
  }
  parts.push("Return the JSON object now.");
  return [{ role: "system", content: DRAFTER_SYSTEM }, { role: "user", content: parts.filter(Boolean).join("\n\n") }];
}

export function evaluatorMessages({ draft, facts, ticket } = {}) {
  const t = ticket ?? facts?.ticket ?? {};
  const user = [
    `Customer asked: ${requestText(facts ?? {}, t)}`,
    "Facts (including the limit):",
    [
      line("Category", facts?.category),
      line("Amount asked", facts?.amount == null ? null : `${facts.amount} GC`),
      line("Policy limit", facts?.policy_limit == null ? null : `${facts.policy_limit} GC`),
      line("Owner out", facts?.owner_out),
      line("Backup out", facts?.backup_out),
      line("May leave the company", facts?.may_leave),
      line("Must not appear in a reply", (facts?.restricted_terms ?? []).join(", ")),
      line("Policy rows cited", (facts?.cited_rows ?? []).join(", ")),
    ].filter(Boolean).join("\n"),
    `Draft reply:\n${draft?.text ?? ""}`,
    `Draft promises: ${JSON.stringify(draft?.promises ?? null)}`,
    "Return the JSON object now.",
  ].join("\n\n");
  return [{ role: "system", content: EVALUATOR_SYSTEM }, { role: "user", content: user }];
}

// Pull the first JSON object out of a model answer; tolerates ```json fences and surrounding prose.
export function extractJson(text) {
  if (typeof text !== "string") return null;
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

export function parseDraftJson(text) {
  const j = extractJson(text);
  if (!j || typeof j.reply_text !== "string" || !j.reply_text.trim()) return null;
  const p = j.promises && typeof j.promises === "object" ? j.promises : {};
  const amt = p.refund_amount == null || p.refund_amount === "" ? null : Number(p.refund_amount);
  if (amt !== null && !Number.isFinite(amt)) return null;
  return {
    text: j.reply_text.trim(),
    promises: { refund_amount: amt, replacement: p.replacement === true, other: typeof p.other === "string" && p.other ? p.other : null },
  };
}

export function parseCriticJson(text) {
  const j = extractJson(text);
  if (!j || typeof j.pass !== "boolean" || typeof j.reason !== "string") return null;
  return { pass: j.pass, reason: j.reason.trim() };
}

// The RFQ acknowledgement (S1.2): code, no model call. Quantities may appear; a price never does.
export const ACKNOWLEDGEMENT_TEMPLATE = "Thank you, your request for a quote is with our sales team, who will come back to you with the price for {quantities}.";

// Complaint handler (S2.2): the Nemotron read and the OpenJev severity question.
export const COMPLAINT_READ_SYSTEM = "You read one customer complaint for the Jedi Pack support team with the company's record of this customer and product. Decide whether the customer is venting (angry, wants to be heard, no concrete harm to repair) or has a genuine complaint the company must handle to keep face (a concrete failure, a public audience, a repeat problem, a promise broken). Return strict JSON: {\"kind\":\"vent\"|\"genuine\",\"face_risk\":boolean,\"reasoning\":string,\"handle\":string}";

export function complaintReadMessages({ ticket, worldText = "", provenanceIds = [] } = {}) {
  const t = ticket ?? {};
  const parts = [
    line("Subject", t.subject),
    `Customer message:\n${t.body ?? ""}`,
    line("Channel", t.channel),
    `Company record (World Model):\n${worldText || "no history"}`,
    provenanceIds.length ? `Provenance ids: ${provenanceIds.join(", ")}` : null,
    "Return the JSON object now.",
  ];
  return [{ role: "system", content: `${COMPLAINT_READ_SYSTEM}\n\nReturn the JSON object now.` }, { role: "user", content: parts.filter(Boolean).join("\n\n") }];
}

export function parseComplaintReadJson(text) {
  const j = extractJson(text);
  const bad = (why) => Object.assign(new Error(`complaint read: ${why}`), { name: "BadResponse" });
  if (!j || (j.kind !== "vent" && j.kind !== "genuine")) throw bad("kind missing or not vent|genuine");
  if (typeof j.face_risk !== "boolean") throw bad("face_risk missing or not a boolean");
  if (typeof j.reasoning !== "string" || !j.reasoning.trim()) throw bad("reasoning missing");
  if (typeof j.handle !== "string" || !j.handle.trim()) throw bad("handle missing");
  return { kind: j.kind, face_risk: j.face_risk, reasoning: j.reasoning.trim(), handle: j.handle.trim() };
}

export const SEVERITY_LEVELS = ["1 nothing to handle", "2", "3", "4", "5", "6", "7", "8", "9 public damage or a broken promise", "10 legal or safety"];
export const SEVERITY_QUESTION = { type: "score", instructions: "How severe is this complaint for the company (1 nothing to handle, 10 legal or safety)?", criteria: SEVERITY_LEVELS };
// The typed legal_threat read (Task 2.2): a yes/no to OpenJev, parsed by severityGate. Injury alone is not a legal threat.
export const LEGAL_QUESTION = {
  type: "noul", instructions: "Does the customer threaten legal action (a lawyer, an attorney, a lawsuit, a court)?",
  criteria: { true: "the message threatens legal action", false: "it does not threaten legal action" },
};

// Plain templates for replies composed from rows (no model). Fill with fillQuote / fillCourtesy, then wrap with sample.frame
// (team "Sales" for the quote, default Support for the courtesy reply) so there is one greeting and one sign-off.
export const QUOTE_TEMPLATE = [
  "Thank you for your request. Here is your quote.",
  "Product: {product}",
  "Quantity: {quantity}",
  "Tier: {tier}",
  "Unit price: {unit_price} GC",
  "Total: {total} GC",
  "Lead time: {lead_days} days",
  "Parts needed:\n{parts}",
  "This quote is valid 14 days.",
].join("\n");
export const COURTESY_TEMPLATE = "We are sorry to read what happened with {situation}. We are looking into it now and will come back to you within two working days.";

const fillTpl = (tpl, vals) => tpl.replace(/\{(\w+)\}/g, (m, k) => (vals[k] == null ? "" : String(vals[k])));
// fillQuote({ product, quantity, tier, unit_price, total, lead_days, parts }): parts is an array of strings or { part_name, needed } or a string.
export function fillQuote({ product, quantity, tier, unit_price, total, lead_days, parts = [] } = {}) {
  const list = Array.isArray(parts)
    ? parts.map((p) => (typeof p === "string" ? p : `${p.part_name ?? p.part_id} x ${p.needed}${p.short ? " (short on stock)" : ""}`)).map((l) => `- ${l}`).join("\n")
    : String(parts);
  return fillTpl(QUOTE_TEMPLATE, { product, quantity, tier, unit_price, total, lead_days, parts: list || "- none listed" });
}
// fillCourtesy({ situation }): the customer's name comes from the greeting that sample.frame adds.
export const fillCourtesy = ({ situation = "your order" } = {}) => fillTpl(COURTESY_TEMPLATE, { situation });

// Customer-service handler (S3.1): a recommendation for the support lead and a draft with [[blank: …]] markers.
export const RECOMMENDATION_SYSTEM = [
  "You help the Jedi Pack support lead with a customer message that matched no known request type and no FAQ answer.",
  "Write a short recommendation for the support lead (what the customer seems to want, what the records say, what to do next) and a draft reply the lead can finish.",
  "End the draft with exactly this sign-off, on its own lines: " + JSON.stringify(signOff()) + ". Never sign as Jedi Pack.",
  "Use only the records you are given. Never invent an order number, a date, an amount, an address or a name: wherever the reply needs one you do not have, write [[blank: <what is needed>]].",
  "Promise no refund, replacement or date, and never mention a stored card number, an internal price list or a staff address.",
  'Return strict JSON and nothing else, in exactly this shape: {"recommendation": string, "draft": string, "blanks": [{"id": string, "what": string}]}',
  "blanks lists every [[blank: …]] marker you put in the draft, with the same words in what.",
].join("\n");

export function recommendationMessages({ ticket, facts, candidates = [], gates = null, rows = {}, worldText = "", memories = "", critiques = [] } = {}) {
  const t = ticket ?? facts?.ticket ?? {};
  const cand = candidates.map((c) => `${c.intent} (${Number(c.score).toFixed(2)})`).join(", ");
  const g = gates?.answers ?? {};
  const parts = [
    line("Customer", facts?.sender_name ?? t.sender_name),
    line("Channel", facts?.channel ?? t.channel),
    `Customer message:\n${t.body ?? facts?.body ?? ""}`,
    cand ? `Closest request types the router found, none clear enough: ${cand}` : null,
    g.category ? `Typed gates: category ${g.category.choice} (${g.category.confidence})` : null,
    `Records (the only facts you may use):\n${JSON.stringify(rows)}`,
    worldText ? `Company record of this customer (World Model):\n${worldText}` : null,
    memories ? `Memory from earlier runs:\n${memories}` : null,
    critiques.length ? `Your previous draft was rejected:\n${critiques.map((c, i) => `${i + 1}. ${c}`).join("\n")}\nWrite a revised draft that fixes every point.` : null,
    "Return the JSON object now.",
  ];
  return [{ role: "system", content: RECOMMENDATION_SYSTEM }, { role: "user", content: parts.filter(Boolean).join("\n\n") }];
}

export function parseRecommendationJson(text) {
  const j = extractJson(text);
  if (!j || typeof j.recommendation !== "string" || !j.recommendation.trim() || typeof j.draft !== "string" || !j.draft.trim()) {
    throw Object.assign(new Error("recommendation: recommendation or draft missing"), { name: "BadResponse" });
  }
  const blanks = (Array.isArray(j.blanks) ? j.blanks : []).map((b, i) => (typeof b === "string" ? { id: `blank-${i + 1}`, what: b } : { id: String(b?.id ?? `blank-${i + 1}`), what: String(b?.what ?? "") })).filter((b) => b.what);
  return { recommendation: j.recommendation.trim(), draft: j.draft.trim(), blanks };
}

// Prompt builders and strict-JSON parsers for the reply loop's two model calls: the drafter and the evaluator.
// The drafter never sees the policy limit: the limit enters through the critics, by design (draft, then two critics).

export const NUDGE = "Your last answer was not valid JSON. Return only the JSON object, with no prose and no code fence.";

export const DRAFTER_SYSTEM = [
  "You write the customer reply for the Jedi Pack support inbox.",
  "Answer what the customer actually asked, in a short, polite email, using only the facts you are given.",
  "Return strict JSON and nothing else, in exactly this shape:",
  '{"reply_text": string, "promises": {"refund_amount": number|null, "replacement": boolean, "other": string|null}}',
  "promises states what the reply commits us to: refund_amount is the amount you promise to refund (null if none),",
  "replacement is true if you promise a replacement, other is any further commitment (null if none).",
].join("\n");

export const EVALUATOR_SYSTEM = [
  "You are the Evaluator for the Jedi Pack support inbox. You vet one draft reply against the facts.",
  "Fail the draft if it promises a refund above the policy limit, commits to anything the cited facts do not support,",
  "names a fact that may not leave the company, or promises help from a person who is out with no one covering.",
  "Return strict JSON and nothing else, in exactly this shape:",
  '{"pass": boolean, "reason": string}',
  "reason is one sentence the planner can apply to the next draft.",
].join("\n");

const line = (k, v) => (v === undefined || v === null || v === "" ? null : `${k}: ${v}`);

function requestText(facts, ticket) {
  const t = ticket ?? facts?.ticket ?? {};
  const kind = facts?.follow_up_kind ?? t.follow_up_kind;
  return kind ? (facts?.follow_up_body ?? t.follow_up_body ?? facts?.body ?? t.body ?? "") : (facts?.body ?? t.body ?? "");
}

// Facts the drafter may see: the request and who is available. No policy limit.
function draftFacts(facts) {
  const who = (id, name, out) => (id == null ? null : `${name ?? `employee ${id}`} (employee ${id}) is ${out ? "out" : "in"}`);
  return [
    line("Category", facts.category),
    line("Amount asked", facts.amount_usd == null ? null : `${facts.amount_usd} USD`),
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
      line("Amount asked", facts?.amount_usd == null ? null : `${facts.amount_usd} USD`),
      line("Policy limit", facts?.policy_limit_usd == null ? null : `${facts.policy_limit_usd} USD`),
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

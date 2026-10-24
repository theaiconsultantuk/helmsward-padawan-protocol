// The refund Reader (24 Oct 2026): one Nightshift read of a non-refund draft for MEANING, beside the Evaluator, in front of Risk's word test.
// The model answers three facts; refundReaderReason is the only place they become a verdict. The reader can only ADD a Risk reason, never remove one.
// It never imports the Nightshift adapter: the call comes through io.reader (in the loop, nightshift.draft: primary route, fallback route, then the optional
// local lane, as for the draft and the critique; a local-lane answer still only tightens). Tests stay offline through stubs; in SAMPLE_MODE the stand-in
// below runs and no call is made. NO_NETWORK=1 is the sample-mode proof flag: without SAMPLE_MODE it makes the call fail, and the word test stands (Codex review 25).
import {
  extractJson, normalizeReply, mentionsRefund, refundAsked, refundRuleReason,
  refundOutOfCategory, refundPromisedOutOfCategory, requestText,
} from "./prompts.mjs";

export const READER_SYSTEM = [
  "You are the Reader for the Jedi Pack support inbox. You read one draft reply and the customer's message for MEANING, not words.",
  "Answer three questions about the draft and the message.",
  "mentions_money_back: does the draft mention, quote, hint at or paraphrase money going back to the customer in any form: a refund, reimbursement, credit, voucher, gift card, discount, coupon, a waived or covered cost, compensation, a goodwill gesture with money, in any language, spelling or tone, sarcastic or not?",
  'offers_money: does the draft commit that THIS customer will receive any of that ("we will refund you", "you will get a credit", "we have waived the fee")? A statement of policy or process ("refunds under 150 USD can be approved", "refunds are handled within 14 days") is a mention, NOT an offer.',
  "customer_asks_refund: does the customer's message genuinely ask about refunds or money back (not sarcasm, not a negation, not an aside)?",
  'Vague goodwill with no money in it ("we will make it right", "we will look after you") is NOT money back.',
  "Return strict JSON and nothing else, in exactly this shape:",
  '{"mentions_money_back": boolean, "offers_money": boolean, "customer_asks_refund": boolean, "reason": string}',
  "reason is one sentence naming the words that decided it.",
].join("\n");

export function readerMessages({ draft, facts, ticket } = {}) {
  const user = [
    `Customer message: ${requestText(facts, ticket)}`,
    `Category: ${facts?.category}`,
    `Draft reply:\n${draft?.text ?? ""}`,
    `Draft promises: ${JSON.stringify(draft?.promises ?? null)}`,
    "Return the JSON object now.",
  ].join("\n\n");
  return [{ role: "system", content: READER_SYSTEM }, { role: "user", content: user }];
}

export function parseReaderJson(text) {
  const j = extractJson(text);
  if (!j || typeof j.mentions_money_back !== "boolean" || typeof j.offers_money !== "boolean"
    || typeof j.customer_asks_refund !== "boolean" || typeof j.reason !== "string") return null;
  return { mentions_money_back: j.mentions_money_back, offers_money: j.offers_money, customer_asks_refund: j.customer_asks_refund, reason: j.reason.trim() };
}

// A code twin for SAMPLE_MODE, deliberately wider than REFUND_WORDS (applied to normalizeReply text); it is not the guarantee, the live reader is.
// Bare "goodwill" is not in it: vague goodwill with no money is allowed (einh's A, 24 Oct 2026).
export const REDRESS_WORDS = /\b(?:(?:store )?credit(?!\s*card)|voucher|gift ?card|discount|coupon|compensat|waiv|cover(?:ing|ed)? (?:the|your|that|this) (?:cost|charge|fee|price)|goodwill (?:credit|payment|refund)|terugbetal|terugstort|rembours|erstatt|r(?:u|ue)ckerstatt|reembols|rimbors)/;

// The reader's reason is model text that may quote the draft or the customer; bound it before it reaches a trace line, a Risk reason or a prompt.
function capReason(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

export function sampleRead(draft, facts) {
  const hit = REDRESS_WORDS.exec(normalizeReply(draft?.text, facts?.cited_rows ?? []));
  return {
    mentions_money_back: Boolean(hit) || mentionsRefund(draft, facts?.cited_rows ?? []),
    offers_money: false,
    customer_asks_refund: refundAsked(facts),
    reason: `code rules: ${hit ? hit[0] : "no redress wording"}`,
    model: "sample/rules",
  };
}

// The only place the booleans become a verdict. Invariant: the result never clears a reason refundRuleReason would give, because the caller
// only runs the reader when refundRuleReason returned null (readRefund enforces it), and every branch here can only return a reason or null.
export function refundReaderReason(facts, draft, read) {
  const cat = facts?.category;
  if (cat === "refund" || !read) return null;
  const suffix = ` (reader: ${capReason(read.reason)})`;
  if (read.offers_money) return refundPromisedOutOfCategory(cat) + suffix;
  const mentions = read.mentions_money_back || mentionsRefund(draft, facts?.cited_rows ?? []);
  if (!mentions) return null;
  // einh's B, kept: the quote stays allowed only when BOTH readers say the customer asked
  if (cat === "question" && read.customer_asks_refund === true && refundAsked(facts)) return null;
  return refundOutOfCategory(cat) + suffix;
}

const yn = (b) => (b ? "yes" : "no");
const verdictOf = (r) => `mentions ${yn(r.mentions_money_back)}, offers ${yn(r.offers_money)}, customer asks ${yn(r.customer_asks_refund)}`;

export async function readRefund({ draft, facts, ticket, io, sampleOn, enabled, L, branch, round = 1, signal, recovered } = {}) {
  if (facts?.category === "refund" || draft?.failed || refundRuleReason(facts, draft) !== null) return { reason: null, read: null, model: null, status: "not_needed" };
  const base = { step: "nvidia.model", agent_name: "RefundReader", action: "read_refund", branch_id: branch, retry_count: round - 1 };
  const input_summary = `round ${round} draft, ${String(draft?.text ?? "").length} chars`;
  if (enabled === false) {
    L({ ...base, input_summary, status: "skipped", output_summary: "REFUND_READER=false: reader off, the word test stands" });
    return { reason: null, read: null, model: null, status: "skipped" };
  }
  const sampled = () => {
    const read = sampleRead(draft, facts);
    read.reason = capReason(read.reason);
    L({ ...base, input_summary, status: "skipped", model: "sample/rules", gate_source: "rules", output_summary: `sample mode: rules reader, no model call; ${verdictOf(read)}; ${read.reason}` });
    return { reason: refundReaderReason(facts, draft, read), read, model: "sample/rules", status: "skipped" };
  };
  if (sampleOn) return sampled();
  if (typeof io?.reader !== "function") return { reason: null, read: null, model: null, status: "not_wired" };
  const fail = (text) => {
    L({ ...base, input_summary, status: "error", gate_source: "nightshift", output_summary: text });
    L({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after RefundReader error", output_summary: "word test stands", status: "success" });
    return { reason: null, read: null, model: null, status: "error" };
  };
  try {
    // both signals bind: the run's (io.signal) and the round's (signal, cancelled when the critique dies), so a dying round never leaves a late line
    const signals = [io.signal, signal].filter(Boolean);
    const bound = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const res = await io.reader(readerMessages({ draft, facts, ticket }), { purpose: "refund_read", trace: io.adapterTrace, ...(bound ? { signal: bound } : {}) });
    if (res?.sample || res?.text == null) return sampled();
    const parsed = parseReaderJson(res.text);
    if (!parsed) {
      recovered?.push({ step: "nvidia.model", type: "BadResponse", message: "reader returned no valid JSON" });
      return fail("reader returned no valid JSON; the word test stands");
    }
    const read = { ...parsed, reason: capReason(parsed.reason) };
    L({ ...base, input_summary, status: "success", model: res.model, ...(res.lane === "local-lane" ? {} : { sponsor: "nvidia" }), gate_source: "nightshift", output_summary: `${verdictOf(read)}; ${read.reason}` });
    return { reason: refundReaderReason(facts, draft, read), read, model: res.model, status: "success" };
  } catch (e) {
    if (io?.signal?.aborted || signal?.aborted) throw e;
    const name = e?.name ?? "Error";
    const message = String(e?.message ?? e);
    recovered?.push({ step: "nvidia.model", type: name, message });
    return fail(`${name}: ${message}`);
  }
}

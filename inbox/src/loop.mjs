// The decision loop core: one ticket in, one decision (send, hold, escalate, close) out, every step traced.
// Order follows methodology.md. Every step the run does not reach is still logged, status "skipped".
import { join } from "node:path";
import { createServer } from "node:net";
import * as zetaris from "./adapters/zetaris.mjs";
import { config, sampleMode as isSampleMode, INBOX_ROOT } from "./config.mjs";
import { Trace, mask } from "./trace.mjs";
import { factsForTicket, findDuplicate as findDuplicateZetaris, ledgerAdjustFor, CATEGORIES } from "./queries.mjs";
import { ledgerAdjust as localLedgerAdjust } from "./decisions.mjs";
import { typedGates, trustFloor, hardRisk } from "./gates.mjs";
import { HMEM } from "./engines/hmem/index.mjs";
import { Scout } from "./engines/scout/index.mjs";
import { verifyContract } from "./engines/scout/contract.mjs";
import * as nightshift from "./adapters/nightshift.mjs";
import * as sample from "./adapters/sample.mjs";
import * as queries from "./queries.mjs";
import { parseRestricted } from "./queries.mjs";
import { appendIntake, publishIntake } from "./intake.mjs";
import { HANDLERS, resolveScenario, matchFaq, matchProductLookup, TOPIC_OF, FACT_NEEDS } from "./scenarios.mjs";
import { readRefund } from "./refund_reader.mjs";
import { draftMessages, evaluatorMessages, parseDraftJson, parseCriticJson, NUDGE, mentionsRefund, normalizeReply, REFUND_WORDS } from "./prompts.mjs";

// The 15 ids, in the methodology table order. (The actual trace order is the demo order: branch comes before nvidia.model.)
export const STEP_ORDER = [
  "memory.read", "planner.plan", "delegate", "executor.act", "zetaris.query",
  "meterless.engine", "nvidia.model", "branch", "critique", "risk.signoff",
  "retry", "escalate_or_fallback", "memory.write", "synthesis", "recovery",
];

const WHO = {
  "memory.read": ["Memory", "memory_read"], "planner.plan": ["Planner", "plan"], delegate: ["Planner", "delegate"],
  "executor.act": ["Executor", "act"], "zetaris.query": ["Executor", "sql"], "meterless.engine": ["Scout", "decide_contract"],
  "nvidia.model": ["Drafter", "draft_reply"], branch: ["Planner", "select_branch"], critique: ["Evaluator", "critique_draft"],
  "risk.signoff": ["Risk", "risk_signoff"], retry: ["Planner", "retry_round"], escalate_or_fallback: ["Escalator", "queue_for_human"],
  "memory.write": ["Memory", "memory_write"], synthesis: ["Planner", "synthesis"], recovery: ["Planner", "recover"],
};

// Branch ids: under-floor, over-limit, owner-out, send-ok, thank-you, misread, plus the grid's fact-block (a fact that
// may not leave: escalate), data-block (a check unavailable or a restricted fact in the message: hold), follow-up and duplicate.
// The duplicate lookup is queries.findDuplicate (the thread_fingerprints template through Zetaris).
// FAULT_ZETARIS_REFUSE_ONCE in sample mode: the first Zetaris call of the run goes through the real adapter with
// sample mode off and a loopback port that was bound and released, so the refusal is a genuine ECONNREFUSED.
// The adapter then answers from the cached rows (error line, then recovery line). Later calls stay in sample mode.
async function closedLoopbackUrl() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve("http://127.0.0.1:2"));
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(`http://127.0.0.1:${port}`));
    });
  });
}
function faultingSqlRun(cfg, trace) {
  let first = true;
  return async (sql, o) => {
    if (!first) return zetaris.sqlRun(sql, { ...o, cfg });
    first = false;
    const url = await closedLoopbackUrl();
    return zetaris.sqlRun(sql, { ...o, trace, retryDelayMs: 0, cfg: { ...cfg, SAMPLE_MODE: "false", ZETARIS_REST_URL: url } });
  };
}

const BRANCH_RE = /^amount .* over the policy limit/;
const LEGACY_CATEGORY = { "refund.request": "refund", "replacement.request": "replacement", complaint: "complaint", appreciation: "appreciation" };

// What a structured draft committed us to: "refund", "replacement" or null. Reads the promises fields first, then the reply text.
export function promisedKind(d) {
  const p = d?.promises ?? {};
  const text = String(d?.text ?? d?.reply_text ?? "");
  if (p.refund_amount != null || REFUND_WORDS.test(normalizeReply(p.other))) return "refund";
  if (p.replacement === true) return "replacement";
  if (mentionsRefund({ text, cited_rows: d?.cited_rows })) return "refund"; // the same word test as Risk; a draft handed over carries the row ids it cited
  return null;
}

// Pure. gates and memory may be null (the planner calls it before the gates have run).
export function decideBranch(facts, gates, memory, extra = {}) {
  const b = decideBranchCore(facts, gates, memory, extra);
  const fc = facts?.fallback_contact;
  return fc && b?.why ? { ...b, why: `${b.why}; routed to the default contact ${fc.email} (${fc.cited})` } : b;
}

// A restricted term from the what-may-leave page written in the customer's own message, or a card number when that page restricts card numbers.
// Pure; returns a short phrase or null. The authored may_leave flag is a different thing (fact-block).
const CARD_NUMBER = /(?<![\d-])(?:\d[ -]?){13,19}(?![\d-])/;
export function restrictedInMessage(facts) {
  const text = `${facts?.subject ?? ""}\n${facts?.body ?? ""}`;
  const low = text.toLowerCase();
  const terms = (facts?.restricted_terms ?? []).filter(Boolean);
  const hit = terms.find((t) => low.includes(String(t).toLowerCase()));
  if (hit) return `"${hit}"`;
  if (terms.some((t) => /card/i.test(t)) && CARD_NUMBER.test(text.replace(/\b(?:JP|FS)-[A-Z]?\d+\b/g, ""))) return "a card number";
  return null;
}

function decideBranchCore(facts, gates, memory, extra = {}) {
  const ticket = facts.ticket ?? {};
  const g = gates?.answers ?? {};
  const followUp = Number(g.is_follow_up ?? 0);
  if (extra.prior_draft) {
    // The chain path (deps.priorDraft): the misread is decided by comparing what the earlier reply PROMISED with what was asked,
    // not by the authored follow_up_kind. A correct earlier draft is not a misread.
    const promised = promisedKind(extra.prior_draft);
    if ((facts.follow_up_kind || followUp >= 0.5) && promised && promised !== facts.category) {
      return { branch_id: "misread", why: `the customer says the earlier reply misread the ask (our earlier draft promised "${promised}", they asked for "${facts.category}")` };
    }
  } else if (facts.follow_up_kind === "misread" || (followUp >= 0.5 && ticket.agent_category && ticket.agent_category !== facts.category)) {
    return { branch_id: "misread", why: `the customer says the earlier reply misread the ask (we answered "${ticket.agent_category || "?"}", they asked for "${facts.category}")` };
  }
  if (facts.category === "appreciation" && facts.follow_up_kind === "thank-you") {
    return { branch_id: "thank-you", why: "a pure thank-you with no new question: nothing to send" };
  }
  if (facts.follow_up_kind === "follow-up") {
    return { branch_id: "follow-up", why: "a follow-up on an open ticket: the ticket stays open, nothing new is sent" };
  }
  // einh, 24 Oct 2026 (challengetrack wins): a fact that may not leave is ESCALATED to the owner, not held. It outranks every check below.
  if (facts.may_leave === false) {
    return { branch_id: "fact-block", why: "the cited fact may not leave the company: external-data block, escalated to the owner" };
  }
  if (extra.duplicate_of) {
    return { branch_id: "duplicate", why: `the same sender, subject and body as earlier thread ${extra.duplicate_of.thread_id}: closed as a duplicate` };
  }
  // a restricted fact (a card number, a staff price list) in the customer's own message wins over the trust floor: held for a person, no draft (H16)
  const sensitive = restrictedInMessage(facts);
  if (sensitive) {
    return { branch_id: "data-block", restricted: sensitive, why: `the message carries ${sensitive}, which may not leave the company: external-data block, held for a person` };
  }
  if (facts.amount != null && facts.policy_limit != null && facts.amount > facts.policy_limit) {
    return { branch_id: "over-limit", why: `amount ${facts.amount} GC is over the ${facts.policy_limit} GC policy limit` };
  }
  if (facts.owner_out && facts.backup_out) {
    return { branch_id: "owner-out", why: `${facts.backup_id == null ? `owner ${facts.owner_id} is out and no backup is named` : `owner ${facts.owner_id} and backup ${facts.backup_id} are both out`} on ${facts.as_of ?? "the day"}` };
  }
  const tf = trustFloor(facts, gates ?? undefined, extra.ledgerAdjust ? { ledgerAdjust: extra.ledgerAdjust } : undefined);
  if (tf.under) {
    const who = facts.owner_out ? `owner ${facts.owner_id} out, ${facts.backup_id == null ? "no backup named" : `backup ${facts.backup_id} ${facts.backup_out ? "out" : "in"}`}` : `owner ${facts.owner_id} in`;
    const noAmount = facts.amount == null && /refund/.test(String(facts.category)) ? `; no amount stated${facts.channel_public ? ` on a public channel (channels:${facts.channel})` : ""}` : "";
    return { branch_id: "under-floor", why: `${tf.category ?? facts.category} weight ${tf.weight} is under the floor ${tf.floor}; ${who}${noAmount}${memory?.length ? "; memory consulted" : ""}` };
  }
  const unavailable = [...(extra.checks_unavailable ?? []), ...(facts.disclosure_unknown === true ? ["disclosure policy"] : [])];
  if (unavailable.length) {
    return { branch_id: "data-block", checks_unavailable: unavailable, why: `${unavailable.join(" and ")} unavailable: a reply cannot be cleared to send, held for a person` };
  }
  return { branch_id: "send-ok", why: `weight ${tf.weight} meets the floor ${tf.floor}, within the limit, someone is available` };
}

class Stop extends Error {}

const errName = (e) => e?.name ?? "Error";
// Public text never carries a host path: an absolute path (the memory dir, INBOX_ROOT, the os tmp dir, a Windows drive path) becomes "<path>/<last part>".
// The full message stays server-side (serverLog), never in a trace line or the journey.
const redactPaths = (t) => String(t)
  .replace(/(?<![\w:.\/])[A-Za-z]:[\\/](?:[^\\/\s'"`,;)]+[\\/])*[^\\/\s'"`,;)]*/g, (m) => `<path>/${m.split(/[\\/]/).filter(Boolean).pop() ?? ""}`)
  .replace(/(?<![\w:.\/])\/(?:[\w.@+~-]+\/)*[\w.@+~-]+/g, (m) => `<path>/${m.split("/").filter(Boolean).pop() ?? ""}`);
const safeMsg = (e) => redactPaths(String(mask(String(e?.message ?? e))));
export const redactHostPaths = redactPaths;
const serverLog = (quiet, step, e) => { if (!quiet) console.error(`[loop] ${step}: ${errName(e)}: ${String(e?.message ?? e)}`); };
// A buffered trace line keeps the moment it was recorded (`at`), so its timestamp and duration_ms are when the step ran, not when the buffer was written out.
const stampedBuffer = () => { const a = []; a.push = (...xs) => Array.prototype.push.apply(a, xs.map((x) => (x && x.at === undefined ? { ...x, at: Date.now() } : x))); return a; };
// Cut at a word boundary with "…" when the text is longer than n; never mid-word.
const one = (s, n = 220) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const head = t.slice(0, n);
  const sp = head.lastIndexOf(" ");
  const cut = sp >= Math.floor(n / 2) ? head.slice(0, sp) : head;
  return `${cut.replace(/[\s,;:.\-(]+$/, "")}\u2026`;
};

// The approver of an over-limit amount: the policy's over-limit owner (facts.owner_*), or its backup when the owner is out.
const approverOf = (f) => (f?.owner_out && !f?.backup_out
  ? { id: f.backup_id ?? null, name: f.backup_name ?? null }
  : { id: f?.owner_id ?? null, name: f?.owner_name ?? null });
const overLimit = (f) => f?.amount != null && f?.policy_limit != null && f.amount > f.policy_limit;

// The default hardRefusal of replyLoop: an amount over the policy limit is a hard fact on the round it appears. Risk refuses and the
// ticket goes to the approver (unless owner and backup are both out). Returns the refusal reason, or null.
export function overLimitRefusal(f) {
  if (!overLimit(f) || (f.owner_out && f.backup_out)) return null;
  const ap = approverOf(f);
  return `amount ${f.amount} GC is over the ${f.policy_limit} GC limit: needs approval by ${ap.name ?? `employee ${ap.id}`} (policy over-limit owner)`;
}

// P11 (einh's board, 24 Oct 2026): above the approver's limit the draft says "routed for approval" and never promises a refund, an amount or a date.
export const OVER_LIMIT_LINE = "The amount is above the approver's limit: say the request has been routed for approval; never promise a refund, an amount or a date.";
const MONEY_PROMISE = /\b(?:we|i)(?:'ll|\s+will|\s+are\s+going\s+to|\s+can|\s+shall)\s+(?:gladly\s+)?(?:refund|reimburse|credit|pay)\b|\b(?:refund|reimburse)(?:ed|ing)?\s+(?:you|of)\b|\b\d[\d.,]*\s*(?:gc|galactic credits?)\b|\b20\d\d-\d\d-\d\d\b|\b(?:by|on|before|within)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|\d)/i;
// Does an over-limit draft promise money: a refund amount in its promises, or the amount, a date or "we will refund" in its words?
export function promisesMoney(d, f) {
  if (!d || d.failed) return false;
  if (d.promises?.refund_amount != null) return true;
  const text = String(d.text ?? "");
  if (MONEY_PROMISE.test(text)) return true;
  return f?.amount != null && new RegExp(`(^|[^\\d.])${String(f.amount).replace(/\.0+$/, "").replace(".", "\\.")}(?:\\.0+)?([^\\d]|$)`).test(text);
}

// The ONE send-eligibility rule (Codex 29, finding 2): a decision "send" needs a non-empty draft and a channel whose row does not say
// autonomous_reply false (channels.csv). Every send path asks here; a send that fails it becomes a hold for the owner.
export function sendEligible(facts, draft) {
  return String(draft?.text ?? "").trim().length > 0 && facts?.channel_autonomous !== false;
}
export const sendBlockReason = (facts, draft) => (facts?.channel_autonomous === false
  ? `channels:${facts.channel ?? "?"}: replies on this channel are sent by a person`
  : String(draft?.text ?? "").trim().length === 0 ? "no draft to send" : null);
// The deterministic words an over-limit draft is replaced by when it still promises money after its one rewrite (Codex 29, finding 4).
export const APPROVAL_ACK = "Thank you for your request. It has been routed for approval and we will come back to you.";

// The reply rounds: draft, critique, Risk sign-off, one retry. Reads everything from the toolbox tb
// ({ f, ticket, L, skipped, fatal, S, sampleOn, memCtx, hardRisk, maxRounds, io: { drafter, sampleDrafter, critic, reader, adapterTrace }, readerOn }).
//   messagesFn({ critiques }) -> drafter messages        (default: the draftMessages of the ticket, facts and memory)
//   sampleDraftFn(seed)       -> sample-mode draft        (default: the run's sample drafter)
//   hardRefusal(f, draft, n)  -> a reason string that makes the round a hard Risk refusal, or null (default: the over-limit rule)
// Returns { draft, crit, risk, rounds, retried, ok }; rounds is the number of rounds run.
export async function replyLoop(tb, { messagesFn, sampleDraftFn, branch, maxRounds, hardRefusal } = {}) {
  const { f, ticket, L, skipped, fatal, S, sampleOn, memCtx, io } = tb;
  const B = branch ?? S.branch?.branch_id;
  const max = maxRounds ?? tb.maxRounds ?? 2;
  const ctxFacts = { ...f, backup: f.backup_name };
  const msgs = messagesFn ?? (({ critiques }) => draftMessages({ ticket, facts: f, memoryContext: memCtx, critiques }));
  const sampleDraft = sampleDraftFn ?? ((seed, o = {}) => io.sampleDrafter(f.ticket ?? ticket, ctxFacts, { seed, ...o }));
  const refusalOf = hardRefusal ?? ((ff) => overLimitRefusal(ff));
  let refused = false;
  // the approval path: an amount over the limit with someone to approve it (the default hardRefusal; a caller's own refusal is not this path)
  const approvalPath = !hardRefusal && Boolean(overLimitRefusal(f));

  const makeDraft = async (seed, critiques, n) => {
    const sampled = () => {
      const d = sampleDraft(seed, { overLimit: approvalPath });
      L({ step: "nvidia.model", agent_name: "Drafter", action: n > 1 ? "draft_revised" : "draft_reply", model: d.model, input_summary: `round ${n}, seed ${seed}`, output_summary: "sample mode: rules drafter, no model call", status: "skipped", branch_id: B, retry_count: n - 1 });
      S.models.drafter = d.model;
      return { text: d.text, promises: d.promises, model: d.model };
    };
    if (sampleOn) return sampled();
    let messages = msgs({ critiques });
    if (approvalPath) messages = messages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: `${m.content}\n${OVER_LIMIT_LINE}` } : m));
    let res;
    try {
      res = await io.drafter(messages, { purpose: "draft", trace: io.adapterTrace, signal: io.signal });
    } catch (e) {
      fatal("nvidia.model", e, "drafter failed, escalated to human");
    }
    if (res.sample || res.text == null) return sampled();
    let parsed = parseDraftJson(res.text);
    let firstModel = null;
    if (!parsed) {
      firstModel = res.model;
      try {
        res = await io.drafter([...messages, { role: "assistant", content: String(res.text) }, { role: "user", content: NUDGE }], { purpose: "draft", trace: io.adapterTrace, signal: io.signal });
        parsed = parseDraftJson(res.text);
      } catch (e) {
        fatal("nvidia.model", e, "drafter failed on the JSON nudge, escalated to human");
      }
    }
    S.models.drafter = res.model;
    L({
      step: "nvidia.model", agent_name: "Drafter", action: n > 1 ? "draft_revised" : "draft_reply", model: res.model, ...(res.lane === "local-lane" ? {} : { sponsor: "nvidia" }),
      input_summary: `round ${n}${critiques.length ? ", with both critiques" : ""}`,
      output_summary: (parsed ? `drafted ${parsed.text.length} chars; promises ${JSON.stringify(parsed.promises)}` : "no valid JSON after one nudge; treated as needs_revision")
        + (firstModel !== null ? `; models: ${firstModel}, then ${res.model}` : ""),
      status: parsed ? "success" : "needs_revision", branch_id: B, retry_count: n - 1,
    });
    return parsed ? { ...parsed, model: res.model } : { text: "", promises: null, model: res.model, failed: true };
  };

  const doCritique = async (draft, n) => {
    let r;
    if (draft.failed) r = { pass: false, reason: "the drafter returned no usable JSON", model: draft.model };
    else {
      try {
        r = sampleOn ? io.sampleCritic(draft, f) : await io.critic({ draft, facts: f, ticket, trace: io.adapterTrace });
      } catch (e) {
        fatal("critique", e, "evaluator failed, escalated to human");
      }
    }
    S.models.evaluator = r.model;
    L({ step: "critique", agent_name: "Evaluator", action: "critique_draft", target_agent: "Planner", model: r.model, branch_id: B, retry_count: n - 1,
      input_summary: `round ${n} draft, ${draft.text.length} chars`, output_summary: `${r.pass ? "Pass" : "Fail"}. ${one(r.reason)}`, status: r.pass ? "success" : "needs_revision", memory_ids: S.memRead });
    return r;
  };

  // The refund Reader (24 Oct 2026): beside the Evaluator, a model read of a non-refund draft for money back in any wording; its signal is the round's.
  const doRead = (draft, n, signal) => readRefund({ draft, facts: f, ticket, io, sampleOn, enabled: tb.readerOn !== false, L, branch: B, round: n, signal, recovered: S.recovered });

  const doRisk = (draft, n, readerReason = null) => {
    const hr = draft.failed ? { reasons: ["no usable draft"] } : tb.hardRisk(f, draft);
    const bothOut = Boolean(f.owner_out && f.backup_out);
    const refusal = refusalOf(f, draft, n) ?? null;
    if (refusal) refused = true;
    const reasons = hr.reasons.filter((r) => !BRANCH_RE.test(r) && !(refusal && /^draft promises refund above/.test(r)));
    if (refusal) reasons.unshift(refusal);
    if (readerReason) reasons.push(readerReason); // a reader catch is a negative round, never hard (einh's pick 3 A, 24 Oct 2026)
    const hard = f.may_leave === false || bothOut || Boolean(refusal);
    const pass = reasons.length === 0;
    const noted = "";
    L({ step: "risk.signoff", agent_name: "Risk", action: "risk_signoff", sponsor: "meterless", branch_id: B, retry_count: n - 1,
      input_summary: `round ${n} draft vs facts, Scout risk ${S.scoutRisk}`,
      output_summary: pass ? `Signed off.${noted}` : `${hard ? "Refused" : "Not signed"}: ${reasons.join("; ")}`,
      status: pass ? "success" : hard ? "refused" : "needs_revision" });
    return { pass, reasons, hard, level: S.scoutRisk };
  };

  let draft = await makeDraft("correct", [], 1);
  if (!draft.failed) S.draft = { text: draft.text, promises: draft.promises, model: draft.model }; // kept even if a later gate dies, so a chain can hand it on
  let round = 1;
  let retried = false;
  let crit, risk;
  for (;;) {
    // critique and reader run side by side; a dying critique (fatal throws Stop) cancels the reader so no late line lands after the escalation
    const readAbort = new AbortController();
    const readP = doRead(draft, round, readAbort.signal);
    let c;
    try { c = await doCritique(draft, round); } catch (e) { readAbort.abort(e); await readP.catch(() => {}); throw e; }
    const rd = await readP;
    crit = c;
    if (rd.status === "success") S.models.reader = rd.model;
    risk = doRisk(draft, round, rd.reason);
    S.rounds.push({ n: round, critique: crit, risk });
    // an over-limit hard refusal still gets ONE rewrite when the draft promised money (P11); then the approval escalate
    const rewriteForApproval = approvalPath && !retried && risk.hard && promisesMoney(draft, f) && f.may_leave !== false;
    if ((crit.pass && risk.pass) || round >= max || (risk.hard && !rewriteForApproval)) break;
    // a negative round, gate not met: retry
    const next = "decline anything above the limit, promise only what the cited rows allow, mention a refund only on a refund request or a question about refunds in any wording or language, and name who follows up";
    const both = [`Evaluator: ${crit.reason}`, `Risk: ${risk.reasons.join("; ") || "signed off"}`];
    L({ step: "retry", agent_name: "Planner", action: "retry_round", target_agent: "Drafter", branch_id: B, retry_count: round, input_summary: `round ${round} negative`,
      output_summary: `${both.join(" | ")}. Next draft must: ${next}`, status: "retrying", memory_ids: S.memRead });
    retried = true;
    L({ step: "planner.plan", agent_name: "Planner", action: "plan_revision", branch_id: B, retry_count: round, input_summary: "both critiques",
      output_summary: `revised plan: branches reply-now vs hold-or-escalate; keep ${B}, redraft once with both critiques, then gate`, status: "success", memory_ids: S.memRead });
    draft = await makeDraft("revised", both, round + 1);
    round += 1;
  }
  if (approvalPath && promisesMoney(draft, f)) {
    // the one rewrite round did not remove the promise: nothing the model wrote is attached; the approver gets the fixed acknowledgement
    L({ step: "nvidia.model", agent_name: "Drafter", action: "draft_replaced", model: "template/approval-ack", branch_id: B, retry_count: round - 1,
      input_summary: `round ${round} draft still promises money after the rewrite`, output_summary: "replaced by the approval acknowledgement (code, no amount, no date); the model draft is not attached", status: "success" });
    draft = { text: sample.frame({ sender_name: f.sender_name }, APPROVAL_ACK), promises: { refund_amount: null, replacement: false, other: null }, model: "template/approval-ack" };
  }
  S.draft = { text: draft.text, promises: draft.promises, model: draft.model };
  const ok = Boolean(crit.pass && risk.pass);
  if (!retried) skipped("retry", refused && overLimitRefusal(f) ? "hard refusal: amount needs approval" : risk.hard && !ok ? "hard fact: a rewrite cannot change it" : "round 1 passed");
  return { draft, crit, risk, rounds: round, retried, ok };
}

export async function runTicket(thread_id, { run_id = `run-${Date.now().toString(36)}`, as_of, cfg = config(), deps = {}, input = null } = {}) {
  const isMsg = typeof input?.message === "string" && input.message.length > 0;
  if (isMsg && !as_of && input.as_of) as_of = input.as_of;
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  const maxRounds = deps.maxRounds ?? 2;
  const runTimeoutMs = deps.runTimeoutMs ?? 300000;
  const sampleOn = isSampleMode(cfg);
  const memoryDir = deps.memoryDir ?? join(INBOX_ROOT, "data", "memory");
  const secret = cfg.SCOUT_SECRET ?? process.env.SCOUT_SECRET ?? "dev-secret";

  const trace = Trace.open(run_id, { ...(deps.logsDir ? { logsDir: deps.logsDir } : {}), ...(deps.quiet ? { stdout: false } : {}) });
  const S = {
    aborted: false, facts: null, recovered: [], decision: null, reasons: [], draft: null, rounds: [], models: {},
    memRead: [], memWritten: [], branch: null, queued: null, current: "memory.read", scoutRisk: null,
    scenario: { scenario: "legacy", how: "thread" }, recommendation: undefined, extraCited: [], msg: null,
    meta: {}, emailRecall: 0, autoReply: false, gates: null, ledger: { affirmed: 0, rejected: 0 },
  };
  // ---- what the queue entry and the output say about who holds the ticket, and what memory knows (item 10) ----
  const emailKey = (e) => String(e ?? "").trim().toLowerCase();
  // einh's sentence, for ANY count of 1 or more, never a second wording
  const secondRefund = () => {
    const p = S.facts?.prior_refunds;
    return p && p.count >= 1 ? `Second Refund Request from this client (${p.count} earlier: ${p.thread_ids.join(", ")}).` : null;
  };
  const memoryNote = () => [secondRefund(), S.emailRecall > 0 ? `H-MEM recalls ${S.emailRecall} earlier decision(s) for this client.` : null].filter(Boolean).join(" ") || null;
  // the person who actually holds the ticket: the backup when the owner is out and the backup is in, else the owner
  const queueMeta = (over = {}) => {
    const f = S.facts;
    const backupHolds = Boolean(f?.owner_out && !f?.backup_out && f?.backup_id != null);
    const ov = { ...S.meta, ...over };
    return {
      team: ov.team ?? (backupHolds ? f?.backup_team : f?.owner_team) ?? null,
      team_label: ov.team_label !== undefined ? ov.team_label : ((backupHolds ? f?.backup_team_label : f?.owner_team_label) ?? null),
      backup_team: ov.backup_team ?? f?.backup_team ?? null,
      topic_label: ov.topic_label ?? f?.topic_label ?? null,
      cc: ov.cc ?? [], also: ov.also ?? [],
      status: ov.status ?? "open",
      ...(ov.courtesy_reply === true ? { courtesy_reply: true } : {}),
      auto_reply: false,
      memory_note: memoryNote(),
      channel_label: f?.channel_label ?? null,
    };
  };
  // The one choke point: every line (direct, buffered-then-flushed, finalisation) is written here, then handed to deps.onLine.
  const restrictedGateSkip = (id, model) => ({ step: "nvidia.model", agent_name: "Gates", action: "typed_gates", sponsor: "nvidia", model, gate_source: "rules", confidence: 0.5,
    input_summary: `typed gates for ${id}`, output_summary: "skipped: restricted fact in the message, so no model receives the text; code rules used", status: "skipped" });
  const W = (f) => {
    const out = trace.line(f);
    if (typeof deps.onLine === "function") deps.onLine(out);
    return out;
  };
  const L = (f) => (S.aborted ? null : W(f));
  const F = (f) => W(f); // finalisation lines, written even after a timeout
  // adapters get a trace whose lines never carry a null sponsor (Trace.line rejects it)
  const adapterTrace = { line: (f) => L(f.sponsor === null ? { ...f, sponsor: undefined } : f) };
  const skipped = (step, why, extra = {}, w = L) => w({
    step, agent_name: WHO[step][0], action: WHO[step][1], input_summary: why ?? "not reached on this branch",
    output_summary: "gate not reached", status: "skipped", ...(S.branch ? { branch_id: S.branch.branch_id } : {}), ...extra,
  });

  // H-MEM init is guarded: a failing persistDir does not throw out of runTicket. memory.read reports it as a soft error inside the
  // pipeline; the queue write and the memory write then fail through their own existing error + recovery paths.
  let hmemInitErr = null;
  let hmem;
  if (deps.hmem && typeof deps.hmem.query === "function") hmem = deps.hmem;
  else {
    try { hmem = new HMEM({ persistDir: deps.hmem?.persistDir ?? memoryDir, clock }); } catch (e) {
      hmemInitErr = e;
      const down = () => { throw hmemInitErr; };
      hmem = { query: down, add: down, queueForHuman: down };
    }
  }
  const runAbort = new AbortController();
  const scout = deps.scout ?? new Scout({ intentRegistry: join(INBOX_ROOT, "src", "engines", "scout", "intents.inbox.json"), policyPack: ["default"], secret });
  const gatesFn = deps.gates ?? typedGates;
  const runtimeDir = deps.runtimeDir ?? null;
  const refuseOnce = sampleOn && String(cfg.FAULT_ZETARIS_REFUSE_ONCE) === "true";
  const factsFn = deps.facts ?? ((id, o) => factsForTicket(id, { ...o, cfg, runtimeDir: deps.runtimeDir ?? join(INBOX_ROOT, "data", "runtime"), ...(refuseOnce ? { sqlRunImpl: faultingSqlRun(cfg, o.trace) } : {}) }));
  const findDup = deps.findDuplicate ?? ((tk, o) => findDuplicateZetaris(tk, { cfg, trace: o.trace, runtimeDir: deps.runtimeDir ?? join(INBOX_ROOT, "data", "runtime") }));
  const ledgerFn = deps.ledgerAdjust ?? ((category, o) => (sampleOn
    ? localLedgerAdjust(category, deps.decisionsDir ? { dir: deps.decisionsDir } : undefined)
    : ledgerAdjustFor(category, { cfg, trace: o.trace })));
  const drafter = deps.drafter ?? ((messages, o) => nightshift.draft(messages, { cfg, trace: o.trace, purpose: o.purpose, signal: o.signal ?? runAbort.signal }));
  const sampleDrafter = deps.sampleDrafter ?? sample.draft;
  const sampleCritic = deps.sampleCritic ?? sample.critique;
  const reader = deps.reader ?? ((messages, o) => nightshift.draft(messages, { cfg, trace: o.trace, purpose: "refund_read", signal: o.signal ?? runAbort.signal }));
  const critic = deps.critic ?? (async ({ draft, facts, ticket }) => {
    const r = await nightshift.draft(evaluatorMessages({ draft, facts, ticket }), { cfg, trace: adapterTrace, purpose: "critique", signal: runAbort.signal });
    const j = parseCriticJson(r.text);
    return j ? { ...j, model: r.model } : { pass: false, reason: "evaluator returned no valid JSON", model: r.model };
  });

  // Log an error line, then the recovery line, then stop the pipeline (the run still ends with a result).
  const fatal = (step, e, recoveryText) => {
    serverLog(deps.quiet, step, e);
    S.recovered.push({ step, type: errName(e), message: safeMsg(e) });
    L({ step, agent_name: WHO[step][0], action: WHO[step][1], input_summary: `${step} failed`, output_summary: `${errName(e)}: ${safeMsg(e)}`, status: "error" });
    L({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: `after ${step} error`, output_summary: recoveryText, status: "success" });
    throw new Stop(recoveryText);
  };
  // Same, for a step the run can survive.
  const soft = (step, e, recoveryText, { agent, action } = {}) => {
    serverLog(deps.quiet, step, e);
    S.recovered.push({ step, type: errName(e), message: safeMsg(e) });
    L({ step, agent_name: agent ?? WHO[step][0], action: action ?? WHO[step][1], input_summary: `${step} failed`, output_summary: `${errName(e)}: ${safeMsg(e)}`, status: "error" });
    L({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: `after ${step} error`, output_summary: recoveryText, status: "success" });
  };

  // owner: { owner_id, backup_id, owner_name, backup_name, role } lets a handler name who it escalates to (default: the facts' owner and backup).
  // Options also carry the queue-entry fields a handler decides: team, team_label, backup_team, topic_label, cc[], also[], status.
  const escalate = (critiques, reason, extra = {}, { approval = null, draft = null, owner = null, attachments, recommendation, escalation, team, team_label, backup_team, topic_label, cc, also, status, courtesy_reply } = {}) => {
    const f = S.facts;
    const ownerId = owner?.owner_id ?? f?.owner_id ?? null;
    const backupId = owner?.backup_id ?? f?.backup_id ?? null;
    const ticketObj = { ...(f?.ticket ?? {}), id: thread_id, thread_id, ...(f ? { category: f.category, decision_reason: reason } : {}),
      ...(approval ? { approval } : {}), ...(draft ? { draft: { text: draft.text, promises: draft.promises } } : {}) };
    const fc = owner?.fallback_contact ?? f?.fallback_contact ?? null;
    S.meta = { ...S.meta, ...Object.fromEntries(Object.entries({ team: team ?? owner?.team, team_label: team_label ?? owner?.team_label, backup_team, topic_label, cc, also, status, courtesy_reply }).filter(([, v]) => v !== undefined)) };
    const meta = queueMeta();
    let memId = null;
    let queueFailed = false;
    try {
      memId = hmem.queueForHuman(ticketObj, critiques, {
        owner: { owner_id: ownerId, backup_id: backupId, owner_name: owner?.owner_name ?? f?.owner_name ?? null, backup_name: owner?.backup_name ?? f?.backup_name ?? null, role: owner?.role ?? (fc ? "default contact" : null), team: meta.team, team_label: meta.team_label, ...(fc ? { fallback_contact: fc } : {}) },
        scenario: S.scenario?.scenario ?? null, recommendation: recommendation ?? null, attachments: attachments ?? null, escalation: escalation ?? null,
        cc: meta.cc, also: meta.also, status: meta.status, courtesy_reply: meta.courtesy_reply,
      });
    } catch (e) {
      queueFailed = true;
      soft("escalate_or_fallback", e, "queue write failed; ticket left with the logged critiques for a human");
    }
    const tid = String(thread_id).replace(/[^A-Za-z0-9._-]/g, "_");
    const queue_file = join(memoryDir, "queue", `${tid}.json`);
    const queue_name = `queue/${tid}.json`; // the trace names the file inside the memory dir, never the server's absolute path
    S.decision = "escalate";
    S.queued = { owner_id: ownerId, backup_id: backupId, owner_name: f?.owner_name ?? null, backup_name: f?.backup_name ?? null, queue_file: queueFailed ? null : queue_file, ...(approval ? { approval } : {}),
      ...(attachments !== undefined ? { attachments } : {}), ...(recommendation !== undefined ? { recommendation } : {}), ...(escalation !== undefined ? { escalation } : {}),
      ...(owner?.owner_name !== undefined ? { owner_name: owner.owner_name } : {}), ...(owner?.backup_name !== undefined ? { backup_name: owner.backup_name } : {}),
      ...(owner?.role !== undefined ? { role: owner.role } : {}),
      ...(fc ? { fallback_contact: fc, role: "default contact" } : {}), ...meta };
    if (memId) S.memWritten.push(memId);
    L({
      step: "escalate_or_fallback", agent_name: "Escalator", action: "queue_for_human", target_agent: "Human",
      input_summary: one(reason), output_summary: approval
        ? `escalated to ${approval.approver_name ?? `employee ${approval.approver_id}`} (employee ${approval.approver_id}) for approval of ${approval.amount} GC over the ${approval.limit} GC limit; the draft is attached for approval; ${queueFailed ? "the queue write failed, the draft and both critiques are in this trace" : `draft and both critiques stored in ${queue_name}`}`
        : fc ? `escalated to the default contact ${fc.email} (${backupId == null ? `owner ${ownerId ?? "?"} out, no backup named` : `owner ${ownerId ?? "?"} and backup ${backupId} both out`}); ${queueFailed ? "the queue write failed, both critiques are in this trace" : `both critiques stored in ${queue_name}`}`
        : `escalated to owner ${ownerId ?? "?"} / backup ${backupId ?? "?"}; ${queueFailed ? "the queue write failed, both critiques are in this trace" : `both critiques stored in ${queue_name}`}`,
      status: queueFailed ? "incomplete" : "success", ...(S.branch ? { branch_id: S.branch.branch_id } : {}), ...(memId ? { memory_ids: [memId] } : {}), ...extra,
    });
    S.reasons.push(reason);
  };

  // A decision "send" that fails sendEligible becomes a hold for the owner, the draft kept (Codex 29, finding 2).
  const settleSend = () => {
    if (S.decision !== "send" || sendEligible(S.facts, S.draft)) return false;
    const why = sendBlockReason(S.facts, S.draft);
    S.decision = "hold";
    S.autoReply = false;
    S.meta = { ...S.meta, status: "open" };
    S.reasons.push(`held for owner ${S.facts?.owner_id ?? "?"}, draft kept: ${why}`);
    L({ step: "planner.plan", agent_name: "Planner", action: "send_check", branch_id: S.branch?.branch_id, input_summary: "send eligibility", output_summary: `send refused, held for a person: ${why}`, status: "success", memory_ids: S.memRead });
    return true;
  };

  async function pipeline() {
    // Facts first, silently: memory.read needs the customer's name. Their zetaris.query lines are logged at step 4.
    const buf = stampedBuffer();
    let factsErr = null;
    const o = { as_of, trace: { line: (f) => buf.push(f) } };
    // A free-text message: append the intake row, publish it, then run Scout and the gates SILENTLY (their lines are written at their usual
    // positions below) so the scenario, and with it the topic the facts are read for, is known before the facts read.
    let preDecided = null;
    let preErr = null;
    let preGates = null;
    let preGbuf = stampedBuffer();
    const factsOpts = {};
    if (isMsg) {
      S.current = "executor.act";
      const dir = deps.runtimeDir ?? join(INBOX_ROOT, "data", "runtime");
      const received_at = new Date(clock()).toISOString();
      const { thread_id: tid, row } = await appendIntake({ message: input.message, from: input.from, name: input.name, subject: input.subject, channel: input.channel,
        scenario: input.scenario ?? "free_text", received_at }, { runtimeDir: dir });
      thread_id = tid;
      const pub = await publishIntake({ cfg, runtimeDir: dir });
      if (pub.error) {
        buf.push({ step: "zetaris.query", agent_name: "Executor", action: "intake_publish", sponsor: "zetaris", input_summary: `intake row ${tid} → JEDI_PACK.intake_runtime`,
          output_summary: `published: false (${one(pub.error, 160)}); the row is read locally`, status: "error" });
        buf.push({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after intake_publish error", output_summary: "intake publish unavailable: the ticket row is read from the local file", status: "success" });
      } else {
        buf.push({ step: "zetaris.query", agent_name: "Executor", action: "intake_publish", sponsor: "zetaris", input_summary: `intake row ${tid} → JEDI_PACK.intake_runtime`,
          output_summary: pub.published ? "published: true, uncached: true" : `published: false (${one(pub.reason ?? "not published", 120)}); the row is read locally`, status: "success",
          detail: pub.published ? `the new message was saved as ${tid} and published, so the next read sees it` : `the new message was saved as ${tid}; it was not published, so it is read from the local file` });
      }
      S.msg = { row, published: pub.published === true };
      const rowTicket = { ...row, thread_id: tid };
      try {
        preDecided = await scout.decide({ prompt: `${row.subject ?? ""}\n${row.body}`, user: { id: "inbox-loop", roles: ["agent"] }, surface: "email" });
      } catch (e) {
        preErr = e;
      }
      // Scout's contract and risk block are checked BEFORE any model call: a refused message never reaches the gates.
      let scoutRefused = preErr != null || !preDecided;
      if (!scoutRefused) {
        try {
          scoutRefused = !verifyContract(preDecided.executionContract, { secret: scout.secret ?? secret }).ok || preDecided.risk?.level === "block";
        } catch { scoutRefused = true; }
      }
      // a restricted fact in the customer's own words (a card number, a staff price): no model call receives the raw text
      let msgRestricted = null;
      if (!scoutRefused) {
        let terms = [];
        try { terms = parseRestricted((await queries.run("wiki", { wiki: "leave" }, { cfg, trace: { line: () => {} } })).objects[0]?.preview); } catch { terms = []; }
        msgRestricted = restrictedInMessage({ subject: row.subject, body: row.body, restricted_terms: terms });
      }
      if (!scoutRefused && msgRestricted) {
        const g = sample.gates(rowTicket);
        preGates = { answers: g.answers, model: g.model, gate_source: "rules", confidence: 0.5 };
        preGbuf.push(restrictedGateSkip(rowTicket.thread_id, g.model));
      } else if (!scoutRefused) {
        try {
          preGates = await gatesFn(rowTicket, {}, { trace: { line: (x) => preGbuf.push(x) }, cfg, sampleMode: sampleOn, signal: runAbort.signal });
        } catch (e) {
          soft("nvidia.model", e, "typed gates failed, used code rules");
          const g = sample.gates(rowTicket);
          preGates = { answers: g.answers, model: g.model, gate_source: "rules", confidence: 0.5 };
        }
      }
      let faqHit = null;
      try {
        faqHit = matchFaq(row.body, (await queries.run("faq", {}, { cfg, trace: { line: () => {} } })).objects);
      } catch { faqHit = null; }
      let productHit = null;
      try {
        const pm = matchProductLookup(row.body, (await queries.run("product_lookup", {}, { cfg, trace: { line: () => {} } })).objects);
        productHit = pm.all.length ? pm : null;
      } catch { productHit = null; }
      S.scenario = resolveScenario({ kind: "message", declared: input.scenario, decided: preDecided, gates: preGates, faqHit, text: row.body, productHit });
      const params = preDecided?.parameters ?? {};
      if (params.summed >= 2 && params.currency === "GC") S.summedNote = `summed ${params.summed} listed amounts (${(params.amounts ?? []).join(" + ")} = ${params.amount} GC; the message never says "total")`;
      // a legacy-resolved message keeps the category Scout read (a replacement request is not a question); the scenario's own topic otherwise
      Object.assign(factsOpts, { ticketSource: "intake", intakeRow: row, published: S.msg.published, topic: TOPIC_OF[S.scenario.scenario] ?? LEGACY_CATEGORY[preDecided?.intent?.primary?.id] ?? "question", needs: FACT_NEEDS[S.scenario.scenario] ?? [],
        amount: params.currency === "GC" ? params.amount : undefined });
    } else {
      S.scenario = resolveScenario({ kind: "thread", declared: input?.scenario });
    }
    try {
      S.facts = await factsFn(thread_id, { ...o, ...factsOpts });
    } catch (e) {
      factsErr = e;
    }
    const f = S.facts;
    const ticket = f?.ticket ?? { thread_id };
    let dup = null;
    let ledger = { affirmed: 0, rejected: 0 };
    const unavailable = [];
    // Their zetaris.query lines join the buffered facts lines; a failure not already traced gets its own error line.
    const guarded = async (action, input, fn) => {
      let traced = false;
      const t = { line: (x) => { if (x.status === "error") traced = true; buf.push(x); } };
      try {
        return { value: await fn(t) };
      } catch (e) {
        if (!traced) buf.push({ step: "zetaris.query", agent_name: "Executor", action, input_summary: input, output_summary: `${errName(e)}: ${safeMsg(e)}`, status: "error", sponsor: "zetaris" });
        buf.push({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: `after ${action} error`,
          output_summary: `${action === "sql:ledger_adjust" ? "trust ledger" : "duplicate check"} unavailable: no send without it, the ticket is held for a person`, status: "success" });
        return { error: e };
      }
    };
    if (f?.disclosure_unknown === true) {
      buf.push({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after the what-may-leave wiki read",
        output_summary: "disclosure policy unavailable: no send without it, the ticket is held for a person", status: "success" });
    }
    if (f) {
      const r = await guarded("sql:thread_fingerprints", `duplicate check for ${thread_id}`, (t) => findDup({ ...(f.ticket ?? {}), thread_id, sender_email: f.sender_email, subject: f.subject, body: f.body, received_at: f.received_at }, { trace: t }));
      dup = r.error ? null : r.value ?? null;
      if (r.error) unavailable.push("duplicate check");
      if (CATEGORIES.includes(f.category)) {
        const l = await guarded("sql:ledger_adjust", `trust ledger for ${f.category}`, (t) => ledgerFn(f.category, { trace: t }));
        if (l.error) unavailable.push("trust ledger");
        if (!l.error && l.value) ledger = { affirmed: Number(l.value.affirmed) || 0, rejected: Number(l.value.rejected) || 0 };
      }
    }
    const inputText = f ? (f.follow_up_kind ? (f.follow_up_body || f.body) : f.body) : "";

    // 1. memory.read
    S.current = "memory.read";
    let memories = [];
    let memCtx = "";
    try {
      if (hmemInitErr) throw hmemInitErr;
      // einh (25 Oct 2026): recall by client email and thread, never by display name shared by visitors.
      const q = f ? `${emailKey(f.sender_email)} ${f.category} ${thread_id}` : String(thread_id);
      const r = hmem.query(q, { topN: 5, threshold: 0.2, ...(f ? { tags: [f.category], entities: [emailKey(f.sender_email)].filter(Boolean) } : {}) });
      const mail = emailKey(f?.sender_email);
      memories = r.memories.filter((m) => (mail && (m.memory.entities ?? []).some((e) => emailKey(e) === mail)) || String(m.memory.content).includes(thread_id));
      memCtx = memories.map((m) => m.memory.content).join("\n");
    } catch (e) {
      soft("memory.read", e, hmemInitErr ? "memory unavailable, continuing without it" : "continued without memory");
    }
    S.memRead = memories.map((m) => m.memory.id);
    const mail = emailKey(f?.sender_email);
    const byEmail = mail ? memories.filter((m) => (m.memory.entities ?? []).some((e) => emailKey(e) === mail)) : [];
    S.emailRecall = byEmail.length;
    L({
      step: "memory.read", agent_name: "Memory", action: "memory_read", input_summary: f ? `${f.sender_name} ${f.category} ${thread_id}` : String(thread_id),
      output_summary: S.memRead.length ? `${S.memRead.length} memories: ${memories.map((m) => `${m.memory.id} (${one(m.memory.content, 70)})`).join("; ")}${byEmail.length ? `; ${byEmail.map((m) => m.memory.id).join(", ")} recalled by the client's email ${mail}` : ""}` : "empty (cold first run)",
      status: "success", memory_ids: S.memRead, sponsor: undefined,
    });

    // 2. planner.plan
    S.current = "planner.plan";
    const known = f && memories.find((m) => (mail && (m.memory.entities ?? []).some((e) => emailKey(e) === mail)) || String(m.memory.content).includes(thread_id));
    const pre = f ? decideBranch(f, null, S.memRead, { duplicate_of: dup, prior_draft: deps.priorDraft, ledgerAdjust: ledger, checks_unavailable: unavailable }) : { branch_id: "unknown", why: "facts unavailable" };
    const replyNow = pre.branch_id === "send-ok";
    L({
      step: "planner.plan", agent_name: "Planner", action: "plan", input_summary: `ticket ${thread_id}`,
      output_summary: `branches: reply-now vs hold-or-escalate; selected ${replyNow ? "reply-now" : "hold-or-escalate"} (${pre.branch_id}: ${one(pre.why, 120)}). memory ids: ${S.memRead.join(", ") || "none"}`
        + (known ? `. Memory ${known.memory.id} recalls this customer from an earlier run: the planner reused its decision context and re-read the rows through Zetaris (amount ${f.amount ?? "none"} vs limit ${f.policy_limit ?? "?"})` : "")
        + (secondRefund() ? `. ${secondRefund()}` : "") + (S.summedNote ? `. ${S.summedNote}` : ""),
      status: "success", memory_ids: S.memRead, ...(known ? { retry_count: 0 } : {}),
    });

    // 3. delegate
    S.current = "delegate";
    L({ step: "delegate", agent_name: "Planner", action: "delegate", target_agent: replyNow ? "Drafter" : "Executor", input_summary: `selected ${replyNow ? "reply-now" : "hold-or-escalate"}`, output_summary: `handed ${thread_id} to ${replyNow ? "Drafter" : "Executor"}`, status: "success" });

    // 4. executor.act (+ the zetaris.query lines it caused)
    S.current = "executor.act";
    for (const b of buf) {
      if (b.status === "error" && b.step === "zetaris.query") S.recovered.push({ step: "zetaris.query", type: "UpstreamRefused", message: safeMsg(b.output_summary) });
      L(b);
    }
    if (factsErr) fatal("executor.act", factsErr, "facts unavailable, escalated to human with the ticket id only");
    L({
      step: "executor.act", agent_name: "Executor", action: "act", input_summary: `facts for ${thread_id} as of ${f.as_of ?? as_of ?? "received_at"}`,
      output_summary: `${f.cited_rows.length} rows cited: ${f.cited_rows.slice(0, 8).join(", ")}${f.cited_rows.length > 8 ? ", ..." : ""}; amount ${f.amount ?? "none"} vs limit ${f.policy_limit ?? "?"}; owner ${f.owner_id} ${f.owner_out ? "out" : "in"}, ${f.backup_id == null ? "no backup named" : `backup ${f.backup_id} ${f.backup_out ? "out" : "in"}`}`
        + (known ? "; facts rows still read in one call (full reuse from memory is not implemented)" : "")
        + (dup ? `; duplicate check: same sender, subject and body as ${dup.thread_id} (${dup.received_at})` : "; duplicate check: none"),
      status: "success", sponsor: "zetaris",
    });

    // 5. meterless.engine: Scout decides, the contract is verified before any model call
    S.current = "meterless.engine";
    let decided;
    try {
      if (preErr) throw preErr;
      decided = preDecided ?? await scout.decide({ prompt: `${f.subject ?? ""}\n${inputText}`, user: { id: "inbox-loop", roles: ["agent"] }, surface: "email" });
    } catch (e) {
      fatal("meterless.engine", e, "Scout failed before any model call, escalated to human");
    }
    S.scoutRisk = decided.risk?.level ?? "low";
    const contract = decided.executionContract;
    const ver = verifyContract(contract, { secret: scout.secret ?? secret });
    if (!ver.ok || decided.risk?.level === "block") {
      L({
        step: "meterless.engine", agent_name: "Scout", action: "decide_contract", sponsor: "meterless", input_summary: one(`${f.subject}: ${inputText}`, 120),
        output_summary: ver.ok ? `refused: risk block (${(decided.risk.flags ?? []).join(", ") || "policy"}), contract ${contract.contractId}` : `refused: contract ${ver.reason}`,
        status: "refused",
      });
      for (const s of ["branch", "nvidia.model", "critique", "risk.signoff", "retry"]) skipped(s, "Scout refused before any model call");
      escalate([{ source: "Scout", reason: ver.ok ? `risk block: ${(decided.risk.flags ?? []).join(", ")}` : `contract ${ver.reason}` }], ver.ok ? "Scout blocked the message; no model call made" : `Scout contract failed verification (${ver.reason}); no model call made`);
      throw new Stop("scout refused");
    }
    L({
      step: "meterless.engine", agent_name: "Scout", action: "decide_contract", sponsor: "meterless", input_summary: one(`${f.subject}: ${inputText}`, 120),
      output_summary: `contract ${contract.contractId} verified; intent ${decided.intent?.primary?.id}; risk ${S.scoutRisk}`, status: "success",
      confidence: decided.intent?.confidence,
    });

    // gates (a model call, so after the contract check); their line is held back until step 7
    const gbuf = preGates ? preGbuf : stampedBuffer();
    let gates = preGates;
    if (!gates && restrictedInMessage(f)) {
      const g = sample.gates(ticket);
      gates = { answers: g.answers, model: g.model, gate_source: "rules", confidence: 0.5 };
      gbuf.push(restrictedGateSkip(thread_id, g.model));
    }
    if (!gates) {
      try {
        gates = await gatesFn(ticket, f, { trace: { line: (x) => gbuf.push(x) }, cfg, sampleMode: sampleOn, signal: runAbort.signal });
      } catch (e) {
        soft("nvidia.model", e, "typed gates failed, used code rules");
        const g = sample.gates(ticket);
        gates = { answers: g.answers, model: g.model, gate_source: "rules", confidence: 0.5 };
      }
    }

    S.gates = gates;
    S.ledger = ledger;
    // The toolbox the reply loop (and, from S1.3a, the scenario handlers) work through.
    const tb = {
      f, ticket, inputText, L, skipped, soft, fatal, escalate, replyLoop, hardRisk, queries, o, sampleOn, cfg, trace, memCtx, decided, gates, S,
      maxRounds, runtimeDir, scenario: S.scenario, io: { drafter, sampleDrafter, sampleCritic, critic, reader, adapterTrace, signal: runAbort.signal },
      readerOn: !(["false", "0"].includes(String(cfg.REFUND_READER ?? "true").trim().toLowerCase())),
    };

    // 6. branch
    S.current = "branch";
    S.branch = decideBranch(f, gates, S.memRead, { duplicate_of: dup, prior_draft: deps.priorDraft, ledgerAdjust: ledger, checks_unavailable: unavailable });
    const B0 = S.branch.branch_id;
    // A scenario with a handler takes over only where the legacy branch would have drafted (under-floor or send-ok); the pre-empting branches stand.
    const handler = HANDLERS[S.scenario.scenario];
    let probe = null;
    let notDispatched = null;
    if (handler && (B0 === "under-floor" || B0 === "send-ok")) {
      const missing = [...unavailable, ...(f.disclosure_unknown === true ? ["disclosure policy"] : [])];
      if (missing.length) notDispatched = `scenario ${S.scenario.scenario} (${S.scenario.how}) not dispatched: ${missing.join(" and ")} unavailable, held for a person`;
    }
    if (handler && !notDispatched && (B0 === "under-floor" || B0 === "send-ok")) {
      try {
        probe = await handler.probe(tb);
      } catch (e) {
        soft("planner.plan", e, "scenario probe failed, legacy branch", { agent: "Planner", action: "route_scenario" });
      }
    }
    if (probe) S.branch = { ...S.branch, branch_id: probe.branch_id, why: probe.why };
    const B = S.branch.branch_id;
    L({ step: "branch", agent_name: "Planner", action: "select_branch", branch_id: B, input_summary: `category ${f.category}, amount ${f.amount ?? "none"}`, output_summary: S.branch.why, status: "success", memory_ids: S.memRead });

    // 7a. the typed gates line
    S.current = "nvidia.model";
    for (const g of gbuf) L({ ...g, branch_id: B });
    if (!gbuf.length) L({ step: "nvidia.model", agent_name: "Gates", action: "typed_gates", sponsor: "nvidia", model: gates.model, gate_source: gates.gate_source, input_summary: `typed gates for ${thread_id}`, output_summary: "gates supplied by caller", status: "success", branch_id: B });

    if (notDispatched) L({ step: "planner.plan", agent_name: "Planner", action: "route_scenario", branch_id: B, input_summary: `ticket ${thread_id}`, output_summary: notDispatched, status: "success", memory_ids: S.memRead });
    if (probe) {
      for (const x of probe.lines ?? []) L(x);
      L({ step: "planner.plan", agent_name: "Planner", action: "route_scenario", branch_id: B, input_summary: `ticket ${thread_id}`,
        output_summary: `scenario ${S.scenario.scenario} (${S.scenario.how}) → ${B}`, status: "success", memory_ids: S.memRead });
      const a = await handler.act(tb, probe);
      S.decision = a.decision;
      if (a.reasons?.length) S.reasons = [...a.reasons];
      if (a.draft) S.draft = { text: a.draft.text, promises: a.draft.promises, model: a.draft.model, ...(a.draft.blanks ? { blanks: a.draft.blanks } : {}) };
      if (a.recommendation !== undefined) S.recommendation = a.recommendation;
      // queue-entry fields a handler decides (team, cc, also, status ...), and whether the reply goes out by itself
      S.meta = { ...S.meta, ...Object.fromEntries(["team", "team_label", "backup_team", "topic_label", "cc", "also", "status", "courtesy_reply"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])) };
      if (a.auto_reply !== undefined) S.autoReply = a.auto_reply === true;
      settleSend();
      if (a.ownerHint) {
        S.ownerHint = a.ownerHint; // who the card names for a reply that needs no queue entry (an automatic reply)
        // team and team_label come together from the chosen owner only (the hint's own hierarchy row); a label that row does not give stays null, never the ticket owner's
        const hid = a.ownerHint.owner_id;
        if (hid != null && hid !== f?.owner_id) {
          let h = null;
          try { h = (await (deps.hierarchy ?? ((id) => queries.run("hierarchy", { employee_id: id }, { cfg, trace: { line: () => {} } })))(hid)).objects[0] ?? null; } catch { h = null; }
          S.meta = { ...S.meta, team: h?.team ?? a.ownerHint.owner_team ?? a.team ?? null, team_label: h?.team_label ?? null };
        } else if (hid != null) S.meta = { ...S.meta, team: f?.owner_team ?? a.team ?? null, team_label: f?.owner_team_label ?? null };
      }
      // A hold names the person it waits for: the handler's owner, unless escalate() already queued it.
      if (a.queued && !S.queued) S.queued = { owner_id: a.queued.owner_id, backup_id: a.queued.backup_id, owner_name: a.queued.owner_name, backup_name: a.queued.backup_name, role: a.queued.role, ...(a.attachments !== undefined ? { attachments: a.attachments } : {}), ...queueMeta() };
      for (const c of a.cited ?? []) if (!S.extraCited.includes(c)) S.extraCited.push(c);
      return;
    }

    // early exits
    if (B === "thank-you") {
      for (const s of ["nvidia.model", "critique", "risk.signoff", "retry", "escalate_or_fallback"]) skipped(s, "thank-you: nothing to send");
      S.decision = "close";
      S.reasons.push(S.branch.why);
      return;
    }
    if (["fact-block", "data-block", "follow-up", "duplicate"].includes(B)) {
      const refusal = B === "fact-block" ? "fact may not leave" : B === "data-block" ? (S.branch.checks_unavailable ? `${S.branch.checks_unavailable.join(" and ")} unavailable` : `${S.branch.restricted ?? "a restricted fact"} may not leave`) : null;
      skipped("nvidia.model", `${B}: no draft`);
      skipped("critique", `${B}: no draft to critique`);
      if (refusal) {
        L({ step: "risk.signoff", agent_name: "Risk", action: "risk_signoff", sponsor: "meterless", branch_id: B, retry_count: 0, input_summary: S.branch.why, output_summary: `Refused: ${refusal}`, status: "refused" });
      } else skipped("risk.signoff", `${B}: nothing to sign`);
      skipped("retry", `${B}: a rewrite cannot change it`);
      if (B === "fact-block") {
        // Risk's refusal is the critique the owner reads; no draft exists, so none is attached
        escalate([{ source: "Risk", reason: refusal }], `${S.branch.why}; ${refusal}`);
      } else {
        S.decision = B === "duplicate" ? "close" : "hold";
        S.reasons.push(B === "data-block" ? `${S.branch.why}: held for owner ${f.owner_id}, no draft` : S.branch.why);
        skipped("escalate_or_fallback", `${B}: no escalation`);
      }
      return;
    }
    if (B === "misread") {
      skipped("nvidia.model", "misread: no new draft, a human takes it");
      const reason = `the customer says the reply "${(deps.priorDraft && promisedKind(deps.priorDraft)) || ticket.agent_category || "earlier"}" misread the ask; ${one(inputText, 140)}`;
      L({ step: "critique", agent_name: "Evaluator", action: "critique_draft", target_agent: "Planner", branch_id: B, retry_count: 0, input_summary: "earlier reply vs the customer's follow-up", output_summary: `Fail. ${reason}`, status: "needs_revision" });
      L({ step: "risk.signoff", agent_name: "Risk", action: "risk_signoff", sponsor: "meterless", branch_id: B, retry_count: 0, input_summary: "earlier promise", output_summary: "Refused. The earlier reply promised something the customer did not ask for; no autonomous reply.", status: "refused" });
      skipped("retry", "misread: a rewrite cannot undo the earlier promise");
      S.rounds.push({ n: 1, critique: { pass: false, reason, model: "none" }, risk: { pass: false, reasons: ["earlier reply promised something not asked for"], level: S.scoutRisk } });
      escalate([{ source: "Evaluator", reason }, { source: "Risk", reason: "earlier reply promised something the customer did not ask for" }], `misread: ${reason}`);
      return;
    }

    // 7b..10. the reply loop
    const { draft, crit, risk, rounds: round, ok } = await replyLoop(tb);
    const approvalNeeded = overLimit(f) && !(f.owner_out && f.backup_out);

    const critiques = S.rounds.flatMap((r) => [{ round: r.n, source: "Evaluator", pass: r.critique.pass, reason: r.critique.reason }, { round: r.n, source: "Risk", pass: r.risk.pass, reason: r.risk.reasons.join("; ") || "signed off" }]);
    if (approvalNeeded) {
      const ap = approverOf(f);
      const approval = { kind: "amount", amount: f.amount, limit: f.policy_limit, approver_id: ap.id, approver_name: ap.name };
      escalate([...critiques, { source: "Draft", reason: `proposed reply, attached for approval: ${draft.text}` }],
        `${S.branch.why}; Risk refused, ${ap.name ?? `employee ${ap.id}`} approves the amount`, {}, { approval, draft });
      return;
    }
    if (!ok) {
      escalate(critiques, risk.hard ? `hard fact Risk cannot rewrite: ${risk.reasons.join("; ")}` : `two negative rounds: ${one(crit.reason)} | ${risk.reasons.join("; ")}`);
      return;
    }
    if (B === "under-floor") {
      S.decision = "hold";
      // the hold names the person it waits for (the backup when the owner is out); there is no queue file for a plain hold
      if (!S.queued) S.queued = { owner_id: f.owner_id ?? null, backup_id: f.backup_id ?? null, owner_name: f.owner_name ?? null, backup_name: f.backup_name ?? null, ...queueMeta() };
      S.reasons.push(`${S.branch.why}. Both critics passed; the reply waits for ${f.owner_out ? `backup ${f.backup_id}` : `owner ${f.owner_id}`} with the draft attached`);
      skipped("escalate_or_fallback", "both critics passed; a hold waits for a person");
      return;
    }
    S.decision = "send";
    S.reasons.push(`both critics passed on round ${round}; ${S.branch.why}`);
    if (settleSend()) skipped("escalate_or_fallback", "both critics passed; a hold waits for a person");
    else skipped("escalate_or_fallback", "both critics passed");
  }

  async function body() {
    try {
      await pipeline();
    } catch (e) {
      if (e?.name === "IntakeFull") throw e;
      if (!(e instanceof Stop)) {
        S.recovered.push({ step: S.current, type: errName(e), message: safeMsg(e) });
        L({ step: S.current === "zetaris.query" ? "executor.act" : S.current, agent_name: "Planner", action: "unexpected_error", input_summary: `${S.current} threw`, output_summary: `${errName(e)}: ${safeMsg(e)}`, status: "error" });
        L({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: `after ${S.current} error`, output_summary: "unexpected error, escalated to human", status: "success" });
      }
      if (!S.decision) escalate(S.rounds.flatMap((r) => [{ source: "Evaluator", reason: r.critique.reason }]), `run stopped at ${S.current}: ${S.recovered.at(-1)?.message ?? "refused"}`);
    }
  }

  let timedOut = false;
  let timer;
  try {
    await Promise.race([
      body(),
      new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(); }, runTimeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
    runAbort.abort(new Error(timedOut ? "RunTimeout" : "RunEnded")); // 24 Oct 2026: always, so a late model answer cannot write a line after synthesis
  }
  if (timedOut) {
    const msg = `run exceeded ${runTimeoutMs} ms at ${S.current}`;
    S.recovered.push({ step: S.current, type: "RunTimeout", message: msg });
    L({ step: S.current === "zetaris.query" ? "executor.act" : S.current, agent_name: "Planner", action: "run_timeout", input_summary: "whole-run cap", output_summary: msg, status: "error" });
    L({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after run timeout", output_summary: "run capped, escalated to human", status: "success" });
    if (!S.decision) escalate([{ source: "Planner", reason: msg }], msg);
    S.aborted = true; // later lines from the abandoned body are dropped; the finalisation below uses F
  }

  // 11. memory.write (one factual memory per run)
  let written = null;
  try {
    const f = S.facts;
    // Memory is recalled by email and thread and holds no customer display name (einh, 25 Oct 2026).
    // Delivery memories record only that an enquiry was handled, never the order details.
    const orderRun = /^delivery-/.test(S.branch?.branch_id ?? "");
    const reason = orderRun ? "a delivery enquiry was handled; no order details are kept in memory" : one(S.reasons[0] ?? "no reason recorded", 160);
    written = hmem.add({
      content: `${orderRun ? "delivery enquiry" : thread_id} ${S.decision}: ${f && !orderRun ? `${f.category}. ` : ""}${reason}`,
      source: "loop", type: "factual", tags: [f?.category ?? "unknown", S.decision],
      entities: [emailKey(f?.sender_email), thread_id].filter(Boolean), provenance: { origin: "loop", run_id, learnedAt: clock(), label: "factual" },
    });
    S.memWritten.push(written.id);
  } catch (e) {
    serverLog(deps.quiet, "memory.write", e);
    S.recovered.push({ step: "memory.write", type: errName(e), message: safeMsg(e) });
    F({ step: "memory.write", agent_name: "Memory", action: "memory_write", input_summary: "hmem.add", output_summary: `${errName(e)}: ${safeMsg(e)}`, status: "error" });
    F({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after memory.write error", output_summary: "continued, nothing remembered from this run", status: "success" });
  }
  F({ step: "memory.write", agent_name: "Memory", action: "memory_write", input_summary: `decision ${S.decision}`,
    output_summary: S.memWritten.length ? `wrote ${S.memWritten.join(", ")} from ${run_id}` : "nothing written", status: S.memWritten.length ? "success" : "skipped",
    memory_ids: S.memWritten, ...(S.branch ? { branch_id: S.branch.branch_id } : {}) });

  // every step not reached is still logged
  const seen = new Set(trace.lines.map((l) => l.step));
  for (const s of STEP_ORDER) if (s !== "synthesis" && !seen.has(s)) skipped(s, undefined, {}, F);

  // 12. synthesis
  const f = S.facts;
  const closed = trace.close();
  F({ step: "synthesis", agent_name: "Planner", action: "synthesis", input_summary: `ticket ${thread_id}`,
    output_summary: `decision ${S.decision}; cited ${(f?.cited_rows ?? []).length} rows; ${closed.log_file}`, status: "success", ...(S.branch ? { branch_id: S.branch.branch_id } : {}) });

  const out = trace.close();
  const unrecovered = timedOut;
  // who holds it and what memory says (item 10). A send is handled at once; every hold and escalate is open; `follow_up` is never set here.
  const decision = S.decision;
  const meta = queueMeta({ status: S.meta.status ?? (decision === "send" || decision === "close" ? "handled" : "open") });
  // an automatic reply: a handler says so, or the branch is one that answers from the rows (faq-hit, product-hit, delivery-*); never without a sent draft
  const autoBranch = /^(faq-hit|product-hit|delivery-)/.test(S.branch?.branch_id ?? "");
  meta.auto_reply = (S.autoReply === true || autoBranch) && decision === "send" && Boolean(S.draft?.text);
  const trusted = f ? !trustFloor(f, S.gates ?? undefined, { ledgerAdjust: S.ledger }).under : false;
  if (S.queued) Object.assign(S.queued, meta);
  // the person every card names (2.1d): the approver over the limit, else the handler's owner, else the facts' owner (the backup when the owner is out)
  const ownerObj = (() => {
    const q = S.queued;
    const bh = Boolean(f?.owner_out && !f?.backup_out && f?.backup_id != null);
    let id, name, role, own = null;
    if (q?.approval?.approver_id != null) ({ approver_id: id, approver_name: name } = q.approval);
    else if (q?.owner_id != null && q.owner_id !== f?.owner_id) { id = q.owner_id; name = q.owner_name; role = q.role; own = true; }
    else if (!q && S.ownerHint?.owner_id != null) { id = S.ownerHint.owner_id; name = S.ownerHint.owner_name; role = S.ownerHint.role; own = true; }
    else if (bh) id = f.backup_id;
    else id = f?.owner_id ?? q?.owner_id ?? null;
    const asOwner = id != null && id === f?.owner_id, asBackup = id != null && id === f?.backup_id;
    const pick = (k) => (asOwner ? f[`owner_${k}`] : asBackup ? f[`backup_${k}`] : undefined);
    return {
      employee_id: id ?? null,
      name: name ?? pick("name") ?? (id != null ? `Employee ${id}` : null),
      role: role ?? pick("role") ?? null,
      team: (own ? meta.team : pick("team")) ?? meta.team ?? null,
      team_label: (own ? meta.team_label : pick("team_label")) ?? meta.team_label ?? null,
    };
  })();
  if (S.queued) S.queued.owner = ownerObj;
  const result = {
    run_id, trace_id: trace.trace_id, status: unrecovered ? "error" : "success",
    output: {
      decision: S.decision, owner: ownerObj, reasons: S.reasons.map((r) => one(r, 300)), cited_rows: [...new Set([...(f?.cited_rows ?? []), ...S.extraCited])],
      ...(S.recommendation !== undefined ? { recommendation: S.recommendation } : {}),
      ...(S.draft ? { draft: S.draft } : {}), ...(S.queued ? { queued_for: S.queued } : {}),
      status: meta.status, auto_reply: meta.auto_reply, memory_note: meta.memory_note, team: meta.team, team_label: meta.team_label, backup_team: meta.backup_team,
      topic_label: meta.topic_label, cc: meta.cc, also: meta.also, ...(meta.courtesy_reply ? { courtesy_reply: true } : {}), channel_label: meta.channel_label, trusted_to_send: trusted,
    },
    agents: [
      { name: "Planner", role: "plan and delegate" }, { name: "Executor", role: "facts from Zetaris" },
      { name: "Drafter", role: "draft the reply", ...(S.models.drafter ? { model: S.models.drafter } : {}) },
      { name: "Evaluator", role: "critique the draft", ...(S.models.evaluator ? { model: S.models.evaluator } : {}) },
      ...(trace.lines.some((l) => l.action === "read_refund") ? [{ name: "RefundReader", role: "refund meaning read", ...(S.models.reader ? { model: S.models.reader } : {}) }] : []),
      { name: "Risk", role: "policy sign-off (code)" }, { name: "Memory", role: "H-MEM read and write" },
      ...(trace.lines.some((l) => l.agent_name === "WorldModel") ? [{ name: "WorldModel", role: "customer and product history" }] : []),
      ...(trace.lines.some((l) => l.agent_name === "Severity") ? [{ name: "Severity", role: "severity gate" }] : []),
    ],
    log_file: out.log_file, execution_time_seconds: Math.round(((clock() - t0) / 1000) * 1000) / 1000,
    rounds: S.rounds, memory: { read: S.memRead, written: S.memWritten }, branch_id: S.branch?.branch_id ?? null, scenario: S.scenario.scenario, resolved_how: S.scenario.how,
    ...(S.msg ? { input: { kind: "message", thread_id, text: S.msg.row.body, from: S.msg.row.sender_email || S.msg.row.sender_name, name: S.msg.row.sender_name || null, channel: S.msg.row.channel, received_at: S.msg.row.received_at, as_of: f?.as_of ?? as_of ?? null } }
      : f ? { input: { kind: "thread", thread_id, text: f.follow_up_kind ? (f.follow_up_body || f.body) : f.body, from: f.sender_email, name: f.sender_name, channel: f.channel, received_at: f.received_at, as_of: f.as_of } } : {}),
    ...(S.recovered.length ? { recovered: S.recovered } : {}),
    ...(unrecovered ? { error: { type: "RunTimeout", message: S.recovered.at(-1)?.message, recoverable: true } } : {}),
  };
  return result;
}

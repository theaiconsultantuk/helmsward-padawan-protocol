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
import { draftMessages, evaluatorMessages, parseDraftJson, parseCriticJson, NUDGE } from "./prompts.mjs";

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

// Branch ids: under-floor, over-limit, owner-out, send-ok, thank-you, misread, plus the grid's data-block,
// follow-up, duplicate and public-channel.
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

// What a structured draft committed us to: "refund", "replacement" or null. Reads the promises fields first, then the reply text.
export function promisedKind(d) {
  const p = d?.promises ?? {};
  const text = String(d?.text ?? d?.reply_text ?? "");
  if (p.refund_amount != null || /refund/i.test(String(p.other ?? ""))) return "refund";
  if (p.replacement === true) return "replacement";
  if (/refund|money back/i.test(text)) return "refund";
  return null;
}

// Pure. gates and memory may be null (the planner calls it before the gates have run).
export function decideBranch(facts, gates, memory, extra = {}) {
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
  if (facts.may_leave === false) {
    return { branch_id: "data-block", why: "the cited fact may not leave the company: external-data block" };
  }
  if (extra.duplicate_of) {
    return { branch_id: "duplicate", why: `the same sender, subject and body as earlier thread ${extra.duplicate_of.thread_id}: closed as a duplicate` };
  }
  if (facts.category === "complaint" && facts.channel === "trustpilot") {
    return { branch_id: "public-channel", why: "a complaint on a public channel (trustpilot): public image risk" };
  }
  if (facts.amount_usd != null && facts.policy_limit_usd != null && facts.amount_usd > facts.policy_limit_usd) {
    return { branch_id: "over-limit", why: `amount ${facts.amount_usd} USD is over the ${facts.policy_limit_usd} USD policy limit` };
  }
  if (facts.owner_out && facts.backup_out) {
    return { branch_id: "owner-out", why: `owner ${facts.owner_id} and backup ${facts.backup_id} are both out on ${facts.as_of ?? "the day"}` };
  }
  const tf = trustFloor(facts, gates ?? undefined, extra.ledgerAdjust ? { ledgerAdjust: extra.ledgerAdjust } : undefined);
  if (tf.under) {
    const who = facts.owner_out ? `owner ${facts.owner_id} out, backup ${facts.backup_id} ${facts.backup_out ? "out" : "in"}` : `owner ${facts.owner_id} in`;
    return { branch_id: "under-floor", why: `${tf.category ?? facts.category} weight ${tf.weight} is under the floor ${tf.floor}; ${who}${facts.amount_usd == null && /refund/.test(String(facts.category)) ? "; no amount stated" : ""}${memory?.length ? "; memory consulted" : ""}` };
  }
  const unavailable = [...(extra.checks_unavailable ?? []), ...(facts.disclosure_unknown === true ? ["disclosure policy"] : [])];
  if (unavailable.length) {
    return { branch_id: "data-block", checks_unavailable: unavailable, why: `${unavailable.join(" and ")} unavailable: a reply cannot be cleared to send, held for a person` };
  }
  return { branch_id: "send-ok", why: `weight ${tf.weight} meets the floor ${tf.floor}, within the limit, someone is available` };
}

class Stop extends Error {}

const errName = (e) => e?.name ?? "Error";
const safeMsg = (e) => String(mask(String(e?.message ?? e)));
const one = (s, n = 220) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function runTicket(thread_id, { run_id = `run-${Date.now().toString(36)}`, as_of, cfg = config(), deps = {} } = {}) {
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
  };
  const L = (f) => (S.aborted ? null : trace.line(f));
  const F = (f) => trace.line(f); // finalisation lines, written even after a timeout
  // adapters get a trace whose lines never carry a null sponsor (Trace.line rejects it)
  const adapterTrace = { line: (f) => L(f.sponsor === null ? { ...f, sponsor: undefined } : f) };
  const skipped = (step, why, extra = {}, w = L) => w({
    step, agent_name: WHO[step][0], action: WHO[step][1], input_summary: why ?? "not reached on this branch",
    output_summary: "gate not reached", status: "skipped", ...(S.branch ? { branch_id: S.branch.branch_id } : {}), ...extra,
  });

  const hmem = deps.hmem && typeof deps.hmem.query === "function" ? deps.hmem : new HMEM({ persistDir: deps.hmem?.persistDir ?? memoryDir, clock });
  const scout = deps.scout ?? new Scout({ intentRegistry: join(INBOX_ROOT, "src", "engines", "scout", "intents.inbox.json"), policyPack: ["default"], secret });
  const gatesFn = deps.gates ?? typedGates;
  const refuseOnce = sampleOn && String(cfg.FAULT_ZETARIS_REFUSE_ONCE) === "true";
  const factsFn = deps.facts ?? ((id, o) => factsForTicket(id, { ...o, cfg, ...(refuseOnce ? { sqlRunImpl: faultingSqlRun(cfg, o.trace) } : {}) }));
  const findDup = deps.findDuplicate ?? ((tk, o) => findDuplicateZetaris(tk, { cfg, trace: o.trace }));
  const ledgerFn = deps.ledgerAdjust ?? ((category, o) => (sampleOn
    ? localLedgerAdjust(category, deps.decisionsDir ? { dir: deps.decisionsDir } : undefined)
    : ledgerAdjustFor(category, { cfg, trace: o.trace })));
  const drafter = deps.drafter ?? ((messages, o) => nightshift.draft(messages, { cfg, trace: o.trace, purpose: o.purpose }));
  const sampleDrafter = deps.sampleDrafter ?? sample.draft;
  const sampleCritic = deps.sampleCritic ?? sample.critique;
  const critic = deps.critic ?? (async ({ draft, facts, ticket }) => {
    const r = await nightshift.draft(evaluatorMessages({ draft, facts, ticket }), { cfg, trace: adapterTrace, purpose: "critique" });
    const j = parseCriticJson(r.text);
    return j ? { ...j, model: r.model } : { pass: false, reason: "evaluator returned no valid JSON", model: r.model };
  });

  // Log an error line, then the recovery line, then stop the pipeline (the run still ends with a result).
  const fatal = (step, e, recoveryText) => {
    S.recovered.push({ step, type: errName(e), message: safeMsg(e) });
    L({ step, agent_name: WHO[step][0], action: WHO[step][1], input_summary: `${step} failed`, output_summary: `${errName(e)}: ${safeMsg(e)}`, status: "error" });
    L({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: `after ${step} error`, output_summary: recoveryText, status: "success" });
    throw new Stop(recoveryText);
  };
  // Same, for a step the run can survive.
  const soft = (step, e, recoveryText) => {
    S.recovered.push({ step, type: errName(e), message: safeMsg(e) });
    L({ step, agent_name: WHO[step][0], action: WHO[step][1], input_summary: `${step} failed`, output_summary: `${errName(e)}: ${safeMsg(e)}`, status: "error" });
    L({ step: "recovery", agent_name: "Planner", action: "recover", input_summary: `after ${step} error`, output_summary: recoveryText, status: "success" });
  };

  // The approver of an over-limit amount: the policy's over-limit owner (facts.owner_*), or its backup when the owner is out.
  const approverOf = (f) => (f?.owner_out && !f?.backup_out
    ? { id: f.backup_id ?? null, name: f.backup_name ?? null }
    : { id: f?.owner_id ?? null, name: f?.owner_name ?? null });
  const overLimit = (f) => f?.amount_usd != null && f?.policy_limit_usd != null && f.amount_usd > f.policy_limit_usd;

  const escalate = (critiques, reason, extra = {}, { approval = null, draft = null } = {}) => {
    const f = S.facts;
    const ticketObj = { ...(f?.ticket ?? {}), id: thread_id, thread_id, ...(f ? { category: f.category, decision_reason: reason } : {}),
      ...(approval ? { approval } : {}), ...(draft ? { draft: { text: draft.text, promises: draft.promises } } : {}) };
    let memId = null;
    let queueFailed = false;
    try {
      memId = hmem.queueForHuman(ticketObj, critiques);
    } catch (e) {
      queueFailed = true;
      soft("escalate_or_fallback", e, "queue write failed; ticket left with the logged critiques for a human");
    }
    const tid = String(thread_id).replace(/[^A-Za-z0-9._-]/g, "_");
    const queue_file = join(memoryDir, "queue", `${tid}.json`);
    S.decision = "escalate";
    S.queued = { owner_id: f?.owner_id ?? null, backup_id: f?.backup_id ?? null, queue_file: queueFailed ? null : queue_file, ...(approval ? { approval } : {}) };
    if (memId) S.memWritten.push(memId);
    L({
      step: "escalate_or_fallback", agent_name: "Escalator", action: "queue_for_human", target_agent: "Human",
      input_summary: one(reason), output_summary: approval
        ? `escalated to ${approval.approver_name ?? `employee ${approval.approver_id}`} (employee ${approval.approver_id}) for approval of ${approval.amount_usd} USD over the ${approval.limit_usd} USD limit; the draft is attached for approval; ${queueFailed ? "the queue write failed, the draft and both critiques are in this trace" : `draft and both critiques stored in ${queue_file}`}`
        : `escalated to owner ${f?.owner_id ?? "?"} / backup ${f?.backup_id ?? "?"}; ${queueFailed ? "the queue write failed, both critiques are in this trace" : `both critiques stored in ${queue_file}`}`,
      status: queueFailed ? "incomplete" : "success", ...(S.branch ? { branch_id: S.branch.branch_id } : {}), ...(memId ? { memory_ids: [memId] } : {}), ...extra,
    });
    S.reasons.push(reason);
  };

  async function pipeline() {
    // Facts first, silently: memory.read needs the customer's name. Their zetaris.query lines are logged at step 4.
    const buf = [];
    let factsErr = null;
    try {
      S.facts = await factsFn(thread_id, { as_of, trace: { line: (f) => buf.push(f) } });
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
      const q = f ? `${f.sender_name} ${f.category} ${thread_id}` : String(thread_id);
      const r = hmem.query(q, { topN: 5, threshold: 0.2, ...(f ? { tags: [f.category], entities: [f.sender_name] } : {}) });
      memories = r.memories;
      memCtx = r.context;
    } catch (e) {
      soft("memory.read", e, "continued without memory");
    }
    S.memRead = memories.map((m) => m.memory.id);
    L({
      step: "memory.read", agent_name: "Memory", action: "memory_read", input_summary: f ? `${f.sender_name} ${f.category} ${thread_id}` : String(thread_id),
      output_summary: S.memRead.length ? `${S.memRead.length} memories: ${memories.map((m) => `${m.memory.id} (${one(m.memory.content, 70)})`).join("; ")}` : "empty (cold first run)",
      status: "success", memory_ids: S.memRead, sponsor: undefined,
    });

    // 2. planner.plan
    S.current = "planner.plan";
    const known = f && memories.find((m) => (m.memory.entities ?? []).includes(f.sender_name) || String(m.memory.content).includes(thread_id));
    const pre = f ? decideBranch(f, null, S.memRead, { duplicate_of: dup, prior_draft: deps.priorDraft, ledgerAdjust: ledger, checks_unavailable: unavailable }) : { branch_id: "unknown", why: "facts unavailable" };
    const replyNow = pre.branch_id === "send-ok";
    L({
      step: "planner.plan", agent_name: "Planner", action: "plan", input_summary: `ticket ${thread_id}`,
      output_summary: `branches: reply-now vs hold-or-escalate; selected ${replyNow ? "reply-now" : "hold-or-escalate"} (${pre.branch_id}: ${one(pre.why, 120)}). memory ids: ${S.memRead.join(", ") || "none"}`
        + (known ? `. Memory ${known.memory.id} recalls this customer from an earlier run: the planner reused its decision context and re-read the rows through Zetaris (amount ${f.amount_usd ?? "none"} vs limit ${f.policy_limit_usd ?? "?"})` : ""),
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
      output_summary: `${f.cited_rows.length} rows cited: ${f.cited_rows.slice(0, 8).join(", ")}${f.cited_rows.length > 8 ? ", ..." : ""}; amount ${f.amount_usd ?? "none"} vs limit ${f.policy_limit_usd ?? "?"}; owner ${f.owner_id} ${f.owner_out ? "out" : "in"}, backup ${f.backup_id} ${f.backup_out ? "out" : "in"}`
        + (known ? "; facts rows still read in one call (full reuse from memory is not implemented)" : "")
        + (dup ? `; duplicate check: same sender, subject and body as ${dup.thread_id} (${dup.received_at})` : "; duplicate check: none"),
      status: "success", sponsor: "zetaris",
    });

    // 5. meterless.engine: Scout decides, the contract is verified before any model call
    S.current = "meterless.engine";
    let decided;
    try {
      decided = await scout.decide({ prompt: `${f.subject ?? ""}\n${inputText}`, user: { id: "inbox-loop", roles: ["agent"] }, surface: "email" });
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
    const gbuf = [];
    let gates;
    try {
      gates = await gatesFn(ticket, f, { trace: { line: (x) => gbuf.push(x) }, cfg, sampleMode: sampleOn });
    } catch (e) {
      soft("nvidia.model", e, "typed gates failed, used code rules");
      const g = sample.gates(ticket);
      gates = { answers: g.answers, model: g.model, gate_source: "rules", confidence: 0.5 };
    }

    // 6. branch
    S.current = "branch";
    S.branch = decideBranch(f, gates, S.memRead, { duplicate_of: dup, prior_draft: deps.priorDraft, ledgerAdjust: ledger, checks_unavailable: unavailable });
    const B = S.branch.branch_id;
    L({ step: "branch", agent_name: "Planner", action: "select_branch", branch_id: B, input_summary: `category ${f.category}, amount ${f.amount_usd ?? "none"}`, output_summary: S.branch.why, status: "success", memory_ids: S.memRead });

    // 7a. the typed gates line
    S.current = "nvidia.model";
    for (const g of gbuf) L({ ...g, branch_id: B });
    if (!gbuf.length) L({ step: "nvidia.model", agent_name: "Gates", action: "typed_gates", sponsor: "nvidia", model: gates.model, gate_source: gates.gate_source, input_summary: `typed gates for ${thread_id}`, output_summary: "gates supplied by caller", status: "success", branch_id: B });

    // early exits
    if (B === "thank-you") {
      for (const s of ["nvidia.model", "critique", "risk.signoff", "retry", "escalate_or_fallback"]) skipped(s, "thank-you: nothing to send");
      S.decision = "close";
      S.reasons.push(S.branch.why);
      return;
    }
    if (["data-block", "follow-up", "duplicate", "public-channel"].includes(B)) {
      const refusal = B === "data-block" ? (S.branch.checks_unavailable ? `${S.branch.checks_unavailable.join(" and ")} unavailable` : "fact may not leave") : B === "public-channel" ? "public image risk: no autonomous reply" : null;
      skipped("nvidia.model", `${B}: no draft`);
      skipped("critique", `${B}: no draft to critique`);
      if (refusal) {
        L({ step: "risk.signoff", agent_name: "Risk", action: "risk_signoff", sponsor: "meterless", branch_id: B, retry_count: 0, input_summary: S.branch.why, output_summary: `Refused: ${refusal}`, status: "refused" });
      } else skipped("risk.signoff", `${B}: nothing to sign`);
      skipped("retry", `${B}: a rewrite cannot change it`);
      if (B === "public-channel") {
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
    const ctxFacts = { ...f, backup: f.backup_name };
    const makeDraft = async (seed, critiques, n) => {
      if (sampleOn) {
        const d = sampleDrafter(f.ticket ?? ticket, ctxFacts, { seed });
        L({ step: "nvidia.model", agent_name: "Drafter", action: n > 1 ? "draft_revised" : "draft_reply", model: d.model, input_summary: `round ${n}, seed ${seed}`, output_summary: "sample mode: rules drafter, no model call", status: "skipped", branch_id: B, retry_count: n - 1 });
        S.models.drafter = d.model;
        return { text: d.text, promises: d.promises, model: d.model };
      }
      const messages = draftMessages({ ticket, facts: f, memoryContext: memCtx, critiques });
      let res;
      try {
        res = await drafter(messages, { purpose: "draft", trace: adapterTrace });
      } catch (e) {
        fatal("nvidia.model", e, "drafter failed, escalated to human");
      }
      if (res.sample || res.text == null) {
        const d = sampleDrafter(f.ticket ?? ticket, ctxFacts, { seed });
        L({ step: "nvidia.model", agent_name: "Drafter", action: n > 1 ? "draft_revised" : "draft_reply", model: d.model, input_summary: `round ${n}, seed ${seed}`, output_summary: "sample mode: rules drafter, no model call", status: "skipped", branch_id: B, retry_count: n - 1 });
        S.models.drafter = d.model;
        return { text: d.text, promises: d.promises, model: d.model };
      }
      let parsed = parseDraftJson(res.text);
      if (!parsed) {
        try {
          res = await drafter([...messages, { role: "assistant", content: String(res.text) }, { role: "user", content: NUDGE }], { purpose: "draft", trace: adapterTrace });
          parsed = parseDraftJson(res.text);
        } catch (e) {
          fatal("nvidia.model", e, "drafter failed on the JSON nudge, escalated to human");
        }
      }
      S.models.drafter = res.model;
      L({
        step: "nvidia.model", agent_name: "Drafter", action: n > 1 ? "draft_revised" : "draft_reply", model: res.model, ...(res.lane === "local-lane" ? {} : { sponsor: "nvidia" }),
        input_summary: `round ${n}${critiques.length ? ", with both critiques" : ""}`,
        output_summary: parsed ? `drafted ${parsed.text.length} chars; promises ${JSON.stringify(parsed.promises)}` : "no valid JSON after one nudge; treated as needs_revision",
        status: parsed ? "success" : "needs_revision", branch_id: B, retry_count: n - 1,
      });
      return parsed ? { ...parsed, model: res.model } : { text: "", promises: null, model: res.model, failed: true };
    };

    const doCritique = async (draft, n) => {
      let r;
      if (draft.failed) r = { pass: false, reason: "the drafter returned no usable JSON", model: draft.model };
      else {
        try {
          r = sampleOn ? sampleCritic(draft, f) : await critic({ draft, facts: f, ticket, trace: adapterTrace });
        } catch (e) {
          fatal("critique", e, "evaluator failed, escalated to human");
        }
      }
      S.models.evaluator = r.model;
      L({ step: "critique", agent_name: "Evaluator", action: "critique_draft", target_agent: "Planner", model: r.model, branch_id: B, retry_count: n - 1,
        input_summary: `round ${n} draft, ${draft.text.length} chars`, output_summary: `${r.pass ? "Pass" : "Fail"}. ${one(r.reason)}`, status: r.pass ? "success" : "needs_revision", memory_ids: S.memRead });
      return r;
    };

    const doRisk = (draft, n) => {
      const hr = draft.failed ? { reasons: ["no usable draft"] } : hardRisk(f, draft);
      // An amount over the policy limit is a hard fact on the round it appears: Risk refuses and the ticket goes to the approver.
      const bothOut = Boolean(f.owner_out && f.backup_out);
      const needsApproval = overLimit(f) && !bothOut;
      const ap = approverOf(f);
      const reasons = hr.reasons.filter((r) => !BRANCH_RE.test(r) && !(needsApproval && /^draft promises refund above/.test(r)));
      if (needsApproval) reasons.unshift(`amount ${f.amount_usd} USD is over the ${f.policy_limit_usd} USD limit: needs approval by ${ap.name ?? `employee ${ap.id}`} (policy over-limit owner)`);
      const hard = f.may_leave === false || bothOut || needsApproval;
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
      crit = await doCritique(draft, round);
      risk = doRisk(draft, round);
      S.rounds.push({ n: round, critique: crit, risk });
      if ((crit.pass && risk.pass) || round >= maxRounds || risk.hard) break;
      // a negative round, gate not met: retry
      const next = "decline anything above the limit, promise only what the cited rows allow, and name who follows up";
      const both = [`Evaluator: ${crit.reason}`, `Risk: ${risk.reasons.join("; ") || "signed off"}`];
      L({ step: "retry", agent_name: "Planner", action: "retry_round", target_agent: "Drafter", branch_id: B, retry_count: round, input_summary: `round ${round} negative`,
        output_summary: `${both.join(" | ")}. Next draft must: ${next}`, status: "retrying", memory_ids: S.memRead });
      retried = true;
      L({ step: "planner.plan", agent_name: "Planner", action: "plan_revision", branch_id: B, retry_count: round, input_summary: "both critiques",
        output_summary: `revised plan: branches reply-now vs hold-or-escalate; keep ${B}, redraft once with both critiques, then gate`, status: "success", memory_ids: S.memRead });
      draft = await makeDraft("revised", both, round + 1);
      round += 1;
    }
    S.draft = { text: draft.text, promises: draft.promises, model: draft.model };
    const approvalNeeded = overLimit(f) && !(f.owner_out && f.backup_out);
    if (!retried) skipped("retry", approvalNeeded ? "hard refusal: amount needs approval" : risk.hard && !(crit.pass && risk.pass) ? "hard fact: a rewrite cannot change it" : "round 1 passed");

    const critiques = S.rounds.flatMap((r) => [{ round: r.n, source: "Evaluator", pass: r.critique.pass, reason: r.critique.reason }, { round: r.n, source: "Risk", pass: r.risk.pass, reason: r.risk.reasons.join("; ") || "signed off" }]);
    const ok = crit.pass && risk.pass;
    if (approvalNeeded) {
      const ap = approverOf(f);
      const approval = { kind: "amount", amount_usd: f.amount_usd, limit_usd: f.policy_limit_usd, approver_id: ap.id, approver_name: ap.name };
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
      S.reasons.push(`${S.branch.why}. Both critics passed; the reply waits for ${f.owner_out ? `backup ${f.backup_id}` : `owner ${f.owner_id}`} with the draft attached`);
      skipped("escalate_or_fallback", "both critics passed; a hold waits for a person");
      return;
    }
    S.decision = "send";
    S.reasons.push(`both critics passed on round ${round}; ${S.branch.why}`);
    skipped("escalate_or_fallback", "both critics passed");
  }

  async function body() {
    try {
      await pipeline();
    } catch (e) {
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
  await Promise.race([
    body(),
    new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(); }, runTimeoutMs); }),
  ]);
  clearTimeout(timer);
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
    const reason = one(S.reasons[0] ?? "no reason recorded", 160);
    written = hmem.add({
      content: `${thread_id} ${S.decision}: ${f ? `${f.sender_name} ${f.category}. ` : ""}${reason}`,
      source: "loop", type: "factual", tags: [f?.category ?? "unknown", S.decision],
      entities: [f?.sender_name, thread_id].filter(Boolean), provenance: { origin: "loop", run_id, learnedAt: clock(), label: "factual" },
    });
    S.memWritten.push(written.id);
  } catch (e) {
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
  const result = {
    run_id, trace_id: trace.trace_id, status: unrecovered ? "error" : "success",
    output: {
      decision: S.decision, reasons: S.reasons.map((r) => one(r, 300)), cited_rows: f?.cited_rows ?? [],
      ...(S.draft ? { draft: S.draft } : {}), ...(S.queued ? { queued_for: S.queued } : {}),
    },
    agents: [
      { name: "Planner", role: "plan and delegate" }, { name: "Executor", role: "facts from Zetaris" },
      { name: "Drafter", role: "draft the reply", ...(S.models.drafter ? { model: S.models.drafter } : {}) },
      { name: "Evaluator", role: "critique the draft", ...(S.models.evaluator ? { model: S.models.evaluator } : {}) },
      { name: "Risk", role: "policy sign-off (code)" }, { name: "Memory", role: "H-MEM read and write" },
    ],
    log_file: out.log_file, execution_time_seconds: Math.round(((clock() - t0) / 1000) * 1000) / 1000,
    rounds: S.rounds, memory: { read: S.memRead, written: S.memWritten }, branch_id: S.branch?.branch_id ?? null,
    ...(S.recovered.length ? { recovered: S.recovered } : {}),
    ...(unrecovered ? { error: { type: "RunTimeout", message: S.recovered.at(-1)?.message, recoverable: true } } : {}),
  };
  return result;
}

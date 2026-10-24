// Jedi Pack journey: a pure, total derivation of "what happened to this ticket" from a stored
// result and its trace lines. No model call, no new trace field, never throws.

const LABELS = {
  "memory.read": "Memory read",
  "planner.plan": "Plan",
  delegate: "Delegate",
  "executor.act": "Facts from Zetaris",
  "zetaris.query": "Zetaris query",
  "meterless.engine": "Scout contract",
  "nvidia.model": "Model step",
  branch: "Branch",
  critique: "Critique",
  "risk.signoff": "Risk sign-off",
  retry: "Retry",
  escalate_or_fallback: "Hand-off",
  "memory.write": "Memory write",
  synthesis: "Outcome",
  recovery: "Recovery",
};
const SQL_LABELS = {
  thread: "Zetaris: the thread",
  policy: "Zetaris: the policy",
  responsibility: "Zetaris: who owns it",
  holiday: "Zetaris: availability",
  contact: "Zetaris: the contact desk",
  holidays: "Zetaris: availability",
  employee: "Zetaris: the employee",
  trust: "Zetaris: the trust ledger",
  wiki: "Zetaris: the wiki",
  faq: "Zetaris: the FAQ",
  products: "Zetaris: the products",
  product_price: "Zetaris: a product price",
  reviews: "Zetaris: the reviews",
  world_threads: "Zetaris: the thread history",
  thread_fingerprints: "Zetaris: the duplicate check",
  intake_thread: "Zetaris: the new message",
};
const ACTION_LABELS = {
  world_context: "World Model context",
  typed_gates: "Typed gates",
  draft_reply: "Draft",
  critique_draft: "Critique",
  read_refund: "Refund read",
  risk_signoff: "Risk sign-off",
  decide_contract: "Scout contract",
  queue_for_human: "Hand-off",
};

// The public form of a queue file: its place inside the memory dir ("queue/F12.json"), never the server's absolute path.
export function publicQueueFile(p) {
  if (typeof p !== "string" || !p) return p ?? null;
  const m = /(?:^|[\\/])queue[\\/]([^\\/]+)$/.exec(p);
  if (m) return `queue/${m[1]}`;
  return /^(?:[\\/]|[A-Za-z]:)/.test(p) ? `queue/${p.split(/[\\/]/).pop()}` : p;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : "");

export function labelFor(step, line) {
  const action = str(line?.action);
  if (action.startsWith("sql:")) {
    const name = action.slice(4);
    return SQL_LABELS[name] ?? `Zetaris: ${name}`;
  }
  if (step === "nvidia.model" && ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (action === "world_context") return ACTION_LABELS.world_context;
  if (step === "meterless.engine" && action === "decide_contract") return "Scout contract";
  return LABELS[step] ?? (typeof step === "string" && step ? step : "Step");
}

// ids named by a line: memory_ids, the "rows: a, b" tail of sql: lines, the "ids: ..." tail of a world line.
// A line's optional detail (the rows in words, written by the query step) is carried into the node as is.
function consultedOf(line) {
  const out = [];
  const add = (id) => {
    const s = String(id).trim();
    if (s && !out.includes(s)) out.push(s);
  };
  if (Array.isArray(line?.memory_ids)) line.memory_ids.forEach(add);
  const action = str(line?.action);
  const outSum = str(line?.output_summary);
  if (action.startsWith("sql:")) {
    const m = outSum.match(/^\s*\d+\s+rows?:\s*(.*)$/s);
    if (m && m[1].trim() !== "none") m[1].split(",").forEach(add);
  } else if (action === "world_context") {
    const m = outSum.match(/\bids:\s*(.*)$/s);
    if (m && m[1].trim().toLowerCase() !== "none") m[1].split(/[,;]/).forEach(add); // "ids: none" is the empty sentinel
  }
  return out;
}

// The technology behind a line, read only from what the line itself records (step, agent_name, sponsor, model,
// gate_source, status); never guessed (einh: "which tech was used in that step ... success (never lie)").
//  a skipped step -> "not run"; memory steps / the Memory agent -> H-MEM; the zetaris sponsor -> Zetaris;
//  the Meterless engine step -> "Meterless (Scout contract)" / "Meterless (World Model)" (no model call);
//  an openjev model or gate_source -> "OpenJev (<model>)"; a sample/ or rules model, gate_source rules, or Risk's
//  sign-off -> "rules" (deterministic code); any other model -> "Nightshift (<model>)" (Nemotron and every model the
//  Drafter, Evaluator, Readers and Recommender call go through Meterless Nightshift); a named agent with no model -> rules.
const METERLESS_ENGINE = { Scout: "Meterless (Scout contract)", WorldModel: "Meterless (World Model)" };
export function techOf(line) {
  const sponsor = str(line?.sponsor);
  const model = str(line?.model).replace(/^(\S+) \(\1\)$/, "$1"); // "openjev-0.1 (openjev-0.1)" -> "openjev-0.1"
  const agent = str(line?.agent_name);
  const step = str(line?.step);
  const gate = str(line?.gate_source);
  if (str(line?.status) === "skipped") return "not run";
  if (agent === "Memory" || /^memory\./.test(step)) return "H-MEM";
  if (sponsor === "zetaris") return "Zetaris";
  if (step === "meterless.engine") return METERLESS_ENGINE[agent] ?? "Meterless";
  if (gate === "openjev" || /^openjev/i.test(model)) return `OpenJev (${model || "openjev"})`;
  if (step === "risk.signoff" || gate === "rules" || model === "rules" || /^sample\//.test(model)) return "rules";
  if (model) return `Nightshift (${model})`;
  if (agent) return "rules";
  return sponsor ? sponsor : "unknown";
}

// "table:key" -> its parts; the key fields of a row id as the trace names it
function rowFields(id) {
  const i = id.indexOf(":");
  return i < 0 ? { id, table: null, key: id } : { id, table: id.slice(0, i), key: id.slice(i + 1) };
}

// What a node handed back. Zetaris: only the HIT rows (the ids this step read that the result cites or keeps), each with its
// key fields, never the scanned count. A model node: the reply text exactly as the trace recorded it. Anything else: null.
function returnedOf(line, tech, retained, consulted) {
  if (line?.status === "skipped") return null;
  if (tech === "Zetaris") {
    const detail = str(line?.detail) || null;
    return retained.map((id) => ({ ...rowFields(id), ...(detail && consulted.length === 1 ? { detail } : {}) }));
  }
  if (/^(OpenJev|Nightshift) \(/.test(tech)) return str(line?.output_summary) || null;
  return null;
}

function tsMs(t) {
  const n = typeof t === "string" ? Date.parse(t) : NaN;
  return Number.isFinite(n) ? n : null;
}

function safeJson(v) {
  try { return JSON.stringify(v) ?? ""; } catch { return ""; }
}

function attachmentIds(result) {
  let att = result?.output?.queued_for?.attachments;
  if (isObj(att) && !Array.isArray(att)) att = Array.isArray(att.cited) ? att.cited : []; // scenario shape: { prices, quantities, products, cited: [ids] }
  if (!Array.isArray(att)) return [];
  const ids = [];
  for (const a of att) {
    if (typeof a === "string") ids.push(a);
    else if (isObj(a)) {
      const id = a.id ?? a.row_id ?? a.cite ?? a.ref;
      if (id !== undefined && id !== null) ids.push(String(id));
    }
  }
  return ids;
}

function retainedHay(result) {
  const parts = [];
  const cited = result?.output?.cited_rows;
  const cites = Array.isArray(cited) ? cited.map((c) => String(c)) : [];
  const written = result?.memory?.written;
  parts.push(safeJson(written));
  parts.push(str(result?.output?.draft?.text));
  parts.push(safeJson(result?.output?.queued_for?.attachments));
  return { cites, text: parts.join("\n") };
}

function draftText(result) {
  const t = result?.output?.draft?.text;
  return typeof t === "string" && t ? t : null;
}

export function blanksIn(text) {
  const out = [];
  if (typeof text !== "string") return out;
  for (const m of text.matchAll(/\[\[blank:\s*([^\]]*?)\s*\]\]/g)) out.push(m[1]);
  return out;
}

function looksLikeAsk(result) {
  if (!isObj(result) || result?.output?.decision) return false;
  const answer = result.answer ?? result.output?.answer;
  return typeof answer === "string";
}

// the human a hand-off is for: the explicit approver when an over-limit approval is queued, else the owner
function recipientOf(q) {
  const a = isObj(q?.approval) ? q.approval : null;
  if (a && a.approver_id !== undefined && a.approver_id !== null) return { id: a.approver_id, name: a.approver_name ?? null };
  const fc = isObj(q?.fallback_contact) ? q.fallback_contact : null;
  if (fc && typeof fc.email === "string" && fc.email) {
    return { id: null, name: typeof fc.label === "string" && fc.label ? fc.label : fc.email, email: fc.email, role: q.role ?? "default contact" };
  }
  // the person who holds it (the backup when the owner is out), as the output's owner object says; else the queue entry's owner
  const o = isObj(q?.owner) && q.owner.employee_id != null ? q.owner : null;
  return { id: o ? o.employee_id : (q?.owner_id ?? null), name: o ? (o.name ?? null) : (q?.owner_name ?? null) };
}

export function replyFor(result) {
  const r = isObj(result) ? result : {};
  const decision = r.output?.decision ?? null;
  const text = draftText(r);
  const q = isObj(r.output?.queued_for) ? r.output.queued_for : null;
  let kind = "none";
  let outText = text;
  if (decision === "send") kind = "auto_reply";
  else if (decision === "hold") kind = text ? "draft_for_human" : "none";
  else if (decision === "escalate") kind = "escalation";
  else if (decision === "close") kind = "none";
  else if (looksLikeAsk(r)) {
    kind = "answer";
    outText = r.answer ?? r.output?.answer ?? null;
  }
  const { id: ownerId, name: ownerName, email, role: deskRole } = recipientOf(q);
  const to = q && (ownerId !== null || ownerName !== null || email)
    ? { employee_id: ownerId, name: ownerName, role: email ? deskRole : (q.role ?? null), ...(email ? { email } : {}) }
    : null;
  return {
    kind,
    text: outText ?? null,
    to,
    attachments: attachmentIds(r),
    blanks: blanksIn(text),
    recommendation: r.output?.recommendation ?? null,
  };
}

function inputFor(result) {
  const i = isObj(result?.input) ? result.input : null;
  const tid = i?.thread_id ?? result?.thread_id ?? null;
  let kind = i?.kind ?? null;
  if (!kind) {
    if (looksLikeAsk(result)) kind = "ask";
    else if (typeof tid === "string" && tid.startsWith("T")) kind = "thread";
    else if (typeof tid === "string" && tid.startsWith("F")) kind = "message";
  }
  return {
    kind,
    thread_id: tid,
    text: i?.text ?? null,
    from: i?.from ?? null,
    name: i?.name ?? null,
    channel: i?.channel ?? null,
    received_at: i?.received_at ?? null,
    as_of: i?.as_of ?? null,
  };
}

function branchIdOf(result, lines) {
  if (typeof result?.branch_id === "string" && result.branch_id) return result.branch_id;
  for (const l of lines) {
    if (l?.step !== "branch") continue;
    if (typeof l.branch_id === "string" && l.branch_id) return l.branch_id;
    const m = str(l.output_summary).match(/branch[_ ]?id[:= ]+([\w-]+)/i);
    if (m) return m[1];
  }
  return null;
}

export function deriveJourney(result, lines, extras = {}) {
  const res = isObj(result) ? result : {};
  const ls = Array.isArray(lines) ? lines.filter(isObj) : [];
  const decision = res.output?.decision ?? null;
  const { cites, text } = retainedHay(res);
  const branchId = branchIdOf(res, ls);
  let lastSynthesis = -1;
  ls.forEach((l, i) => { if (l.step === "synthesis") lastSynthesis = i; });

  const nodes = ls.map((l, i) => {
    const tech = techOf(l);
    const skipped = l.status === "skipped";
    const consulted = skipped ? [] : consultedOf(l);
    const retained = consulted.filter((id) => cites.includes(id) || text.includes(id));
    const reached =
      (l.step === "escalate_or_fallback" && l.status === "success") ||
      (decision === "hold" && l.step === "synthesis" && i === lastSynthesis);
    // duration_ms: the line's own; else the gap to the previous line's timestamp (older traces); null when neither is known
    const gap = i === 0 ? 0 : (tsMs(l.timestamp) !== null && tsMs(ls[i - 1].timestamp) !== null ? Math.max(0, tsMs(l.timestamp) - tsMs(ls[i - 1].timestamp)) : null);
    const duration_ms = typeof l.duration_ms === "number" && l.duration_ms >= 0 ? l.duration_ms : gap;
    return {
      n: i + 1,
      step: l.step ?? null,
      agent: l.agent_name ?? null,
      label: labelFor(l.step, l),
      route: skipped ? `not reached: ${str(l.input_summary)}` : str(l.output_summary) || null,
      detail: skipped ? null : str(l.detail) || null,
      consulted,
      retained,
      reached_human: Boolean(reached),
      status: l.status ?? null,
      model: l.model ?? null,
      timestamp: l.timestamp ?? null,
      duration_ms,
      tech,
      returned: returnedOf(l, tech, retained, consulted),
    };
  });

  const path = [];
  const lastIdx = (() => {
    for (let i = ls.length - 1; i >= 0; i--) if (ls[i].step === "synthesis" && ls[i].status !== "skipped") return i;
    return -1;
  })();
  nodes.forEach((n, i) => {
    if (n.status === "skipped") return;
    if (n.step === "branch") path.push(branchId ? `Branch: ${branchId}` : "Branch");
    else if (i === lastIdx) path.push("Reply");
    else path.push(n.label);
  });

  const input = inputFor(res);
  const reply = replyFor(res);
  const q = isObj(res.output?.queued_for) ? res.output.queued_for : null;
  const gotSomething = Boolean(q) || decision === "hold" || decision === "escalate";
  let reached = null;
  if (gotSomething) {
    const failed = ls.some((l) => l.step === "escalate_or_fallback" && l.status === "incomplete");
    const what = [];
    if (failed) what.push("nothing stored: the queue write failed");
    else {
      if (draftText(res)) what.push("the draft");
      const crit = res.output?.critiques ?? res.critiques ?? q?.critiques;
      if (Array.isArray(crit) ? crit.length >= 2 : crit) what.push(Array.isArray(crit) && crit.length >= 2 ? "both critiques" : "the critiques");
      else if (ls.some((l) => l.step === "escalate_or_fallback" && l.status === "success" && /both critiques/.test(str(l.output_summary)))) what.push("both critiques");
      for (const id of reply.attachments) if (!what.includes(id)) what.push(id);
    }
    const who = recipientOf(q);
    reached = {
      who: { employee_id: who.id, name: who.name, ...(who.email ? { email: who.email } : {}) },
      what,
      // null when the queue write failed; absent on a plain hold, which writes no queue file
      ...(failed ? { queue_file: null } : (q && "queue_file" in q) || res.queue_file !== undefined ? { queue_file: publicQueueFile(q?.queue_file ?? res.queue_file ?? null) } : {}),
    };
  }

  const o = isObj(res.output) ? res.output : {};
  const pick = (k, dflt = null) => o[k] ?? q?.[k] ?? dflt;
  const es = isObj(extras) ? extras.sent : null;
  const sent = isObj(es)
    ? {
        by: str(es.by) || null,
        at: str(es.at) || null,
        body: str(es.body) || null,
        status: es.status === "handled" || es.status === "follow_up" ? es.status : null,
        ticket_id: str(es.ticket_id) || null,
        queue_file: str(es.queue_file) || null,
      }
    : null;
  // the sent file is the later fact: it overrides the stored run's status
  const finalStatus = sent?.status ?? pick("status");
  return {
    run_id: res.run_id ?? ls[0]?.run_id ?? null,
    team: pick("team"),
    team_label: pick("team_label"),
    topic_label: pick("topic_label"),
    cc: pick("cc", []),
    also: pick("also", []),
    status: finalStatus,
    ticket_status: finalStatus,
    sent,
    auto_reply: pick("auto_reply", false) === true,
    memory_note: pick("memory_note"),
    channel_label: pick("channel_label"),
    trusted_to_send: o.trusted_to_send === true,
    scenario: res.scenario ?? null,
    resolved_how: res.resolved_how ?? null,
    decision,
    input,
    nodes,
    human: { input: input.text, path, reply },
    reached_human: reached,
  };
}

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
  risk_signoff: "Risk sign-off",
  decide_contract: "Scout contract",
  queue_for_human: "Hand-off",
};

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
    if (m) m[1].split(/[,;]/).forEach(add);
  }
  return out;
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
  const ownerId = q?.owner_id ?? null;
  const ownerName = q?.owner_name ?? null;
  const to = q && (ownerId !== null || ownerName !== null)
    ? { employee_id: ownerId, name: ownerName, role: q.role ?? null }
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

export function deriveJourney(result, lines) {
  const res = isObj(result) ? result : {};
  const ls = Array.isArray(lines) ? lines.filter(isObj) : [];
  const decision = res.output?.decision ?? null;
  const { cites, text } = retainedHay(res);
  const branchId = branchIdOf(res, ls);
  let lastSynthesis = -1;
  ls.forEach((l, i) => { if (l.step === "synthesis") lastSynthesis = i; });

  const nodes = ls.map((l, i) => {
    const skipped = l.status === "skipped";
    const consulted = skipped ? [] : consultedOf(l);
    const retained = consulted.filter((id) => cites.includes(id) || text.includes(id));
    const reached =
      (l.step === "escalate_or_fallback" && (l.status === "success" || l.status === "incomplete")) ||
      (decision === "hold" && l.step === "synthesis" && i === lastSynthesis);
    return {
      n: i + 1,
      step: l.step ?? null,
      agent: l.agent_name ?? null,
      label: labelFor(l.step, l),
      route: skipped ? `not reached: ${str(l.input_summary)}` : str(l.output_summary) || null,
      consulted,
      retained,
      reached_human: Boolean(reached),
      status: l.status ?? null,
      model: l.model ?? null,
      timestamp: l.timestamp ?? null,
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
    const what = [];
    if (draftText(res)) what.push("the draft");
    const crit = res.output?.critiques ?? res.critiques ?? q?.critiques;
    if (Array.isArray(crit) ? crit.length >= 2 : crit) what.push(Array.isArray(crit) && crit.length >= 2 ? "both critiques" : "the critiques");
    else if (ls.some((l) => /both critiques/.test(str(l.output_summary)))) what.push("both critiques");
    for (const id of reply.attachments) if (!what.includes(id)) what.push(id);
    reached = {
      who: {
        employee_id: q?.owner_id ?? null,
        name: q?.owner_name ?? null,
      },
      what,
      queue_file: q?.queue_file ?? res.queue_file ?? null,
    };
  }

  return {
    run_id: res.run_id ?? ls[0]?.run_id ?? null,
    scenario: res.scenario ?? null,
    resolved_how: res.resolved_how ?? null,
    decision,
    input,
    nodes,
    human: { input: input.text, path, reply },
    reached_human: reached,
  };
}

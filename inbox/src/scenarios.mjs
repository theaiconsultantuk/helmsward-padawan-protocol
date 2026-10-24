// Scenario routing for a free-text message: which scenario it is, and the question and RFQ handlers.
// Each handler is two phases (the loop wires them, S1.3a):
//   probe(tb)      -> { branch_id, why, cited, data, lines }   lookups only; their trace lines are returned, never written
//   act(tb, probe) -> { decision, reasons, draft?, queued?, recommendation?, attachments?, cited }
// tb is the loop's toolbox ({ f, ticket, inputText, L, skipped, escalate, replyLoop, hardRisk, queries, o, cfg, decided, ... }).
import { tokens, extractParams } from "./engines/scout/index.mjs";
import { rowsForIntent } from "./ask.mjs";
import { draftMessages, complaintReadMessages, parseComplaintReadJson, recommendationMessages, parseRecommendationJson, NUDGE } from "./prompts.mjs";
import { severityGate } from "./gates.mjs";
import { getWorld, toObjects, complaintContext, worldLine, mentionedProducts } from "./engines/world-model/world.mjs";
import * as sample from "./adapters/sample.mjs";

export const SCENARIOS = ["refund", "question", "rfq", "complaint", "free_text"];
export const TOPIC_OF = { refund: "refund", question: "question", rfq: "rfq", complaint: "complaint", customer_service: "customer_service" };
// What a scenario's facts gather may read beyond the ticket row, the owner chain, the trust row and the what-may-leave page.
// `legacy` is absent on purpose: a typed message resolved to legacy gets `[]` from the loop (scoped, no borrowed limit); a stored thread passes no needs and keeps the full read.
export const FACT_NEEDS = { refund: ["limit"], question: [], rfq: [], complaint: [], customer_service: [] };

const one = (s, n = 160) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const NO_PROMISES = () => ({ refund_amount: null, replacement: false, other: null });

// kind: "thread" | "message". A thread run with nothing declared is the loop exactly as today.
export function resolveScenario({ kind, declared = null, decided = null, gates = null, faqHit = null } = {}) {
  if (declared && declared !== "free_text") return { scenario: declared, how: "declared" };
  if (kind === "thread") return { scenario: "legacy", how: "thread" };
  const id = decided?.intent?.primary?.id ?? "GENERAL";
  const conf = decided?.intent?.confidence ?? 0;
  const cat = gates?.answers?.category;
  if (id === "rfq.request") return { scenario: "rfq", how: "scout" };
  if (id === "refund.request") return { scenario: "refund", how: "scout" };
  if (id === "complaint" || (cat?.choice === "complaint" && cat.confidence >= 0.6)) return { scenario: "complaint", how: id === "complaint" ? "scout" : "gates" };
  if (id === "order.question" || (cat?.choice === "question" && cat.confidence >= 0.6)) return { scenario: "question", how: id === "order.question" ? "scout" : "gates" };
  if (id === "replacement.request" || id === "appreciation" || id === "follow_up") return { scenario: "legacy", how: "scout" };
  if (faqHit) return { scenario: "question", how: "faq" };          // the data is searched before anyone is bothered
  return { scenario: "customer_service", how: conf < 0.4 ? "none" : "unrouted" };
}

// ---- pure matchers (one tokenizer: Scout's tokens()) ----

// score = |tokens(text) ∩ (tokens(question) ∪ tokens(keywords))| / |tokens(question)|; a hit is the top row, score >= 0.6, >= 2 shared tokens.
export function matchFaq(text, faqRows) {
  const t = new Set(tokens(text));
  let best = null;
  for (const row of faqRows ?? []) {
    const q = new Set(tokens(row.question));
    if (!q.size) continue;
    const pool = new Set([...q, ...tokens(row.keywords)]);
    const shared = [...t].filter((w) => pool.has(w));
    const score = shared.length / q.size;
    if (!best || score > best.score) best = { row, score, shared };
  }
  return best && best.score >= 0.6 && best.shared.length >= 2 ? best : null;
}

// products whose name tokens all appear in the text
export function matchProducts(text, productRows) {
  const t = new Set(tokens(text));
  return (productRows ?? []).filter((p) => { const n = tokens(p.name); return n.length > 0 && n.every((w) => t.has(w)); });
}

// the inner text of every [[blank: …]] marker
export function blanks(text) {
  return [...String(text ?? "").matchAll(/\[\[blank:\s*([^\]]*?)\s*\]\]/gi)].map((m) => m[1]);
}

// ---- shared probe helpers ----

// A buffering trace: lines are held, ready for the loop to write after the branch line.
function buffer(tb, branch) {
  const lines = [];
  const o = { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}), trace: { line: (x) => lines.push(branch ? { ...x, branch_id: branch } : x) } };
  return { lines, o };
}
const idsIn = (lines) => lines.flatMap((l) => (l.step === "zetaris.query" && l.status === "success" ? (/rows: (.*)$/.exec(l.output_summary ?? "")?.[1] ?? "").split(", ").filter((x) => x && x !== "none") : []));

// who owns a topic: the facts' owner when the ticket is already that topic, else the responsibility row (+ names), looked up in probe.
async function ownerOf(tb, topic, o) {
  const f = tb.f ?? {};
  if (f.category === topic && f.owner_id != null) {
    return { owner_id: f.owner_id, backup_id: f.backup_id, owner_name: f.owner_name, backup_name: f.backup_name, role: `${topic} owner`, looked_up: false };
  }
  const r = (await tb.queries.run("responsibility", { topic }, o)).objects[0];
  if (!r) return { owner_id: null, backup_id: null, role: `${topic} owner`, looked_up: true };
  const nameOf = async (id) => {
    try {
      const e = (await tb.queries.run("employee", { employee_id: Number(id) }, o)).objects[0];
      return e ? `${e.given_name} ${e.family_name}` : undefined;
    } catch { return undefined; }
  };
  const owner_id = Number(r.owner_id), backup_id = Number(r.backup_id);
  return { owner_id, backup_id, owner_name: await nameOf(owner_id), backup_name: await nameOf(backup_id), role: `${topic} owner`, looked_up: true };
}

// the real Risk sign-off line over a code-made draft
function signoff(tb, branch, draft) {
  const hr = tb.hardRisk(tb.f ?? {}, draft);
  const reasons = hr.reasons ?? [];
  const pass = reasons.length === 0;
  tb.L({ step: "risk.signoff", agent_name: "Risk", action: "risk_signoff", sponsor: "meterless", branch_id: branch, retry_count: 0,
    input_summary: `${branch} draft vs facts`, output_summary: pass ? "Signed off." : `Not signed: ${reasons.join("; ")}`, status: pass ? "success" : "needs_revision" });
  return { pass, reasons };
}
const skipLine = (tb, step, text) => tb.skipped(step, text, { output_summary: text });

// ---- question ----

const sentences = (s) => one(s, 400);

// The records quote for the sample draft: the page that shares the most words with the question, at most two of its sentences
// (the ones that share words), never a sentence with a restricted term and never a prohibition list ("may not include …").
export function quoteFromRecords(wiki, question, restricted = []) {
  const qt = new Set(tokens(question));
  const overlap = (s) => tokens(s).filter((w) => qt.has(w)).length;
  const bad = (s) => /\b(may not|must not|cannot|never)\b/i.test(s) || restricted.some((t) => t && s.toLowerCase().includes(String(t).toLowerCase()));
  let best = null;
  for (const w of wiki ?? []) {
    const sents = String(w.text ?? "").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    const kept = sents.map((t, i) => ({ t, i, n: overlap(t) })).filter((x) => x.n > 0 && !bad(x.t));
    const total = kept.reduce((a, x) => a + x.n, 0);
    if (kept.length && (!best || total > best.total)) best = { page: w.page, kept, total };
  }
  if (!best) return null;
  const pick = [...best.kept].sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
  return { page: best.page, text: pick.map((x) => x.t).join(" ") };
}

async function probeQuestion(tb) {
  const text = tb.inputText ?? "";
  const { lines: ro, o } = buffer(tb, null);
  const faqRows = (await tb.queries.run("faq", {}, o)).objects;
  const hit = matchFaq(text, faqRows);
  if (hit) {
    return { branch_id: "faq-hit", why: `FAQ ${hit.row.faq_id} matches (score ${hit.score.toFixed(2)}, shared: ${hit.shared.join(", ")}); FAQ text is canonical, the floor gates model drafts`,
      cited: [`faq:${hit.row.faq_id}`], data: { faq: hit, faqRows: faqRows.length }, lines: ro.map((x) => ({ ...x, branch_id: "faq-hit" })) };
  }
  // miss: the wiki page, the policy rows and the customer's ticket
  const collected = [];
  const rtrace = { line: (x) => { collected.push(x); return x; } };
  const { data, rows } = await rowsForIntent("order.question", tb.f?.sender_email ?? null, { ...o, trace: rtrace });
  const qt = new Set(tokens(text));
  const shares2 = (s) => tokens(s).filter((w) => qt.has(w)).length >= 2;
  const candidates = [
    ...(rows.wiki ?? []).map((w) => `${w.page ?? ""} ${w.text ?? ""}`),
    ...(rows.policy ?? []).map((p) => `${p.topic ?? ""} ${p.limit_amount ?? ""}`),
    ...(rows.ticket ? [`${rows.ticket.subject ?? ""} ${rows.ticket.category ?? ""}`] : []),
  ];
  // a question about refunds or replacements also reads that topic's policy and wiki rows (the limit lives there)
  const topic = /refund|money back/i.test(text) ? "refund.request" : /replac/i.test(text) ? "replacement.request" : null;
  if (topic) {
    // owner names are a nicety rowsForIntent reads and tolerates missing: their error lines are not this branch's failures
    const quiet = { line: (x) => (x.status === "error" && /employee/.test(String(x.action)) ? x : rtrace.line(x)) };
    const more = await rowsForIntent(topic, null, { ...o, trace: quiet });
    rows.policy = more.rows.policy ?? rows.policy; rows.category = more.rows.category ?? rows.category;
    rows.wiki = [...(more.rows.wiki ?? []), ...(rows.wiki ?? [])];
  }
  const cited = [...new Set(idsIn(collected))];
  const checked = `the FAQ (${faqRows.length} rows), ${rows.wiki?.length ?? 0} wiki page(s)${rows.policy?.length ? ", the policy rows" : ""}${rows.ticket ? ", the customer's ticket" : ""}`;
  const answerable = candidates.some(shares2);
  const owner = answerable ? null : await ownerOf(tb, "question", o);
  const branch_id = answerable ? "question-records" : "question-unanswered";
  const lines = [...ro, ...collected].map((x) => ({ ...x, branch_id }));
  return { branch_id, why: answerable ? `no FAQ match; the records (${cited.join(", ") || "none"}) share two words with the question` : `no FAQ match and no record shares two words with the question; checked ${checked}`,
    cited: answerable ? cited : [], data: { faq: null, faqRows: faqRows.length, rows, records: data, checked, owner }, lines };
}

async function actQuestion(tb, p) {
  const B = p.branch_id;
  if (B === "faq-hit") {
    const { row } = p.data.faq;
    skipLine(tb, "nvidia.model", "FAQ canonical text, no model call");
    skipLine(tb, "critique", "canonical FAQ answer, nothing to evaluate");
    const draft = { text: sample.frame(tb.ticket ?? tb.f, row.answer), promises: NO_PROMISES(), model: "faq/canonical" };
    const sig = signoff(tb, B, draft);
    skipLine(tb, "retry", "canonical FAQ text: a rewrite cannot change it");
    if (!sig.pass) {
      const owner = await ownerOf(tb, "question", { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
      tb.escalate([{ source: "Risk", reason: sig.reasons.join("; ") }], `FAQ ${row.faq_id} answer not signed off: ${sig.reasons.join("; ")}`, {}, { owner, draft });
      return { decision: "escalate", reasons: sig.reasons, draft, queued: owner, cited: p.cited };
    }
    tb.skipped("escalate_or_fallback", "FAQ answer sent; nothing to escalate");
    return { decision: "send", reasons: [`FAQ ${row.faq_id} answers it; ${p.why}`], draft, cited: p.cited };
  }
  if (B === "question-records") {
    const rows = p.data.rows;
    const messagesFn = ({ critiques }) => {
      const m = draftMessages({ ticket: tb.ticket, facts: { ...tb.f, cited_rows: [...(tb.f?.cited_rows ?? []), ...p.cited] }, memoryContext: tb.memCtx, critiques });
      const last = m.length - 1;
      m[last] = { ...m[last], content: m[last].content.replace(/Return the JSON object now\.$/, `Records (the only facts you may use):\n${JSON.stringify(rows)}\n\nReturn the JSON object now.`) };
      return m;
    };
    const quote = quoteFromRecords(rows.wiki, tb.inputText ?? "", tb.f?.restricted_terms ?? []);
    const sampleDraftFn = () => ({
      text: sample.frame(tb.ticket ?? tb.f, `From our records${quote?.page ? ` ("${quote.page}")` : ""}: ${quote ? sentences(quote.text) : "see the cited rows"}`),
      promises: NO_PROMISES(), model: "sample/rules",
    });
    const r = await tb.replyLoop(tb, { messagesFn, sampleDraftFn, branch: B });
    const draft = { text: r.draft.text, promises: r.draft.promises, model: r.draft.model };
    if (!r.ok) {
      const rounds = tb.S.rounds ?? [];
      const critiques = rounds.flatMap((x) => [{ round: x.n, source: "Evaluator", pass: x.critique.pass, reason: x.critique.reason }, { round: x.n, source: "Risk", pass: x.risk.pass, reason: x.risk.reasons.join("; ") || "signed off" }]);
      const reason = r.risk.hard ? `hard fact Risk cannot rewrite: ${r.risk.reasons.join("; ")}` : `two negative rounds: ${one(r.crit.reason)} | ${r.risk.reasons.join("; ")}`;
      tb.escalate(critiques, reason);
      return { decision: "escalate", reasons: [reason], draft, cited: p.cited };
    }
    tb.skipped("escalate_or_fallback", "both critics passed; a hold waits for a person");
    const owner = await ownerOf(tb, "question", { ...(tb.o ?? {}), ...(tb.cfg ? { cfg: tb.cfg } : {}) });
    return { decision: "hold", reasons: [`${p.why}. Both critics passed; the reply waits for the question owner with the draft attached`], draft, queued: owner, cited: p.cited };
  }
  // question-unanswered
  skipLine(tb, "nvidia.model", "question-unanswered: no draft");
  skipLine(tb, "critique", "question-unanswered: no draft to critique");
  skipLine(tb, "risk.signoff", "question-unanswered: nothing to sign");
  skipLine(tb, "retry", "question-unanswered: a rewrite cannot change it");
  const owner = p.data.owner;
  const recommendation = `not in the FAQ or the records; checked: ${p.data.checked}`;
  tb.escalate([{ source: "Planner", reason: recommendation }], `question-unanswered: ${recommendation}`, {}, { owner, recommendation });
  return { decision: "escalate", reasons: [recommendation], queued: owner, recommendation, cited: [] };
}

// ---- RFQ ----

const said = (q) => (q.length === 0 ? "the quantity asked" : q.length === 1 ? String(q[0]) : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`);

async function probeRfq(tb) {
  const text = tb.inputText ?? "";
  const { lines, o } = buffer(tb, "rfq");
  const params = tb.decided?.parameters;
  const quantities = Array.isArray(params?.quantities) ? params.quantities : extractParams(text).quantities ?? [];
  const products = (await tb.queries.run("products", {}, o)).objects;
  const matched = matchProducts(text, products);
  const prices = [];
  for (const m of matched) {
    const r = (await tb.queries.run("product_price", { product_id: m.product_id }, o)).objects[0];
    if (r) prices.push(r);
  }
  const owner = await ownerOf(tb, "rfq", o);
  const ids = prices.map((x) => `products:${x.product_id}`);
  const q = said(quantities);
  const recommendation = prices.length
    ? `The records hold one unit price for ${prices.map((x) => `${x.name} (${Number(x.unit_price_usd)} ${x.currency ?? "USD"}, minimum ${Number(x.min_order_qty)})`).join(" and for ")}; no volume tiers exist, so ${q} cannot be priced from the data. Sales to quote.`
    : `Quantities asked: ${q}; no product in the records matches; sales to identify.`;
  return { branch_id: "rfq", why: `request for a quote: ${prices.length ? `${prices.map((x) => x.name).join(", ")} found` : "no product matched"}, quantities ${quantities.join(", ") || "none stated"}; sales quotes, prices attached`,
    cited: [...ids, ...(owner.looked_up ? ["responsibility:rfq"] : [])],
    data: { quantities, products: matched, prices, owner, recommendation, ids }, lines };
}

async function actRfq(tb, p) {
  const { quantities, products, prices, owner, recommendation, ids } = p.data;
  const B = p.branch_id;
  skipLine(tb, "nvidia.model", "acknowledgement template, no model call");
  skipLine(tb, "critique", "template, nothing to evaluate");
  // a quantity that equals a unit price would put a price in the draft: say it without numbers
  const safeQ = quantities.filter((n) => !prices.some((x) => String(Number(x.unit_price_usd)) === String(n)));
  const ack = sample.acknowledgement(tb.ticket ?? tb.f, { quantities: safeQ.length === quantities.length ? quantities : [] });
  const draft = { text: ack.text, promises: ack.promises, model: ack.model };
  const sig = signoff(tb, B, draft);
  skipLine(tb, "retry", "template: a rewrite cannot change it");
  const attachments = { prices, quantities, products, cited: ids };
  const reason = `rfq: ${recommendation}${sig.pass ? "" : ` (acknowledgement not signed off: ${sig.reasons.join("; ")})`}`;
  tb.escalate(sig.pass ? [] : [{ source: "Risk", reason: sig.reasons.join("; ") }], reason, {}, { owner, draft: sig.pass ? draft : null, attachments, recommendation });
  return { decision: "escalate", reasons: [reason], draft: sig.pass ? draft : undefined, queued: owner, recommendation, attachments, cited: p.cited };
}

// ---- complaint ----

const NO_HISTORY = () => ({ text: "no earlier threads for this sender", provenance: [], summary: { earlier_threads: 0, complaints: 0, public_before: false, product_complaints: {} }, customer_id: null, product_ids: [] });

async function probeComplaint(tb) {
  const f = tb.f ?? {};
  // one buffer: the world_threads / products / reviews / owner query lines (and their adapter recoveries) join the probe's own lines in order
  const { lines, o } = buffer(tb, null);
  const ticket = { ...(tb.ticket ?? {}), subject: f.subject ?? tb.ticket?.subject ?? "", body: tb.inputText ?? f.body ?? "", channel: f.channel ?? tb.ticket?.channel,
    thread_id: f.thread_id, sender_name: f.sender_name ?? tb.ticket?.sender_name, sender_email: f.sender_email };
  const rows = {};
  let products = [];
  let ctx = NO_HISTORY();
  let wline = "no world context";
  try {
    for (const k of ["world_threads", "products", "reviews"]) rows[k] = (await tb.queries.run(k, {}, o)).objects;
    products = toObjects(rows.products);
    const dir = process.env.WORLD_MODEL_DIR;
    const world = await getWorld({ rows, ...(dir ? { storage: "local", persistDir: dir } : {}) });
    const mentioned = mentionedProducts(`${ticket.subject} ${ticket.body}`, products).map((p) => (typeof p === "object" ? p.product_id : p));
    ctx = complaintContext(world, { sender_email: f.sender_email, product_ids: mentioned, thread_id: f.thread_id, channel: f.channel });
    wline = worldLine(world, ctx);
    lines.push({ step: "meterless.engine", agent_name: "WorldModel", action: "world_context", sponsor: "meterless",
      input_summary: `history of ${f.sender_email ?? "the sender"} and ${ctx.product_ids.length ? ctx.product_ids.join(", ") : "no product"}`,
      output_summary: wline, memory_ids: ctx.provenance.map((p) => p.id), status: "success" });
  } catch (e) {
    lines.push({ step: "meterless.engine", agent_name: "WorldModel", action: "world_context", input_summary: "meterless.engine failed", output_summary: `${e?.name ?? "Error"}: ${one(e?.message, 200)}`, status: "error" },
      { step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after meterless.engine error", output_summary: "world context unavailable, read by text alone", status: "success" });
  }
  // the Nemotron read
  const readLine = (model, read, extra = {}) => {
    const { local, ...rest } = extra;
    lines.push({ step: "nvidia.model", agent_name: "Reader", action: "read_complaint", ...(local ? {} : { sponsor: "nvidia" }), model,
      input_summary: `complaint read for ${f.thread_id ?? "ticket"}`, output_summary: `kind ${read.kind}, face_risk ${read.face_risk}: ${one(read.reasoning, 120)}`, status: "success", ...rest });
  };
  let read;
  const twin = () => sample.complaintRead(ticket, { worldText: ctx.text });
  const sampleLine = (r, extra = {}) => readLine(r.model ?? "sample/rules", r, { status: "skipped", output_summary: `sample mode: rules read (${r.model ?? "sample/rules"}), no model call; kind ${r.kind}, face_risk ${r.face_risk}: ${one(r.reasoning, 100)}`, ...extra });
  if (tb.sampleOn) {
    read = twin();
    sampleLine(read);
  } else {
    try {
      const messages = complaintReadMessages({ ticket, worldText: ctx.text, provenanceIds: ctx.provenance.map((p) => p.id) });
      let res = await tb.io.drafter(messages, { purpose: "complaint_read", trace: tb.io.adapterTrace, signal: tb.io.signal });
      if (res.sample || res.text == null) { read = twin(); sampleLine(read); }
      else {
        let models = null;
        try { read = parseComplaintReadJson(res.text); } catch {
          const first = res.model;
          res = await tb.io.drafter([...messages, { role: "assistant", content: String(res.text) }, { role: "user", content: NUDGE }], { purpose: "complaint_read", trace: tb.io.adapterTrace, signal: tb.io.signal });
          models = `models: ${first}, then ${res.model}`;
          read = parseComplaintReadJson(res.text);
        }
        readLine(res.model, read, { local: res.lane === "local-lane", ...(models ? { output_summary: `kind ${read.kind}, face_risk ${read.face_risk}: ${one(read.reasoning, 100)} (${models})` } : {}) });
      }
    } catch (e) {
      lines.push({ step: "nvidia.model", agent_name: "Reader", action: "read_complaint", sponsor: "nvidia", input_summary: "nvidia.model failed", output_summary: `${e?.name ?? "Error"}: ${one(e?.message, 200)}`, status: "error" },
        { step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after nvidia.model error", output_summary: "complaint read unavailable, rules read used", status: "success" });
      read = twin();
      readLine(read.model ?? "sample/rules", read, { input_summary: "rules read after the model failed" });
    }
  }
  // severity (the gate logs its own line through the shim)
  const sev = await severityGate(ticket, { ...f, repeat: ctx.summary.earlier_threads > 0, publicChannel: f.channel === "trustpilot" }, wline,
    { trace: { line: (x) => lines.push(x) }, cfg: tb.cfg, sampleMode: tb.sampleOn, kind: read.kind, signal: tb.io?.signal });
  const sevCls = sev.score >= 9 ? "complaint-severe" : read.kind === "genuine" ? "complaint-genuine" : "complaint-vent";
  const owner = await ownerOf(tb, "complaint", o);
  const cited = ["world_threads", ...ctx.product_ids.map((p) => `products:${p}`), ...(owner.looked_up ? ["responsibility:complaint"] : [])];
  const hist = ctx.summary.earlier_threads ? `${ctx.summary.earlier_threads} earlier thread${ctx.summary.earlier_threads === 1 ? "" : "s"} on record` : "no earlier threads";
  return { branch_id: sevCls, why: `severity ${sev.score} (${sev.legend}), the customer reads as ${read.kind} (${hist}); ${sevCls === "complaint-severe" ? "a person handles it" : sevCls === "complaint-genuine" ? "the owner gets the draft and the handling note" : "a calm acknowledgement closes it"}`,
    cited, data: { ctx, read, severity: sev, owner }, lines: lines.map((x) => ({ ...x, branch_id: sevCls })) };
}

async function actComplaint(tb, p) {
  const B = p.branch_id;
  const { ctx, read, severity: sev, owner } = p.data;
  const severe = B === "complaint-severe";
  const messagesFn = ({ critiques }) => {
    const m = draftMessages({ ticket: tb.ticket, facts: tb.f, memoryContext: tb.memCtx, critiques });
    const last = m.length - 1;
    const extra = [`How to handle it: ${read.handle || "acknowledge and pass to the owner"}`, `The company's record of this customer: ${ctx.text}`,
      B === "complaint-vent" ? "The customer is venting: write a calm acknowledgement, promise nothing." : "Acknowledge the problem and say a person will follow up; promise no refund, replacement or date."].join("\n");
    m[last] = { ...m[last], content: m[last].content.replace(/Return the JSON object now\.$/, `${extra}\n\nReturn the JSON object now.`) };
    return m;
  };
  const sampleDraftFn = () => ({
    text: sample.frame(tb.ticket ?? tb.f, B === "complaint-vent"
      ? "Thank you for letting us know. We are sorry the order did not arrive as you hoped, and we have noted it."
      : "Thank you for telling us, and we are sorry. This matters to us, and a colleague will look at it personally and come back to you."),
    promises: NO_PROMISES(), model: "sample/rules" });
  const r = await tb.replyLoop(tb, { messagesFn, sampleDraftFn, branch: B, hardRefusal: severe ? () => `severity ${sev.score}: a person handles it` : undefined });
  const draft = { text: r.draft.text, promises: r.draft.promises, model: r.draft.model };
  const critiques = (tb.S.rounds ?? []).flatMap((x) => [{ round: x.n, source: "Evaluator", pass: x.critique.pass, reason: x.critique.reason }, { round: x.n, source: "Risk", pass: x.risk.pass, reason: x.risk.reasons.join("; ") || "signed off" }]);
  const escalation = { severity: sev.score, kind: read.kind, reasoning: read.reasoning, handle: read.handle, world: ctx.provenance.map((x) => x.id) };
  if (severe) {
    const reason = `${p.why}; Risk refused the draft on round 1, escalated with the draft attached`;
    tb.escalate(critiques, reason, {}, { owner, draft, recommendation: read.handle, escalation });
    return { decision: "escalate", reasons: [reason], draft, queued: owner, recommendation: read.handle, cited: p.cited };
  }
  if (!r.ok) {
    const reason = r.risk.hard ? `hard fact Risk cannot rewrite: ${r.risk.reasons.join("; ")}` : `two negative rounds: ${one(r.crit.reason)} | ${r.risk.reasons.join("; ")}`;
    tb.escalate(critiques, reason, {}, { owner, draft, escalation });
    return { decision: "escalate", reasons: [reason], draft, queued: owner, cited: p.cited };
  }
  tb.skipped("escalate_or_fallback", "both critics passed; a hold waits for a person");
  const recommendation = B === "complaint-vent" ? "vent: a calm reply closes it; no action" : read.handle || "a person owns this and repairs it";
  return { decision: "hold", reasons: [`${p.why}. Both critics passed; the reply waits for the complaint owner with the draft attached`], draft, queued: owner, recommendation, cited: p.cited };
}

// ---- customer service (the default when nothing else fits; a person gets a head start) ----

// every amount the text names (a currency sign or code beside a number)
const amountsIn = (text) => [...String(text ?? "").matchAll(/(?:[$€£]\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:usd|eur|dollars?|euros?|[$€£]))/gi)]
  .map((m) => Number(String(m[1] ?? m[2]).replace(/,(?=\d{3}\b)/g, "").replace(/[.,]$/, ""))).filter(Number.isFinite);

// the draft's blanks, completed: every marker in the text is in the list (missing ones are added, not failed)
function completeBlanks(text, listed = []) {
  const out = listed.map((b, i) => ({ id: b.id ?? `blank-${i + 1}`, what: b.what }));
  for (const w of blanks(text)) if (!out.some((b) => b.what.toLowerCase() === w.toLowerCase())) out.push({ id: `blank-${out.length + 1}`, what: w });
  return out;
}

async function probeCustomerService(tb) {
  const f = tb.f ?? {};
  const text = tb.inputText ?? "";
  const { lines, o } = buffer(tb, "customer-service");
  const collected = [];
  const rtrace = { line: (x) => { collected.push(x); return x; } };
  const cand = (tb.decided?.candidates ?? []).filter((c) => c.intent !== "GENERAL").slice(0, 3);
  const conf = tb.decided?.intent?.confidence ?? 0;
  const faqRows = (await tb.queries.run("faq", {}, o)).objects;
  const top = cand[0]?.intent ?? "GENERAL";
  const email = String(f.sender_email ?? "").trim();
  const { rows } = await rowsForIntent(top, email || null, { ...o, trace: rtrace });
  lines.push(...collected.map((x) => ({ ...x, branch_id: "customer-service" })));
  const cited = [...new Set(idsIn(collected))];
  // the world context, when we know who is writing
  let worldText = "", wline = "sender unknown: no world context";
  if (email) {
    const ticket = { ...(tb.ticket ?? {}), subject: f.subject ?? "", body: text, channel: f.channel, thread_id: f.thread_id, sender_email: email };
    try {
      const wrows = {};
      for (const k of ["world_threads", "products", "reviews"]) wrows[k] = (await tb.queries.run(k, {}, o)).objects;
      const dir = process.env.WORLD_MODEL_DIR;
      const world = await getWorld({ rows: wrows, ...(dir ? { storage: "local", persistDir: dir } : {}) });
      const mentioned = mentionedProducts(text, toObjects(wrows.products)).map((p) => (typeof p === "object" ? p.product_id : p));
      const ctx = complaintContext(world, { sender_email: email, product_ids: mentioned, thread_id: f.thread_id, channel: f.channel });
      worldText = ctx.text; wline = worldLine(world, ctx);
      lines.push({ step: "meterless.engine", agent_name: "WorldModel", action: "world_context", sponsor: "meterless", branch_id: "customer-service",
        input_summary: `history of ${email}`, output_summary: wline, memory_ids: ctx.provenance.map((p) => p.id), status: "success" });
    } catch (e) {
      lines.push({ step: "meterless.engine", agent_name: "WorldModel", action: "world_context", input_summary: "meterless.engine failed", output_summary: `${e?.name ?? "Error"}: ${one(e?.message, 200)}`, status: "error", branch_id: "customer-service" },
        { step: "recovery", agent_name: "Planner", action: "recover", input_summary: "after meterless.engine error", output_summary: "world context unavailable, read by text alone", status: "success", branch_id: "customer-service" });
    }
  }
  const owner = await ownerOf(tb, "customer_service", o);
  const pages = (rows.wiki ?? []).map((w) => w.page).filter(Boolean);
  const topText = cand.slice(0, 2).map((c) => `${c.intent} ${Number(c.score).toFixed(1)}`).join(", ") || "none";
  return { branch_id: "customer-service",
    why: `no intent cleared the band (confidence ${Number(conf).toFixed(2)}; top ${topText}); the FAQ (${faqRows.length} rows) was searched, no match`,
    cited: [...cited, ...(owner.looked_up ? ["responsibility:customer_service"] : [])],
    data: { candidates: cand, rows, worldText, pages, faqRows: faqRows.length, owner }, lines };
}

async function actCustomerService(tb, p) {
  const B = p.branch_id;
  const f = tb.f ?? {};
  const { candidates, rows, worldText, pages, faqRows, owner } = p.data;
  const ticket = { ...(tb.ticket ?? {}), subject: f.subject ?? tb.ticket?.subject ?? "", body: tb.inputText ?? f.body ?? "", sender_name: f.sender_name ?? tb.ticket?.sender_name };
  const limit = f.policy_limit_usd ?? (rows.policy?.[0]?.limit_amount != null ? Number(rows.policy[0].limit_amount) : null);
  const twin = () => sample.recommendation(ticket, { candidates, pages, faqRows });
  const callLine = (model, rec, extra = {}) => {
    const { local, ...rest } = extra;
    tb.L({ step: "nvidia.model", agent_name: "Recommender", action: "recommend", ...(local ? {} : { sponsor: "nvidia" }), model, branch_id: B,
      input_summary: `recommendation and draft for ${f.thread_id ?? "ticket"}`, output_summary: `recommendation ${rec.recommendation.length} chars; draft ${rec.draft.length} chars; ${rec.blanks.length} blank(s)`, status: "success", ...rest });
  };
  const recommend = async (critiques) => {
    const messages = recommendationMessages({ ticket, facts: f, candidates, gates: tb.gates, rows, worldText, memories: tb.memCtx, critiques });
    let firstModel = null;
    try {
      let res = await tb.io.drafter(messages, { purpose: "recommendation", trace: tb.io.adapterTrace, signal: tb.io.signal });
      if (res.sample || res.text == null) { const r = twin(); callLine(r.model, r, { status: "skipped", output_summary: `sample mode: rules recommender (${r.model}), no model call` }); return { ...r, model: r.model }; }
      let rec;
      let models = null;
      try { rec = parseRecommendationJson(res.text); } catch {
        firstModel = res.model;
        res = await tb.io.drafter([...messages, { role: "assistant", content: String(res.text) }, { role: "user", content: NUDGE }], { purpose: "recommendation", trace: tb.io.adapterTrace, signal: tb.io.signal });
        models = `models: ${firstModel}, then ${res.model}`;
        rec = parseRecommendationJson(res.text);
      }
      callLine(res.model, rec, { local: res.lane === "local-lane", ...(models ? { output_summary: `recommendation ${rec.recommendation.length} chars; draft ${rec.draft.length} chars; ${rec.blanks.length} blank(s); ${models}` } : {}) });
      return { ...rec, model: res.model };
    } catch (e) {
      tb.L({ step: "nvidia.model", agent_name: "Recommender", action: "recommend", sponsor: "nvidia", branch_id: B, input_summary: "nvidia.model failed", output_summary: `${e?.name ?? "Error"}: ${one(e?.message, 200)}${firstModel ? ` (first model ${firstModel}, nudge failed)` : ""}`, status: "error" });
      tb.L({ step: "recovery", agent_name: "Planner", action: "recover", branch_id: B, input_summary: "after nvidia.model error", output_summary: "rules recommendation used", status: "success" });
      const r = twin(); callLine(r.model, r, { input_summary: "rules recommendation after the model failed" }); return r;
    }
  };
  const build = (rec) => ({ text: rec.draft, promises: NO_PROMISES(), model: rec.model, blanks: completeBlanks(rec.draft, rec.blanks) });
  const check = (draft) => {
    const hr = tb.hardRisk(f, draft);
    const reasons = [...hr.reasons];
    const bad = amountsIn(draft.text).filter((a) => limit == null || a > limit);
    if (bad.length) reasons.push(`draft names an amount (${bad.join(", ")}) ${limit == null ? "with no limit to support it" : `over the ${limit} USD limit`}`);
    return reasons;
  };
  const max = tb.maxRounds ?? 2;
  let rec = await recommend([]);
  let draft = build(rec);
  let n = 1, crit, riskReasons;
  for (;;) {
    try {
      crit = tb.sampleOn ? tb.io.sampleCritic(draft, f) : await tb.io.critic({ draft, facts: f, ticket, trace: tb.io.adapterTrace });
    } catch (e) {
      crit = { pass: false, reason: `evaluator unavailable: ${one(e?.message, 120)}`, model: "none" };
    }
    tb.S.models.evaluator = crit.model;
    tb.L({ step: "critique", agent_name: "Evaluator", action: "critique_draft", target_agent: "Planner", model: crit.model, branch_id: B, retry_count: n - 1,
      input_summary: `round ${n} draft, ${draft.text.length} chars`, output_summary: `${crit.pass ? "Pass" : "Fail"}. ${one(crit.reason)}`, status: crit.pass ? "success" : "needs_revision", memory_ids: tb.S.memRead });
    riskReasons = check(draft);
    const rpass = riskReasons.length === 0;
    tb.L({ step: "risk.signoff", agent_name: "Risk", action: "risk_signoff", sponsor: "meterless", branch_id: B, retry_count: n - 1,
      input_summary: `round ${n} draft vs facts`, output_summary: rpass ? "Signed off." : `Refused: ${riskReasons.join("; ")}`, status: rpass ? "success" : "refused" });
    tb.S.rounds.push({ n, critique: crit, risk: { pass: rpass, reasons: riskReasons, hard: !rpass } });
    if ((crit.pass && rpass) || !rpass || n >= max) break;   // a Risk refusal is hard: no second draft, the first is withheld
    const both = [`Evaluator: ${crit.reason}`, `Risk: ${riskReasons.join("; ") || "signed off"}`];
    tb.L({ step: "retry", agent_name: "Planner", action: "retry_round", target_agent: "Recommender", branch_id: B, retry_count: n, input_summary: `round ${n} negative`,
      output_summary: `${both.join(" | ")}. Next draft must fix both`, status: "retrying", memory_ids: tb.S.memRead });
    rec = await recommend(both);
    draft = build(rec);
    n += 1;
  }
  if (n === 1) skipLine(tb, "retry", "round 1 passed");
  tb.S.models.drafter = rec.model;
  const withheld = riskReasons.length > 0;
  tb.skipped("escalate_or_fallback", "customer service holds with the recommendation; nothing is escalated");
  const reasons = withheld
    ? [`draft withheld: ${one(riskReasons.join("; "), 140)}; customer service holds with the recommendation. ${p.why}`]
    : [`${p.why}. ${crit.pass ? "Both critics passed" : `Evaluator not convinced (${one(crit.reason, 80)})`}; customer service holds with the draft attached`];
  return { decision: "hold", reasons, ...(withheld ? {} : { draft }), queued: owner, recommendation: rec.recommendation, cited: p.cited };
}

export const handleCustomerService = { probe: probeCustomerService, act: actCustomerService };

export const handleComplaint = { probe: probeComplaint, act: actComplaint };

export const handleQuestion = { probe: probeQuestion, act: actQuestion };
export const handleRfq = { probe: probeRfq, act: actRfq };
export const HANDLERS = { question: handleQuestion, rfq: handleRfq, complaint: handleComplaint, customer_service: handleCustomerService };

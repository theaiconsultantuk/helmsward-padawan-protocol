// askQuestion: a plain-words question answered only from Zetaris rows.
// Intent -> named query templates (never text -> SQL). Scout guards first; Nightshift phrases the answer from the rows.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { config, sampleMode as isSampleMode, secrets as cfgSecrets, INBOX_ROOT } from "./config.mjs";
import { Trace } from "./trace.mjs";
import { Scout } from "./engines/scout/index.mjs";
import * as queries from "./queries.mjs";
import * as nightshift from "./adapters/nightshift.mjs";

export const ASK_SYSTEM = [
  "You answer a question for the Jedi Pack support team.",
  "Answer ONLY from the rows given in the user message. Do not use any other knowledge.",
  "Quote the limit (amount and currency) and the name of the policy page when the rows contain them.",
  'For anything the rows do not contain, say "I don\'t have that in the records".',
  "Answer in two or three plain sentences, no JSON, no lists.",
].join("\n");

const one = (s, n = 160) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const WIKI_OF = { "refund.request": "refund.request", "replacement.request": "replacement.request", "order.question": "question" };
const CATEGORY_OF = { "refund.request": "refund", "replacement.request": "replacement", complaint: "complaint" };

// Scout answers GENERAL below its 0.40 confidence band even when one intent clearly leads. For a read-only
// question the leading candidate is safe to use (nothing is sent or decided); confidence stays Scout's own.
function pickIntent(decided) {
  const id = decided.intent?.primary?.id ?? "GENERAL";
  if (id !== "GENERAL") return id;
  const top = (decided.candidates ?? []).find((c) => c.intent !== "GENERAL" && c.score > 0);
  if (!top) return "GENERAL";
  return top.intent === "follow_up" ? "order.question" : top.intent;
}

export function loadThreadsIndex() {
  const text = readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8");
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// customer email -> thread ids (newest first). Ids are whitelisted by queries.mjs (T<n>); the email never reaches SQL.
function threadIdsFor(email, all) {
  const mine = all.filter((t) => String(t.sender_email).toLowerCase() === String(email).toLowerCase())
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  if (!mine.length) return [];
  const ids = [mine[0].thread_id];
  if (mine[0].parent_thread_id) ids.push(mine[0].parent_thread_id);
  return ids;
}

function titleOf(preview) {
  const m = /^title:\s*"?([^"\n]+)"?/m.exec(String(preview ?? ""));
  return m ? m[1].trim() : null;
}

function bodyOf(preview) {
  const s = String(preview ?? "").replace(/^---[\s\S]*?---/, "").replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
  return s.replace(/^Fictional policy for Jedi Pack Inc\. The company is not real\.\s*/, "");
}

function templateAnswer(question, intent, data) {
  const parts = [];
  const pol = data.policies[0];
  const page = data.wiki[0];
  const title = page ? titleOf(page.preview) : null;
  if (pol) {
    const who = (id) => data.names[String(id)] ?? `employee ${id}`;
    parts.push(`The ${pol.topic} limit is ${Number(pol.limit_amount)} ${pol.currency}: up to it the owner is ${who(pol.under_limit_owner_id)}, above it ${who(pol.over_limit_owner_id)}.`);
  } else if (data.category) {
    parts.push(`There is no stated ${data.category} limit in the records.`);
  }
  if (data.facts) {
    const f = data.facts;
    parts.push(`Your ticket ${f.thread_id} (${f.category}${f.amount_usd != null ? `, ${f.amount_usd} USD` : ""}) is with ${f.owner_name ?? "the team"}${f.owner_out ? " who is out, so the backup covers it" : ""}.`);
  }
  if (title) parts.push(`Source: the "${title}" page${intent === "GENERAL" || intent === "appreciation" ? `: ${one(bodyOf(page.preview), 140)}` : ""}.`);
  if (!parts.length) parts.push("I don't have that in the records.");
  else if (intent === "GENERAL" && !pol && !data.facts) parts.push("I don't have anything more specific on that in the records.");
  return parts.join(" ");
}

// Intent -> named query templates -> the rows an answer may use. `o` is { trace, cfg } (the trace collects the cited ids).
// Shared by /ask and the question scenario (S1.2). Returns { data, rows }.
export async function rowsForIntent(intent, customer, o, opts = {}) {
  const data = { policies: [], wiki: [], names: {}, facts: null, category: CATEGORY_OF[intent] ?? null };
  const rows = {};
  if (CATEGORY_OF[intent]) {
    const p = await queries.policyForCategory(CATEGORY_OF[intent], o);
    data.policies = p.policy;
    rows.policy = p.policy; rows.category = p.categories; rows.trust_ledger = p.trust_ledger;
    for (const id of new Set(p.policy.flatMap((x) => [x.under_limit_owner_id, x.over_limit_owner_id]))) {
      // a name is a nicety: an employee row that cannot be read leaves "employee <id>" in the answer
      const e = (await queries.run("employee", { employee_id: id }, o).catch(() => ({ objects: [] }))).objects[0];
      if (e) data.names[String(e.employee_id)] = `${e.given_name} ${e.family_name}`;
    }
    rows.owners = data.names;
  }
  const wikiIntent = WIKI_OF[intent] ?? (intent === "complaint" ? null : "GENERAL");
  if (wikiIntent) {
    const w = await queries.wikiFor(wikiIntent === "GENERAL" ? "other" : wikiIntent, o);
    data.wiki = w;
    rows.wiki = w.map((x) => ({ page: titleOf(x.preview), path: x.path, text: one(bodyOf(x.preview), 700) }));
  }
  if (customer) {
    const ids = threadIdsFor(customer, opts.threads ?? loadThreadsIndex());
    if (ids.length) {
      const f = await queries.factsForTicket(ids[0], o);
      data.facts = f;
      rows.ticket = { thread_id: f.thread_id, category: f.category, amount_usd: f.amount_usd, received_at: f.received_at, subject: f.subject,
        policy_limit_usd: f.policy_limit_usd, owner: f.owner_name, owner_out: f.owner_out };
      if (ids[1]) {
        const parent = await queries.thread(ids[1], o);
        if (parent) rows.parent_ticket = { thread_id: parent.thread_id, category: parent.category, subject: parent.subject, amount_usd: parent.amount_usd };
      }
    }
  }
  return { data, rows };
}

export async function askQuestion(question, { customer = null, run_id = `ask_${Date.now().toString(36)}`, cfg = config(), deps = {} } = {}) {
  const trace = Trace.open(run_id, { ...(deps.logsDir ? { logsDir: deps.logsDir } : {}), ...(deps.quiet ? { stdout: false } : {}) });
  const q = String(question ?? "").trim();
  const sample = isSampleMode(cfg);
  const secret = cfg.SCOUT_SECRET;
  const scout = deps.scout ?? new Scout({ intentRegistry: join(INBOX_ROOT, "src", "engines", "scout", "intents.inbox.json"), policyPack: ["default"], ...(secret ? { secret } : {}) });
  const drafter = deps.drafter ?? ((messages, o) => nightshift.draft(messages, { cfg, trace: o.trace, purpose: o.purpose }));
  const finish = (r) => ({ ...r, trace_id: trace.trace_id, log_file: trace.close().log_file });

  // 1. guard first: Scout decides before any query or model call
  const decided = await scout.decide({ prompt: q, user: { id: "inbox-ask", roles: ["agent"] }, surface: "email" });
  const contractId = decided.executionContract?.contractId ?? "none";
  const flags = decided.risk?.flags ?? [];
  const confidence = decided.intent?.confidence ?? 0;
  if (decided.risk?.level === "block") {
    trace.line({ step: "meterless.engine", agent_name: "Scout", action: "decide_contract", sponsor: "meterless", input_summary: one(q, 120),
      output_summary: `contract ${contractId}; refused: ${flags.join(", ") || "blocked"}`, status: "refused", confidence });
    const answer = `This question was refused: ${flags.join(", ")}`;
    trace.line({ step: "synthesis", agent_name: "Planner", action: "answer", input_summary: one(q, 120), output_summary: `refused, no model call, no rows`, status: "refused" });
    return finish({ answer, intent: "blocked", cited_rows: [], model: null, confidence, refused: { flags } });
  }
  const intent = pickIntent(decided);
  trace.line({ step: "meterless.engine", agent_name: "Scout", action: "decide_contract", sponsor: "meterless", input_summary: one(q, 120),
    output_summary: `contract ${contractId}; intent ${intent}; risk ${decided.risk?.level ?? "low"}`, status: "success", confidence });

  // 2. intent -> templates; the trace wrapper collects the ids the queries return
  const cited = [];
  const qtrace = { line: (f) => {
    const m = f.step === "zetaris.query" && f.status === "success" ? /rows: (.*)$/.exec(f.output_summary ?? "") : null;
    if (m && m[1] !== "none") for (const id of m[1].split(", ")) if (!cited.includes(id)) cited.push(id);
    return trace.line(f);
  } };
  const o = { trace: qtrace, cfg };
  const { data, rows } = await rowsForIntent(intent, customer, o, { threads: deps.threads });

  // 3. Nightshift phrases the answer from the rows; sample mode builds it from the rows
  let answer, model, status = "success";
  const messages = [{ role: "system", content: ASK_SYSTEM },
    { role: "user", content: `Question: ${q}\n\nRows (the only facts you may use):\n${JSON.stringify(rows)}` }];
  let r = null, err = null;
  if (!sample) {
    try { r = await drafter(messages, { trace, purpose: "ask" }); } catch (e) { err = e; }
  } else if (deps.drafter) {
    r = await drafter(messages, { trace, purpose: "ask" });
  } else {
    r = await nightshift.draft(messages, { cfg, trace, purpose: "ask" });
  }
  if (r?.text && String(r.text).trim()) {
    answer = String(r.text).trim(); model = r.model ?? null;
  } else {
    answer = templateAnswer(q, intent, data); model = "sample/rules";
    status = err ? "error" : "skipped";
  }
  trace.line({ step: "nvidia.model", agent_name: "Drafter", action: "answer_question", sponsor: "nvidia", model, input_summary: one(q, 120),
    output_summary: err ? `${err.name}: ${one(err.message, 120)}; answered from the rows by template` : one(answer, 160), status, confidence });
  trace.line({ step: "synthesis", agent_name: "Planner", action: "answer", input_summary: one(q, 120),
    output_summary: `intent ${intent}; cited ${cited.join(", ") || "none"}; ${trace.close().log_file}`, status: "success", confidence, model });
  return finish({ answer, intent, cited_rows: cited, model, confidence });
}

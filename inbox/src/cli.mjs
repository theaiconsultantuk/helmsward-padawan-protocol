#!/usr/bin/env node
// Jedi Pack inbox CLI: doctor, pin-primary (the Nightshift measuring step), sql, sql-name.
// .env is read only through config.mjs; the one write is the NIGHTSHIFT_ROUTE_PRIMARY line, by sed.
import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { config, secrets, sampleMode, INBOX_ROOT } from "./config.mjs";
import { mask } from "./trace.mjs";
import * as zetaris from "./adapters/zetaris.mjs";
import * as nightshift from "./adapters/nightshift.mjs";
import * as openjev from "./adapters/openjev.mjs";
import { typedGates, severityGate, trustFloor, hardRisk } from "./gates.mjs";

const PROMPT = [{ role: "user", content: "Reply with the single word OK." }];
const CANDIDATES = [
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-nano-30b-a3b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "meterless/auto",
  "meterless/fast",
];
const isNemotron = (id) => typeof id === "string" && id.startsWith("nvidia/nemotron");

const receiptOf = (body) => ({
  kind: body?.meterless?.winning_route?.kind ?? "unknown",
  egress: body?.meterless?.egress?.destination ?? "unknown",
});

async function doctor() {
  const cfg = config();
  if (sampleMode(cfg)) { console.log("sample mode: all three skipped"); return 0; }
  let ok = 0, warn = 0, fail = 0;

  const z = await zetaris.status({ cfg });
  if (z.ok) { ok++; console.log(`zetaris: ok (SELECT 1 in ${z.ms} ms)`); }
  else { fail++; console.log(`zetaris: FAIL (${z.error})`); }

  const n = await nightshift.status({ cfg });
  if (n.state !== "online") {
    fail++; console.log(`nightshift: ${n.state}${n.error ? ` (${n.error})` : ""}`);
  } else {
    const routes = `routes: [${n.models.slice(0, 6).join(", ")}${n.models.length > 6 ? ", ..." : ""}]`;
    const primary = (cfg.NIGHTSHIFT_ROUTE_PRIMARY ?? "").trim();
    console.log(`nightshift: online, ${routes}`);
    if (!primary) {
      fail++;
      console.log("primary route: not pinned yet (run: node src/cli.mjs pin-primary)");
    } else {
      // own fetch: the adapter's chat() takes no max_tokens and drops the body of a 502 (meterless_detail)
      try {
        const res = await fetch(`${cfg.METERLESS_BASE_URL}/chat/completions`, {
          method: "POST", signal: AbortSignal.timeout(60000),
          headers: { Authorization: `Bearer ${cfg.METERLESS_RUNTIME_TOKEN}`, "meterless-app": "jedi-pack-inbox", "meterless-scope": "user", "Content-Type": "application/json" },
          body: JSON.stringify({ model: primary, messages: PROMPT, temperature: 0.2, max_tokens: 16 }),
        });
        const text = await res.text();
        let body; try { body = JSON.parse(text); } catch { body = text; }
        if (res.status === 401 || res.status === 403) {
          fail++; console.log(`primary route ${primary}: unauthorized (HTTP ${res.status})`);
        } else if (res.status >= 400) {
          warn++;
          const detail = String(body?.meterless_detail ?? body?.error?.message ?? (typeof body === "string" ? body : JSON.stringify(body))).slice(0, 120);
          console.log(`primary route ${primary}: HTTP ${res.status}`);
          console.log(`warn: ${detail}`);
        } else {
          const headers = {};
          for (const [k, v] of res.headers.entries()) headers[k.toLowerCase()] = v;
          const model = nightshift.handledModel({ headers, body });
          const { kind, egress } = receiptOf(body);
          console.log(`primary route ${primary} → ${model ?? "no model id"} (${kind}, egress ${egress})`);
          if (isNemotron(model)) { ok++; console.log("ok"); }
          else if (kind === "local") { warn++; console.log("warn: Nightshift answered from its local lane; the Nemotron evidence is in judging/traces/"); }
          else { warn++; console.log(`warn: handled model is not nvidia/nemotron (${model ?? "no model id"})`); }
        }
      } catch (e) {
        fail++; console.log(`primary route ${primary}: offline (${e.name}: ${e.message})`);
      }
    }
  }

  const o = await openjev.status({ cfg });
  if (o.ok) { ok++; console.log(`openjev: ok (model ${o.model}, ${o.ms} ms)`); }
  else { fail++; console.log(`openjev: FAIL (${o.error})`); }

  if (String(process.env.LOCAL_LANE_BASE_URL ?? cfg.LOCAL_LANE_BASE_URL ?? "").trim()) {
    try {
      const r = await nightshift.localLane(PROMPT, { cfg, maxTokens: 16, timeoutMs: 60000 });
      ok++; console.log(`local lane: ok (${r.model}, ${r.latencyMs} ms)`);
    } catch { console.log("local lane: offline (optional)"); }
  }

  console.log(`doctor: ${ok} ok, ${warn} warn, ${fail} fail`);
  return fail > 0 ? 1 : 0;
}

async function pinPrimary() {
  const cfg = config();
  const sec = secrets();
  const outDir = join(INBOX_ROOT, "judging");
  mkdirSync(outDir, { recursive: true });
  const authHeaders = { Authorization: `Bearer ${cfg.METERLESS_RUNTIME_TOKEN}`, "meterless-app": "jedi-pack-inbox" };

  // (1) the model list
  const mr = await fetch(`${cfg.METERLESS_BASE_URL}/models`, { headers: authHeaders, signal: AbortSignal.timeout(15000) });
  const mtext = await mr.text();
  let mbody; try { mbody = JSON.parse(mtext); } catch { mbody = mtext; }
  writeFileSync(join(outDir, "nightshift-models.json"), JSON.stringify(mask({ status: mr.status, body: mbody }, sec), null, 2) + "\n");
  console.log(`models: HTTP ${mr.status}, ${Array.isArray(mbody?.data) ? mbody.data.length : 0} ids -> judging/nightshift-models.json`);
  if (!mr.ok) { console.log("cannot list models; stopping"); return 1; }

  // (2) first live chat per candidate (120 s: the local WebLLM lane answers in 30-70 s, measured 23 Oct) (own fetch: the adapter drops headers on non-200)
  const record = [];
  let pinned = null;
  for (const route of CANDIDATES) {
    const t0 = Date.now();
    const entry = { route };
    try {
      const res = await fetch(`${cfg.METERLESS_BASE_URL}/chat/completions`, {
        method: "POST", signal: AbortSignal.timeout(120000),
        headers: { ...authHeaders, "meterless-scope": "user", "Content-Type": "application/json" },
        body: JSON.stringify({ model: route, messages: PROMPT, temperature: 0.2, max_tokens: 16 }),
      });
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      const headers = {};
      for (const [k, v] of res.headers.entries()) if (!sec.includes(v)) headers[k.toLowerCase()] = v;
      entry.status = res.status; entry.headers = headers; entry.body = body;
      entry.handled_model = nightshift.handledModel({ headers, body });
    } catch (e) {
      entry.status = null; entry.error = `${e.name}: ${e.message}`; entry.handled_model = null;
    }
    entry.latency_ms = Date.now() - t0;
    record.push(entry);
    console.log(`  ${route}: HTTP ${entry.status ?? "none"} → ${entry.handled_model ?? "no model id"} (${entry.latency_ms} ms)`);
    if (!pinned && entry.status === 200 && isNemotron(entry.handled_model)) pinned = entry;
  }
  writeFileSync(join(outDir, "nightshift-first-call.json"), JSON.stringify(mask(record, sec), null, 2) + "\n");

  // (3) pin
  if (!pinned) {
    console.log("no route reported a Nemotron model id");
    for (const e of record) {
      const { kind, egress } = receiptOf(e.body);
      console.log(`  ${e.route}: winning_route.kind ${kind}, egress.destination ${egress}`);
    }
    let current = "";
    try { current = (readFileSync(join(INBOX_ROOT, ".env"), "utf8").match(/^NIGHTSHIFT_ROUTE_PRIMARY=(.*)$/m)?.[1] ?? "").trim(); } catch { /* no .env */ }
    if (current) { console.log(`Nightshift chose a local lane for every probe; pin stays at ${current}`); return 0; }
    console.log("Nightshift chose a local lane for every probe; pin stays at unset");
    return 3;
  }
  execFileSync("sed", ["-i", `s|^NIGHTSHIFT_ROUTE_PRIMARY=.*|NIGHTSHIFT_ROUTE_PRIMARY=${pinned.route}|`, join(INBOX_ROOT, ".env")]);
  console.log(`pinned: ${pinned.route} → ${pinned.handled_model}`);
  return 0;
}

async function sql(args, apply) {
  const stmt = args.join(" ").trim();
  if (!stmt) { console.error('usage: sql "<statement>" [--apply]'); return 64; }
  if (!/^\s*(select|show|describe)\b/i.test(stmt) && !apply) {
    console.error("refused: only SELECT/SHOW/DESCRIBE run without --apply");
    return 2;
  }
  const out = await zetaris.sqlRun(stmt, { cfg: config() });
  console.log(JSON.stringify(mask(out, secrets()), null, 2));
  return 0;
}

const csv = (name) => {
  const [head, ...rows] = readFileSync(join(INBOX_ROOT, "data", "synthetic", name), "utf8").trim().split("\n");
  const cols = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v])));
};

async function gatesCmd(args) {
  const id = args[0];
  if (!id) { console.error("usage: gates <thread_id>"); return 64; }
  const ticket = readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((t) => t.thread_id === id);
  if (!ticket) { console.error(`no thread ${id}`); return 2; }
  const pol = csv("policy.csv").find((p) => p.topic === "refund") ?? csv("policy.csv")[0];
  const limit = Number(pol.limit_amount);
  const led = csv("trust-ledger.csv").find((r) => r.category === ticket.category);
  const over = ticket.amount_usd != null && ticket.amount_usd > limit;
  const ownerId = Number(over ? pol.over_limit_owner_id : pol.under_limit_owner_id);
  const backupId = Number(over ? pol.over_limit_backup_id : pol.under_limit_backup_id);
  const day = String(ticket.received_at).slice(0, 10);
  const hol = csv("holiday-2026.csv");
  const out = (e) => hol.some((h) => Number(h.employee_id) === e && h.date === day);
  const facts = {
    thread_id: id, category: ticket.category, amount_usd: ticket.amount_usd, policy_limit_usd: limit,
    category_weight: led ? Number(led.weight) : 0, floor: led ? Number(led.floor) : 0.8,
    owner_id: ownerId, backup_id: backupId, owner_out: out(ownerId), backup_out: out(backupId),
    may_leave: ticket.may_leave, restricted_terms: [], cited_rows: [], received_at: ticket.received_at,
  };
  const g = await typedGates(ticket, facts, { cfg: config() });
  const a = g.answers;
  console.log(`gate_source: ${g.gate_source}  model: ${g.model}  confidence: ${g.confidence.toFixed(2)}`);
  console.log(`is_follow_up: ${a.is_follow_up.toFixed(2)}`);
  console.log(`category: ${a.category.choice} (confidence ${a.category.confidence.toFixed(2)})`);
  console.log(`urgency: ${a.urgency.score.toFixed(2)} (${JSON.stringify(a.urgency.legend)})`);
  console.log(`tone: ${a.tone.score.toFixed(2)} (${JSON.stringify(a.tone.legend)})`);
  console.log(`asks_for_money: ${a.asks_for_money.toFixed(2)}`);
  console.log(`trustFloor: ${JSON.stringify(trustFloor(facts, g))}`);
  console.log(`hardRisk: ${JSON.stringify(hardRisk(facts))}`);
  return 0;
}

async function sqlName(args) {
  const [tpl, ...kv] = args;
  if (!tpl) { console.error("usage: sql-name <template> [k=v ...] | sql-name facts <thread_id> [as_of=YYYY-MM-DD]"); return 64; }
  const cfg = config();
  const queries = await import("./queries.mjs");
  const kvObj = (a) => Object.fromEntries(a.map((x) => x.split(/=(.*)/s).slice(0, 2)));
  if (tpl === "facts") {
    if (!kv[0]) { console.error("usage: sql-name facts <thread_id> [as_of=YYYY-MM-DD]"); return 64; }
    const f = await queries.factsForTicket(kv[0], { as_of: kvObj(kv.slice(1)).as_of, cfg });
    console.log(JSON.stringify(mask(f, secrets()), null, 2));
    return 0;
  }
  const r = await queries.run(tpl, kvObj(kv), { cfg });
  console.log(JSON.stringify(mask(r.objects, secrets()), null, 2));
  return 0;
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  apply: { type: "boolean", default: false }, thread: { type: "string" }, "as-of": { type: "string" },
  "run-id": { type: "string" }, example: { type: "string" }, customer: { type: "string" }, kind: { type: "string" },
} });

async function runCmd(v) {
  let body;
  if (v.example !== undefined) {
    if (!/^\d+$/.test(v.example)) { console.error("usage: run --example N"); return 64; }
    body = JSON.parse(readFileSync(join(INBOX_ROOT, "input_examples", `example_${v.example}.json`), "utf8"));
  } else if (v.thread) {
    body = { input: { thread_id: v.thread } };
  } else { console.error("usage: run --thread <id> [--as-of YYYY-MM-DD] [--run-id <id>] [--example N]"); return 64; }
  if (v["as-of"]) body.input = { ...body.input, as_of: v["as-of"] };
  if (v["run-id"]) body.run_id = v["run-id"];
  let cfg = config();
  if (body.options?.sample_mode === true) cfg = { ...cfg, SAMPLE_MODE: "true" };
  const { runTicket } = await import("./loop.mjs");
  const result = await runTicket(body.input.thread_id ?? null, { run_id: body.run_id, as_of: body.input.as_of, cfg, deps: { quiet: true }, input: body.input });
  const out = {
    run_id: result.run_id, status: result.status, output: result.output, agents: result.agents,
    ...(result.scenario ? { scenario: result.scenario, resolved_how: result.resolved_how, branch_id: result.branch_id } : {}),
    ...(result.input ? { input: result.input } : {}),
    trace_id: result.trace_id, log_file: result.log_file, execution_time_seconds: result.execution_time_seconds,
    ...(result.error ? { error: result.error } : {}),
  };
  console.log(JSON.stringify(mask(out, secrets()), null, 2));
  return result.status === "success" ? 0 : 1;
}
async function askCmd(args, v) {
  const question = args.join(" ").trim();
  if (!question) { console.error('usage: ask "<question>" [--customer <email>]'); return 64; }
  const { askQuestion } = await import("./ask.mjs");
  const out = await askQuestion(question, { customer: v.customer ?? null, cfg: config(), deps: { quiet: true } });
  console.log(JSON.stringify(mask(out, secrets()), null, 2));
  return 0;
}
async function gatesSeverityCmd(args, v) {
  const text = args.join(" ").trim();
  const kind = v.kind ?? "vent";
  if (!text || !["vent", "genuine"].includes(kind)) { console.error('usage: gates-severity "<text>" [--kind vent|genuine]'); return 64; }
  const ticket = { subject: text.slice(0, 60), body: text, channel: "chat" };
  const noop = { line() {} };
  const r = await severityGate(ticket, {}, "", { trace: noop, cfg: config(), sampleMode: false, kind });
  console.log(JSON.stringify(mask(r, secrets()), null, 2));
  return 0;
}
const [cmd, ...rest] = positionals;
let code = 64;
try {
  if (cmd === "doctor") code = await doctor();
  else if (cmd === "pin-primary") code = await pinPrimary();
  else if (cmd === "sql") code = await sql(rest, values.apply);
  else if (cmd === "gates") code = await gatesCmd(rest);
  else if (cmd === "gates-severity") code = await gatesSeverityCmd(rest, values);
  else if (cmd === "run") code = await runCmd(values);
  else if (cmd === "sql-name") code = await sqlName(rest);
  else if (cmd === "ask") code = await askCmd(rest, values);
  else console.error("usage: cli.mjs doctor | pin-primary | sql \"<statement>\" [--apply] | gates <thread_id> | gates-severity \"<text>\" [--kind vent|genuine] | sql-name <template> [k=v ...] | ask \"<question>\" [--customer <email>] | run --thread <id>|--example N");
} catch (e) {
  console.error(`${e.name}: ${mask(String(e.message), secrets())}`);
  code = 1;
}
process.exit(code);

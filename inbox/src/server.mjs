// Jedi Pack inbox HTTP server: /health /run /ask /sources /intake /counters /feedback /runs /runs/:id[/trace|/journey] /queue /openapi.yaml.
// JSON everywhere (except the YAML file), CORS *, zero deps (node:http). Contract: inbox/openapi.yaml.
import { createServer as httpServer } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, secrets, sampleMode, INBOX_ROOT } from "./config.mjs";
import { mask } from "./trace.mjs";
import { runTicket } from "./loop.mjs";
import { askQuestion } from "./ask.mjs";
import * as queries from "./queries.mjs";
import * as decisions from "./decisions.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { deriveJourney } from "./journey.mjs";

export const VERSION = "0.1.0";
export const BODY_LIMIT = 256 * 1024;
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
export const RUN_CAP = 200;
// run_id -> result, for CP4's GET /runs/:id. Insertion order; oldest dropped past the cap.
export const runs = new Map();
// run_id -> finish time (ISO), kept beside the result so GET /runs/:id still returns the result unchanged
const runAt = new Map();
function remember(run_id, result) {
  runs.delete(run_id);
  runs.set(run_id, result);
  runAt.set(run_id, new Date().toISOString());
  while (runs.size > RUN_CAP) runs.delete(runs.keys().next().value);
  for (const k of runAt.keys()) if (!runs.has(k)) runAt.delete(k);
}
const atOf = (id) => runAt.get(id) ?? null;
const personOf = (id, name) => ({ employee_id: id ?? null, name: name ?? null });

// GET /runs rows, newest first
function runList(limit) {
  return [...runs.entries()].reverse().slice(0, limit).map(([id, r]) => {
    const isAsk = id.startsWith("ask_") || (r.intent !== undefined && r.output === undefined);
    return {
      run_id: id, kind: isAsk ? "ask" : "run", scenario: r.scenario ?? null, decision: r.output?.decision ?? null,
      thread_id: r.input?.thread_id ?? null, branch_id: r.branch_id ?? null,
      execution_time_seconds: r.execution_time_seconds ?? null, at: atOf(id),
    };
  });
}

// GET /queue rows: every queue file under memoryDir/queue plus held results from the runs map, newest first
function queueList(memoryDir) {
  const out = [];
  const qdir = join(memoryDir, "queue");
  let files = [];
  try { files = readdirSync(qdir).filter((f) => f.endsWith(".json")); } catch { files = []; }
  for (const f of files) {
    try {
      const full = join(qdir, f);
      const q = JSON.parse(readFileSync(full, "utf8"));
      const own = q.owner ?? null;
      const t = q.ticket ?? {};
      const mtime = statSync(full).mtime.toISOString();
      const row = { ticket_id: t.thread_id ?? t.id ?? f.replace(/\.json$/, ""), file: f, category: t.category ?? null, decision_reason: t.decision_reason ?? null };
      if (t.approval) row.approver = personOf(t.approval.approver_id, t.approval.approver_name);
      else {
        const hit = [...runs.values()].find((r) => (r.input?.thread_id ?? null) === row.ticket_id || r.output?.queued_for?.queue_file?.endsWith(`/${f}`));
        const qf = hit?.output?.queued_for;
        row.owner = personOf(own?.owner_id ?? qf?.owner_id ?? t.owner_id, own?.owner_name ?? qf?.owner_name ?? t.owner_name);
      }
      row.has_draft = Boolean(t.draft?.text);
      row.critiques = Array.isArray(q.critiques) ? q.critiques : (q.critiques ? [q.critiques] : []);
      row.mtime = mtime;
      out.push(row);
    } catch { /* an unreadable queue file is skipped */ }
  }
  for (const [id, r] of runs) {
    if (r.output?.decision !== "hold" || !r.output?.draft) continue;
    const qf = r.output.queued_for;
    out.push({ run_id: id, ticket_id: r.input?.thread_id ?? null, kind: "held", scenario: r.scenario ?? null,
      owner: personOf(qf?.owner_id, qf?.owner_name), has_draft: true,
      recommendation: qf?.recommendation ?? r.output.recommendation ?? null, at: atOf(id) });
  }
  const when = (x) => Date.parse(x.mtime ?? x.at ?? "") || 0;
  return out.sort((a, b) => when(b) - when(a));
}

// Static pages: a CLOSED list. The request only picks an entry; the file path is built from the entry, never from request input.
const STATIC_TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
export const STATIC_NAMES = ["app.js", "dashboard.js", "style.css", "demo-scenarios.json"];
const PAGES = { "/": "index.html", "/dashboard": "dashboard.html" };
function staticFile(path) {
  let entry = Object.hasOwn(PAGES, path) ? PAGES[path] : null;
  if (!entry && path.startsWith("/static/")) {
    let raw;
    try { raw = decodeURIComponent(path.slice(8)); } catch { raw = ""; }
    entry = STATIC_NAMES.find((n) => n === raw) ?? null;
  }
  if (!entry) return null;
  const ext = entry.slice(entry.lastIndexOf("."));
  return { file: join(INBOX_ROOT, "public", entry), type: STATIC_TYPES[ext] };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// thread_id -> category, from the committed threads file
function threadIndex() {
  try {
    return new Map(readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => { const t = JSON.parse(l); return [t.thread_id, t.category ?? ""]; }));
  } catch { return new Map(); }
}
const threadIds = () => new Set(threadIndex().keys());

const newRunId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const errBody = (run_id, type, message, recoverable, t0, trace_id = null) => ({
  run_id, status: "error", error: { type, message, recoverable }, trace_id,
  execution_time_seconds: Math.round(((Date.now() - t0) / 1000) * 1000) / 1000,
});

class HttpError extends Error {
  constructor(status, type, message) { super(message); this.status = status; this.type = type; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new HttpError(413, "BadRequest", `body over ${BODY_LIMIT} bytes`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const ASOF = /^\d{4}-\d{2}-\d{2}$/;
export const CHANNELS = ["email", "contact-form", "chat", "trustpilot"];

// validates the free-text message input; returns the clean object the loop takes, or throws the 400
function validateMessage(input) {
  const bad = (m) => { throw new HttpError(400, "BadRequest", m); };
  if (typeof input.message !== "string") bad("message must be a string");
  const message = input.message.trim();
  if (message.length < 1 || message.length > 4000) bad("message must be 1 to 4000 characters");
  if (typeof input.from !== "string" || !input.from.trim() || input.from.length > 200) bad("from must be a non-empty string of at most 200 characters (an email or a name)");
  if (typeof input.channel !== "string" || !CHANNELS.includes(input.channel)) bad(`channel must be one of ${CHANNELS.join(", ")}`);
  if (input.scenario !== undefined && (typeof input.scenario !== "string" || !SCENARIOS.includes(input.scenario))) bad(`scenario must be one of ${SCENARIOS.join(", ")} or absent`);
  for (const k of ["name", "subject"]) {
    if (input[k] !== undefined && input[k] !== null && (typeof input[k] !== "string" || input[k].length > 200)) bad(`${k} must be a string of at most 200 characters`);
  }
  if (input.as_of !== undefined && (typeof input.as_of !== "string" || !ASOF.test(input.as_of))) bad("as_of must be YYYY-MM-DD");
  return { message, from: input.from.trim(), channel: input.channel, ...(input.scenario ? { scenario: input.scenario } : {}),
    ...(input.name ? { name: input.name } : {}), ...(input.subject ? { subject: input.subject } : {}), ...(input.as_of ? { as_of: input.as_of } : {}) };
}

export function createServer({ cfg = config(), deps = {} } = {}) {
  const started = Date.now();
  const sec = secrets();
  const dir = deps.dir ?? decisions.RUNTIME_DIR;
  const memoryDir = deps.memoryDir ?? join(INBOX_ROOT, "data", "memory");
  const logsDir = deps.logsDir ?? join(INBOX_ROOT, "logs");
  const runtimeDir = deps.runtimeDir ?? dir; // intake.csv lives beside decisions.csv (data/runtime by default)
  // publishes are serialised; /run fires one and moves on, /feedback and /counters wait for the queue
  let pending = Promise.resolve();
  const queue = () => {
    pending = pending.then(() => (deps.publish ?? decisions.publish)({ dir, cfg })).catch((e) => ({ published: false, error: `${e?.name ?? "Error"}: ${String(e?.message ?? e).slice(0, 200)}` }));
    return pending;
  };
  const publishLater = () => { queue(); };
  const publishNow = () => queue();
  const settled = () => pending;
  const inflight = new Set(); // run ids being run now: a concurrent reuse is a 409 too
  const server = httpServer(async (req, res) => {
    const send = (status, body) => {
      if (res.headersSent) return;
      const text = JSON.stringify(mask(body, sec));
      res.writeHead(status, { ...CORS, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    };
    const sendText = (status, type, text) => {
      if (res.headersSent) return;
      res.writeHead(status, { ...CORS, "Content-Type": type, "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    };
    const t0 = Date.now();
    let run_id = null;
    let claimed = false;
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
      if (req.method === "GET" && path === "/health") {
        send(200, { ok: true, sample_mode: sampleMode(cfg), version: VERSION, uptime_s: Math.round((Date.now() - started) / 1000) });
        return;
      }
      if (path === "/" || path === "/dashboard" || path.startsWith("/static/")) {
        if (req.method !== "GET") { send(405, errBody(null, "BadRequest", `use GET ${path}`, false, t0)); return; }
        const f = staticFile(path);
        let buf = null;
        if (f) { try { buf = readFileSync(f.file); } catch { buf = null; } }
        if (!f || !buf) { send(404, errBody(null, "NotFound", `no route GET ${path}`, false, t0)); return; }
        res.writeHead(200, { ...CORS, "Content-Type": f.type, "Content-Length": buf.length, "Cache-Control": "no-store" });
        res.end(buf);
        return;
      }
      const GET_ONLY = ["/sources", "/intake", "/counters", "/openapi.yaml"];
      const runsM = /^\/runs\/([^/]+)(\/trace|\/journey)?$/.exec(path);
      if (GET_ONLY.includes(path) || path === "/runs" || path === "/queue" || runsM) {
        if (req.method !== "GET") { send(405, errBody(null, "BadRequest", `use GET ${path}`, false, t0)); return; }
        if (path === "/sources") { send(200, await (deps.sources ?? queries.sources)({ cfg })); return; }
        if (path === "/intake") { send(200, JSON.parse(readFileSync(join(INBOX_ROOT, "data", "synthetic", "intakes", "contact-form", "submissions.json"), "utf8"))); return; }
        if (path === "/counters") {
          if (deps.counters) { send(200, await deps.counters({ cfg })); return; }
          if (sampleMode(cfg)) { send(200, decisions.localCounters({ dir })); return; }
          await settled();
          send(200, await queries.counters({ cfg }));
          return;
        }
        if (path === "/runs") {
          const raw = new URL(req.url, "http://localhost").searchParams.get("limit");
          const limit = raw === null ? 50 : (/^\d+$/.test(raw) ? Number(raw) : NaN);
          if (!(limit >= 1 && limit <= 200)) throw new HttpError(400, "BadRequest", "limit must be an integer from 1 to 200");
          send(200, runList(limit));
          return;
        }
        if (path === "/queue") { send(200, queueList(memoryDir)); return; }
        if (path === "/openapi.yaml") { sendText(200, "application/yaml; charset=utf-8", readFileSync(join(INBOX_ROOT, "openapi.yaml"), "utf8")); return; }
        let id;
        try { id = decodeURIComponent(runsM[1]); } catch { id = ""; }
        const stored = runs.get(id);
        if (!stored) { send(404, errBody(id, "NotFound", `no stored run ${id}`, false, t0)); return; }
        if (!runsM[2]) { send(200, stored); return; }
        const tracePath = join(logsDir, basename(String(stored.log_file ?? `trace-${id}.jsonl`)));
        let text;
        try { text = readFileSync(tracePath, "utf8"); } catch { send(404, errBody(id, "NotFound", `trace file for ${id} is gone`, false, t0)); return; }
        const traceLines = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
        send(200, runsM[2] === "/journey" ? deriveJourney(stored, traceLines) : traceLines);
        return;
      }
      if (!["/run", "/ask", "/feedback"].includes(path)) { send(404, errBody(null, "NotFound", `no route ${req.method} ${path}`, false, t0)); return; }
      if (req.method !== "POST") { send(405, errBody(null, "BadRequest", `use POST ${path}`, false, t0)); return; }

      let body;
      try { body = JSON.parse(await readBody(req) || "null"); }
      catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "BadRequest", "body is not valid JSON");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "BadRequest", "body must be a JSON object");

      if (path === "/ask") {
        if (typeof body.question !== "string" || !body.question.trim()) throw new HttpError(400, "BadRequest", "question must be a non-empty string");
        if (body.question.length > 2000) throw new HttpError(400, "BadRequest", "question is over 2000 characters");
        if (body.customer !== undefined && body.customer !== null && typeof body.customer !== "string") throw new HttpError(400, "BadRequest", "customer must be a string");
        const askId = `ask_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        const r = await (deps.ask ?? askQuestion)(body.question, { customer: body.customer || null, run_id: askId, cfg, deps });
        const out = { run_id: askId, ...r };
        remember(askId, out);
        send(200, out);
        return;
      }
      if (path === "/feedback") {
        if (typeof body.run_id !== "string" || !body.run_id) throw new HttpError(400, "BadRequest", "run_id is required");
        if (body.verdict !== "affirm" && body.verdict !== "reject") throw new HttpError(400, "BadRequest", "verdict must be affirm or reject");
        if (body.note !== undefined && typeof body.note !== "string") throw new HttpError(400, "BadRequest", "note must be a string");
        const row = await decisions.setVerdict(body.run_id, body.verdict, body.note, { dir });
        if (!row) throw new HttpError(404, "NotFound", `no decision recorded for run ${body.run_id}`);
        const pub = await publishNow();
        send(200, { ...row, delta: Number(row.delta), published: pub.published === true, ...(pub.error ? { publish_error: pub.error } : {}) });
        return;
      }
      if (body.run_id !== undefined && (typeof body.run_id !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(body.run_id))) {
        throw new HttpError(400, "BadRequest", "run_id must be 1-80 chars of letters, digits, . _ -");
      }
      run_id = body.run_id ?? newRunId();
      const input = body.input;
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "BadRequest", "input must be an object: {thread_id, as_of?} or {message, from, channel}");
      const opts = body.options ?? {};
      if (typeof opts !== "object" || Array.isArray(opts) || (opts.sample_mode !== undefined && typeof opts.sample_mode !== "boolean")) {
        throw new HttpError(400, "BadRequest", "options.sample_mode must be a boolean");
      }

      const isMsg = input.thread_id === undefined;
      let msgInput = null;
      if (isMsg) {
        if (input.message === undefined) throw new HttpError(400, "BadRequest", "input needs thread_id, or message + from + channel");
        msgInput = validateMessage(input);
      } else {
        if (typeof input.thread_id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(input.thread_id)) throw new HttpError(400, "BadRequest", "thread_id must be a short id string");
        if (input.as_of !== undefined && (typeof input.as_of !== "string" || !ASOF.test(input.as_of))) throw new HttpError(400, "BadRequest", "as_of must be YYYY-MM-DD");
        if (!threadIds().has(input.thread_id)) {
          send(404, errBody(run_id, "NotFound", `unknown thread ${input.thread_id}`, false, t0));
          return;
        }
      }
      if (runs.has(run_id) || inflight.has(run_id)) throw new HttpError(409, "Conflict", `run_id ${run_id} was already used`);
      inflight.add(run_id);
      claimed = true;

      // options.sample_mode:true forces sample mode; false never turns a sample-mode server live.
      const runCfg = opts.sample_mode === true ? { ...cfg, SAMPLE_MODE: "true" } : cfg;
      const result = isMsg
        ? await runTicket(null, { run_id, as_of: msgInput.as_of, cfg: runCfg, deps: { ...deps, runtimeDir }, input: msgInput })
        : await runTicket(input.thread_id, { run_id, as_of: input.as_of, cfg: runCfg, deps });
      const out = {
        run_id: result.run_id, status: result.status, output: result.output, agents: result.agents,
        trace_id: result.trace_id, log_file: result.log_file, execution_time_seconds: result.execution_time_seconds,
        ...(result.scenario !== undefined ? { scenario: result.scenario, resolved_how: result.resolved_how, branch_id: result.branch_id } : {}),
        ...(result.input ? { input: result.input } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
      remember(run_id, out);
      // a sample-forced run on a LIVE server is not counted: it writes no row and triggers no publish
      const forcedSampleOnLive = sampleMode(runCfg) && !sampleMode(cfg);
      if (out.status === "success" && out.output?.decision && !forcedSampleOnLive && (!isMsg || out.input?.thread_id)) {
        await decisions.appendDecision({ run_id, thread_id: isMsg ? (result.input?.thread_id ?? "") : input.thread_id, category: isMsg ? (result.scenario ?? "") : (threadIndex().get(input.thread_id) ?? ""), decision: out.output.decision }, { dir });
        publishLater();
      }
      inflight.delete(run_id);
      send(200, out);
    } catch (e) {
      if (claimed) inflight.delete(run_id);
      if (e instanceof HttpError) { send(e.status, errBody(run_id, e.type, e.message, false, t0)); return; }
      send(500, errBody(run_id, "InternalError", "unexpected server error", true, t0));
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = 60000;
  server.timeout = REQUEST_TIMEOUT_MS;
  return server;
}

export function main() {
  const cfg = config();
  const port = Number(cfg.PORT);
  const host = cfg.HOST;
  const server = createServer({ cfg });
  server.listen(port, host, () => console.log(`jedi-pack-inbox listening on http://${host}:${port} (sample_mode ${sampleMode(cfg)})`));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

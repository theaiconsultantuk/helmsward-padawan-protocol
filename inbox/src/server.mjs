// Jedi Pack inbox HTTP server: /health /run /ask /sources /intake /counters /feedback /faq /demo/scenarios /demo/client /runs /runs/:id[/trace|/journey] /queue /openapi.yaml.
// JSON everywhere (except the YAML file), CORS from CORS_ORIGIN, default *, zero deps (node:http). Contract: inbox/openapi.yaml.
import { createServer as httpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { basename, join, relative, resolve, sep, extname } from "node:path";
import { config, secrets, sampleMode, INBOX_ROOT } from "./config.mjs";
import { mask } from "./trace.mjs";
import { runTicket } from "./loop.mjs";
import { createProgressBoard, progressFromStored, nightshiftEngine } from "./progress.mjs";
import { createProviderHealth } from "./provider_health.mjs";
import { askQuestion } from "./ask.mjs";
import * as queries from "./queries.mjs";
import * as decisions from "./decisions.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { deriveJourney, publicQueueFile, recipientOf } from "./journey.mjs";
import { readCsv } from "./csv.mjs";
import { INTAKE_CAP, readIntake } from "./intake.mjs";
import { isMain } from "./main_guard.mjs";
import { generateClient } from "./demo_names.mjs";

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
// Finished runs are kept on disk (<runtimeDir>/runs/<run_id>.json) so a restart does not blank the desk, the queue and Under the hood.
const runFile = (dir, id) => join(dir, `${String(id).replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
function persistRun(dir, id) {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = runFile(dir, id) + ".tmp";
    writeFileSync(tmp, JSON.stringify({ at: atOf(id), result: runs.get(id) }));
    renameSync(tmp, runFile(dir, id));
    const keep = new Set([...runs.keys()].map((k) => runFile(dir, k)));
    for (const f of readdirSync(dir)) if (f.endsWith(".json") && !keep.has(join(dir, f))) { try { unlinkSync(join(dir, f)); } catch { /* already gone */ } }
  } catch { /* a run that cannot be saved is still served from memory */ }
}
export function loadRuns(dir) {
  let rows = [];
  try {
    rows = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } })
      .filter((r) => r && r.result && typeof r.result.run_id === "string");
  } catch { return 0; }
  rows.sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""));
  for (const r of rows.slice(-RUN_CAP)) { if (runs.has(r.result.run_id)) continue; runs.set(r.result.run_id, r.result); if (r.at) runAt.set(r.result.run_id, r.at); }
  return runs.size;
}
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

// the queue file path for a ticket id: sanitised like hmem's queueForHuman, never read from stored data
const queueFileOf = (memoryDir, tid) => join(memoryDir, "queue", `${String(tid).replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
function readQueue(memoryDir, tid) {
  try { return JSON.parse(readFileSync(queueFileOf(memoryDir, tid), "utf8")); } catch { return null; }
}
// einh's ruling (24 Oct 2026): a send settles the ticket on a hold, or on an escalation that carries an approval; any other escalation stays open
const sendStatus = (output) => (output?.decision === "hold" || (output?.decision === "escalate" && output?.queued_for?.approval) ? "handled" : "follow_up");

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
      const hit = [...runs.values()].find((r) => (r.input?.thread_id ?? null) === row.ticket_id || r.output?.queued_for?.queue_file?.endsWith(`/${f}`));
      const qf = hit?.output?.queued_for;
      if (t.approval) row.approver = personOf(t.approval.approver_id, t.approval.approver_name);
      else row.owner = personOf(own?.owner_id ?? qf?.owner_id ?? t.owner_id, own?.owner_name ?? qf?.owner_name ?? t.owner_name);
      // who holds it now: the backup when the owner is out (owner above stays the policy owner)
      if (qf) { const h = recipientOf(qf); row.holder = personOf(h.id, h.name); } else row.holder = row.approver ?? row.owner ?? null;
      if (hit) row.run_id = hit.run_id;
      row.status = t.status ?? q.sent?.status ?? null;
      row.sent_at = q.sent?.at ?? null;
      row.has_draft = Boolean(t.draft?.text);
      row.critiques = Array.isArray(q.critiques) ? q.critiques : (q.critiques ? [q.critiques] : []);
      row.mtime = mtime;
      out.push(row);
    } catch { /* an unreadable queue file is skipped */ }
  }
  for (const [id, r] of runs) {
    if (r.output?.decision !== "hold") continue;
    // a hold already sent shows once, from its queue file (HANDLED), not again as waiting
    if (r.input?.thread_id && readQueue(memoryDir, r.input.thread_id)?.sent) continue;
    const hasDraft = Boolean(r.output?.draft?.text ?? r.output?.draft);
    const qf = r.output.queued_for;
    // a hold with no draft (the customer-service withheld draft) is still waiting on a human when it carries a recommendation
    if (!hasDraft && !(qf?.recommendation ?? r.output.recommendation)) continue;
    out.push({ run_id: id, ticket_id: r.input?.thread_id ?? null, kind: "held", scenario: r.scenario ?? null,
      owner: personOf(qf?.owner_id, qf?.owner_name), holder: (() => { const h = recipientOf(qf); return personOf(h.id, h.name); })(), has_draft: hasDraft,
      recommendation: qf?.recommendation ?? r.output.recommendation ?? null, status: null, at: atOf(id) });
  }
  const when = (x) => Date.parse(x.mtime ?? x.at ?? "") || 0;
  return out.sort((a, b) => when(b) - when(a));
}

// a run id whose trace file is on disk was used, even after the capped runs map has evicted it
function traceExists(logsDir, id) {
  try { statSync(join(logsDir, `trace-${id}.jsonl`)); return true; } catch { return false; }
}

// Static pages: a CLOSED list. The request only picks an entry; the file path is built from the entry, never from request input.
const STATIC_TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
export const STATIC_NAMES = ["app.js", "dashboard.js", "style.css", "demo-scenarios.json"];
const PAGES = { "/": "index.html", "/inbox": "inbox.html", "/dashboard": "dashboard.html" };
// The storefront folder: a directory route with a CLOSED extension list. Every segment is vetted and the resolved path must stay inside public/shop.
const SHOP_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".mp4": "video/mp4", ".ico": "image/x-icon" };
function shopFile(path) {
  let raw;
  try { raw = decodeURIComponent(path.slice("/shop/".length)); } catch { return null; }
  if (raw.includes("\\") || raw.includes("%") || raw.includes("\0")) return null;
  const segs = raw.split("/");
  if (segs.some((x) => x === "" || x === "." || x === ".." || x.startsWith("."))) return null;
  const root = resolve(INBOX_ROOT, "public", "shop");
  const full = resolve(root, ...segs);
  if (!full.startsWith(root + sep)) return null;
  const type = Object.hasOwn(SHOP_TYPES, extname(full).toLowerCase()) ? SHOP_TYPES[extname(full).toLowerCase()] : null;
  return type ? { file: full, type } : null;
}
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

// CodexBWAI: match the hosted cache policy without changing either route guard.
const STATIC_CACHE = Object.fromEntries([
  ...[".glb", ".png", ".jpg", ".jpeg", ".webp", ".woff2", ".mp4"].map((ext) => [ext, "public, max-age=86400"]),
  ...[".js", ".css", ".json", ".svg"].map((ext) => [ext, "public, max-age=300"]),
]);
const VENDOR_ROOT = resolve(INBOX_ROOT, "public", "shop", "shared", "vendor") + sep;
const compressible = (type) => /^(?:text\/|application\/(?:javascript|json)(?:;|$)|image\/svg\+xml(?:;|$)|model\/gltf-binary(?:;|$))/.test(type);
const acceptsGzip = (header) => String(header ?? "").split(",").some((entry) => {
  const [coding, ...params] = entry.trim().toLowerCase().split(";");
  if (coding.trim() !== "gzip") return false;
  const q = params.find((p) => p.trim().startsWith("q="));
  return q === undefined || Number(q.trim().slice(2)) > 0;
});

export const LIVE_RUN_CAP = 2;
function corsHeaders(cfg) {
  const origin = cfg.CORS_ORIGIN;
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (!origin || origin === "*") headers["Access-Control-Allow-Origin"] = "*";
  else if (/^https?:\/\/[^\s,/]+$/.test(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  } else console.error("CORS_ORIGIN is not one origin; sending no Access-Control-Allow-Origin");
  return headers;
}
const requireJson = (req) => {
  if (!/^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] ?? "").trim()))
    throw new HttpError(415, "UnsupportedMediaType", "unsupported media type: application/json required");
};

// thread_id -> category, from the committed threads file
function threadIndex() {
  try {
    return new Map(readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => { const t = JSON.parse(l); return [t.thread_id, t.category ?? ""]; }));
  } catch { return new Map(); }
}
const threadIds = () => new Set(threadIndex().keys());

// the 14 demo scenarios: a committed JSON file, read per request (the file is small and a republish needs no restart)
const demoScenarios = () => JSON.parse(readFileSync(join(INBOX_ROOT, "public", "demo-scenarios.json"), "utf8"));
// the seeded client of s04 (customers.csv, seeded_prior_refund=true): the authored T02/T06 refunds are its prior refunds
function seededClient() {
  const row = readCsv(join(INBOX_ROOT, "data", "synthetic", "customers.csv")).find((r) => String(r.seeded_prior_refund) === "true");
  if (!row) throw new HttpError(500, "InternalError", "no seeded client in customers.csv");
  return { customer_id: row.customer_id, name: row.name, email: row.email, generated: false, seeded_prior_refund: true };
}

// the seeded client of s10: the customer on order JP-1001 (orders.csv customer_id -> customers.csv), the only sender the delivery road answers for that order
function orderOwnerClient(order_id = "JP-1001") {
  const order = readCsv(join(INBOX_ROOT, "data", "synthetic", "orders.csv")).find((r) => r.order_id === order_id);
  const row = order && readCsv(join(INBOX_ROOT, "data", "synthetic", "customers.csv")).find((r) => r.customer_id === order.customer_id);
  if (!row) throw new HttpError(500, "InternalError", `no customer on order ${order_id} in the records`);
  return { customer_id: row.customer_id, name: row.name, email: row.email, generated: false, order_owner: true, order_id };
}

const newRunId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const errBody = (run_id, type, message, recoverable, t0, trace_id = null) => ({
  run_id, status: "error", error: { type, message, recoverable }, trace_id,
  execution_time_seconds: Math.round(((Date.now() - t0) / 1000) * 1000) / 1000,
});

class HttpError extends Error {
  constructor(status, type, message, recoverable = false) { super(message); this.status = status; this.type = type; this.recoverable = recoverable; }
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
  if (typeof input.name === "string" && input.name !== "" &&
      (!/^[\p{L}\p{M}' ’-]+$/u.test(input.name) || !/\p{L}/u.test(input.name.trim())))
    bad("name: only letters, space, - and ' allowed");
  if (input.as_of !== undefined && (typeof input.as_of !== "string" || !ASOF.test(input.as_of))) bad("as_of must be YYYY-MM-DD");
  return { message, from: input.from.trim(), channel: input.channel, ...(input.scenario ? { scenario: input.scenario } : {}),
    ...(input.name ? { name: input.name } : {}), ...(input.subject ? { subject: input.subject } : {}), ...(input.as_of ? { as_of: input.as_of } : {}) };
}

export function createServer({ cfg = config(), deps = {} } = {}) {
  const board = deps.progressBoard ?? createProgressBoard();
  const health = createProviderHealth({ cfg, sample: sampleMode(cfg), statusFn: deps.nightshiftStatus, ...(deps.healthFirstWaitMs ? { firstWaitMs: deps.healthFirstWaitMs } : {}) });
  const CORS = corsHeaders(cfg);
  // einh's ruling (25 Oct 2026): /run and /ask share 2 live slots, held until completion even after disconnect (the page polls after a 524).
  let liveNow = 0;
  const takeLive = () => {
    if (liveNow >= LIVE_RUN_CAP) throw new HttpError(503, "Busy", `busy: ${LIVE_RUN_CAP} live runs in flight (cap ${LIVE_RUN_CAP}); retry later`, true);
    liveNow += 1;
    return () => { liveNow -= 1; };
  };
  const started = Date.now();
  const sec = secrets();
  const dir = deps.dir ?? decisions.RUNTIME_DIR;
  const memoryDir = deps.memoryDir ?? join(INBOX_ROOT, "data", "memory");
  const logsDir = deps.logsDir ?? join(INBOX_ROOT, "logs");
  const runtimeDir = deps.runtimeDir ?? dir; // intake.csv lives beside decisions.csv (data/runtime by default)
  const runsDir = join(runtimeDir, "runs");
  if (deps.persistRuns !== false) loadRuns(runsDir);
  // publishes are serialised; /run fires one and moves on, /feedback and /counters wait for the queue
  let pending = Promise.resolve();
  const queue = () => {
    pending = pending.then(() => (deps.publish ?? decisions.publish)({ dir, cfg })).catch((e) => ({ published: false, error: `${e?.name ?? "Error"}: ${String(e?.message ?? e).slice(0, 200)}` }));
    return pending;
  };
  const publishLater = () => { queue(); };
  const publishNow = () => queue();
  const settled = () => pending;
  // Opt-in token for a shared instance (API_TOKEN set): the POST routes need "Authorization: Bearer <token>".
  // Reads, the pages and /health stay open; unset means the loopback default, no token anywhere.
  const requireBearer = (req) => {
    if (!cfg.API_TOKEN) return;
    const got = Buffer.from(String(req.headers.authorization ?? "")), want = Buffer.from(`Bearer ${cfg.API_TOKEN}`);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "Unauthorized", "this instance needs Authorization: Bearer <API_TOKEN> on POST /run, /ask, /feedback and /runs/{id}/send");
  };
  // queue-file writes have a chain of their own: decisions.serial also carries the Zetaris publishes, and a send must not wait behind an upload
  let queueChain = Promise.resolve();
  const handleSend = (m, req, send, t0) => {
    const job = queueChain.then(() => doSend(m, req, send, t0));
    queueChain = job.catch(() => {});
    return job;
  };
  async function doSend(m, req, send, t0) {
    let id;
    try { id = decodeURIComponent(m[1]); } catch { id = ""; }
    let body;
    try { body = JSON.parse(await readBody(req) || "{}"); }
    catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "BadRequest", "body is not valid JSON");
    }
    if (body === null) body = {};
    if (typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "BadRequest", "body must be a JSON object");
    const stored = runs.get(id);
    if (!stored) throw new HttpError(404, "NotFound", `no stored run ${id}`);
    if (body.by !== undefined && (typeof body.by !== "string" || body.by.length > 120)) throw new HttpError(400, "BadRequest", "by must be a string of at most 120 characters");
    if (body.text !== undefined && (typeof body.text !== "string" || body.text.trim().length < 1 || body.text.length > 4000)) throw new HttpError(400, "BadRequest", "text must be 1 to 4000 characters");
    const out = stored.output;
    if (stored.status !== "success" || (out?.decision !== "hold" && out?.decision !== "escalate")) {
      throw new HttpError(400, "BadRequest", `only a held or escalated ticket can be sent; this run decided ${out?.decision ?? "nothing"}`);
    }
    const draftText = typeof out.draft?.text === "string" ? out.draft.text : (typeof out.draft === "string" ? out.draft : "");
    const reply = body.text?.trim() || draftText;
    if (!reply) throw new HttpError(400, "BadRequest", "no draft to send; supply text");
    const rawTid = stored.input?.thread_id;
    if (rawTid === undefined || rawTid === null || rawTid === "") throw new HttpError(400, "BadRequest", "this run has no ticket id");
    const ticket_id = String(rawTid).replace(/[^A-Za-z0-9._-]/g, "_");
    const file = queueFileOf(memoryDir, rawTid);
    let q = null;
    try { q = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) { if (e?.code !== "ENOENT") throw new HttpError(500, "InternalError", `queue file for ${ticket_id} is not readable`); }
    if (q?.sent) throw new HttpError(409, "Conflict", `ticket ${ticket_id} was already sent at ${q.sent.at}`);
    const qf = out.queued_for ?? {};
    const status = sendStatus(out);
    const by = body.by?.trim() || qf.approval?.approver_name || qf.owner_name || "a person";
    const at = new Date().toISOString();
    if (!q) {
      const inp = stored.input ?? {};
      q = {
        ticket: { thread_id: rawTid, id: rawTid, channel: inp.channel ?? null, sender_name: inp.name ?? "", sender_email: inp.from ?? "", subject: inp.subject ?? String(inp.text ?? "").slice(0, 60),
          body: inp.text ?? "", scenario: stored.scenario ?? null, category: stored.scenario ?? null, decision_reason: out.decision_reason ?? out.reason ?? null, ...(out.draft ? { draft: typeof out.draft === "object" ? out.draft : { text: out.draft } } : {}) },
        critiques: [], queuedAt: Date.now(),
        ...(qf.owner_id != null || qf.owner_name ? { owner: { owner_id: qf.owner_id ?? null, owner_name: qf.owner_name ?? null, backup_id: qf.backup_id ?? null, backup_name: qf.backup_name ?? null } } : {}),
        scenario: stored.scenario ?? null,
      };
    }
    q.ticket = { ...(q.ticket ?? {}), status };
    q.sent = { run_id: id, by, at, body: reply, status, ticket_id };
    mkdirSync(join(memoryDir, "queue"), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(q, null, 2) + "\n");
    renameSync(tmp, file);
    send(200, { run_id: id, ticket_id, status, sent: q.sent, queue_file: relative(INBOX_ROOT, file) });
  }
  const inflight = new Set(); // run ids being run now: a concurrent reuse is a 409 too
  const compressed = new Map(); // one version per file, FIFO capped at 64 buffers
  const server = httpServer(async (req, res) => {
    const send = (status, body) => {
      if (res.headersSent) return;
      const text = JSON.stringify(mask(body, sec));
      res.writeHead(status, { ...CORS, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" });
      res.end(text);
    };
    const sendText = (status, type, text) => {
      if (res.headersSent) return;
      res.writeHead(status, { ...CORS, "Content-Type": type, "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    };
    const sendStatic = (f) => {
      if (!f) return false;
      let st;
      try { st = statSync(f.file); } catch { return false; }
      if (!st.isFile()) return false;
      const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
      const zip = compressible(f.type);
      const headers = { ...CORS, "Content-Type": f.type, ETag: etag,
        "Cache-Control": f.file.startsWith(VENDOR_ROOT) ? "public, max-age=86400" : (STATIC_CACHE[extname(f.file).toLowerCase()] ?? "no-cache"),
        ...(zip ? { Vary: [CORS.Vary, "Accept-Encoding"].filter(Boolean).join(", ") } : {}),
      };
      const matches = String(req.headers["if-none-match"] ?? "").split(",")
        .some((tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag.slice(2));
      if (matches) { res.writeHead(304, headers); res.end(); return true; }
      let buf;
      if (zip && acceptsGzip(req.headers["accept-encoding"])) {
        const cached = compressed.get(f.file);
        if (cached?.etag === etag) buf = cached.body;
        else {
          try { buf = gzipSync(readFileSync(f.file)); } catch { return false; }
          compressed.delete(f.file);
          if (compressed.size >= 64) compressed.delete(compressed.keys().next().value);
          compressed.set(f.file, { etag, body: buf });
        }
        headers["Content-Encoding"] = "gzip";
      } else {
        try { buf = readFileSync(f.file); } catch { return false; }
      }
      res.writeHead(200, { ...headers, "Content-Length": buf.length });
      res.end(buf);
      return true;
    };
    const t0 = Date.now();
    let run_id = null;
    let claimed = false;
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
      if (req.method === "GET" && path === "/health") {
        send(200, { ok: true, sample_mode: sampleMode(cfg), version: VERSION, uptime_s: Math.round((Date.now() - started) / 1000), primary: await health.snapshot() });
        return;
      }
      if (path === "/shop" || path === "/shop/") {
        if (req.method !== "GET") { send(405, errBody(null, "BadRequest", `use GET ${path}`, false, t0)); return; }
        res.writeHead(302, { ...CORS, Location: "/shop/index.html", "Content-Length": 0, "Cache-Control": "no-store" });
        res.end();
        return;
      }
      if (path.startsWith("/shop/")) {
        if (req.method !== "GET") { send(405, errBody(null, "BadRequest", `use GET ${path}`, false, t0)); return; }
        if (!sendStatic(shopFile(path))) send(404, errBody(null, "NotFound", `no route GET ${path}`, false, t0));
        return;
      }
      if (path === "/" || path === "/inbox" || path === "/dashboard" || path.startsWith("/static/")) {
        if (req.method !== "GET") { send(405, errBody(null, "BadRequest", `use GET ${path}`, false, t0)); return; }
        if (!sendStatic(staticFile(path))) send(404, errBody(null, "NotFound", `no route GET ${path}`, false, t0));
        return;
      }
      if (path === "/faq" || path === "/demo/scenarios" || path === "/demo/client") {
        if (req.method !== "GET") { send(405, errBody(null, "BadRequest", `use GET ${path}`, false, t0)); return; }
        if (path === "/faq") {
          // the faq template through the same reader the loop uses (sample cache in sample mode, Zetaris live); `source` stays internal
          const rows = deps.faq ? await deps.faq({ cfg }) : (await queries.run("faq", {}, { cfg, limit: 500 })).objects;
          send(200, rows.map(({ faq_id, question, answer, keywords }) => ({ faq_id, question, answer, keywords })));
          return;
        }
        if (path === "/demo/scenarios") { send(200, demoScenarios()); return; }
        const sc = new URL(req.url, "http://localhost").searchParams.get("scenario");
        if (sc !== null && !demoScenarios().some((d) => d.id === sc)) throw new HttpError(400, "BadRequest", "scenario must be one of s01..s14 or absent");
        const client = sc === "s04" ? seededClient() : sc === "s10" ? orderOwnerClient() : generateClient();
        if (res.headersSent) return;
        const text = JSON.stringify(mask(client, sec));
        res.writeHead(200, { ...CORS, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" });
        res.end(text);
        return;
      }
      const GET_ONLY = ["/sources", "/intake", "/counters", "/openapi.yaml"];
      const runsM = /^\/runs\/([^/]+)(\/trace|\/journey|\/progress)?$/.exec(path);
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
        if (runsM[2] === "/progress") {
          const live = board.get(id);
          if (live) { send(200, live); return; }
          if (id.startsWith("ask_") || (stored && !stored.output)) { send(404, errBody(id, "NotFound", "progress exists for /run runs only", false, t0)); return; }
          if (!stored) { send(404, errBody(id, "NotFound", `no stored run ${id}`, false, t0)); return; }
          let lines = [];
          try { lines = readFileSync(join(logsDir, basename(String(stored.log_file ?? `trace-${id}.jsonl`))), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* a stored run remains readable without its trace */ }
          send(200, progressFromStored(stored, lines)); return;
        }
        if (!stored) { send(404, errBody(id, "NotFound", `no stored run ${id}`, false, t0)); return; }
        if (!runsM[2]) { send(200, stored.decision_early ? { ...stored, decision_early: { seen_s: null, ...stored.decision_early } } : stored); return; }
        const tracePath = join(logsDir, basename(String(stored.log_file ?? `trace-${id}.jsonl`)));
        let text;
        try { text = readFileSync(tracePath, "utf8"); } catch { send(404, errBody(id, "NotFound", `trace file for ${id} is gone`, false, t0)); return; }
        const traceLines = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
        if (runsM[2] === "/journey") {
          const tid = stored.input?.thread_id;
          const q = tid ? readQueue(memoryDir, tid) : null;
          send(200, deriveJourney(stored, traceLines, { sent: q?.sent ? { ...q.sent, queue_file: relative(INBOX_ROOT, queueFileOf(memoryDir, tid)) } : null }));
        } else send(200, traceLines);
        return;
      }
      const sendM = /^\/runs\/([^/]+)\/send$/.exec(path);
      if (sendM) {
        if (req.method !== "POST") { send(405, errBody(null, "BadRequest", `use POST ${path}`, false, t0)); return; }
        requireBearer(req);
        requireJson(req);
        await handleSend(sendM, req, send, t0);
        return;
      }
      if (!["/run", "/ask", "/feedback"].includes(path)) { send(404, errBody(null, "NotFound", `no route ${req.method} ${path}`, false, t0)); return; }
      if (req.method !== "POST") { send(405, errBody(null, "BadRequest", `use POST ${path}`, false, t0)); return; }
      requireBearer(req);
      requireJson(req);

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
        const release = !sampleMode(cfg) ? takeLive() : null;
        let r;
        try { r = await (deps.ask ?? askQuestion)(body.question, { customer: body.customer || null, run_id: askId, cfg, deps }); }
        finally { release?.(); }
        const out = { run_id: askId, ...r };
        remember(askId, out); if (deps.persistRuns !== false) persistRun(runsDir, askId);
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
      if (isMsg && readIntake({ runtimeDir }).length >= INTAKE_CAP)
        throw new HttpError(503, "IntakeFull", `intake full: ${INTAKE_CAP} rows (cap); message runs refused`);
      if (runs.has(run_id) || inflight.has(run_id) || traceExists(logsDir, run_id)) throw new HttpError(409, "Conflict", `run_id ${run_id} was already used`);
      inflight.add(run_id);
      claimed = true;

      // options.sample_mode:true forces sample mode; false never turns a sample-mode server live.
      const runCfg = opts.sample_mode === true ? { ...cfg, SAMPLE_MODE: "true" } : cfg;
      const release = !sampleMode(runCfg) ? takeLive() : null;
      board.start(run_id, { mode: sampleMode(runCfg) ? "sample" : "live", fallbackRoute: runCfg.NIGHTSHIFT_ROUTE_FALLBACK ?? null, primaryEngine: nightshiftEngine(runCfg) });
      const onLine = (l, meta) => { board.line(run_id, l); deps.onLine?.(l, meta); };
      const onProgress = (e) => {
        const a = e.kind === "work" ? board.work(run_id, e) : (e.kind === "decided" ? board.decided(run_id, e.early) : undefined);
        let b; try { b = deps.onProgress?.(e); } catch { b = undefined; }
        return e.kind === "work" ? (x) => { try { a?.(x); } finally { try { if (typeof b === "function") b(x); } catch { /* ignore listener errors */ } } } : undefined;
      };
      const runDeps = { ...deps, onLine, onProgress };
      const run = deps.runTicket ?? runTicket;
      let result;
      // the loop reads the sample ledger and runtime rows from the folders /feedback and /run write to
      try { result = isMsg
        ? await run(null, { run_id, as_of: msgInput.as_of, cfg: runCfg, deps: { ...runDeps, decisionsDir: deps.decisionsDir ?? dir, runtimeDir }, input: msgInput })
        : await run(input.thread_id, { run_id, as_of: input.as_of, cfg: runCfg, deps: { ...runDeps, decisionsDir: deps.decisionsDir ?? dir, runtimeDir } });
      } finally { release?.(); }
      // the server keeps its own absolute queue path; the public result names the file inside the memory dir only
      const publicOutput = result.output?.queued_for?.queue_file
        ? { ...result.output, queued_for: { ...result.output.queued_for, queue_file: publicQueueFile(result.output.queued_for.queue_file) } }
        : result.output;
      const out = {
        ...(Number.isFinite(result.wall_ms) ? { wall_ms: result.wall_ms } : {}),
        provider: result.provider,
        ...(result.decision_early ? { decision_early: result.decision_early } : {}),
        run_id: result.run_id, status: result.status, output: publicOutput, agents: result.agents,
        trace_id: result.trace_id, log_file: result.log_file, execution_time_seconds: result.execution_time_seconds,
        ...(result.scenario !== undefined ? { scenario: result.scenario, resolved_how: result.resolved_how, branch_id: result.branch_id } : {}),
        ...(result.input ? { input: result.input } : {}),
        ...(result.memory ? { memory: result.memory } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
      remember(run_id, out); if (deps.persistRuns !== false) persistRun(runsDir, run_id);
      board.finish(run_id, out);
      if (!sampleMode(runCfg)) health.note(out.provider);
      // a sample-forced run on a LIVE server is not counted: it writes no row and triggers no publish
      const forcedSampleOnLive = sampleMode(runCfg) && !sampleMode(cfg);
      if (out.status === "success" && out.output?.decision && !forcedSampleOnLive && (!isMsg || out.input?.thread_id)) {
        await decisions.appendDecision({ run_id, thread_id: isMsg ? (result.input?.thread_id ?? "") : input.thread_id, category: isMsg ? (result.scenario ?? "") : (threadIndex().get(input.thread_id) ?? ""), decision: out.output.decision }, { dir });
        publishLater();
      }
      inflight.delete(run_id);
      send(200, out);
    } catch (e) {
      if (claimed) { inflight.delete(run_id); board.finish(run_id, { status: "error", output: null }); }
      if (e?.name === "IntakeFull") { send(503, errBody(run_id, "IntakeFull", `intake full: ${INTAKE_CAP} rows (cap); message runs refused`, false, t0)); return; }
      if (e instanceof HttpError) { send(e.status, errBody(run_id, e.type, e.message, e.recoverable === true, t0)); return; }
      send(500, errBody(run_id, "InternalError", "unexpected server error", true, t0));
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = 60000;
  server.timeout = REQUEST_TIMEOUT_MS;
  return server;
}

// With JEDI_IN_CONTAINER=1 (the Dockerfile sets it; setting it by hand has the same effect) a loopback HOST would make
// `docker run -p` dead-end, so the server binds 0.0.0.0 and says so. Without the marker HOST is honoured as given.
// Loopback: localhost, any 127.x.x.x, ::1 in any spelling (also bracketed, also the IPv4-mapped ::ffff:127.x.x.x).
export function isLoopback(host) {
  let h = String(host ?? "").trim().toLowerCase();
  if (h.length > 64) return false;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h === "localhost") return true;
  const v4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return v4.slice(1).every((o) => Number(o) <= 255);
  if (h.split("::").length > 2) return false; // at most one "::", in any form
  if (h.startsWith("::ffff:")) return isLoopback(h.slice(7)); // IPv4-mapped: judge the IPv4 part
  if (!h.includes(":") || /[^0-9a-f:]/.test(h)) return false;
  const parts = h.split("::"); // expanded to the full eight groups
  const head = parts[0] ? parts[0].split(":") : [], tail = parts[1] ? parts[1].split(":") : [];
  if (![...head, ...tail].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return false;
  const groups = parts.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  return groups.length === 8 && groups.slice(0, 7).every((g) => /^0{1,4}$/.test(g)) && /^0{0,3}1$/.test(groups[7]);
}
export function listenHost(cfg, env = globalThis.process?.env ?? {}) {
  const host = String(cfg.HOST ?? "127.0.0.1");
  if (env.JEDI_IN_CONTAINER === "1" && isLoopback(host)) return { host: "0.0.0.0", overrode: host };
  return { host, overrode: null };
}

export function main({ cfg = config(), log = console.log } = {}) {
  const port = Number(cfg.PORT);
  const { host, overrode } = listenHost(cfg);
  const server = createServer({ cfg });
  server.listen(port, host, () => log(`jedi-pack-inbox listening on http://${host}:${port} (sample_mode ${sampleMode(cfg)})${overrode ? ` (HOST=${overrode} ignored: JEDI_IN_CONTAINER=1)` : ""}`));
  return server;
}

if (isMain(import.meta.url)) main();

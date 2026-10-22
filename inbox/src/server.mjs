// Jedi Pack inbox HTTP server: GET /health, POST /run. JSON only, zero deps (node:http).
import { createServer as httpServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, secrets, sampleMode, INBOX_ROOT } from "./config.mjs";
import { mask } from "./trace.mjs";
import { runTicket } from "./loop.mjs";

export const VERSION = "0.1.0";
export const BODY_LIMIT = 256 * 1024;
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
export const RUN_CAP = 200;
// run_id -> result, for CP4's GET /runs/:id. Insertion order; oldest dropped past the cap.
export const runs = new Map();
function remember(run_id, result) {
  runs.delete(run_id);
  runs.set(run_id, result);
  while (runs.size > RUN_CAP) runs.delete(runs.keys().next().value);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function threadIds() {
  try {
    return new Set(readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l).thread_id));
  } catch { return new Set(); }
}

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

export function createServer({ cfg = config(), deps = {} } = {}) {
  const started = Date.now();
  const sec = secrets();
  const server = httpServer(async (req, res) => {
    const send = (status, body) => {
      if (res.headersSent) return;
      const text = JSON.stringify(mask(body, sec));
      res.writeHead(status, { ...CORS, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    };
    const t0 = Date.now();
    let run_id = null;
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
      if (req.method === "GET" && path === "/health") {
        send(200, { ok: true, sample_mode: sampleMode(cfg), version: VERSION, uptime_s: Math.round((Date.now() - started) / 1000) });
        return;
      }
      if (path !== "/run") { send(404, errBody(null, "NotFound", `no route ${req.method} ${path}`, false, t0)); return; }
      if (req.method !== "POST") { send(405, errBody(null, "BadRequest", "use POST /run", false, t0)); return; }

      let body;
      try { body = JSON.parse(await readBody(req) || "null"); }
      catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "BadRequest", "body is not valid JSON");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "BadRequest", "body must be a JSON object");
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

      if (input.thread_id === undefined) {
        if (typeof input.message === "string" && typeof input.from === "string" && typeof input.channel === "string") {
          send(200, errBody(run_id, "NotImplemented", "free-text intake lands in CP4's /intake; use {thread_id} for now", false, t0));
          return;
        }
        throw new HttpError(400, "BadRequest", "input needs thread_id, or message + from + channel");
      }
      if (typeof input.thread_id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(input.thread_id)) throw new HttpError(400, "BadRequest", "thread_id must be a short id string");
      if (input.as_of !== undefined && (typeof input.as_of !== "string" || !ASOF.test(input.as_of))) throw new HttpError(400, "BadRequest", "as_of must be YYYY-MM-DD");
      if (!threadIds().has(input.thread_id)) {
        send(404, errBody(run_id, "NotFound", `unknown thread ${input.thread_id}`, false, t0));
        return;
      }

      // options.sample_mode:true forces sample mode; false never turns a sample-mode server live.
      const runCfg = opts.sample_mode === true ? { ...cfg, SAMPLE_MODE: "true" } : cfg;
      const result = await runTicket(input.thread_id, { run_id, as_of: input.as_of, cfg: runCfg, deps });
      const out = {
        run_id: result.run_id, status: result.status, output: result.output, agents: result.agents,
        trace_id: result.trace_id, log_file: result.log_file, execution_time_seconds: result.execution_time_seconds,
        ...(result.error ? { error: result.error } : {}),
      };
      remember(run_id, out);
      send(200, out);
    } catch (e) {
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

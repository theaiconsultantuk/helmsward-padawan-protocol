// Jedi Pack inbox trace writer: one JSON line per event in logs/trace-<run_id>.jsonl, mirrored to stdout.
// Every string value is masked before it is written, so a line never carries a key or token.
import { appendFileSync, mkdirSync } from "node:fs";
import { INBOX_ROOT, secrets as secretsFromConfig } from "./config.mjs";

export const STEPS = [
  "memory.read", "planner.plan", "delegate", "executor.act", "zetaris.query",
  "meterless.engine", "nvidia.model", "branch", "critique", "risk.signoff",
  "retry", "escalate_or_fallback", "memory.write", "synthesis", "recovery",
];
export const STATUSES = [
  "success", "needs_revision", "retrying", "error", "incomplete", "skipped", "refused",
];
const SPONSORS = ["zetaris", "meterless", "nvidia"];
const REQUIRED = ["step", "agent_name", "action", "input_summary", "output_summary", "status"];
const OPTIONAL = ["target_agent", "model", "confidence", "retry_count", "branch_id", "memory_ids", "sponsor", "gate_source", "detail", "source"];
// Build G, CodexBWAI: per-buffer-push identity, copied by spreads but never JSON.
export const BUFFER_LINE = Symbol("buffer line");

const MASK = "[masked]";

// Masking rule, applied in this order to every string:
//  1. any configured secret value -> [masked]
//  2. "Bearer <token>" -> "Bearer [masked]"
//  3. "sk-" followed by 8+ token chars -> [masked]
//  4. any run of 40+ chars from [A-Za-z0-9+/=_-] -> [masked], EXCEPT a run that is
//     path-shaped (contains "/", or is directly followed by ".<alnum>" i.e. a file
//     extension, so "." is honoured although it is outside the run alphabet) or is a
//     contract signature (purely lowercase hex, exactly 64 chars). So
//     "inbox/judging/traces/trace-demo-recovery-first-run-0001.jsonl" and a 64-hex
//     signature survive, while a bare 48-char runtime token is masked.
export function mask(value, secrets = []) {
  if (Array.isArray(value)) return value.map((v) => mask(v, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v, secrets)]));
  }
  if (typeof value !== "string") return value;
  let s = value;
  for (const sec of secrets) {
    if (typeof sec === "string" && sec.length > 0) s = s.split(sec).join(MASK);
  }
  s = s.replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [masked]");
  s = s.replace(/sk-[A-Za-z0-9_-]{8,}/g, MASK);
  s = s.replace(/[A-Za-z0-9+/=_-]{40,}/g, (run, offset, whole) => {
    if (run.includes("/")) return run;
    if (/^[0-9a-f]{64}$/.test(run)) return run;
    if (/^\.[A-Za-z0-9]/.test(whole.slice(offset + run.length))) return run;
    return MASK;
  });
  return s;
}

export class Trace {
  static open(run_id, opts = {}) {
    return new Trace(run_id, opts);
  }

  constructor(run_id, { logsDir = `${INBOX_ROOT}/logs`, secrets = secretsFromConfig(), stdout = true, trace_id = run_id, onLine = null } = {}) {
    if (!run_id || typeof run_id !== "string") throw new Error("Trace.open: run_id is required");
    this.run_id = run_id;
    this.trace_id = trace_id;
    this.logsDir = logsDir;
    this.secrets = secrets;
    this.stdout = stdout;
    this.path = `${logsDir}/trace-${run_id}.jsonl`;
    this._lines = [];
    this._start = Date.now(); // the run's stable start: elapsed_ms counts from here, whatever order buffered lines are flushed in
    this.onLine = onLine;
    this._spans = []; // disjoint measured work already attributed to a node (CodexBWAI, Build F)
  }

  get lines() {
    return [...this._lines];
  }

  // A safe early copy without writing or claiming any measured work spans.
  preview(fields = {}) {
    for (const k of REQUIRED) {
      if (fields[k] === undefined || fields[k] === null || fields[k] === "") {
        throw new Error(`trace line: missing required field "${k}"`);
      }
    }
    if (!STEPS.includes(fields.step)) throw new Error(`trace line: unknown step "${fields.step}"`);
    if (!STATUSES.includes(fields.status)) throw new Error(`trace line: unknown status "${fields.status}"`);
    if (fields.sponsor !== undefined && !SPONSORS.includes(fields.sponsor)) {
      throw new Error(`trace line: unknown sponsor "${fields.sponsor}"`);
    }
    const now = Number.isFinite(fields.at) ? fields.at : Date.now();
    const elapsed_ms = Math.max(0, now - this._start);
    const raw = {
      timestamp: new Date(now).toISOString(),
      duration_ms: 0,
      elapsed_ms,
      ran_s: Math.round(elapsed_ms / 100) / 10,
      seen_s: fields[BUFFER_LINE]?.seen_s ?? Math.round((Date.now() - this._start) / 100) / 10,
      run_id: this.run_id,
      trace_id: this.trace_id,
    };
    for (const k of REQUIRED) raw[k] = fields[k];
    for (const k of OPTIONAL) if (fields[k] !== undefined) raw[k] = fields[k];
    const out = mask(raw, this.secrets);
    if (fields[BUFFER_LINE]) out[BUFFER_LINE] = fields[BUFFER_LINE];
    return out;
  }

  line(fields = {}) {
    const out = this.preview(fields);
    // `at` is completion, never flush time. Only explicit operation spans own time;
    // bookkeeping/paired lines own zero. Attribute overlapping work once, to the
    // first written measured node, so node totals never overclaim wall time.
    const now = Date.parse(out.timestamp);
    const start = Math.min(now, Math.max(this._start, Number.isFinite(fields.started_at) ? fields.started_at : now));
    let duration_ms = Math.max(0, now - start);
    for (const [a, b] of this._spans) duration_ms -= Math.max(0, Math.min(now, b) - Math.max(start, a));
    if (now > start) {
      const spans = [...this._spans, [start, now]].sort((a, b) => a[0] - b[0]);
      this._spans = [];
      for (const span of spans) {
        const last = this._spans.at(-1);
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
        else this._spans.push([...span]);
      }
    }
    out.duration_ms = duration_ms;
    // The board stamps arrival before the line is persisted, retaining restart parity.
    try { this.onLine?.(out, fields.flush ?? (Number.isFinite(fields.at) ? "buffered" : "direct")); } catch { /* observers cannot stop a run */ }
    mkdirSync(this.logsDir, { recursive: true });
    appendFileSync(this.path, JSON.stringify(out) + "\n");
    this._lines.push(out);
    if (this.stdout) console.log(`[INFO] run_id=${out.run_id} ${out.agent_name} ${out.action}: ${out.output_summary}`);
    return out;
  }

  close() {
    return { log_file: `logs/trace-${this.run_id}.jsonl`, lines: this._lines.length };
  }
}

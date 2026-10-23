// Runtime decisions table: data/runtime/decisions.csv (gitignored), streamed to Zetaris as JEDI_PACK.decisions.
// appendDecision after every /run, setVerdict on /feedback, publish() copies the file into the container and UNCACHEs the table.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, sampleMode, INBOX_ROOT } from "./config.mjs";
import * as zetaris from "./adapters/zetaris.mjs";

export const HEADER = ["run_id", "thread_id", "category", "decision", "verdict", "delta", "ts"];
export const VERDICTS = { affirm: 0.05, reject: -0.05 };
export const RUNTIME_DIR = join(INBOX_ROOT, "data", "runtime");
export const CONTAINER = "zetaris-driver-1";
export const REMOTE_DIR = "/home/zetaris/customer-data/shared/jedi-pack/runtime";
export const UNCACHE_SQL = "UNCACHE LIGHTNING FILESTORE TABLE decisions FROM JEDI_PACK";

const q = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const line = (r) => HEADER.map((h) => q(r[h])).join(",");

export function parseCsv(text) {
  const rows = []; let row = [], f = "", inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inq = false; } else f += c; }
    else if (c === '"') inq = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return (head ? body : []).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const file = (dir) => join(dir, "decisions.csv");
export function readDecisions({ dir = RUNTIME_DIR } = {}) {
  return existsSync(file(dir)) ? parseCsv(readFileSync(file(dir), "utf8")) : [];
}
function writeAll(rows, dir) {
  mkdirSync(dir, { recursive: true });
  const tmp = `${file(dir)}.${process.pid}.tmp`;
  writeFileSync(tmp, [HEADER.join(","), ...rows.map(line)].join("\n") + "\n");
  renameSync(tmp, file(dir)); // atomic replace
}

// writes are serialised in-process; one row per run_id (a re-run replaces its own row)
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

export function appendDecision({ run_id, thread_id, category, decision }, { dir = RUNTIME_DIR, now = () => new Date() } = {}) {
  return serial(async () => {
    const rows = readDecisions({ dir }).filter((r) => r.run_id !== run_id);
    const row = { run_id, thread_id: thread_id ?? "", category: category ?? "", decision: decision ?? "", verdict: "", delta: "", ts: now().toISOString() };
    rows.push(row);
    writeAll(rows, dir);
    return row;
  });
}

// returns the updated row, or null for an unknown run_id
export function setVerdict(run_id, verdict, note, { dir = RUNTIME_DIR } = {}) {
  return serial(async () => {
    if (!Object.hasOwn(VERDICTS, verdict)) throw new TypeError(`verdict must be affirm or reject`);
    const rows = readDecisions({ dir });
    const row = rows.find((r) => r.run_id === run_id);
    if (!row) return null;
    row.verdict = verdict; row.delta = String(VERDICTS[verdict]);
    writeAll(rows, dir);
    return { ...row, ...(note ? { note: String(note).slice(0, 500) } : {}) };
  });
}

// the same counts the Zetaris GROUP BY gives, from the local file (sample mode)
export function localCounters({ dir = RUNTIME_DIR } = {}) {
  const out = { send: 0, hold: 0, escalate: 0, close: 0, queued: 0, affirmed: 0, rejected: 0 };
  for (const r of readDecisions({ dir })) {
    if (r.decision in out) out[r.decision]++;
    if (r.decision === "escalate") out.queued++;
    if (r.verdict === "affirm") out.affirmed++;
    if (r.verdict === "reject") out.rejected++;
  }
  return out;
}

// per category: how many affirmed / rejected, the shape trustFloor's ledgerAdjust takes
export function ledgerAdjust(category, { dir = RUNTIME_DIR } = {}) {
  const rows = readDecisions({ dir }).filter((r) => r.category === category);
  return { affirmed: rows.filter((r) => r.verdict === "affirm").length, rejected: rows.filter((r) => r.verdict === "reject").length };
}

const sh = (cmd, args, { input, cwd } = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => { err += d; });
  p.on("error", reject);
  p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} exited ${code}: ${err.trim().slice(0, 300)}`))));
  if (input) input(p.stdin);
});

// Stream the CSV into the container as uid 1001 (the zetaris_drop.sh route), then UNCACHE the table.
export async function publish({ dir = RUNTIME_DIR, cfg = config(), runSql = zetaris.sqlRun } = {}) {
  if (sampleMode(cfg)) return { published: false, reason: "sample mode: nothing leaves this machine" };
  if (!existsSync(file(dir))) writeAll([], dir);
  await sh("docker", ["exec", "-u", "1001", CONTAINER, "mkdir", "-p", REMOTE_DIR]);
  const tar = spawn("tar", ["-C", dir, "-cf", "-", "decisions.csv"], { stdio: ["ignore", "pipe", "pipe"] });
  const tarDone = new Promise((res, rej) => { tar.on("error", rej); tar.on("close", (c) => (c === 0 ? res() : rej(new Error(`tar exited ${c}`)))); });
  await Promise.all([
    tarDone,
    sh("docker", ["exec", "-i", "-u", "1001", CONTAINER, "tar", "-xf", "-", "-C", REMOTE_DIR], { input: (stdin) => tar.stdout.pipe(stdin) }),
  ]);
  let uncached = true;
  try { await runSql(UNCACHE_SQL, { cfg, timeoutMs: 60000 }); }
  catch (e) {
    // first publish: the table is not registered yet, nothing to uncache
    if (/not found|does not exist|no such table|cannot find|BadResponse/i.test(`${e?.name} ${e?.message}`)) uncached = false;
    else throw e;
  }
  return { published: true, uncached };
}

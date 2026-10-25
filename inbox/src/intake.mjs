// Free-text intake table: data/runtime/intake.csv (gitignored), streamed to Zetaris as JEDI_PACK.intake_runtime.
// Same pattern as decisions.mjs: atomic CSV replace, serialised in-process, published on the one serial() chain.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { RUNTIME_DIR, parseCsv, publishFile, q, serial } from "./decisions.mjs";

export const INTAKE_HEADER = ["thread_id", "received_at", "channel", "sender_name", "sender_email", "subject", "body", "scenario", "category"];
export const INTAKE_CAP = 5000;
export const INTAKE_FILE = "intake.csv";
export const INTAKE_TABLE = "intake_runtime";

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const path = (dir) => join(dir, INTAKE_FILE);
const line = (r) => INTAKE_HEADER.map((h) => q(r[h])).join(",");

// The runtime intake refunds the SQL (prior_refunds, second branch) counts: same sender (case-insensitive), a DIFFERENT thread, received STRICTLY
// BEFORE this one, category or scenario refund. Rows come back as [thread_id, received_at, "intake_runtime"], oldest first. Pure over `rows`.
export function intakeRefundRows(rows, { email, thread_id, received_at } = {}) {
  const at = Date.parse(received_at);
  return (rows ?? [])
    .filter((r) => (r.category === "refund" || r.scenario === "refund") && String(r.sender_email ?? "").toLowerCase() === String(email ?? "").toLowerCase()
      && r.thread_id !== thread_id && Date.parse(r.received_at) < at)
    .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at) || (a.thread_id < b.thread_id ? -1 : a.thread_id > b.thread_id ? 1 : 0))
    .map((r) => [String(r.thread_id), String(r.received_at), INTAKE_TABLE]);
}

export function readIntake({ runtimeDir = RUNTIME_DIR } = {}) {
  return existsSync(path(runtimeDir)) ? parseCsv(readFileSync(path(runtimeDir), "utf8")) : [];
}

function writeAll(rows, dir) {
  mkdirSync(dir, { recursive: true });
  const tmp = `${path(dir)}.${process.pid}.tmp`;
  writeFileSync(tmp, [INTAKE_HEADER.join(","), ...rows.map(line)].join("\n") + "\n");
  renameSync(tmp, path(dir)); // atomic replace
}

// A free-text message has no subject: its label is the start of the message, cut at a word boundary with "…" when it cuts.
// A display label only; no reply ever quotes it (the draft quotes the customer's whole first sentence, or nothing).
export function subjectLabel(body, max = 60) {
  const t = String(body ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const sp = head.lastIndexOf(" ");
  const cut = sp >= Math.floor(max / 2) ? head.slice(0, sp) : head;
  return `${cut.replace(/[\s,;:.\-]+$/, "")}\u2026`;
}

const nextId = (rows) => `F${rows.reduce((m, r) => { const n = /^F(\d+)$/.exec(r.thread_id); return n ? Math.max(m, Number(n[1])) : m; }, 0) + 1}`;

export function appendIntake({ message, from, name, subject, channel, scenario, received_at } = {}, { runtimeDir = RUNTIME_DIR, now = () => new Date() } = {}) {
  return serial(async () => {
    const rows = readIntake({ runtimeDir });
    // einh's pick (25 Oct 2026): the whole file is rewritten per run, so message runs stop at 5,000 rows (Dean X15).
    if (rows.length >= INTAKE_CAP) throw Object.assign(new Error(`intake full: ${INTAKE_CAP} rows (cap); message runs refused`), { name: "IntakeFull" });
    const f = String(from ?? "").trim();
    const isEmail = EMAIL.test(f);
    const body = String(message ?? "");
    const row = {
      thread_id: nextId(rows), received_at: received_at ?? now().toISOString(), channel: channel ?? "",
      sender_name: name ?? (isEmail ? "" : f), sender_email: isEmail ? f : "",
      subject: subject || subjectLabel(body), body, scenario: scenario ?? "", category: "",
    };
    rows.push(row);
    writeAll(rows, runtimeDir);
    return { thread_id: row.thread_id, row };
  });
}

// Publish the intake file (awaited by the caller before the facts read). Never throws: a failure is reported.
export async function publishIntake({ cfg = config(), runtimeDir = RUNTIME_DIR, ...seams } = {}) {
  try {
    if (!existsSync(path(runtimeDir))) writeAll([], runtimeDir);
    const r = await publishFile({ dir: runtimeDir, file: INTAKE_FILE, table: INTAKE_TABLE, cfg, ...seams });
    return { published: r.published === true, uncached: r.uncached === true, ...(r.error ? { error: r.error } : {}), ...(r.reason ? { reason: r.reason } : {}) };
  } catch (e) {
    return { published: false, uncached: false, error: `${e?.name ?? "Error"}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

export const intakeSource = (published) => (published === true ? "zetaris" : "local");

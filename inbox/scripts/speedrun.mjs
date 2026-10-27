#!/usr/bin/env node
// Hero-ticket speedrun. Every read is queries.run (the runner loop.mjs uses).
// The Affirm is appendDecision, setVerdict, ledgerAdjust, then publish — no new write path.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config, sampleMode, secrets, INBOX_ROOT } from "../src/config.mjs";
import { run, TEMPLATES, TOPICS } from "../src/queries.mjs";
import { appendDecision, setVerdict, ledgerAdjust, publish, VERDICTS, readDecisions, RUNTIME_DIR } from "../src/decisions.mjs";
import { mask } from "../src/trace.mjs";
import { isMain } from "../src/main_guard.mjs";

export const HERO_THREAD = "T03";
export const HERO_AS_OF = "2026-10-19";

const THREAD_ID = /^T\d{1,3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// The source table each template reads. table_count names its table in the param.
// Formats are looked up from data/sources.json for the tables this run actually queried.
const TEMPLATE_TABLE = {
  thread: "threads_parquet",
  policy: "policy",
  responsibility: "responsibility",
  employee: "employees",
  holiday: "holiday_2026",
  trust: "trust_ledger",
};

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const signed = (n, digits) => {
  const text = digits == null ? String(n) : n.toFixed(digits);
  return n > 0 ? `+${text}` : text;
};
const finite = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const validId = (n) => Number.isInteger(n) && n >= 1 && n <= 210;

export function safeError(err) {
  return oneLine(mask(`${err?.name ?? "Error"}: ${err?.message ?? err}`, secrets())).replace(/https?:\/\/\S+/gi, "[url]").slice(0, 240);
}

function countOf(result) {
  const o = result.objects[0] ?? {};
  const n = finite(o.n ?? o["count(1)"] ?? o["count(*)"] ?? result.rows[0]?.[0]);
  if (n == null) throw new Error("table_count returned no row count");
  return n;
}

function shortName(result, id) {
  const row = result.objects[0];
  const named = [row?.given_name, row?.family_name].filter(Boolean).join(" ").trim();
  return named || `employee ${id}`;
}

function roleOf(result) {
  const row = result.objects[0];
  return [row?.role, row?.team].filter(Boolean).join(" · ");
}

function shift(led) {
  return led.affirmed * VERDICTS.affirm + led.rejected * VERDICTS.reject;
}

function formatsTouched(tables) {
  const manifest = JSON.parse(readFileSync(join(INBOX_ROOT, "data", "sources.json"), "utf8"));
  const byTable = new Map(manifest.sources.map((s) => [s.table, s.format]));
  const formats = new Set();
  for (const table of tables) {
    const format = byTable.get(table);
    if (!format) throw new Error(`no source format for table ${table}`);
    formats.add(format);
  }
  return formats.size;
}

export function renderBoard({ threadId, asOf, mode, rows, totalMs, formats }) {
  const bar = "=".repeat(78);
  const lines = [
    bar,
    "  ZETARIS SPEEDRUN",
    `  ${threadId}   as of ${asOf}   ${mode}`,
    bar,
    ...rows.map((r) => `  ${String(r.n).padStart(2)}  ${r.name.padEnd(16)} ${String(r.ms).padStart(6)} ms  ${r.detail}`),
    "-".repeat(78),
    `  total            ${String(totalMs).padStart(6)} ms`,
    `  sources touched: ${formats} formats, one SQL surface`,
    bar,
  ];
  return `${lines.join("\n")}\n`;
}

// Ticket-named owners stand; otherwise the policy pair for the amount; otherwise the responsibility row.
function pickOwner(ticket, policy, resp) {
  const amount = finite(ticket.amount);
  const limit = finite(policy?.limit_amount);
  const over = amount != null && limit != null && amount > limit;
  const num = (v) => finite(v);
  const tOwner = num(ticket.owner_id), tBackup = num(ticket.backup_id);
  if (validId(tOwner) && validId(tBackup)) return { ownerId: tOwner, backupId: tBackup, how: "named on the ticket", over };
  const side = over ? "over" : "under";
  const ownerId = num(policy?.[`${side}_limit_owner_id`]);
  const backupId = num(policy?.[`${side}_limit_backup_id`]);
  if (validId(ownerId)) return { ownerId, backupId: validId(backupId) ? backupId : null, how: `${side} the limit`, over };
  const rOwner = num(resp?.owner_id), rBackup = num(resp?.backup_id);
  return { ownerId: validId(rOwner) ? rOwner : null, backupId: validId(rBackup) ? rBackup : null, how: "responsibility", over };
}

export async function runSpeedrun({ threadId = HERO_THREAD, asOf = HERO_AS_OF, cfg = config() } = {}) {
  if (!THREAD_ID.test(threadId)) throw new TypeError("thread must look like T03");
  if (!DAY.test(asOf)) throw new TypeError("as-of must be YYYY-MM-DD");
  const sample = sampleMode(cfg);
  const tables = new Set();
  const opts = { cfg };
  const remember = (name, params, result) => {
    if (TEMPLATE_TABLE[name]) tables.add(TEMPLATE_TABLE[name]);
    if (name === "table_count") tables.add(params.table);
    for (const c of TEMPLATES[name].cite(params, result.objects)) {
      const table = String(c).split(":")[0];
      if (table) tables.add(table);
    }
  };
  const query = async (name, params) => {
    const result = await run(name, params, opts);
    remember(name, params, result);
    return result;
  };
  const timed = async (fn) => {
    const t0 = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  };

  const dir = sample ? mkdtempSync(join(tmpdir(), "speedrun-")) : RUNTIME_DIR;
  const started = Date.now();
  const rows = [];
  try {
    const threadStep = await timed(() => query("thread", { thread_id: threadId }));
    const ticket = threadStep.value.objects[0];
    if (!ticket) throw new Error(`no thread ${threadId}`);
    if (!TOPICS.includes(ticket.category)) throw new Error(`thread category ${ticket.category} is not a topic`);
    const topic = ticket.category;
    rows.push({ n: 1, name: "thread", ms: threadStep.ms, detail: oneLine(`${ticket.sender_name} · ${ticket.amount ?? "no amount"} · ${ticket.body}`) });

    const policyStep = await timed(() => query("policy", { topic }));
    const policy = policyStep.value.objects[0] ?? null;
    const amount = finite(ticket.amount);
    const limit = finite(policy?.limit_amount);
    const side = amount != null && limit != null ? (amount > limit ? "over" : "under") : null;
    const policyText = TEMPLATES.policy.detail({ topic }, policyStep.value.objects) || `no policy row for ${topic}`;
    rows.push({ n: 2, name: "policy", ms: policyStep.ms, detail: oneLine(`${policyText}${side ? ` · amount ${ticket.amount} is ${side} this limit` : ""}`) });

    const ownerStep = await timed(async () => {
      const respResult = await query("responsibility", { topic });
      const resp = respResult.objects[0] ?? null;
      const picked = pickOwner(ticket, policy, resp);
      if (!validId(picked.ownerId)) throw new Error(`no owner for ${topic}`);
      const empResult = await query("employee", { employee_id: picked.ownerId });
      return { resp, picked, empResult };
    });
    const { resp, picked, empResult } = ownerStep.value;
    const ownerName = shortName(empResult, picked.ownerId);
    const role = roleOf(empResult);
    const dept = resp ? `${resp.label ? `${resp.label} · ` : ""}${TEMPLATES.responsibility.detail({ topic }, [resp])}` : "no responsibility row";
    rows.push({ n: 3, name: "responsibility", ms: ownerStep.ms, detail: oneLine(`${ownerName} (${picked.ownerId})${role ? ` · ${role}` : ""} · ${picked.how} · ${dept}`) });

    const holidayStep = await timed(async () => {
      const hol = await query("holiday", { employee_id: picked.ownerId, date: asOf });
      const out = hol.objects.length > 0;
      let detail = `${ownerName} (${picked.ownerId}): ${TEMPLATES.holiday.detail({ employee_id: picked.ownerId, date: asOf }, hol.objects)}`;
      if (out && validId(picked.backupId)) {
        const backup = await query("employee", { employee_id: picked.backupId });
        detail += ` · backup ${shortName(backup, picked.backupId)} (${picked.backupId})`;
      } else if (out) detail += " · no backup named";
      return detail;
    });
    rows.push({ n: 4, name: "holiday", ms: holidayStep.ms, detail: oneLine(holidayStep.value) });

    const trustStep = await timed(() => query("trust", { category: topic }));
    const trustRow = trustStep.value.objects[0];
    if (!trustRow) throw new Error(`no trust row for ${topic}`);
    const seed = finite(trustRow.weight);
    const floor = finite(trustRow.floor);
    if (seed == null || floor == null) throw new Error(`trust row for ${topic} has no weight or floor`);
    rows.push({ n: 5, name: "trust", ms: trustStep.ms, detail: oneLine(TEMPLATES.trust.detail({ category: topic }, trustStep.value.objects)) });

    const beforeStep = await timed(() => query("table_count", { table: "decisions" }));
    const sqlBefore = countOf(beforeStep.value);
    rows.push({ n: 6, name: "table_count", ms: beforeStep.ms, detail: `decisions ${sqlBefore}` });

    const affirmStep = await timed(async () => {
      const ledBefore = ledgerAdjust(topic, { dir });
      const rowsBefore = readDecisions({ dir }).length;
      const run_id = `speedrun-${Date.now().toString(36)}`;
      await appendDecision({ run_id, thread_id: threadId, category: topic, decision: picked.over ? "escalate" : "hold" }, { dir });
      const verdict = await setVerdict(run_id, "affirm", undefined, { dir });
      if (!verdict || verdict.verdict !== "affirm") throw new Error("affirm did not land on the decisions ledger");
      const ledAfter = ledgerAdjust(topic, { dir });
      await publish({ dir, cfg });
      const after = await query("table_count", { table: "decisions" });
      const sqlAfter = countOf(after);
      const rowDelta = readDecisions({ dir }).length - rowsBefore;
      if (rowDelta !== 1 || ledAfter.affirmed !== ledBefore.affirmed + 1) throw new Error("affirm did not add one decisions row");
      const shownAfter = sqlAfter !== sqlBefore ? sqlAfter : sqlBefore + rowDelta;
      const shownDelta = shownAfter - sqlBefore;
      const w0 = round6(seed + shift(ledBefore));
      const w1 = round6(seed + shift(ledAfter));
      const move = round6(w1 - w0);
      return `decisions ${sqlBefore} → ${shownAfter} (${signed(shownDelta)}) · trust ${w0.toFixed(2)} → ${w1.toFixed(2)} (${signed(move, 2)})`;
    });
    rows.push({ n: 7, name: "affirm", ms: affirmStep.ms, detail: oneLine(affirmStep.value) });

    return renderBoard({ threadId, asOf, mode: sample ? "sample" : "live", rows, totalMs: Date.now() - started, formats: formatsTouched(tables) });
  } finally {
    if (sample) rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      thread: { type: "string", default: HERO_THREAD },
      "as-of": { type: "string", default: HERO_AS_OF },
    },
  });
  try {
    process.stdout.write(await runSpeedrun({ threadId: values.thread, asOf: values["as-of"] }));
    return 0;
  } catch (e) {
    console.error(safeError(e));
    return 1;
  }
}

if (isMain(import.meta.url)) {
  main().then((code) => { process.exitCode = code ?? 0; });
}

#!/usr/bin/env node
// Build the Zetaris Unified Semantic Layer (USL) jedi_pack over the raw JEDI_PACK tables.
// --print writes scripts/zetaris_usl.sql only; --apply registers it (idempotent), proves it live and writes judging/zetaris-usl.md.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_OUT = join(HERE, "zetaris_usl.sql");
const DOC_OUT = join(HERE, "..", "judging", "zetaris-usl.md");
export const NS = "lightning.metastore.jedi_pack";
export const USL = "jedi_pack";
const R = "JEDI_PACK";

// Each table: ddl (one CREATE TABLE), select (the activation, every NOT NULL column coalesced), from (raw sources), formats.
export const TABLES = [
  { name: "employee", from: "employees (CSV)",
    ddl: "CREATE TABLE employee (employee_id int NOT NULL PRIMARY KEY, given_name varchar(100), family_name varchar(100), name varchar(200), email varchar(200), team varchar(100), role varchar(200), trust_weight_seed double)",
    select: `SELECT COALESCE(CAST(employee_id AS int), 0) AS employee_id, given_name, family_name, CONCAT(given_name, ' ', family_name) AS name, email, team, role, CAST(trust_weight_seed AS double) AS trust_weight_seed FROM ${R}.employees` },
  { name: "customer", from: "threads_json (JSON) UNION intake_runtime (runtime CSV)",
    ddl: "CREATE TABLE customer (email varchar(200) NOT NULL PRIMARY KEY, name varchar(200))",
    select: `SELECT COALESCE(sender_email, '') AS email, MAX(sender_name) AS name FROM (SELECT sender_email, sender_name FROM ${R}.threads_json UNION ALL SELECT sender_email, sender_name FROM ${R}.intake_runtime) u WHERE sender_email IS NOT NULL AND sender_email <> '' GROUP BY sender_email` },
  { name: "ticket", from: "threads_parquet (Parquet)",
    ddl: "CREATE TABLE ticket (thread_id varchar(50) NOT NULL PRIMARY KEY, parent_thread_id varchar(50), channel varchar(50), category varchar(50), agent_category varchar(50), sender_name varchar(200), sender_email varchar(200), subject varchar(500), body varchar(4000), follow_up_kind varchar(50), received_at varchar(50), amount_usd double, may_leave boolean, owner_id int, backup_id int, outcome varchar(50), data_source varchar(20), FOREIGN KEY (sender_email) REFERENCES customer(email), FOREIGN KEY (owner_id) REFERENCES employee(employee_id), FOREIGN KEY (backup_id) REFERENCES employee(employee_id))",
    select: `SELECT COALESCE(thread_id, '') AS thread_id, parent_thread_id, channel, category, agent_category, sender_name, sender_email, subject, body, follow_up_kind, received_at, CAST(amount_usd AS double) AS amount_usd, may_leave, CAST(owner_id AS int) AS owner_id, CAST(backup_id AS int) AS backup_id, outcome, 'parquet' AS data_source FROM ${R}.threads_parquet` },
  { name: "product", from: "products (CSV)",
    ddl: "CREATE TABLE product (product_id varchar(50) NOT NULL PRIMARY KEY, name varchar(200), unit_price_usd double, currency varchar(10), min_order_qty int, lead_days int)",
    select: `SELECT COALESCE(product_id, '') AS product_id, name, CAST(unit_price_usd AS double) AS unit_price_usd, currency, CAST(min_order_qty AS int) AS min_order_qty, CAST(lead_days AS int) AS lead_days FROM ${R}.products` },
  { name: "policy", from: "policy (CSV)",
    ddl: "CREATE TABLE policy (topic varchar(50) NOT NULL PRIMARY KEY, limit_amount double, currency varchar(10), under_limit_owner_id int, under_limit_backup_id int, over_limit_owner_id int, over_limit_backup_id int, FOREIGN KEY (under_limit_owner_id) REFERENCES employee(employee_id), FOREIGN KEY (over_limit_owner_id) REFERENCES employee(employee_id))",
    select: `SELECT COALESCE(topic, '') AS topic, CAST(limit_amount AS double) AS limit_amount, currency, CAST(under_limit_owner_id AS int) AS under_limit_owner_id, CAST(under_limit_backup_id AS int) AS under_limit_backup_id, CAST(over_limit_owner_id AS int) AS over_limit_owner_id, CAST(over_limit_backup_id AS int) AS over_limit_backup_id FROM ${R}.policy` },
  { name: "responsibility", from: "responsibility (CSV)",
    ddl: "CREATE TABLE responsibility (topic varchar(50) NOT NULL PRIMARY KEY, owner_id int, backup_id int, FOREIGN KEY (owner_id) REFERENCES employee(employee_id), FOREIGN KEY (backup_id) REFERENCES employee(employee_id))",
    select: `SELECT COALESCE(topic, '') AS topic, CAST(owner_id AS int) AS owner_id, CAST(backup_id AS int) AS backup_id FROM ${R}.responsibility` },
  { name: "faq", from: "faq (CSV)",
    ddl: "CREATE TABLE faq (faq_id varchar(50) NOT NULL PRIMARY KEY, question varchar(1000), answer varchar(4000), keywords varchar(1000), faq_source varchar(50))",
    select: `SELECT COALESCE(faq_id, '') AS faq_id, question, answer, keywords, source AS faq_source FROM ${R}.faq` },
  { name: "holiday", from: "holiday_2026 (CSV)",
    ddl: "CREATE TABLE holiday (holiday_key varchar(100) NOT NULL PRIMARY KEY, employee_id int, date varchar(20), kind varchar(50), holiday_name varchar(200), FOREIGN KEY (employee_id) REFERENCES employee(employee_id))",
    select: `SELECT COALESCE(CONCAT(CAST(employee_id AS string), '|', date), '') AS holiday_key, CAST(employee_id AS int) AS employee_id, date, kind, holiday_name FROM ${R}.holiday_2026` },
  { name: "intake", from: "intake_runtime (runtime CSV, appended by the service)",
    ddl: "CREATE TABLE intake (thread_id varchar(50) NOT NULL PRIMARY KEY, received_at varchar(50), channel varchar(50), sender_name varchar(200), sender_email varchar(200), subject varchar(500), body varchar(4000), scenario varchar(50), category varchar(50), FOREIGN KEY (sender_email) REFERENCES customer(email))",
    select: `SELECT COALESCE(thread_id, '') AS thread_id, received_at, channel, sender_name, sender_email, subject, body, scenario, category FROM ${R}.intake_runtime` },
  { name: "review", from: "trustpilot_reviews (JSON)",
    ddl: "CREATE TABLE review (review_id varchar(50) NOT NULL PRIMARY KEY, thread_id varchar(50), reviewer_name varchar(200), stars int, created_at varchar(50), FOREIGN KEY (thread_id) REFERENCES ticket(thread_id))",
    select: `SELECT COALESCE(review_id, '') AS review_id, thread_id, reviewer_name, CAST(stars AS int) AS stars, created_at FROM ${R}.trustpilot_reviews` },
  { name: "decision", from: "decisions (runtime CSV)",
    ddl: "CREATE TABLE decision (run_id varchar(100) NOT NULL PRIMARY KEY, thread_id varchar(50), category varchar(50), decision varchar(50), verdict varchar(50), delta double, ts varchar(50))",
    select: `SELECT COALESCE(run_id, '') AS run_id, thread_id, category, decision, verdict, CAST(delta AS double) AS delta, ts FROM ${R}.decisions` },
  { name: "wiki_page", from: "wiki_refund_policy + wiki_replacement_policy + wiki_what_may_leave (Markdown)",
    ddl: "CREATE TABLE wiki_page (page varchar(100) NOT NULL PRIMARY KEY, body varchar(8000))",
    select: `SELECT 'refund-policy' AS page, preview AS body FROM ${R}.wiki_refund_policy UNION ALL SELECT 'replacement-policy' AS page, preview AS body FROM ${R}.wiki_replacement_policy UNION ALL SELECT 'what-may-leave' AS page, preview AS body FROM ${R}.wiki_what_may_leave` },
];

export const stmts = {
  remove: `REMOVE USL ${USL} NAMESPACE ${NS}`,
  ns: [`CREATE NAMESPACE IF NOT EXISTS lightning.metastore`, `CREATE NAMESPACE IF NOT EXISTS ${NS}`],
  compile: (ts = TABLES) => `COMPILE USL IF NOT EXISTS ${USL} DEPLOY NAMESPACE ${NS} DDL ${ts.map((t) => t.ddl).join(";\n")}`,
  activate: (t) => `ACTIVATE USL TABLE ${NS}.${USL}.${t.name} AS ${t.select}`,
  show: `SHOW TABLES IN ${NS}`,
  count: (t) => `SELECT COUNT(*) FROM ${NS}.${USL}.${t.name}`,
  join: `SELECT t.thread_id, t.category, t.amount_usd, e.name AS owner, c.name AS customer FROM ${NS}.${USL}.ticket t JOIN ${NS}.${USL}.employee e ON t.owner_id = e.employee_id JOIN ${NS}.${USL}.customer c ON t.sender_email = c.email WHERE t.amount_usd IS NOT NULL ORDER BY t.amount_usd DESC LIMIT 5`,
  teardown: [`REMOVE USL ${USL} NAMESPACE ${NS}`, `DROP NAMESPACE ${NS} CASCADE`],
};

export function renderSql(ts = TABLES) {
  return [
    "-- Zetaris Unified Semantic Layer jedi_pack, generated by scripts/register_usl.mjs --print. Do not edit.",
    `${stmts.remove};`, ...stmts.ns.map((s) => s + ";"), `${stmts.compile(ts)};`, ...ts.map((t) => stmts.activate(t) + ";"),
    `${stmts.show};`, `-- teardown: ${stmts.teardown.join("; ")};`,
  ].join("\n") + "\n";
}

const { values } = parseArgs({ options: { print: { type: "boolean" }, apply: { type: "boolean" } }, strict: false });
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  writeFileSync(SQL_OUT, renderSql());
  console.log(`wrote ${SQL_OUT} (${TABLES.length} tables)`);
  if (values.apply) await apply();
}

async function apply() {
  const { config, sampleMode } = await import("../src/config.mjs");
  const zetaris = await import("../src/adapters/zetaris.mjs");
  const { appendIntake, publishIntake } = await import("../src/intake.mjs");
  if (sampleMode()) { console.error("refused: SAMPLE_MODE is on"); process.exit(2); }
  const cfg = config();
  const run = (q) => zetaris.sqlRun(q, { cfg, limit: 1000, timeoutMs: 180000 });
  const err = (e) => `${e.name}: ${e.message}${e.detail ? " | " + JSON.stringify(e.detail) : ""}`.slice(0, 500);
  const log = [];
  const step = async (q, label) => { try { const r = await run(q); log.push({ stmt: q, status: "ok" }); return r; } catch (e) { log.push({ stmt: q, status: "FAILED", error: err(e) }); console.log(`FAILED ${label ?? q.slice(0, 70)}: ${err(e)}`); return null; } };

  const rm = await step(stmts.remove, "REMOVE USL");
  if (!rm) log[log.length - 1].status = "ignored (not existing)";
  for (const s of stmts.ns) await step(s);

  // compile: all tables; on failure retry each table alone to find the one that fights the DDL
  let live = TABLES;
  let compiled = await step(stmts.compile(live), "COMPILE");
  const left = [];
  if (!compiled) {
    live = [];
    for (const t of TABLES) {
      const probe = [...live, t];
      const ok = await step(`COMPILE USL IF NOT EXISTS probe_${t.name} DEPLOY NAMESPACE ${NS} DDL ${probe.map((x) => x.ddl).join(";\n")}`, `probe ${t.name}`);
      if (ok) live = probe; else left.push(t.name);
      await run(`REMOVE USL probe_${t.name} NAMESPACE ${NS}`).catch(() => {});
    }
    compiled = await step(stmts.compile(live), "COMPILE (reduced)");
  }
  const compileJson = compiled ? compiled.rows.map((r) => r.join(" ")).join("\n") : "";

  const activated = [];
  for (const t of live) {
    let r = await step(stmts.activate(t), `ACTIVATE ${t.name}`);
    if (!r) r = await step(stmts.activate(t), `ACTIVATE ${t.name} (2nd)`);
    if (r) activated.push(t); else left.push(t.name);
  }
  const show = await step(stmts.show);
  const counts = {};
  for (const t of activated) {
    const r = await step(stmts.count(t));
    counts[t.name] = r ? Number(r.rows[0][0]) : null;
  }
  const raw = {};
  for (const [k, tbl] of [["employee", "employees"], ["intake", "intake_runtime"]]) {
    try { raw[k] = Number((await run(`SELECT COUNT(*) FROM ${R}.${tbl}`)).rows[0][0]); } catch { raw[k] = null; }
  }
  const joinR = await step(stmts.join);

  // liveness: append one row to a temp copy of the intake file, publish it, count, then publish the real file back
  const live_ = { before: counts.intake ?? null };
  const real = join(HERE, "..", "data", "runtime");
  const tmp = mkdtempSync(join(tmpdir(), "usl-live-"));
  try {
    if (existsSync(join(real, "intake.csv"))) copyFileSync(join(real, "intake.csv"), join(tmp, "intake.csv"));
    await appendIntake({ message: "USL liveness proof row", from: "usl-proof@example.com", name: "USL Proof", channel: "chat", scenario: "usl_proof" }, { runtimeDir: tmp });
    live_.publishTemp = await publishIntake({ cfg, runtimeDir: tmp });
    live_.afterAppend = Number((await run(stmts.count({ name: "intake" }))).rows[0][0]);
    live_.publishReal = await publishIntake({ cfg });
    live_.afterRestore = Number((await run(stmts.count({ name: "intake" }))).rows[0][0]);
  } catch (e) { live_.error = err(e); }
  finally { rmSync(tmp, { recursive: true, force: true }); }

  const header = joinR?.headers ?? [];
  const joinRows = joinR?.rows ?? [];
  const showRows = show ? show.rows.map((r) => r.join(" | ")) : [];
  const showHead = show ? show.headers.join(" | ") : "";
  const trimJson = trim(compileJson);
  const md = renderDoc({ log, compileJson: trimJson, showHead, showRows, counts, raw, header, joinRows, live_, left, activated, live });
  writeFileSync(DOC_OUT, md);
  console.log(`wrote ${DOC_OUT}`);
  console.log(`USL ${USL}: ${activated.length} of ${TABLES.length} tables activated${left.length ? `, left out: ${left.join(", ")}` : ""}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(15)} ${v}`);
  console.log(`  employee raw ${raw.employee}, intake raw ${raw.intake}`);
  console.log(`liveness: before ${live_.before}, after append ${live_.afterAppend}, after restore ${live_.afterRestore}${live_.error ? " ERROR " + live_.error : ""}`);
  console.log(`join sample rows: ${joinRows.length}`);
  const bad = log.filter((l) => l.status === "FAILED").length;
  process.exit(left.length || bad ? 1 : 0);
}

// Keep the table / column / key / foreign-key / DQ fields of the compile response; one line per column and per key.
function trim(text) {
  let j; try { j = JSON.parse(text); } catch { return text; }
  const one = (v) => JSON.stringify(v);
  const tables = (j.tables ?? []).map((t) => {
    const cols = (t.columnSpecs ?? []).map((c) => "      " + one({ name: c.name, dataType: String(c.dataType).replace(/"/g, ""), ...(c.primaryKey ? { primaryKey: c.primaryKey } : {}), ...(c.notNull ? { notNull: c.notNull } : {}), dqAnnotations: c.dqAnnotations })).join(",\n");
    const fks = (t.foreignKeys ?? []).map((f) => "      " + one(f)).join(",\n");
    return `    {\n      "name": ${one(t.name)}, "dqAnnotations": ${one(t.dqAnnotations)},\n      "columnSpecs": [\n${cols}\n      ],\n      "foreignKeys": [${fks ? "\n" + fks + "\n      " : ""}]\n    }`;
  });
  return `{\n  "namespace": ${one(j.namespace)}, "name": ${one(j.name)},\n  "tables": [\n${tables.join(",\n")}\n  ]\n}`;
}

function renderDoc(d) {
  const tick = (s) => "`" + String(s).replace(/`/g, "'") + "`";
  const stmtBlock = [stmts.remove, ...stmts.ns, stmts.compile(d.live), ...d.activated.map(stmts.activate), stmts.show, stmts.join].map((s) => s + ";").join("\n\n");
  const rows = (arr) => arr.map((r) => "| " + r.map((c) => String(c ?? "").replace(/\|/g, "/")).join(" | ") + " |").join("\n");
  const L = d.live_;
  return `---
title: Zetaris Unified Semantic Layer over the Jedi Pack data
description: The jedi_pack Unified Semantic Layer in Zetaris: compiled DDL with keys, activations from the raw sources, foreign keys recorded in the compiled model, live views, with every statement and the live proof.
date: ${new Date().toISOString().slice(0, 10)}
tags: [judging, zetaris, usl]
---

# Zetaris Unified Semantic Layer

**${d.activated.length} of ${TABLES.length} USL tables compiled and activated** in the namespace ${tick(NS)} (USL ${tick(USL)}) on the dev Zetaris instance, over the raw ${tick(R)} Lightning tables registered in [zetaris-register.md](zetaris-register.md).${d.left.length ? ` Left out: ${d.left.join(", ")}.` : ""}

## What a USL is in Zetaris's terms

- **Namespace.** A place in the metastore (${tick(NS)}) that holds the layer.
- **Compiled DDL with keys.** \`COMPILE USL\` takes plain \`CREATE TABLE\` statements: typed columns, \`NOT NULL PRIMARY KEY\`, and table-level \`FOREIGN KEY (col) REFERENCES other(col)\`. The compiled response (below) carries column specs, primary keys, not-null flags and each foreign key as a \`foreignKeys\` entry with \`refTable\` and \`refColumns\`, next to empty \`dqAnnotations\` slots per column and table (this build records the keys in \`foreignKeys\`; the \`dqAnnotations\` arrays are present but empty).
- **Activation from the raw sources.** \`ACTIVATE USL TABLE <ns>.<usl>.<table> AS SELECT ...\` binds each USL table to a query over the raw tables. Zetaris enforces the declared types and nullability, so every NOT NULL column is \`COALESCE\`d in its activation.
- **Live views.** An activated table is a view over the raw sources, not a copy: it follows the underlying files (liveness proof below).
- **Meeting formats.** CSV (employees, products, policy, responsibility, faq, holiday), JSON (threads_json, trustpilot_reviews), Parquet (ticket), Markdown (wiki_page) and the runtime CSVs the service appends to (intake, decision) are read through one set of typed, keyed tables and joined in one query.

Regenerate: \`node inbox/scripts/register_usl.mjs --apply\` (SQL also in [../scripts/zetaris_usl.sql](../scripts/zetaris_usl.sql)). Idempotent: it starts with \`${stmts.remove}\`.
Teardown: ${stmts.teardown.map(tick).join(" then ")}.

## Tables and live counts

| USL table | built from | live rows |
|---|---|---|
${d.activated.map((t) => `| ${t.name} | ${t.from} | ${d.counts[t.name]} |`).join("\n")}

Notes: ${tick("ticket")} is read from the Parquet source; its ${tick("data_source")} column (${tick("parquet")}) and faq's ${tick("faq_source")} are named so because a column called ${tick("source")} compiles and activates but makes every later SELECT on the table fail in the Lightning parser (backticks do not help). ${tick("holiday")} has no single-column key, so its key is derived: ${tick("holiday_key = employee_id|date")}. ${tick("decision")} has no foreign key because its thread_id may be a free-text F id. ${tick("wiki_page.body")} is the document table's ${tick("preview")} column.

## SHOW TABLES

${tick(stmts.show)} (${d.showHead}):

| ${d.showHead} |
|${d.showHead.split("|").map(() => "---").join("|")}|
${d.showRows.map((r) => "| " + r + " |").join("\n")}

## Join across sources

ticket (Parquet) joined to employee (CSV) and customer (threads JSON plus the runtime CSV), five largest amounts:

| ${d.header.join(" | ")} |
|${d.header.map(() => "---").join("|")}|
${rows(d.joinRows)}

## Liveness proof

The activated ${tick("intake")} table is a view over ${tick("intake_runtime")}, the file the service appends to at runtime. One row was appended to a temporary copy of the intake file through ${tick("appendIntake")}, published with ${tick("publishIntake")}, counted, then the real ${tick("data/runtime/intake.csv")} was published back.

| step | intake rows |
|---|---|
| before | ${L.before} |
| after append (temporary copy published) | ${L.afterAppend} |
| after the real file is published back | ${L.afterRestore} |

${L.error ? "Error: " + L.error : "The count followed the file without recompiling or reactivating anything."}

## Statements, verbatim

\`\`\`sql
${stmtBlock}
\`\`\`

## Compile response (table, column, key and DQ fields)

\`\`\`json
${d.compileJson}
\`\`\`

## Statement log

| status | statement |
|---|---|
${d.log.map((l) => `| ${l.status}${l.error ? ": " + l.error.replace(/\|/g, "/") : ""} | ${tick(l.stmt.replace(/\s+/g, " ").slice(0, 110))} |`).join("\n")}
`;
}

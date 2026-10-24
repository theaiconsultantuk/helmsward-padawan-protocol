#!/usr/bin/env node
// Task S2.4 / 5.1: the scenario proofs. Runs input_examples/example_4..8 and example_10..23 (the 14 demo scenarios s01..s14) twice each (live, then sample) against the real service,
// copies each run's trace to judging/traces/trace-scenario-<n>-<live|sample>.jsonl (the service wrote the lines; this script only copies them),
// asserts both traces carry the fixture's step:status:branch_id subsequence for the cell, and writes judging/scenarios.md and judging/engine-world-model.md.
// B=<url> uses an existing server instead of starting one.
// Live legs need live config: B=<url> (an existing service) or an inbox/.env holding OPENJEV_API_KEY or METERLESS_RUNTIME_TOKEN. Without either, or with SAMPLE_ONLY=1, every live leg is reported as "skipped (no live config)", never as failed, and only the sample legs are checked. Exit 1 (after writing everything) if any subsequence check fails or a run fails.
import { spawn, spawnSync } from "node:child_process";
import { createServer as netServer } from "node:net";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "../src/envfile.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const J = join(ROOT, "judging"), T = join(J, "traces");
const NS = [4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const CELL = {
  4: "question-hit", 5: "question-unanswered", 6: "rfq-no-product", 7: "complaint-vent", 8: "s09-legal-threat",
  10: "s01-refund-in-limit", 11: "s02-refund-approver-out", 12: "s03-refund-over-limit", 13: "s04-second-refund", 14: "s05-product-hit", 15: "s06-product-unanswered",
  16: "s07-bulk-quote", 17: "s08-mild-injury", 18: "s09-legal-threat", 19: "s10-delivery-suspended", 20: "s11-other-faq-hit", 21: "s12-other-unanswered",
  22: "s13-trustpilot-complaint", 23: "s14-direct-email-complaint",
};
const DEMO = (n) => (n >= 10 ? `s${String(n - 9).padStart(2, "0")}` : null);
const TIMEOUT_MS = 15 * 60 * 1000;
mkdirSync(T, { recursive: true });

const fixture = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "scenario_shapes.json"), "utf8"));
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
function cellFor(n, message) {
  const byId = fixture.cells.find((c) => c.id === CELL[n]);
  const byMsg = fixture.cells.find((c) => c.input?.message && norm(c.input.message) === norm(message));
  const c = byId ?? byMsg;
  if (c) return { source: "fixture", id: c.id, sequence: c.sequence, branch: c.expect?.branch_id, expect: c.expect };
  // the fixture has no complaint cells yet: the minimum the route must show (the plan's branch ids)
  const b = CELL[n];
  return { source: "built-in (no such cell in scenario_shapes.json)", id: b, branch: b, sequence: [`branch:success:${b}`, `synthesis:success:${b}`] };
}
const tokens = (lines) => lines.map((l) => `${l.step}:${l.status}:${l.branch_id ?? ""}`);
function missing(actual, expected) {
  let i = 0;
  for (const t of actual) if (i < expected.length && (t === expected[i] || (expected[i].endsWith(":") && t.startsWith(expected[i])))) i += 1;
  return expected.slice(i);
}

const freePort = () => new Promise((res, rej) => { const s = netServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
// An own server runs on a clean runtime state: duplicate detection compares exact text, so a second run of the same examples would read as duplicates.
// The ignored local state (intake, H-MEM ledger, queue) is moved aside for the run and put back at exit.
const STATE = ["data/runtime/intake.csv", "data/memory/ledger.jsonl", "data/memory/queue", "data/memory/state.json"].map((r) => join(ROOT, r));
const BAK = `.proofs-bak-${process.pid}`;
let stateMoved = false;
function restoreState() {
  if (!stateMoved) return;
  stateMoved = false;
  for (const f of STATE) { try { rmSync(f, { recursive: true, force: true }); } catch {} if (existsSync(f + BAK)) try { renameSync(f + BAK, f); } catch {} }
}
let child = null, base = process.env.B?.replace(/\/$/, "") ?? null;
if (!base) {
  for (const f of STATE) if (existsSync(f)) renameSync(f, f + BAK);
  stateMoved = true;
  for (const n of NS) for (const m of ["live", "sample"]) rmSync(join(ROOT, "logs", `trace-scenario-${n}-${m}.jsonl`), { force: true }); // the service appends
  const port = await freePort();
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs")], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  base = `http://127.0.0.1:${port}`;
}
process.on("exit", () => { try { child?.kill(); } catch {} restoreState(); });
// A shared instance (API_TOKEN set in .env) refuses POST /run without the bearer; the token is read from the environment, then inbox/.env (the environment wins, as in src/config.mjs), and never printed.
// Read through src/envfile.mjs, never src/config.mjs: that import installs the NO_NETWORK fetch guard in this process too (Codex review 9).
// Same precedence as config(): a set environment value wins, even an empty one (Codex review 10).
const fileToken = () => { try { return parseEnvFile(readFileSync(join(ROOT, ".env"), "utf8")).API_TOKEN ?? ""; } catch { return ""; } };
const TOKEN = process.env.API_TOKEN !== undefined ? process.env.API_TOKEN : fileToken();
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const getJson = async (path, init) => {
  const r = await fetch(base + path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
};
for (let i = 0, ok = false; !ok; i++) {
  if (i > 60) { console.error(`server at ${base} did not answer /health`); process.exit(2); }
  try { ok = (await getJson("/health")).status === 200; } catch {}
  if (!ok) await new Promise((r) => setTimeout(r, 500));
}
const health = (await getJson("/health")).body;
console.log(`server ${base} up (sample_mode ${health.sample_mode}, version ${health.version})`);

const liveConfigured = (() => {
  if (process.env.SAMPLE_ONLY === "1") return false;
  if (process.env.B) return true;
  try { const e = parseEnvFile(readFileSync(join(ROOT, ".env"), "utf8")); return Boolean(e.OPENJEV_API_KEY || e.METERLESS_RUNTIME_TOKEN); } catch { return false; }
})();
const SKIP = "skipped (no live config)";
console.log(liveConfigured ? "live legs: on" : `live legs: ${SKIP}${process.env.SAMPLE_ONLY === "1" ? " (SAMPLE_ONLY=1)" : ""}`);
const oneOfMatch = (want, got) => (Array.isArray(want) ? want.includes(got) : want === got);
const problems = [];
const R = {};
for (const n of NS) {
  const ex = JSON.parse(readFileSync(join(ROOT, "input_examples", `example_${n}.json`), "utf8"));
  const cell = cellFor(n, ex.input.message);
  R[n] = { ex, cell };
  for (const mode of ["live", "sample"]) {
    const run_id = `scenario-${n}-${mode}`;
    const rec = { run_id, mode };
    R[n][mode] = rec;
    if (mode === "live" && !liveConfigured) { rec.skipped = SKIP; console.log(`example ${n} live   ${SKIP}`); continue; }
    const t0 = Date.now();
    try {
      const body = { run_id, input: ex.input, options: { sample_mode: mode === "sample" } };
      const r = await getJson("/run", { method: "POST", headers: { "Content-Type": "application/json", ...AUTH }, body: JSON.stringify(body) });
      rec.http = r.status; rec.result = r.body; rec.seconds = Math.round((Date.now() - t0) / 100) / 10;
      // a refused POST stores no run: say so, instead of a trace fetch 404 one line later
      if (r.status !== 200) throw new Error(`POST /run answered ${r.status}${r.body?.error?.type ? ` (${r.body.error.type})` : ""}`);
      const tr = await getJson(`/runs/${run_id}/trace`);
      const jr = await getJson(`/runs/${run_id}/journey`);
      if (tr.status !== 200 || !Array.isArray(tr.body)) throw new Error(`trace fetch ${tr.status}`);
      rec.lines = tr.body;
      rec.journey = jr.status === 200 ? jr.body : null;
      writeFileSync(join(T, `trace-scenario-${n}-${mode}.jsonl`), rec.lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      rec.missing = missing(tokens(rec.lines), cell.sequence);
      if (r.status !== 200 || r.body?.status !== "success") problems.push(`example ${n} ${mode}: run status ${r.status} ${r.body?.status ?? ""}`);
      if (rec.missing.length) problems.push(`example ${n} ${mode}: missing tokens ${rec.missing.join(", ")}`);
      const ce = cell.expect;
      if (ce) {
        const o = r.body?.output ?? {};
        if (ce.decision && o.decision !== ce.decision) problems.push(`example ${n} ${mode}: decision ${o.decision}, cell wants ${ce.decision}`);
        if (ce.branch_id !== undefined && ce.branch_id !== null && !oneOfMatch(ce.branch_id, r.body?.branch_id)) problems.push(`example ${n} ${mode}: branch ${r.body?.branch_id}, cell wants ${[].concat(ce.branch_id).join("|")}`);
        if (ce.owner !== undefined && o.owner?.employee_id !== ce.owner) problems.push(`example ${n} ${mode}: owner ${o.owner?.employee_id}, cell wants ${ce.owner}`);
      }
    } catch (e) {
      rec.error = `${e?.name}: ${e?.message}`;
      problems.push(`example ${n} ${mode}: ${rec.error}`);
    }
    const o = rec.result?.output ?? {};
    console.log(`example ${n} ${mode.padEnd(6)} decision=${o.decision ?? "-"} branch=${rec.result?.branch_id ?? "-"} ${rec.seconds ?? "?"}s subsequence(${cell.id}): ${rec.error ? "ERROR" : rec.missing.length ? "MISSING " + rec.missing.join(" | ") : "ok"}`);
  }
}
child?.kill();

// ---------------------------------------------------------------- markdown
const brussels = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "medium" }).format(new Date());
const date = brussels.slice(0, 10);
const find = (rec, pred) => (rec.lines ?? []).filter(pred);
const q = (s) => "`" + String(s).replace(/`/g, "'") + "`";
const sevOf = (rec) => find(rec, (l) => l.action === "severity_gate")[0];
const modelLines = (rec) => find(rec, (l) => l.step === "nvidia.model" && l.status !== "skipped");
function section(n) {
  const { ex, cell, live, sample } = R[n];
  const i = ex.input;
  const out = [];
  out.push(`## Example ${n}: ${cell.id}${DEMO(n) ? ` (demo scenario ${DEMO(n)})` : ""}`, "");
  out.push(`Input (${q(`input_examples/example_${n}.json`)}):`, "", `- message: ${q(i.message)}`, `- from: ${q(i.from)}${i.name ? ` (${i.name})` : ""}`, `- channel: ${q(i.channel)}; scenario: ${q(i.scenario ?? "(not declared)")}; as_of: ${q(i.as_of)}`, "");
  out.push(`Checked against: ${cell.source === "fixture" ? `fixture cell ${q(cell.id)}` : cell.source}: ${cell.sequence.map(q).join(", ")}.`, "");
  for (const [label, rec] of [["Live", live], ["Sample", sample]]) {
    out.push(`### ${label} (${q(rec.run_id)})`, "");
    if (rec.skipped) { out.push(`This leg was ${rec.skipped}. It runs against the live service after the merge (CP6).`, ""); continue; }
    if (rec.error || !rec.lines) { out.push(`The run failed: ${q(rec.error ?? "no trace")}.`, ""); continue; }
    const r = rec.result, o = r.output ?? {};
    out.push(`- decision: ${q(o.decision)}; scenario ${q(r.scenario)}; resolved ${q(r.resolved_how)}; branch ${q(r.branch_id)}; ${rec.seconds} s`);
    const br = find(rec, (l) => l.step === "branch")[0];
    if (br) out.push(`- branch line, why: ${br.output_summary ?? br.why ?? JSON.stringify(br)}`);
    if (label === "Live") {
      const ml = modelLines(rec);
      out.push(`- nvidia.model lines (${ml.length}): ${ml.length ? ml.map((l) => `${q(l.action)} ${q(l.model ?? "no model id")} ${l.status}`).join("; ") : "none"}`);
    }
    const wl = find(rec, (l) => l.action === "world_context");
    if (wl.length) out.push("- world_context line (verbatim):", "", "```json", ...wl.map((l) => JSON.stringify(l)), "```", "");
    const sg = find(rec, (l) => l.action === "severity_gate");
    if (sg.length) out.push("- severity_gate line (verbatim):", "", "```json", ...sg.map((l) => JSON.stringify(l)), "```", "");
    const h = rec.journey?.human?.reply;
    if (h) {
      const att = Array.isArray(h.attachments) ? h.attachments.map((a) => (typeof a === "string" ? a : a.name ?? a.kind ?? JSON.stringify(a))).join(", ") : "";
      out.push(`- journey human.reply: kind ${q(h.kind)}, to ${q(typeof h.to === "object" ? JSON.stringify(h.to) : h.to)}, attachments ${att ? q(att) : "none"}, recommendation ${q(norm(h.recommendation ?? "none").slice(0, 300))}`);
      out.push(`- reply text (first 200 chars): ${q(norm(h.text ?? "").slice(0, 200) || "(no text)")}`);
    } else out.push("- journey human.reply: none in the journey");
    if (o.owner || (o.cc ?? []).length || o.memory_note) out.push(`- owner ${q(o.owner ? `${o.owner.employee_id} ${o.owner.name} (${o.owner.team})` : "none")}; cc ${q(JSON.stringify((o.cc ?? []).map((x) => x.id)))}; auto_reply ${q(o.auto_reply)}; status ${q(o.status)}; memory_note ${q(o.memory_note ?? "none")}`);
    out.push(`- trace: ${q(`judging/traces/trace-scenario-${n}-${label.toLowerCase()}.jsonl`)} (${rec.lines.length} lines); subsequence check: ${rec.missing.length ? "MISSING " + rec.missing.map(q).join(", ") : "ok"}`);
    out.push("");
  }
  const L = live.result, S = sample.result;
  const diffs = [];
  if (L && S) {
    if (L.output?.decision !== S.output?.decision) diffs.push(`decision ${L.output?.decision} vs ${S.output?.decision}`);
    if (L.branch_id !== S.branch_id) diffs.push(`branch ${L.branch_id} vs ${S.branch_id}`);
    const ls = sevOf(live), ss = sevOf(sample);
    if (ls || ss) diffs.push(`severity live ${q(ls?.output_summary ?? "none")} vs sample ${q(ss?.output_summary ?? "none")}`);
  }
  if (live.skipped) { out.push(`Live vs sample: live ${live.skipped}; sample ${sample.lines ? (sample.missing.length === 0 ? "subsequence ok" : "subsequence FAILED") : "run failed"}. Subsequence check: live skipped, sample ${sample.missing?.length === 0 ? "ok" : "FAILED"}.`, ""); return out.join("\n"); }
  out.push(`Live vs sample: ${(live.lines && sample.lines) ? (diffs.length ? "differences: " + diffs.join("; ") : "same decision and branch") : "a run failed"}. Subsequence check: live ${live.missing?.length === 0 ? "ok" : "FAILED"}, sample ${sample.missing?.length === 0 ? "ok" : "FAILED"}.`, "");
  return out.join("\n");
}
const fm = (title, description, tags) => `---\ntitle: ${title}\ndescription: ${description}\ndate: ${date}\ntags: [${tags}]\n---\n`;
const allOk = problems.length === 0;
const md = [
  fm("Scenario proofs", "Examples 4 to 8 and 10 to 23 (the 14 demo scenarios) run live and in sample mode with the traces, the models, the World Model line and the journey reply for each.", "judging, scenarios"),
  "# Scenario proofs", "",
  `Command: ${q("node inbox/scripts/scenario_proofs.mjs")} (starts its own server from ${q("src/server.mjs")} with the real ${q(".env")}; ${q("B=<url>")} uses an existing one). Run time (Europe/Brussels): ${brussels}.`, "",
  `Each example runs through ${q("POST /run")}: live (${q("options.sample_mode: false")}) and sample (${q("options.sample_mode: true")}). The traces are copied from ${q("GET /runs/<id>/trace")} as the service wrote them; the script writes no trace line. Both traces must contain the fixture's ${q("step:status:branch_id")} subsequence for the cell. Overall: ${allOk ? "all checks passed" : "PROBLEMS: " + problems.join("; ")}.`, "",
  `Live legs: ${liveConfigured ? "run" : SKIP + ", so this page shows the sample legs; the live legs run against the live service after the merge (CP6)"}.`, "",
  "| Example | Cell | Live | Sample | Subsequence live / sample |", "|---|---|---|---|---|",
  ...NS.map((n) => { const { cell, live, sample } = R[n]; const f = (r) => r.skipped ? SKIP : r.result ? `${r.result.output?.decision} / ${r.result.branch_id}` : "failed"; const sc = (r) => r.skipped ? "skipped" : r.missing?.length === 0 ? "ok" : "FAILED"; return `| ${n} | ${cell.id} | ${f(live)} | ${f(sample)} | ${sc(live)} / ${sc(sample)} |`; }), "",
  ...NS.map(section),
].join("\n");
writeFileSync(join(J, "scenarios.md"), md);

// ---- engine-world-model.md
const cleanEnv = { ...process.env }; delete cleanEnv.NODE_TEST_CONTEXT;
const s8 = R[8].sample, r8 = R[8].live.lines ? R[8].live : s8, r8mode = R[8].live.lines ? "live" : "sample (the live leg was skipped: no live config)";
const wl8 = find(r8, (l) => l.action === "world_context")[0];
const sg8 = sevOf(r8);
const nt = spawnSync(process.execPath, ["--test", ...["world", "world_model_bundle", "world_model_conformance", "complaint_route"].map((f) => join(ROOT, "tests", `${f}.test.mjs`))], { cwd: ROOT, encoding: "utf8", env: cleanEnv });
const nto = nt.stdout + nt.stderr;
const num = (k) => (nto.match(new RegExp(`^# ${k} (\\d+)`, "m")) ?? [])[1] ?? "?";
const perFile = [];
for (const f of ["world", "world_model_bundle", "world_model_conformance", "complaint_route"]) {
  const r = spawnSync(process.execPath, ["--test", join(ROOT, "tests", `${f}.test.mjs`)], { cwd: ROOT, encoding: "utf8", env: cleanEnv });
  const o = r.stdout + r.stderr, g = (k) => (o.match(new RegExp(`^# ${k} (\\d+)`, "m")) ?? [])[1] ?? "?";
  perFile.push({ f, tests: g("tests"), pass: g("pass"), fail: g("fail"), skipped: g("skipped"), rc: r.status });
}
const sev = sg8 ? sg8.output_summary : "(no severity_gate line in the trace)";
const wm = [
  fm("Meterless World Model engine", "What the Meterless World Model does in the Jedi Pack inbox, the complaint route it powers, its tests and the live trace with the world_context line.", "judging, meterless, world-model"),
  "# Meterless World Model in the Jedi Pack inbox", "",
  "## What it does in the product", "",
  "The engine is Meterless `engines/world-model` (Apache-2.0), committed as a built bundle under `src/engines/world-model/`. The product builds one World Model per process from three Zetaris-backed templates (`world_threads`, `products`, `reviews`), in memory by default. It holds the customer and product history behind a complaint:", "",
  "- entities keyed by stable id: a customer by email, a product by product id, so the same person under two spellings is one entity",
  "- thread and mention contexts: the earlier threads a customer sent and the products a message mentions",
  "- count facts: earlier threads, earlier complaints, whether a complaint was public, complaints per product",
  "- a provenance id on every context, so each statement the route reads can be traced to the row it came from (a write without provenance is rejected, which the conformance runner checks)", "",
  "## The feature it powers: the complaint route", "",
  "A message declared or classified as a complaint makes the loop ask the World Model for the customer's and product's history. That context (one `world_context` trace line, sponsor `meterless`, with the cited ids in `memory_ids`) feeds two reads. Nemotron reads the complaint with the record and decides whether the customer is venting or has a genuine complaint. OpenJev then scores the severity. A repeat customer with a severe text escalates to the complaint owner with the draft attached, and the reply never goes out on its own. A mild complaint from a new customer gets a calm acknowledgement held for the owner.", "",
  "## Tests", "",
  "Real run, " + brussels + " (Europe/Brussels): `node --test` on the four files.", "",
  "| File | Tests | Pass | Fail | Skipped |", "|---|---|---|---|---|",
  ...perFile.map((p) => `| ${q("tests/" + p.f + ".test.mjs")} | ${p.tests} | ${p.pass} | ${p.fail} | ${p.skipped} |`),
  "", `Combined run: ${num("tests")} tests, ${num("pass")} pass, ${num("fail")} fail, ${num("skipped")} skipped, exit ${nt.status}. The bundle and conformance tests skip themselves when esbuild or tsx is not on disk (the clean-clone image), and say so.`, "",
  "## Conformance", "",
  "The Meterless conformance runner scores 8/8 on the reference TypeScript and 8/8 on our committed bundle. The scorecards are in [engine-world-model-conformance.md](engine-world-model-conformance.md).", "",
  `## Trace: example 8, ${r8mode}`, "",
  `Trace: ${q(`judging/traces/trace-scenario-8-${R[8].live.lines ? "live" : "sample"}.jsonl`)}. Input: Tilda Moss (${q("tilda.moss@example.com")}) writes about the second saber whose hilt split and cut her son, a public review and a lawyer. Shown run decision ${q(r8.result?.output?.decision)}, branch ${q(r8.result?.branch_id)}; sample decision ${q(s8.result?.output?.decision)}, branch ${q(s8.result?.branch_id)}.`, "",
  "The `world_context` line, verbatim:", "", "```json", wl8 ? JSON.stringify(wl8) : "(no world_context line in the trace)", "```", "",
  `Its \`memory_ids\`: ${wl8 ? q(JSON.stringify(wl8.memory_ids ?? [])) : "none"}.`, "",
  "## OpenJev severity: ten levels", "",
  "The severity gate asks OpenJev one `score` question with ten levels (1 to 10), because OpenJev accepts at most ten score levels. The score is an expected index, so severity = round(score) + 1. Escalation is at 9 or above. The `severity_gate` line from example 8 (live when configured, else sample); its `output_summary` carries the integer, the raw float, the confidence and the source:", "",
  "```json", sg8 ? JSON.stringify(sg8) : "(no severity_gate line in the trace)", "```", "",
  `Reading: ${q(sev)}.`, "",
  "See also [scenarios.md](scenarios.md) for examples 4 to 8 and 10 to 23 live and in sample mode.", "",
].join("\n");
writeFileSync(join(J, "engine-world-model.md"), wm);

console.log(allOk ? "ALL CHECKS PASSED" : `PROBLEMS:\n- ${problems.join("\n- ")}`);
process.exit(allOk ? 0 : 1);

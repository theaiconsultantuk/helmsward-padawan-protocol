#!/usr/bin/env node
// Task S2.4: the scenario proofs. Runs input_examples/example_4..8 twice each (live, then sample) against the real service,
// copies each run's trace to judging/traces/trace-scenario-<n>-<live|sample>.jsonl (the service wrote the lines; this script only copies them),
// asserts both traces carry the fixture's step:status:branch_id subsequence for the cell, and writes judging/scenarios.md and judging/engine-world-model.md.
// B=<url> uses an existing server instead of starting one. Exit 1 (after writing everything) if any subsequence check fails or a run fails.
import { spawn, spawnSync } from "node:child_process";
import { createServer as netServer } from "node:net";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "../src/envfile.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const J = join(ROOT, "judging"), T = join(J, "traces");
const NS = [4, 5, 6, 7, 8];
const CELL = { 4: "question-hit", 5: "question-unanswered", 6: "rfq-no-product", 7: "complaint-vent", 8: "complaint-severe" };
const TIMEOUT_MS = 15 * 60 * 1000;
mkdirSync(T, { recursive: true });

const fixture = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "scenario_shapes.json"), "utf8"));
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
function cellFor(n, message) {
  const byId = fixture.cells.find((c) => c.id === CELL[n]);
  const byMsg = fixture.cells.find((c) => c.input?.message && norm(c.input.message) === norm(message));
  const c = byId ?? byMsg;
  if (c) return { source: "fixture", id: c.id, sequence: c.sequence, branch: c.expect?.branch_id };
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
let child = null, base = process.env.B?.replace(/\/$/, "") ?? null;
if (!base) {
  for (const n of NS) for (const m of ["live", "sample"]) rmSync(join(ROOT, "logs", `trace-scenario-${n}-${m}.jsonl`), { force: true }); // the service appends
  const port = await freePort();
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs")], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  base = `http://127.0.0.1:${port}`;
}
process.on("exit", () => { try { child?.kill(); } catch {} });
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
  out.push(`## Example ${n}: ${cell.id}`, "");
  out.push(`Input (${q(`input_examples/example_${n}.json`)}):`, "", `- message: ${q(i.message)}`, `- from: ${q(i.from)}${i.name ? ` (${i.name})` : ""}`, `- channel: ${q(i.channel)}; scenario: ${q(i.scenario ?? "(not declared)")}; as_of: ${q(i.as_of)}`, "");
  out.push(`Checked against: ${cell.source === "fixture" ? `fixture cell ${q(cell.id)}` : cell.source}: ${cell.sequence.map(q).join(", ")}.`, "");
  for (const [label, rec] of [["Live", live], ["Sample", sample]]) {
    out.push(`### ${label} (${q(rec.run_id)})`, "");
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
  out.push(`Live vs sample: ${(live.lines && sample.lines) ? (diffs.length ? "differences: " + diffs.join("; ") : "same decision and branch") : "a run failed"}. Subsequence check: live ${live.missing?.length === 0 ? "ok" : "FAILED"}, sample ${sample.missing?.length === 0 ? "ok" : "FAILED"}.`, "");
  return out.join("\n");
}
const fm = (title, description, tags) => `---\ntitle: ${title}\ndescription: ${description}\ndate: ${date}\ntags: [${tags}]\n---\n`;
const allOk = problems.length === 0;
const md = [
  fm("Scenario proofs", "Examples 4 to 8 run live and in sample mode with the traces, the models, the World Model line and the journey reply for each.", "judging, scenarios"),
  "# Scenario proofs", "",
  `Command: ${q("node inbox/scripts/scenario_proofs.mjs")} (starts its own server from ${q("src/server.mjs")} with the real ${q(".env")}; ${q("B=<url>")} uses an existing one). Run time (Europe/Brussels): ${brussels}.`, "",
  `Each example runs twice through ${q("POST /run")}: live (${q("options.sample_mode: false")}) and sample (${q("options.sample_mode: true")}). The traces are copied from ${q("GET /runs/<id>/trace")} as the service wrote them; the script writes no trace line. Both traces must contain the fixture's ${q("step:status:branch_id")} subsequence for the cell. Overall: ${allOk ? "all checks passed" : "PROBLEMS: " + problems.join("; ")}.`, "",
  "| Example | Cell | Live | Sample | Subsequence live / sample |", "|---|---|---|---|---|",
  ...NS.map((n) => { const { cell, live, sample } = R[n]; const f = (r) => r.result ? `${r.result.output?.decision} / ${r.result.branch_id}` : "failed"; return `| ${n} | ${cell.id} | ${f(live)} | ${f(sample)} | ${live.missing?.length === 0 ? "ok" : "FAILED"} / ${sample.missing?.length === 0 ? "ok" : "FAILED"} |`; }), "",
  ...NS.map(section),
].join("\n");
writeFileSync(join(J, "scenarios.md"), md);

// ---- engine-world-model.md
const cleanEnv = { ...process.env }; delete cleanEnv.NODE_TEST_CONTEXT;
const r8 = R[8].live, s8 = R[8].sample;
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
const sev = sg8 ? sg8.output_summary : "(no severity_gate line in the live trace)";
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
  "## Live trace: example 8", "",
  `Trace: ${q("judging/traces/trace-scenario-8-live.jsonl")}. Input: Tilda Moss (${q("tilda.moss@example.com")}) writes about the second saber whose hilt split and cut her son, a public review and a lawyer. Live decision ${q(r8.result?.output?.decision)}, branch ${q(r8.result?.branch_id)}; sample decision ${q(s8.result?.output?.decision)}, branch ${q(s8.result?.branch_id)}.`, "",
  "The `world_context` line, verbatim:", "", "```json", wl8 ? JSON.stringify(wl8) : "(no world_context line in the live trace)", "```", "",
  `Its \`memory_ids\`: ${wl8 ? q(JSON.stringify(wl8.memory_ids ?? [])) : "none"}.`, "",
  "## OpenJev severity: ten levels", "",
  "The live severity gate asks OpenJev one `score` question with ten levels (1 to 10), because OpenJev accepts at most ten score levels. The score is an expected index, so severity = round(score) + 1. Escalation is at 9 or above. The live `severity_gate` line from example 8; its `output_summary` carries the integer, the raw float, the confidence and the source:", "",
  "```json", sg8 ? JSON.stringify(sg8) : "(no severity_gate line in the live trace)", "```", "",
  `Reading: ${q(sev)}.`, "",
  "See also [scenarios.md](scenarios.md) for all five examples live and in sample mode.", "",
].join("\n");
writeFileSync(join(J, "engine-world-model.md"), wm);

console.log(allOk ? "ALL CHECKS PASSED" : `PROBLEMS:\n- ${problems.join("\n- ")}`);
process.exit(allOk ? 0 : 1);

// P13 free-text probe: posts each case in tests/fixtures/freetext_cases.json twice through POST /run (live, then sample_mode true)
// and prints a markdown table. B = base URL (default https://jedi.blastworks.ai). The bearer token is read from the env file
// (PROBE_ENV, default the live clone's inbox/.env) via envfile.mjs, used only in the Authorization header, never printed or logged.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseEnvFile } from "../src/envfile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const B = (process.env.B || "https://jedi.blastworks.ai").replace(/\/$/, "");
const ENV_FILE = process.env.PROBE_ENV || "/opt/glitch/_local/hackathon/live/inbox/.env";
const OUT_DIR = process.env.PROBE_OUT || "/tmp/claude-1053";
const RUN_MS = Number(process.env.PROBE_RUN_MS || 150000), TOTAL_MS = Number(process.env.PROBE_TOTAL_MS || 20 * 60000);
const cases = JSON.parse(readFileSync(join(here, "../tests/fixtures/freetext_cases.json"), "utf8")).cases;
const token = parseEnvFile(readFileSync(ENV_FILE, "utf8")).API_TOKEN || "";
const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
const t0 = Date.now(), stamp = t0.toString(36);
const runIds = [], raw = [];

async function getJson(path) {
  const r = await fetch(B + path, { signal: AbortSignal.timeout(20000) });
  return r.ok ? r.json() : null;
}
// the trace's `branch` line reads "category <c>, amount <n|none> | ..." (the facts the planner branched on)
const branchLine = (trace) => {
  const lines = Array.isArray(trace) ? trace : trace?.lines ?? [];
  return lines.find((l) => l.step === "branch")?.input_summary ?? "";
};
const amountOf = (res, trace) => (/amount ([0-9.]+)/.exec(branchLine(trace)) || [])[1] ?? "none";
const catOf = (res, trace) => (/category ([a-z_]+)/.exec(branchLine(trace)) || [])[1] ?? res.scenario ?? "?";
async function post(c, sample, n) {
  const run_id = `probe-${c.id.toLowerCase()}-${sample ? "s" : "l"}${n}-${stamp}`;
  runIds.push(run_id);
  const body = { run_id, input: { message: c.message, from: c.from, name: c.name, subject: c.subject, channel: c.channel }, options: { sample_mode: sample } };
  try {
    const r = await fetch(B + "/run", { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(RUN_MS) });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 200 || j.status !== "success") return { run_id, err: `${r.status} ${j.error?.type ?? j.status ?? ""} ${String(j.error?.message ?? "").slice(0, 80)}`.trim() };
    const trace = await getJson(`/runs/${run_id}/trace`).catch(() => null);
    raw.push({ run_id, response: j, trace }); // responses carry no token
    return { run_id, cat: catOf(j, trace), branch: j.branch_id ?? "-", decision: j.output?.decision ?? "-", amount: amountOf(j, trace), secs: j.execution_time_seconds };
  } catch (e) {
    return { run_id, err: e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : `error ${e?.name}` };
  }
}
const cell = (x) => (x.err ? `${x.err}` : `${x.cat} / ${x.branch} / ${x.decision} / ${x.amount}`);
const rows = [];
const replay = process.env.PROBE_REPLAY ? JSON.parse(readFileSync(process.env.PROBE_REPLAY, "utf8")) : null; // re-render a saved .raw.json, no posts
const fromRaw = (id) => { const x = replay.find((r) => r.run_id === id); return x ? { run_id: id, cat: catOf(x.response, x.trace), branch: x.response.branch_id ?? "-", decision: x.response.output?.decision ?? "-", amount: amountOf(x.response, x.trace) } : { run_id: id, err: "missing" }; };
for (const c of cases) {
  if (replay) {
    const out = { c, live: [], sample: [] };
    for (const [k, t] of [["live", "l"], ["sample", "s"]]) for (let n = 1; n <= (c.repeat || 1); n++) { const id = `probe-${c.id.toLowerCase()}-${t}${n}-${process.env.PROBE_STAMP}`; runIds.push(id); out[k].push(fromRaw(id)); }
    rows.push(out);
    continue;
  }
  const out = { c, live: null, sample: null };
  for (const sample of [false, true]) {
    const results = [];
    for (let n = 1; n <= (c.repeat || 1); n++) {
      if (Date.now() - t0 > TOTAL_MS) { results.push({ run_id: "-", err: "timeout" }); continue; }
      results.push(await post(c, sample, n));
    }
    out[sample ? "sample" : "live"] = results;
  }
  rows.push(out);
}
const show = (rs) => rs.map(cell).join(" ; then ");
const sig = (rs) => rs.map((x) => (x.err ? x.err : `${x.cat}|${x.branch}|${x.decision}|${x.amount}`)).join(";");
const lines = ["| case | live category / branch / decision / amount | sample category / branch / decision / amount | same? |", "|---|---|---|---|"];
for (const r of rows) lines.push(`| ${r.c.id} ${r.c.what.split(":")[0]} | ${show(r.live)} | ${show(r.sample)} | ${sig(r.live) === sig(r.sample) ? "yes" : "no"} |`);
const table = lines.join("\n");
mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, `freetext_probe_${stamp}.md`);
writeFileSync(file, `${table}\n\nruns: ${runIds.join(", ")}\n`);
if (!replay) writeFileSync(file.replace(/\.md$/, ".raw.json"), JSON.stringify(raw, null, 1));
console.log(table);
console.log(`\nrun ids: ${runIds.join(", ")}\ntable saved: ${file}`);

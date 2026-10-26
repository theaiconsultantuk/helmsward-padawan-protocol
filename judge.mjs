#!/usr/bin/env node
// Judge's check for the Jedi Pack inbox: one command from a clean clone, no keys, no install, no network.
//   node judge.mjs            run the checks, then keep the app open on http://127.0.0.1:8000 until Ctrl+C
//   node judge.mjs --check    run the checks and exit (0 = all passed)
//   node judge.mjs --tests    also run the unit suite (npm ci + npm test; npm needs the internet once)
//   node judge.mjs --docker   also build the Docker image and run one example inside it with no network
//   node judge.mjs --port 8123   open the app on another port (default: 8000, or the next free one)
// Runs on Windows, macOS and Linux with Node 22+ alone. The checks run on throwaway temp folders and delete them, so they
// repeat cleanly; only the app left open for you writes to inbox/data/runtime/, inbox/data/memory/ and inbox/logs/ (all gitignored).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ORIG_ENV = { ...process.env }; // children get the judge's own environment, not the no-network guard set below
const ROOT = dirname(fileURLToPath(import.meta.url));
const INBOX = join(ROOT, "inbox");
const usage = (code, why) => {
  if (why) console.log(`judge.mjs: ${why}\n`);
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(code);
};
const flags = new Set();
let portArg = null;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--help" || a === "-h") usage(0);
  else if (a === "--port") {
    if (portArg !== null) usage(2, "--port given twice");
    const v = process.argv[++i];
    if (!/^\d+$/.test(v ?? "") || Number(v) < 1 || Number(v) > 65535) usage(2, `--port needs a number from 1 to 65535, got ${v ?? "nothing"}`);
    portArg = Number(v);
  } else if (["--check", "--tests", "--docker"].includes(a)) flags.add(a);
  else usage(2, `unknown option ${a}`);
}
const flag = (f) => flags.has(f);

const results = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
};
const section = (t) => console.log(`\n== ${t}`);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---- 1. preconditions ----------------------------------------------------------------------------
section("1/6 Preconditions");
const major = Number(process.versions.node.split(".")[0]);
record("Node 22 or newer", major >= 22, `node ${process.versions.node}`);
if (major < 22) { console.log("Install Node 22+ from https://nodejs.org and run again."); process.exit(1); }
const appHere = existsSync(join(INBOX, "src", "server.mjs"));
record("the inbox/ app is here", appHere, INBOX);
if (!appHere) process.exit(1);
const git = spawnSync("git", ["-C", ROOT, "log", "-1", "--format=%h %cs %s"], { encoding: "utf8" });
console.log(`      commit: ${git.status === 0 ? git.stdout.trim() : "(git not available)"}`);
console.log(`      inbox/.env: ${existsSync(join(INBOX, ".env")) ? "present: its other settings are read, but sample mode, no network and no API token are forced here" : "absent, as in a clean clone"}`);

// The repo's own sample harness: sets SAMPLE_MODE=true and NO_NETWORK=1 (every fetch rejects) before the app loads,
// and serves it in-process on fresh temp folders. scripts/heldout_run.mjs uses the same one.
// A set environment variable wins over inbox/.env, so an empty API_TOKEN keeps a token in .env from locking the harness's POSTs.
process.env.API_TOKEN = "";
const { sampleServer, httpJson } = await import("./inbox/scripts/ledger_learning.mjs");
const { runHeldout } = await import("./inbox/scripts/heldout_run.mjs");

// ---- 2. the shipped examples ---------------------------------------------------------------------
section("2/6 Every shipped input example gives its expected decision (sample mode, network blocked)");
const s = await sampleServer("jedi-judge-");
const health = (await httpJson(s.base, "/health")).data;
record("GET /health answers in sample mode", health?.ok === true && health?.sample_mode === true, `version ${health?.version}`);
const ids = (dir) => readdirSync(join(INBOX, dir)).map((f) => /^example_(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
const nums = ids("input_examples");
const outs = ids("output_examples");
const MIN_EXAMPLES = 23; // what the submission ships; a missing file must fail, not shrink the check
const complete = nums.length >= MIN_EXAMPLES && nums.every((n, i) => n === i + 1) && outs.join() === nums.join();
record(`input_examples/ and output_examples/ both hold examples 1 to ${nums.length}`, complete, complete ? "" : `inputs [${nums.join(",")}], outputs [${outs.join(",")}]`);
let matched = 0;
const runIds = {};
for (const n of nums) {
  const body = readJson(join(INBOX, "input_examples", `example_${n}.json`));
  const want = readJson(join(INBOX, "output_examples", `example_${n}.json`)).output.decision;
  body.options = { ...(body.options || {}), sample_mode: true };
  let got;
  try { const r = await httpJson(s.base, "/run", body); got = r.data?.output?.decision ?? `HTTP ${r.code}`; runIds[n] = r.data?.run_id; }
  catch (e) { got = e.message; }
  if (got === want) matched++;
  const what = body.input.thread_id ? `thread ${body.input.thread_id}` : `"${String(body.input.message).slice(0, 50)}…"`;
  console.log(`      ${got === want ? "ok  " : "FAIL"} example ${String(n).padStart(2)}  ${String(got).padEnd(8)} expected ${want.padEnd(8)}  ${what}`);
}
record(`${matched} of ${nums.length} examples match inbox/output_examples/`, matched === nums.length);

// ---- 3. one trace --------------------------------------------------------------------------------
section("3/6 One trace: example 3 (thread T01, the misread that escalates)");
const t = runIds[3] ? await httpJson(s.base, `/runs/${runIds[3]}/trace`) : { data: null };
const lines = Array.isArray(t.data) ? t.data : [];
for (const l of lines) console.log(`      ${String(l.step).padEnd(21)} ${String(l.status).padEnd(15)} ${String(l.output_summary ?? "").slice(0, 62)}`);
// Every step the loop does not reach is still logged as "skipped", so a name alone proves nothing: check what each step did.
const has = (step, status, action) => lines.some((l) => l.step === step && l.status === status && (!action || l.action === action));
const expect = [
  ["H-MEM read", has("memory.read", "success")],
  ["Zetaris read the thread", has("zetaris.query", "success", "sql:thread")],
  ["Scout verified a contract", has("meterless.engine", "success", "decide_contract")],
  ["the critique failed the draft", has("critique", "needs_revision")],
  ["Risk refused it", has("risk.signoff", "refused")],
  ["it escalated to a human", has("escalate_or_fallback", "success", "queue_for_human")],
  ["H-MEM write", has("memory.write", "success")],
  ["the synthesis closed the trace", has("synthesis", "success")],
];
const notDone = expect.filter(([, ok]) => !ok).map(([what]) => what);
record("the trace shows each step doing its work", lines.length > 0 && notDone.length === 0, notDone.length ? `not seen: ${notDone.join("; ")}` : expect.map(([w]) => w).join(" → "));
await s.close();

// ---- 4. the held-out set -------------------------------------------------------------------------
section("4/6 Held-out set: 20 messages the rules were never tuned on (8 adversarial)");
const ho = await runHeldout({ prefix: "judge-heldout" });
const committed = /pass (\d+) \/ (\d+)/.exec(readFileSync(join(INBOX, "judging", "heldout", "results-sample-mode.txt"), "utf8"));
console.log(`      ${ho.passed} of ${ho.total} match; the committed result (README, judging/heldout/results-sample-mode.txt) says ${committed ? `${committed[1]} of ${committed[2]}` : "?"}`);
for (const r of ho.rows.filter((x) => !x.pass)) console.log(`      miss ${r.id} ${r.tag}: got ${r.got}, labelled ${r.want.join("/")}`);
record("the held-out score reproduces the committed one", !!committed && ho.passed === Number(committed[1]) && ho.total === Number(committed[2]));

// ---- 5. optional: tests and Docker ---------------------------------------------------------------
section("5/6 Optional checks");
const win = process.platform === "win32";
const sh = (cmd, a) => spawnSync(cmd, a, { cwd: INBOX, stdio: "inherit", shell: win, env: ORIG_ENV });
if (flag("--tests")) {
  const installed = existsSync(join(INBOX, "node_modules"));
  if (!installed) console.log("      npm ci (dev tools only: tsx, yaml, esbuild; the app itself has no dependencies) …");
  else console.log("      inbox/node_modules is there already: npm ci skipped");
  if (!installed && sh("npm", ["ci", "--no-audit", "--no-fund"]).status !== 0) record("npm ci", false, "it needs the npm registry once");
  else {
    console.log("      npm test (the live Zetaris tests skip without a Zetaris key, and say so) …");
    record("npm test", sh("npm", ["test"]).status === 0);
  }
} else console.log("      unit suite skipped: add --tests to run npm ci + npm test");
if (flag("--docker")) {
  const tag = "jedi-pack-inbox-judge";
  if (sh("docker", ["build", "-q", "-t", tag, "."]).status !== 0) record("docker build", false, "is Docker running?");
  else {
    record("docker build (node:22-slim, no npm step)", true);
    const r = spawnSync("docker", ["run", "--rm", "--network", "none", "-e", "SAMPLE_MODE=true", tag, "node", "src/cli.mjs", "run", "--example", "3"], { encoding: "utf8", shell: win, env: ORIG_ENV });
    let out = null; try { out = JSON.parse(r.stdout); } catch {}
    const ran = !r.error && r.signal === null && r.status === 0 && out?.status === "success";
    record("example 3 inside the container with --network none", ran && out.output?.decision === "escalate",
      ran ? `decision ${out.output?.decision}` : `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}, status ${out?.status ?? "none"}${r.error ? `, ${r.error.message}` : ""}`);
  }
} else console.log("      Docker skipped: add --docker to build the image and run example 3 with no network");

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? `FAILED ${failed.length} of ${results.length} checks: ${failed.map((f) => f.name).join("; ")}` : `ALL ${results.length} CHECKS PASSED`}`);
if (flag("--check")) process.exit(failed.length ? 1 : 0);

// ---- 6. leave the app open -----------------------------------------------------------------------
section("6/6 Open the app (sample mode, network blocked)");
const free = (p) => new Promise((ok) => { const v = createServer().once("error", () => ok(false)).once("listening", () => v.close(() => ok(true))); v.listen(p, "127.0.0.1"); });
let port = portArg ?? 8000;
if (!portArg) { while (!(await free(port)) && port < 8050) port++; }
if (!(await free(port))) { console.log(`port ${port} is taken; pick another with --port <n>`); process.exit(1); }
const BASE = `http://127.0.0.1:${port}`;
mkdirSync(join(INBOX, "data", "runtime"), { recursive: true });
const logPath = join(INBOX, "data", "runtime", "judge-server.log");
const logFd = openSync(logPath, "w");
const app = spawn(process.execPath, ["src/server.mjs"], {
  cwd: INBOX,
  env: { ...ORIG_ENV, SAMPLE_MODE: "true", NO_NETWORK: "1", HOST: "127.0.0.1", PORT: String(port), API_TOKEN: "" },
  stdio: ["ignore", logFd, logFd],
});
let stopping = false;
const stop = (code) => { stopping = true; try { app.kill(); } catch {} process.exit(code); };
process.on("SIGINT", () => { console.log("\nstopped."); stop(0); });
process.on("SIGTERM", () => stop(0));
app.on("exit", (c) => { if (!stopping) { console.log(`the app stopped (exit ${c}); read ${logPath}`); process.exit(1); } });
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await httpJson(BASE, "/health")).code === 200; } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) { console.log(`no /health within 15 s; read ${logPath}`); stop(1); }
console.log(`The app is running on ${BASE}. Open:
  ${BASE}/shop/contact.html   the front end: pick a scenario, submit, then open "Under the hood"
  ${BASE}/shop/desk.html      what the staff see: the queue, the team kanban, the sign-off chain
  ${BASE}/dashboard           counters, the escalation queue, affirm and reject
  ${BASE}/runs                the runs you make (then /runs/<run_id>/trace)
The hosted demo, with live models and live Zetaris: https://jedi.blastworks.ai/shop/contact.html (until 7 Nov 2026)
Server log: ${logPath}
Press Ctrl+C to stop.`);

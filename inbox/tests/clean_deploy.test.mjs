// scripts/clean_deploy.sh: sample mode starts the server on a copy of the inbox with no node_modules, --stop ends it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const INBOX = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(INBOX, "scripts", "clean_deploy.sh");
const hasBash = spawnSync("bash", ["-c", "true"]).status === 0;
const hasCurl = spawnSync("curl", ["--version"]).status === 0;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("clean_deploy.sh text: syntax ok, no secret echo, no xtrace, no npm ci", { skip: !hasBash && "bash not available" }, () => {
  for (const f of ["clean_deploy.sh", "zetaris_drop.sh"]) {
    const r = spawnSync("bash", ["-n", join(INBOX, "scripts", f)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  const text = readFileSync(SCRIPT, "utf8");
  assert.ok(!text.includes("echo $ZETARIS"), "echoes a Zetaris value");
  assert.ok(!/set\s+-\w*x/.test(text.replace(/set \+x/g, "")), "set -x present");
  assert.ok(!text.includes("npm ci"), "npm ci present");
  assert.ok(!/\bnpm\b/i.test(text), "the word npm appears in clean_deploy.sh");
  assert.match(text, /scripts\.doctor|\.scripts/, "doctor must come from package.json");
  assert.match(text, /\$\{CLEAN_DEPLOY_EXPECT_MODE/);
  assert.match(text, /--stop first/, "mismatch FAIL line must name the fix");
  assert.match(readFileSync(join(INBOX, "scripts", "zetaris_drop.sh"), "utf8"), /SKIP_RUNTIME/);
});

test("sample mode starts on a node_modules-free copy, /health is 200, --stop ends the process", { skip: (!hasBash && "bash not available") || (!hasCurl && "curl not available") }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "clean-deploy-"));
  const copy = join(tmp, "inbox");
  cpSync(INBOX, copy, {
    recursive: true,
    filter: (src) => !src.split(sep).includes("node_modules") && !src.split(sep).includes("runtime") && !src.endsWith(`${sep}.env`),
  });
  assert.ok(!existsSync(join(copy, "node_modules")), "copy must not hold node_modules");
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  const script = join(copy, "scripts", "clean_deploy.sh");
  let pid = 0;
  try {
    const up = spawnSync("bash", [script], { cwd: tmp, env, encoding: "utf8", timeout: 30000 });
    assert.equal(up.status, 0, up.stdout + up.stderr);
    assert.match(up.stdout, new RegExp(`http://127\\.0\\.0\\.1:${port}/`));
    assert.match(up.stdout, /no key, no network needed/);
    pid = Number(readFileSync(join(copy, "data", "runtime", "clean_deploy.pid"), "utf8").trim());
    assert.ok(alive(pid));
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const stop = spawnSync("bash", [script, "--stop"], { cwd: tmp, env, encoding: "utf8", timeout: 15000 });
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
    assert.ok(!alive(pid), "server process still running after --stop");
    assert.ok(!existsSync(join(copy, "data", "runtime", "clean_deploy.pid")));
  } finally {
    if (pid && alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("second run reuses, stale pid is replaced, mode mismatch fails with the fix", { skip: (!hasBash && "bash not available") || (!hasCurl && "curl not available") }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "clean-deploy-"));
  const copy = join(tmp, "inbox");
  cpSync(INBOX, copy, {
    recursive: true,
    filter: (src) => !src.split(sep).includes("node_modules") && !src.split(sep).includes("runtime") && !src.endsWith(`${sep}.env`),
  });
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  const script = join(copy, "scripts", "clean_deploy.sh");
  const pidf = join(copy, "data", "runtime", "clean_deploy.pid");
  const run = (args, e = env) => spawnSync("bash", [script, ...args], { cwd: tmp, env: e, encoding: "utf8", timeout: 30000 });
  let pid = 0;
  try {
    // stale pid file: process gone -> removed, start proceeds
    spawnSync("mkdir", ["-p", join(copy, "data", "runtime")]);
    const dead = spawnSync("bash", ["-c", "sleep 0 & echo $!"], { encoding: "utf8" }).stdout.trim();
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(pidf, dead + "\n");
    const first = run([]);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    pid = Number(readFileSync(pidf, "utf8").trim());
    assert.notEqual(String(pid), dead);
    assert.ok(alive(pid));
    // second run on the same port reuses
    const second = run([]);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /already running.*ok|ok \(already running/);
    assert.equal(Number(readFileSync(pidf, "utf8").trim()), pid);
    // check-running: right mode ok, wrong mode FAIL naming the fix
    const good = run(["--check-running"]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    const bad = run(["--check-running"], { ...env, CLEAN_DEPLOY_EXPECT_MODE: "live" });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout, /FAIL .*sample mode.*live.*--stop first/);
    // a live pid that answers on no health of ours (other port) fails too
    const other = run(["--check-running"], { ...env, PORT: String(await freePort()) });
    assert.notEqual(other.status, 0);
    assert.match(other.stdout, /FAIL .*does not answer.*--stop first/);
    assert.ok(alive(pid), "mismatch must not kill the server");
    run(["--stop"]);
    assert.ok(!alive(pid));
  } finally {
    if (pid && alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
    rmSync(tmp, { recursive: true, force: true });
  }
});

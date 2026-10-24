// scripts/clean_deploy.sh: sample mode starts the server on a copy of the inbox with no node_modules, --stop ends it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
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

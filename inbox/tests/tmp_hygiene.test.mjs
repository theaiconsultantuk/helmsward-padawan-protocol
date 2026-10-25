// `npm test` leaves nothing behind in the machine's temp folder: the wrapper gives the run one private folder and removes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const INBOX = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a child run through scripts/test.mjs leaves no new entry in its parent temp folder", () => {
  // an isolated "machine temp" so concurrent processes cannot add entries to the listing
  const parent = mkdtempSync(join(tmpdir(), "tmp-hygiene-parent-"));
  const probeDir = mkdtempSync(join(tmpdir(), "tmp-hygiene-probe-"));
  try {
    const probe = join(probeDir, "leaky.test.mjs");
    writeFileSync(probe, [
      'import { test } from "node:test";',
      'import { mkdtempSync } from "node:fs";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      'test("leaks a folder on purpose", () => { mkdtempSync(join(tmpdir(), "leak-")); });',
      "",
    ].join("\n"));
    const before = readdirSync(parent);
    const r = spawnSync(process.execPath, [join(INBOX, "scripts", "test.mjs"), probe], {
      cwd: INBOX,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: parent, TEMP: parent, TMP: parent },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(readdirSync(parent), before, "the wrapper's run folder and the probe's leak are both gone");
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(probeDir, { recursive: true, force: true });
  }
});

test("a failing child keeps its exit code through the wrapper", () => {
  const probeDir = mkdtempSync(join(tmpdir(), "tmp-hygiene-probe-"));
  try {
    const probe = join(probeDir, "red.test.mjs");
    writeFileSync(probe, 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("red", () => assert.equal(1, 2));\n');
    const r = spawnSync(process.execPath, [join(INBOX, "scripts", "test.mjs"), probe], { cwd: INBOX, encoding: "utf8" });
    assert.notEqual(r.status, 0);
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
});

// ---- cleanup failure, cleanup after a failing child, and the child's signal ----
import { chmodSync } from "node:fs";
import { spawn } from "node:child_process";

const probeTest = (dir, name, body) => {
  const f = join(dir, name);
  writeFileSync(f, `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\n${body}\n`);
  return f;
};
const canBlockRemoval = process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;

test("a run folder that cannot be removed is named, and an otherwise passing run exits non-zero", { skip: !canBlockRemoval && "needs a non-root POSIX user to block a removal" }, () => {
  const parent = mkdtempSync(join(tmpdir(), "tmp-hygiene-parent-"));
  const probeDir = mkdtempSync(join(tmpdir(), "tmp-hygiene-probe-"));
  try {
    const probe = probeTest(probeDir, "stuck.test.mjs",
      'test("leaves an undeletable folder", () => { const d = join(tmpdir(), "stuck"); mkdirSync(d); writeFileSync(join(d, "f"), "x"); chmodSync(d, 0o555); });');
    const r = spawnSync(process.execPath, [join(INBOX, "scripts", "test.mjs"), probe], { cwd: INBOX, encoding: "utf8", env: { ...process.env, TMPDIR: parent, TEMP: parent, TMP: parent } });
    assert.notEqual(r.status, 0, "a green child with an unremovable run folder must not exit 0");
    assert.match(r.stderr, /could not remove the run folder .*jedi-test-/);
  } finally {
    for (const d of readdirSync(parent)) { try { chmodSync(join(parent, d, "stuck"), 0o755); } catch { /* none */ } }
    rmSync(parent, { recursive: true, force: true });
    rmSync(probeDir, { recursive: true, force: true });
  }
});

test("a failing child still has its run folder removed", () => {
  const parent = mkdtempSync(join(tmpdir(), "tmp-hygiene-parent-"));
  const probeDir = mkdtempSync(join(tmpdir(), "tmp-hygiene-probe-"));
  try {
    const probe = probeTest(probeDir, "red2.test.mjs", 'test("leaks then fails", () => { mkdtempSync(join(tmpdir(), "leak-")); assert.equal(1, 2); });');
    const r = spawnSync(process.execPath, [join(INBOX, "scripts", "test.mjs"), probe], { cwd: INBOX, encoding: "utf8", env: { ...process.env, TMPDIR: parent, TEMP: parent, TMP: parent } });
    assert.notEqual(r.status, 0);
    assert.deepEqual(readdirSync(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(probeDir, { recursive: true, force: true });
  }
});

test("a signal that ends the child is re-raised on the wrapper, and the run folder is still removed", { skip: process.platform === "win32" && "POSIX signals" }, async () => {
  const parent = mkdtempSync(join(tmpdir(), "tmp-hygiene-parent-"));
  const probeDir = mkdtempSync(join(tmpdir(), "tmp-hygiene-probe-"));
  try {
    const probe = probeTest(probeDir, "killed.test.mjs", 'test("kills itself", () => { mkdtempSync(join(tmpdir(), "leak-")); process.kill(process.pid, "SIGKILL"); });');
    const w = spawn(process.execPath, [join(INBOX, "scripts", "test.mjs"), probe], { cwd: INBOX, stdio: "ignore", env: { ...process.env, TMPDIR: parent, TEMP: parent, TMP: parent } });
    const [code, sig] = await new Promise((res) => w.on("close", (c, s) => res([c, s])));
    // node --test reports the killed file as a failure (non-zero); a signal that reaches the wrapper itself is re-raised as that signal
    assert.ok(code !== 0 || sig, `code ${code} signal ${sig}`);
    assert.deepEqual(readdirSync(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(probeDir, { recursive: true, force: true });
  }
});

test("a child killed by a signal ends the wrapper with that same signal, and the run folder is removed", { skip: process.platform === "win32" && "POSIX signals" }, async () => {
  const parent = mkdtempSync(join(tmpdir(), "tmp-hygiene-parent-"));
  const probeDir = mkdtempSync(join(tmpdir(), "tmp-hygiene-probe-"));
  try {
    const probe = probeTest(probeDir, "slow.test.mjs", 'test("waits", async () => { await new Promise((r) => setTimeout(r, 20000)); });');
    const w = spawn(process.execPath, [join(INBOX, "scripts", "test.mjs"), probe], { cwd: INBOX, stdio: "ignore", env: { ...process.env, TMPDIR: parent, TEMP: parent, TMP: parent } });
    await new Promise((r) => setTimeout(r, 1500));
    const kids = spawnSync("pgrep", ["-P", String(w.pid)], { encoding: "utf8" }).stdout.split(/\s+/).filter(Boolean);
    assert.ok(kids.length >= 1, "the wrapper has a node --test child");
    for (const k of kids) process.kill(Number(k), "SIGKILL");
    const [code, sig] = await new Promise((res) => w.on("close", (c, s) => res([c, s])));
    assert.ok(sig === "SIGKILL" || code === 137, `code ${code} signal ${sig}`);
    assert.deepEqual(readdirSync(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(probeDir, { recursive: true, force: true });
  }
});

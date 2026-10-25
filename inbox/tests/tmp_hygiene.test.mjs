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

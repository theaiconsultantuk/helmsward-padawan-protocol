import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = path.join(root, "node_modules/.bin/tsx");

test("the World Model bundle passes the Meterless conformance runner 8/8", { skip: fs.existsSync(tsx) ? false : "toolchain absent" }, () => {
  const r = spawnSync(tsx, [path.join(root, "engines/world-model/conformance/runner.ts")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WORLD_MODEL_IMPL: path.join(root, "src/engines/world-model/index.mjs") },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /8\/8 checks passed/);
});

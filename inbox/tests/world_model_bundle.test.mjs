import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolchain = fs.existsSync(path.join(root, "node_modules/.bin/esbuild"));

test("the committed World Model bundle equals a fresh build", { skip: toolchain ? false : "toolchain absent" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-bundle-"));
  const out = path.join(dir, "index.mjs");
  try {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/build_world_model.mjs"), out], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const fresh = fs.readFileSync(out);
    const committed = fs.readFileSync(path.join(root, "src/engines/world-model/index.mjs"));
    assert.ok(fresh.equals(committed), "bundle is stale: run npm run build:world-model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

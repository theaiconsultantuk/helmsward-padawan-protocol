// gen_company.py is non-destructive: a full run overwrites only what it generates and merges sources.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const inbox = resolve(here, "..");
const gen = join(inbox, "scripts", "gen_company.py");
const hasUv = spawnSync("uv", ["--version"]).status === 0;
const skip = hasUv ? false : "uv is not installed";

function run(args) {
  return spawnSync("uv", ["run", "--with", "pyarrow", "python", gen, ...args], { encoding: "utf-8", timeout: 240000 });
}

// <root>/data/synthetic + <root>/data/sources.json: the layout the generator expects.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gen-safety-"));
  mkdirData(root);
  return root;
}
function mkdirData(root) {
  cpSync(join(inbox, "data", "synthetic"), join(root, "data", "synthetic"), { recursive: true });
  cpSync(join(inbox, "data", "sources.json"), join(root, "data", "sources.json"));
}
function walk(dir, base = dir, acc = {}) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, acc);
    else acc[p.slice(base.length)] = st.mtimeMs;
  }
  return acc;
}

test("a full run keeps files and manifest entries it does not own", { skip, timeout: 300000 }, () => {
  const root = fixture();
  try {
    const syn = join(root, "data", "synthetic");
    const contactsBefore = readFileSync(join(syn, "contacts.csv"));
    writeFileSync(join(syn, "keep-me.txt"), "sentinel\n");
    const mp = join(root, "data", "sources.json");
    const before = JSON.parse(readFileSync(mp, "utf-8"));
    before.sources.push({ name: "stranger", path: "stranger.csv", format: "CSV", table: "stranger", rows: 3 });
    before.extra_top_level = "kept";
    writeFileSync(mp, JSON.stringify(before, null, 2) + "\n");

    const r = run(["--out", syn, "--seed", "42"]);
    assert.equal(r.status, 0, r.stderr);

    assert.deepEqual(readFileSync(join(syn, "contacts.csv")), contactsBefore);
    assert.equal(readFileSync(join(syn, "keep-me.txt"), "utf-8"), "sentinel\n");
    const after = JSON.parse(readFileSync(mp, "utf-8"));
    const names = after.sources.map((s) => s.name);
    assert.ok(names.includes("stranger"), "stranger entry survives");
    assert.equal(after.extra_top_level, "kept");
    for (const n of ["employees", "holiday_2026", "responsibility", "policy", "threads_json", "threads_parquet", "escalation_notes"]) {
      assert.ok(names.includes(n), "owned entry present: " + n);
    }
    // entries the generator did not write (seeded elsewhere) are kept too
    for (const s of before.sources) assert.ok(names.includes(s.name), "kept: " + s.name);
    assert.equal(new Set(names).size, names.length, "no duplicate entries");
    // owned entries first, the stranger after them
    assert.ok(names.indexOf("employees") < names.indexOf("stranger"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--dry-run lists the files and writes nothing", { skip, timeout: 300000 }, () => {
  const root = fixture();
  try {
    const before = walk(root);
    const manifestBefore = readFileSync(join(root, "data", "sources.json"));
    const r = run(["--out", join(root, "data", "synthetic"), "--seed", "42", "--dry-run"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /employees\.csv/);
    assert.match(r.stdout, /threads\/threads\.parquet/);
    assert.match(r.stdout, /sources\.json/);
    assert.deepEqual(walk(root), before, "no file added, removed or touched");
    assert.deepEqual(readFileSync(join(root, "data", "sources.json")), manifestBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

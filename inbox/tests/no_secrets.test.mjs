// Invariant sweep: no secret value and no Bearer token in any shipped/log artefact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT, secrets, parseEnvFile } from "../src/config.mjs";

const DIRS = ["logs", "output_examples", "judging", "data/sample"].map((d) => join(INBOX_ROOT, d));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === ".gitkeep") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// value -> key name, from the same sources config.secrets() reads (names only ever reported).
function nameMap() {
  const map = new Map();
  const sources = [];
  try { sources.push(parseEnvFile(readFileSync(join(INBOX_ROOT, ".env"), "utf8"))); } catch {}
  sources.push(process.env);
  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) {
      if (/(_KEY|_TOKEN|_SECRET)$/.test(k) && typeof v === "string" && v.length >= 8 && !map.has(v)) map.set(v, k);
    }
  }
  return map;
}

test("no secret value or Bearer token in logs, output_examples, judging, data/sample", () => {
  const vals = secrets();
  const names = nameMap();
  const files = DIRS.flatMap((d) => walk(d));
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "latin1");
    for (const v of vals) {
      if (text.includes(v)) hits.push(`${f}: contains value of ${names.get(v) ?? "a configured secret"}`);
    }
    if (/Bearer [A-Za-z0-9._-]{8,}/.test(text)) hits.push(`${f}: contains a Bearer token`);
  }
  console.log(`no_secrets: swept ${files.length} file(s) against ${vals.length} secret value(s)`);
  assert.deepEqual(hits, [], hits.join("\n"));
});

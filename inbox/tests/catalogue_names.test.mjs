// Jocke's storefront catalogue names are canon (einh): the 10 products that were renamed must not survive under their old
// names anywhere in the tree, and the authored sender "Padmé Amidala" (a film character) is now "Seraphine Kaelborn".
// A content sweep, not a file-name sweep: padme_chain.test.mjs and padme-chain.md keep their names (identifiers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const INBOX = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(INBOX, "..");
const THIS = join(INBOX, "tests", "catalogue_names.test.mjs");

// old names; "Emitter Hilt" is renamed to "Strand Emitter Hilt", which contains it, so that one only counts when not prefixed.
const OLD = [
  /Arc Blade Trainer/i, /(?<!Strand )Emitter Hilt/i, /Core Crystal Case/i, /Orbit Stand/i, /Wayfarer Cloak/i,
  /Initiate Robe/i, /Drift Boots/i, /Quartermaster Belt/i, /Sidearm Holster/i, /Pilgrim Pack/i,
  /Padm(?:é|e|=C3=A9)\s+Amidala/i, /padme\.amidala/i, /padme-3/i,
];

// What the sweep reads (roots relative to the repo; a directory is walked, a path ending in /*.md or /*.jsonl matches that folder only).
const ROOTS = [
  "inbox/data", "kristof/data", "inbox/src", "inbox/public", "inbox/input_examples", "inbox/output_examples", "inbox/tests",
  "inbox/docs", "inbox/judging/*.md", "inbox/judging/traces/*.jsonl", "inbox/README.md", "inbox/openapi.yaml", "kristof/challengetrack.md",
];
// Recorded history, exempt by explicit path (prefix or glob), each with its reason.
const EXEMPT = [
  [/^inbox\/judging\/traces\/[^/]*live[^/]*\.jsonl$/, "recorded live evidence: what the live run actually said"],
  [/^logs\//, "run logs are history"],
  [/^kristof\/cursor\/logs\//, "agent session logs are history"],
  [/^agent-comms\//, "agent coordination record is history"],
];
const BINARY_EXT = /\.(parquet|sqlite|xlsx|png|jpe?g|webp|glb|gif|ico|woff2?|zip|gz)$/i;

const rel = (p) => relative(REPO, p).split(sep).join("/");
const isExempt = (r) => EXEMPT.some(([re]) => re.test(r));

function walk(path, out) {
  let st;
  try { st = statSync(path); } catch { return out; }
  if (st.isDirectory()) {
    for (const n of readdirSync(path)) if (n !== "node_modules" && n !== ".git") walk(join(path, n), out);
  } else out.push(path);
  return out;
}
function files(spec) {
  const star = spec.indexOf("/*.");
  if (star < 0) return walk(join(REPO, spec), []);
  const dir = join(REPO, spec.slice(0, star)), ext = spec.slice(star + 2);
  return readdirSync(dir).filter((n) => n.endsWith(ext)).map((n) => join(dir, n));
}

export function sweep(extra = []) {
  const hits = [];
  for (const spec of ROOTS) for (const f of files(spec)) {
    if (f === THIS || isExempt(rel(f)) || BINARY_EXT.test(f)) continue;
    const buf = readFileSync(f);
    if (buf.includes(0)) continue; // a binary we did not list
    const text = buf.toString("utf8");
    for (const re of [...OLD, ...extra]) { const m = re.exec(text); if (m) hits.push(`${rel(f)}: "${m[0]}"`); }
  }
  return hits;
}

test("the sweep sees the tree: it reads data, seeds, src, docs and examples", () => {
  const seen = ROOTS.flatMap(files).filter((f) => !BINARY_EXT.test(f) && f !== THIS).map(rel);
  for (const must of ["inbox/data/synthetic/products.csv", "kristof/data/products.csv", "inbox/data/sample/products.json", "inbox/src/scenarios.mjs", "inbox/public/demo-scenarios.json", "inbox/README.md"])
    assert.ok(seen.includes(must), `${must} is not swept`);
});

test("the sweep is not vacuous: it finds each old name and the old sender when one is planted", () => {
  const planted = ["Arc Blade Trainers", "emitter hilt", "Core Crystal Case", "orbit stand", "Wayfarer Cloak", "Initiate Robe", "Drift Boots",
    "Quartermaster Belt", "Sidearm Holster", "Pilgrim Pack", "Padmé Amidala", "padme.amidala@example.com", "padme-3"];
  for (const s of planted) assert.ok(OLD.some((re) => re.test(s)), s);
  for (const s of ["Strand Emitter Hilt", "Orbit Display Stand", "Seraphine Kaelborn", "seraphine.kaelborn@example.com"]) assert.ok(!OLD.some((re) => re.test(s)), s);
});

test("no old catalogue name and no film-character sender anywhere outside recorded history", () => {
  const hits = sweep();
  assert.deepEqual(hits, [], `old names still present:\n${hits.join("\n")}`);
});

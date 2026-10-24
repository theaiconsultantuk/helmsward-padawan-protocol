// P10 ("Take the set, keep the columns"): the authored answer columns stay in threads.jsonl, and nothing reads them at runtime.
// The 24 threads run in sample mode three ways: normal, with the sample caches poisoned, and with the ticket the loop
// sees poisoned as well. Every decision and branch_id must equal the normal run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { factsForTicket } from "../src/queries.mjs";

const POISON_COLS = ["outcome", "outcome_reason", "ledger_effect", "owner_out"];
const THREADS = readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(0, 24);

const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "noo-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "noo-mem-")), quiet: true });

// A copy of data/sample in which every table that has one of the four columns carries "POISON" in it
// (thread.json, world_threads.json today; any other cache that gains one is poisoned too).
function poisonedSampleDir() {
  const src = join(INBOX_ROOT, "data", "sample");
  const dst = mkdtempSync(join(tmpdir(), "noo-sample-"));
  const touched = [];
  for (const f of readdirSync(src).filter((x) => x.endsWith(".json"))) {
    const entries = JSON.parse(readFileSync(join(src, f), "utf8"));
    let n = 0;
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v.headers) && Array.isArray(v.rows)) {
        const idx = v.headers.map((h, i) => (POISON_COLS.includes(h) ? i : -1)).filter((i) => i >= 0);
        for (const r of v.rows) for (const i of idx) { r[i] = "POISON"; n += 1; }
      }
      for (const k of Object.keys(v)) { if (POISON_COLS.includes(k) && typeof v[k] !== "object") { v[k] = "POISON"; n += 1; } else walk(v[k]); }
    };
    walk(entries);
    writeFileSync(join(dst, f), JSON.stringify(entries));
    if (n) touched.push(f);
  }
  return { dir: dst, touched };
}

const poisonObj = (o) => { if (o && typeof o === "object") for (const c of POISON_COLS) if (c in o) o[c] = "POISON"; return o; };

async function runAll(label, { sampleDir, wrapFacts, control }) {
  const out = {};
  for (const t of THREADS) {
    const cfg = { ...config(), SAMPLE_MODE: "true", ...(sampleDir ? { SAMPLE_DIR: sampleDir } : {}) };
    const deps = dirs();
    if (wrapFacts) {
      deps.facts = async (id, opts) => {
        const f = await factsForTicket(id, { ...opts, cfg });
        poisonObj(f.ticket); // the thread row as the loop holds it (facts.owner_out is the computed fact and is left alone)
        if (control) f.may_leave = false;
        return f;
      };
    }
    const r = await runTicket(t.thread_id, { run_id: `noo-${label}-${t.thread_id}`, cfg, deps });
    out[t.thread_id] = { decision: r.output.decision, branch_id: r.branch_id };
  }
  return out;
}

test("the 24 threads decide the same with the authored answer columns poisoned (sample caches, then the ticket row too)", async () => {
  assert.equal(THREADS.length, 24);
  const base = await runAll("base", {});
  const { dir, touched } = poisonedSampleDir();
  assert.ok(touched.includes("thread.json"), `poisoning reached thread.json (touched: ${touched.join(", ")})`);
  const cache = await runAll("cache", { sampleDir: dir });
  const both = await runAll("both", { sampleDir: dir, wrapFacts: true });
  console.log(`\npoisoned columns ${POISON_COLS.join(", ")} in sample caches: ${touched.join(", ")}; plus deps.facts wrapper on facts and facts.ticket`);
  assert.deepEqual(cache, base, "poisoned sample caches changed a decision or branch");
  assert.deepEqual(both, base, "poisoned ticket row changed a decision or branch");
});

test("negative control: the wrapper does reach the loop (changing a column the loop does read changes decisions)", async () => {
  const base = await runAll("ctl-base", {});
  const ctl = await runAll("ctl", { wrapFacts: true, control: true });
  assert.notDeepEqual(ctl, base);
});

test("owner_out on the facts is computed from the holiday rows, not read from the thread row's authored column", async () => {
  const { dir } = poisonedSampleDir();
  const cfg = { ...config(), SAMPLE_MODE: "true", SAMPLE_DIR: dir };
  const clean = { ...config(), SAMPLE_MODE: "true" };
  for (const t of THREADS) {
    const a = await factsForTicket(t.thread_id, { cfg: clean }), b = await factsForTicket(t.thread_id, { cfg });
    assert.equal(b.owner_out, a.owner_out, `${t.thread_id} owner_out`);
    assert.equal(typeof b.owner_out, "boolean", `${t.thread_id} owner_out is a computed boolean`);
  }
});

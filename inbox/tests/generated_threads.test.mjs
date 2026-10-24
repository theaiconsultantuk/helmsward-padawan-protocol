// The 76 generated threads (T25 to T100) may be answered. Until 24 Oct gen_company.py set may_leave to "refund within the
// limit", so 64 of them held as data-block ("the cited fact may not leave the company") and T27, an over-limit refund, held
// instead of escalating (Paul, 24 Oct). Only the authored 24 may carry may_leave false (T04, T23).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";

const THREADS = readFileSync(join(INBOX_ROOT, "data", "synthetic", "threads", "threads.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const generated = THREADS.slice(24);

test("every generated thread (T25 to T100) carries may_leave true in the source data", () => {
  assert.equal(THREADS.length, 100);
  assert.equal(generated.length, 76);
  assert.deepEqual(generated.filter((t) => t.may_leave !== true).map((t) => t.thread_id), []);
  assert.deepEqual(THREADS.slice(0, 24).filter((t) => t.may_leave === false).map((t) => t.thread_id), ["T04", "T23"], "the authored data-block threads");
});

test("the sample cache agrees with the source data on may_leave for all 100 threads", () => {
  const cache = JSON.parse(readFileSync(join(INBOX_ROOT, "data", "sample", "thread.json"), "utf8"));
  for (const t of THREADS) {
    const e = cache.find((x) => x.params?.thread_id === t.thread_id);
    assert.ok(e, `${t.thread_id} cached`);
    const i = e.result.headers.indexOf("may_leave");
    assert.equal(e.result.rows[0][i], t.may_leave ? "true" : "false", t.thread_id);
  }
});

test("T27 (over-limit refund) escalates and T30 (appreciation) is not blocked, in sample mode", async () => {
  const go = async (id) => runTicket(id, { run_id: `gen-${id}`, cfg: { ...config(), SAMPLE_MODE: "true" }, deps: { logsDir: mkdtempSync(join(tmpdir(), "gen-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "gen-mem-")), quiet: true } });
  const t27 = await go("T27");
  assert.equal(t27.output.decision, "escalate"); assert.equal(t27.branch_id, "over-limit");
  const t30 = await go("T30");
  assert.notEqual(t30.branch_id, "data-block"); assert.notEqual(t30.output.decision, "hold");
});

// A customer draft carries no internal row ids: the rows a draft rests on travel in cited_rows and the trace, never in the
// text a customer reads (a sample draft printed "holiday_2026:15@2026-10-22"; Dean's D1, 24 Oct). And one label: the rules
// read is "sample/rules" everywhere, never "sample-rules".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import * as sample from "../src/adapters/sample.mjs";

const ROW_ID = /holiday_2026:|threads_parquet:|employees:\d|policy rows:|responsibility:|trust_ledger:/;

test("a sample draft never prints a row id to the customer", () => {
  const ticket = { thread_id: "X1", category: "refund", subject: "Refund for order JP-1042", sender_name: "Lira Venn", amount_usd: 40 };
  const facts = { category: "refund", cited_rows: ["threads_parquet:T02", "policy:refund", "holiday_2026:15@2026-10-22"], policy_limit_usd: 150, backup: "Soren Adey" };
  for (const seed of ["correct", "revised", "misread"]) assert.doesNotMatch(sample.draft(ticket, facts, { seed }).text, ROW_ID, seed);
  assert.doesNotMatch(sample.draft({ ...ticket, category: "question" }, { ...facts, category: "question" }).text, ROW_ID, "question");
});

test("T02 in sample mode: the draft text is clean and the rows are still cited", async () => {
  const deps = { logsDir: mkdtempSync(join(tmpdir(), "draft-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "draft-mem-")), quiet: true };
  const r = await runTicket("T02", { run_id: "draft-text-T02", cfg: { ...config(), SAMPLE_MODE: "true" }, deps });
  assert.ok(r.output.draft?.text, "T02 has a draft");
  assert.doesNotMatch(r.output.draft.text, ROW_ID);
  assert.ok(r.output.cited_rows.some((c) => c.startsWith("holiday_2026:")), "the holiday row is still cited");
});

test('the rules read is labelled "sample/rules" everywhere, never "sample-rules"', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".mjs") ? [join(d, e.name)] : []));
  for (const f of walk(join(INBOX_ROOT, "src"))) assert.ok(!readFileSync(f, "utf8").includes("sample-rules"), f);
});

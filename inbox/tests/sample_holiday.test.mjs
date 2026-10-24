import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { queryByName, critique, draft } from "../src/adapters/sample.mjs";

const cfg = config({ SAMPLE_MODE: "true" });
const full = () => {
  const dir = cfg.SAMPLE_DIR ?? new URL("../data/sample", import.meta.url).pathname;
  return JSON.parse(readFileSync(`${dir}/holidays.json`, "utf8")).find((e) => Object.keys(e.params ?? {}).length === 0).result.rows;
};
const byHand = (id, date) => full().filter((r) => String(r[0]) === String(id) && r[1] === date);

test("holiday derives a per-employee answer from the full table", () => {
  const a = queryByName("holiday", { employee_id: 5, date: "2026-09-29" }, { cfg });
  assert.equal(a.rows.length, 1);
  assert.deepEqual(a.rows, byHand(5, "2026-09-29"));
  const b = queryByName("holiday", { employee_id: 5, date: "2026-10-20" }, { cfg });
  assert.deepEqual(b.rows, byHand(5, "2026-10-20"));
  assert.equal(b.total, b.rows.length);
  assert.deepEqual(b.headers.slice(0, 2), ["employee_id", "date"]);
  const none = queryByName("holiday", { employee_id: 5, date: "2026-01-01" }, { cfg });
  assert.equal(none.rows.length, 0);
  assert.equal(none.total, 0);
});

test("an exact holiday entry wins over the derivation", () => {
  const dir = mkdtempSync(join(tmpdir(), "samp-"));
  writeFileSync(join(dir, "holiday.json"), JSON.stringify([{ params: { employee_id: 5, date: "2026-09-29" }, result: { headers: ["employee_id", "date"], rows: [["5", "1999-01-01"]], total: 1 } }]));
  writeFileSync(join(dir, "holidays.json"), JSON.stringify([{ params: {}, result: { headers: ["employee_id", "date"], rows: [["5", "2026-09-29"], ["5", "2026-09-29"]], total: 2 } }]));
  const r = queryByName("holiday", { employee_id: 5, date: "2026-09-29" }, { cfg: config({ SAMPLE_MODE: "true", SAMPLE_DIR: dir }) });
  assert.deepEqual(r.rows, [["5", "1999-01-01"]]);
});

test("other templates without an entry still throw", () => {
  assert.throws(() => queryByName("employee", { employee_id: 999 }, { cfg }), /no cached rows/);
});

test("critique: a promised refund fails with a null limit and over a set limit", () => {
  const d = { promises: { refund_amount: 40 }, text: "ok" };
  // a promised refund with no policy limit behind it fails (Codex review 7, HIGH); the limit rules are refund-category rules
  assert.equal(critique(d, { category: "refund", policy_limit: null, restricted_terms: [] }).pass, false);
  const r = critique(d, { category: "refund", policy_limit: 30, restricted_terms: [] });
  assert.equal(r.pass, false);
  assert.match(r.reason, /above the limit/);
});

test("revised draft with a null limit never says null", () => {
  const t = draft({ subject: "s", category: "refund" }, { policy_limit: null, cited_rows: [] }, { seed: "revised" }).text;
  assert.ok(!t.includes("null"));
  assert.match(t, /We are not promising anything today/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMPLATES, validate, run, counters, sources, wikiFor, employeeAvailability, parseRestricted } from "../src/queries.mjs";
import { withMockFetch } from "./helpers/mock_fetch.mjs";

const live = { SAMPLE_MODE: "false", ZETARIS_REST_URL: "http://zetaris.invalid", ZETARIS_API_KEY: "k", ZETARIS_ORG_ID: "1" };

test("validate rejects injection and bad values before any fetch", async () => {
  const bad = [
    ["thread", { thread_id: "T02'" }], ["thread", { thread_id: "T02; DROP" }], ["thread", { thread_id: "1 OR 1=1" }],
    ["thread", { thread_id: "T02 " }], ["trust", { category: "bogus" }], ["holiday", { employee_id: 15, date: "22/10/2026" }],
    ["holiday", { employee_id: "15 OR 1=1", date: "2026-10-22" }], ["employee", { employee_id: 201 }],
    ["nope", {}], ["thread", { thread_id: "T02", extra: "x" }], ["thread", {}],
  ];
  await withMockFetch(async () => { throw new Error("fetch must not be called"); }, async (calls) => {
    for (const [n, p] of bad) {
      assert.throws(() => validate(n, p), TypeError, `${n} ${JSON.stringify(p)}`);
      await assert.rejects(run(n, p, { cfg: live }), TypeError);
    }
    await assert.rejects(wikiFor("x'; DROP", { cfg: live }), TypeError);
    assert.equal(calls.length, 0);
  });
});

test("templates render deterministic SQL for valid params", () => {
  assert.equal(TEMPLATES.thread.sql({ thread_id: "T02" }), "SELECT * FROM JEDI_PACK.threads_parquet WHERE thread_id = 'T02'");
  assert.equal(TEMPLATES.holiday.sql({ employee_id: "15", date: "2026-10-22" }),
    "SELECT * FROM JEDI_PACK.holiday_2026 WHERE employee_id = 15 AND date = '2026-10-22'");
  assert.equal(TEMPLATES.trust.sql({ category: "refund" }), "SELECT * FROM JEDI_PACK.trust_ledger WHERE category = 'refund'");
  assert.equal(TEMPLATES.thread.sql({ thread_id: "T02" }), TEMPLATES.thread.sql({ thread_id: "T02" }));
});

test("run builds objects, cites rows and traces success and error", async () => {
  const lines = [];
  const trace = { line: (l) => lines.push(l) };
  const ok = async () => ({ headers: ["category", "weight", "floor"], rows: [["refund", "0.55", "0.8"]], total: 1, source: "live" });
  const r = await run("trust", { category: "refund" }, { trace, cfg: live, sqlRunImpl: ok });
  assert.deepEqual(r.objects, [{ category: "refund", weight: "0.55", floor: "0.8" }]);
  assert.equal(lines[0].step, "zetaris.query");
  assert.equal(lines[0].action, "sql:trust");
  assert.match(lines[0].output_summary, /1 rows: trust_ledger:refund/);
  await assert.rejects(run("trust", { category: "refund" }, { trace, cfg: live, sqlRunImpl: async () => { throw Object.assign(new Error("boom"), { name: "UpstreamTimeout" }); } }));
  assert.equal(lines[1].status, "error");
});

test("counters returns zeros when the table is missing, sums when present", async () => {
  const missing = async () => { throw Object.assign(new Error("zetaris: HTTP 400"), { name: "BadResponse" }); };
  assert.deepEqual(await counters({ cfg: live, sqlRunImpl: missing }),
    { send: 0, hold: 0, escalate: 0, close: 0, queued: 0, affirmed: 0, rejected: 0 });
  const some = async () => ({ headers: ["outcome", "ledger_effect", "n"], rows: [["hold", "affirm", "3"], ["send", "reject", "2"]] });
  const c = await counters({ cfg: live, sqlRunImpl: some });
  assert.equal(c.hold, 3); assert.equal(c.send, 2); assert.equal(c.affirmed, 3); assert.equal(c.rejected, 2);
  const auth = async () => { throw Object.assign(new Error("no"), { name: "Unauthorized" }); };
  await assert.rejects(counters({ cfg: live, sqlRunImpl: auth }));
});

test("counters in sample mode with an empty fixture dir returns zeros", async () => {
  const dir = mkdtempSync(join(tmpdir(), "q-"));
  const c = await counters({ cfg: { SAMPLE_MODE: "true", SAMPLE_DIR: dir } });
  assert.equal(c.send, 0);
});

test("sources merges manifest and live counts, keeps manifest on error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "q-"));
  const manifestPath = join(dir, "sources.json");
  writeFileSync(manifestPath, JSON.stringify({ sources: [
    { name: "employees", format: "CSV", table: "employees", rows: 200 },
    { name: "policy", format: "CSV", table: "policy", rows: 1 },
    { name: "odd", format: "REST", table: "intake", rows: 7 },
  ] }));
  const impl = async (sql) => {
    if (/employees/.test(sql)) return { headers: ["n"], rows: [["201"]] };
    throw new Error("down");
  };
  const s = await sources({ cfg: live, manifestPath, sqlRunImpl: impl });
  assert.deepEqual(s, [
    { name: "employees", format: "CSV", table: "employees", rows: 201, live: true },
    { name: "policy", format: "CSV", table: "policy", rows: 1, live: false },
    { name: "odd", format: "REST", table: "intake", rows: 7, live: false },
  ]);
});

test("wikiFor routes intents and availability reads holiday rows", async () => {
  const seen = [];
  const impl = async (sql) => { seen.push(sql); return { headers: ["preview"], rows: [["p"]] }; };
  await wikiFor("refund.request", { cfg: live, sqlRunImpl: impl });
  await wikiFor("replacement.request", { cfg: live, sqlRunImpl: impl });
  await wikiFor("question", { cfg: live, sqlRunImpl: impl });
  assert.match(seen[0], /wiki_refund_policy/); assert.match(seen[1], /wiki_replacement_policy/); assert.match(seen[2], /wiki_what_may_leave/);
  const a = await employeeAvailability(15, "2026-10-22", { cfg: live, sqlRunImpl: async () => ({ headers: ["employee_id", "date"], rows: [["15", "2026-10-22"]] }) });
  assert.equal(a.out, true);
});

test("parseRestricted extracts the forbidden list", () => {
  assert.deepEqual(parseRestricted("A reply may not include a stored card number, an internal staff price list, or a staff home address.\nIf"),
    ["stored card number", "internal staff price list", "staff home address"]);
  assert.deepEqual(parseRestricted("nothing"), []);
});

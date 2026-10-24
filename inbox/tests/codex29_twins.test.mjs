// Codex review 29 folds (5, 6, 7): the offline twins answer what the live SQL answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { factsForTicket, runLocal, run } from "../src/queries.mjs";
import { queryByName } from "../src/adapters/sample.mjs";
import { appendIntake, intakeRefundRows } from "../src/intake.mjs";
import { loadTables } from "../src/csv.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
const SYN = fileURLToPath(new URL("../data/synthetic/", import.meta.url));
const NOW = Date.parse("2026-10-25T10:00:00.000Z");
const fresh = (runtimeDir) => ({ logsDir: mkdtempSync(join(tmpdir(), "c29-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "c29-mem-")), runtimeDir, quiet: true });

test("5: prior_refunds counts the runtime intake refunds with the SQL's rules, from the cache path and from local()", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "c29-run-"));
  const email = "cold.twin@email.com";
  const mk = (o) => appendIntake({ from: email, message: "refund please", scenario: "refund", ...o }, { runtimeDir });
  const f1 = await mk({ received_at: "2026-10-25T09:00:00.000Z" });
  await appendIntake({ from: "Cold.Twin@Email.com", message: "refund again", scenario: "refund", received_at: "2026-10-25T09:30:00.000Z" }, { runtimeDir });
  await appendIntake({ from: email, message: "thanks", scenario: "question", received_at: "2026-10-25T09:40:00.000Z" }, { runtimeDir }); // not a refund
  await appendIntake({ from: "other@email.com", message: "refund", scenario: "refund", received_at: "2026-10-25T09:10:00.000Z" }, { runtimeDir }); // another sender
  await appendIntake({ from: email, message: "refund later", scenario: "refund", received_at: "2026-10-25T11:00:00.000Z" }, { runtimeDir }); // not earlier
  const params = { email: email.toUpperCase().replace("@EMAIL.COM", "@email.com"), thread_id: "F3", received_at: "2026-10-25T10:00:00.000Z" };
  // the cache path (sample mode): run() adds the runtime rows
  const r = await run("prior_refunds", params, { cfg, runtimeDir });
  assert.deepEqual(r.rows.map((x) => x.slice(0, 3)), [[f1.thread_id, "2026-10-25T09:00:00.000Z", "intake_runtime"], ["F2", "2026-10-25T09:30:00.000Z", "intake_runtime"]]);
  // the same through queryByName directly, and the pure helper and the local() twin agree
  assert.equal(queryByName("prior_refunds", params, { cfg, runtimeDir }).rows.length, 2);
  const tables = loadTables(SYN, { runtimeDir });
  assert.equal(runLocal("prior_refunds", params, tables).rows.length, 2);
  assert.equal(intakeRefundRows(tables.intake_runtime, params).length, 2);
  // without the runtime table, local() is the stored threads only (the committed caches are built that way)
  assert.equal(runLocal("prior_refunds", params, loadTables(SYN)).rows.length, 0);
});

test("5: cold-start twin in sample mode: F2's prior_refunds count is 1 from the runtime intake alone (H-MEM empty)", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "c29-run-"));
  const ask = async (d, id, message, ticks) => {
    const deps = { ...d, clock: () => NOW + ticks * 60000, facts: (tid, o) => factsForTicket(tid, { ...o, cfg, runtimeDir }) };
    const result = await runTicket(null, { run_id: id, cfg, as_of: "2026-10-25", deps, input: { message, from: "twin.zeta@email.com", name: "Twin", channel: "chat", scenario: "refund", as_of: "2026-10-25" } });
    return result.output;
  };
  const o1 = await ask(fresh(runtimeDir), "c29-a", "I want a refund of 100 GC for my cracked saber", 0);
  assert.equal(o1.memory_note, null);
  const o2 = await ask(fresh(runtimeDir), "c29-b", "Another refund, 100 GC for the same saber, still broken", 5); // an empty H-MEM: only the intake file knows F1
  assert.equal(o2.memory_note, "Second Refund Request from this client (1 earlier: F1).");
  assert.ok(o2.cited_rows.includes("intake_runtime:F1"));
});

test("6: an uncached employee on 2026-12-25 is out (company-wide Life Day and Christmas) with the holiday SQL's four columns", () => {
  const r = queryByName("holiday", { employee_id: 3, date: "2026-12-25" }, { cfg });
  assert.deepEqual(r.headers, ["employee_id", "date", "kind", "holiday_name"]);
  assert.ok(r.rows.length >= 2);
  const names = r.rows.map((x) => x[3]);
  assert.ok(names.includes("Life Day") && names.includes("Christmas Day"), names.join());
  assert.ok(r.rows.every((x) => x.length === 4 && x[0] === null && x[1] === "2026-12-25"));
  assert.equal(r.total, r.rows.length);
  assert.deepEqual(r, { ...runLocal("holiday", { employee_id: 3, date: "2026-12-25" }, loadTables(SYN)), timeUsed: 0 });
});

test("7: boolean columns come back as the views' boolean text (true/false), null for empty, whatever the CSV spelling", () => {
  const t = (rows, name) => ({ ...loadTables(SYN), [name]: rows });
  const prod = runLocal("product_price", { sku: "FS-B01" }, t([{ sku: "FS-B01", show_in_store: "TRUE", unit_price: "1", min_order_qty: "1", lead_days: "1" }], "products"));
  assert.equal(prod.rows[0][prod.headers.indexOf("show_in_store")], "true");
  const cust = runLocal("customer_by_email", { email: "x@y.zz" }, t([{ customer_id: "C1", email: "X@y.zz", seeded_prior_refund: "0", fictional: "" }], "customers"));
  assert.equal(cust.rows[0][cust.headers.indexOf("seeded_prior_refund")], "false");
  assert.equal(cust.rows[0][cust.headers.indexOf("fictional")], null);
  const ch = runLocal("channel", { channel: "email" }, t([{ channel: "email", public: "False", autonomous_reply: "Yes", intake_address: "", label: "E" }], "channels"));
  assert.deepEqual([ch.rows[0][1], ch.rows[0][2], ch.rows[0][3]], ["false", "true", null]);
  const sku = runLocal("product_by_sku", { sku: "FS-B01" }, loadTables(SYN));
  assert.ok(["true", "false"].includes(sku.rows[0][sku.headers.indexOf("show_in_store")]));
});

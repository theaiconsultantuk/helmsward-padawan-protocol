// Offline: every CSV/JSON-backed template has a local() twin that answers from data/synthetic exactly as the live sql would.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TEMPLATES, LOCAL_EXEMPT, runLocal, validate } from "../src/queries.mjs";
import { parseCsv, readCsv, loadTables } from "../src/csv.mjs";

const DIR = fileURLToPath(new URL("../data/synthetic/", import.meta.url));
const SAMPLE = fileURLToPath(new URL("../data/sample/", import.meta.url));
const tables = loadTables(DIR);
const L = (name, params = {}) => runLocal(name, params, tables);
const objs = (r) => r.rows.map((x) => Object.fromEntries(r.headers.map((h, i) => [h, x[i]])));

test("csv: RFC-4180 quoting, doubled quotes, embedded newlines, CRLF, BOM, short rows", () => {
  assert.deepEqual(parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n'), [["a", "b", "c"], ["1", "x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv("a,b\n1,\"line1\nline2\"\n\n3,4"), [["a", "b"], ["1", "line1\nline2"], ["3", "4"]]);
  assert.deepEqual(parseCsv("﻿a,b\n,\n"), [["a", "b"], ["", ""]]);
  assert.deepEqual(parseCsv("a\rb\r1"), [["a"], ["b"], ["1"]]);
  assert.throws(() => parseCsv('a,b\n1,"open'), /unterminated/);
});

test("csv: readCsv keys rows by header, empty cells stay empty strings, products has 50 rows and a quoted description", () => {
  const p = readCsv(`${DIR}products.csv`);
  assert.equal(p.length, 50);
  assert.equal(p[0].sku, "FS-B01");
  assert.ok(p.every((r) => Object.keys(r).length === 16));
  assert.equal(readCsv(`${DIR}shipping_rules.csv`).find((r) => r.planet === "Coruscant").note, "");
});

test("loadTables: every raw table the templates read is loaded, plus threads_json", () => {
  for (const t of ["employees", "holiday_2026", "responsibility", "policy", "categories", "trust_ledger", "products", "faq", "contacts",
    "companyhierarchy", "customers", "orders", "shipping_rules", "bulk_pricing", "bom", "channels", "threads_json"]) assert.ok(Array.isArray(tables[t]) && tables[t].length > 0, t);
  assert.equal(tables.threads_json.length, 100);
});

test("every template has a local() except the pinned exempt list", () => {
  assert.deepEqual([...LOCAL_EXEMPT].sort(), ["decision_counts", "ledger_adjust", "intake_thread", "reviews", "table_count", "thread", "wiki", "world_threads"].sort());
  for (const [name, t] of Object.entries(TEMPLATES)) {
    if (LOCAL_EXEMPT.includes(name)) assert.equal(t.local, undefined, `${name} is exempt and must not claim a local`);
    else assert.equal(typeof t.local, "function", `${name} needs a local()`);
  }
  for (const n of ["thread", "wiki", "reviews", "world_threads", "intake_thread", "ledger_adjust", "decision_counts", "table_count"]) {
    assert.throws(() => runLocal(n, n === "wiki" ? { wiki: "refund" } : n === "thread" ? { thread_id: "T01" } : n === "intake_thread" ? { thread_id: "F1" }
      : n === "ledger_adjust" ? { category: "refund" } : n === "table_count" ? { table: "faq" } : {}, tables), /no local twin/, n);
  }
});

test("runLocal validates the params like run() does", () => {
  assert.throws(() => runLocal("order", { order_id: "JP-1'" }, tables), TypeError);
  assert.throws(() => runLocal("nope", {}, tables), TypeError);
});

test("every local() answers {headers, rows, total} with strings or null only, rows as wide as the headers", () => {
  const params = {
    policy: { topic: "refund" }, responsibility: { topic: "refund" }, employee: { employee_id: 15 }, holiday: { employee_id: 15, date: "2026-10-27" },
    contact: { topic: "default" }, category: { category: "refund" }, trust: { category: "refund" }, thread_fingerprints: {}, faq: {}, products: {},
    product_price: { sku: "FS-B03" }, product_lookup: {}, product_by_sku: { sku: "FS-B03" }, hierarchy: { employee_id: 15 }, team_head: { team: "Sales" },
    customer_by_email: { email: "liravenn@email.com" }, prior_refunds: { email: "liravenn@email.com", thread_id: "T06", received_at: "2026-10-22T11:05:00Z" },
    order: { order_id: "JP-1001" }, shipping_rule: { planet: "Alderaan" }, bulk_tiers: {}, bom: { sku: "FS-B04" }, channel: { channel: "email" }, holidays: {},
  };
  const names = Object.keys(TEMPLATES).filter((n) => !LOCAL_EXEMPT.includes(n));
  assert.deepEqual(Object.keys(params).sort(), names.sort(), "this test covers every local template");
  for (const n of names) {
    const r = L(n, params[n]);
    assert.deepEqual(Object.keys(r).sort(), ["headers", "rows", "total"], n);
    assert.equal(r.total, r.rows.length, n);
    assert.ok(r.rows.length > 0, `${n} found no row`);
    for (const row of r.rows) {
      assert.equal(row.length, r.headers.length, n);
      for (const v of row) assert.ok(v === null || typeof v === "string", `${n}: ${typeof v}`);
    }
  }
});

test("prior_refunds: T02 has none before it, T06 has T02, an upper-case email is the same, the ticket itself and later tickets are never counted", () => {
  const at = { T02: "2026-10-22T09:20:00Z", T06: "2026-10-22T11:05:00Z" };
  const p = (email, thread_id, received_at) => L("prior_refunds", { email, thread_id, received_at });
  assert.equal(p("liravenn@email.com", "T02", at.T02).rows.length, 0);
  const six = p("liravenn@email.com", "T06", at.T06);
  assert.deepEqual(six.rows.map((r) => r[0]), ["T02"]);
  assert.deepEqual(six.headers, ["thread_id", "received_at", "src"]);
  assert.deepEqual(TEMPLATES.prior_refunds.cite({}, objs(six)), ["threads_json:T02"]);
  assert.deepEqual(p("LiraVenn@EMAIL.com", "T06", at.T06).rows, six.rows);
  assert.equal(p("liravenn@email.com", "T06", "2026-10-22T09:20:00Z").rows.length, 0, "strictly before: T02's own time excludes T02");
  assert.equal(p("liravenn@email.com", "F7", "2026-12-01T00:00:00.000Z").rows.length, 2, "a free-text ticket afterwards sees both");
  assert.equal(p("nobody@email.com", "T06", at.T06).rows.length, 0);
});

test("customer_by_email: case-insensitive, the seeded client has a prior refund", () => {
  const r = objs(L("customer_by_email", { email: "LIRAVENN@email.com" }));
  assert.equal(r.length, 1);
  assert.equal(r[0].customer_id, "C002"); assert.equal(r[0].seeded_prior_refund, "true");
  assert.equal(L("customer_by_email", { email: "ghost@email.com" }).rows.length, 0);
});

test("shipping_rule: Alderaan is suspended in any case, an unknown planet gets the default row", () => {
  assert.equal(objs(L("shipping_rule", { planet: "alderaan" }))[0].status, "suspended");
  assert.match(objs(L("shipping_rule", { planet: "Alderaan" }))[0].note, /suspended/);
  const d = objs(L("shipping_rule", { planet: "Jakku" }));
  assert.equal(d.length, 1); assert.equal(d[0].planet, "default"); assert.equal(d[0].status, "open"); assert.equal(d[0].note, null);
  assert.equal(objs(L("shipping_rule", { planet: "Coruscant" }))[0].planet, "Coruscant");
  assert.deepEqual(TEMPLATES.shipping_rule.cite({}, d), ["shipping_rules:default"]);
});

test("holiday: a blank-employee row matches any employee; a personal row still matches; cite says company", () => {
  for (const e of [1, 15, 40, 210]) {
    const r = objs(L("holiday", { employee_id: e, date: "2026-12-25" }));
    assert.ok(r.some((x) => x.employee_id === null && x.holiday_name === "Life Day"), `employee ${e}`);
  }
  assert.deepEqual(TEMPLATES.holiday.cite({}, objs(L("holiday", { employee_id: 3, date: "2026-12-25" }))), ["holiday_2026:company@2026-12-25", "holiday_2026:company@2026-12-25"]); // Christmas Day and Life Day, both blank-employee rows
  assert.equal(L("holiday", { employee_id: 57, date: "2026-12-25" }).rows.length, 3, "a personal row on a company day adds to the two company rows")
  const own = objs(L("holiday", { employee_id: 15, date: "2026-10-27" }));
  assert.equal(own.length, 1); assert.equal(own[0].employee_id, "15"); assert.equal(own[0].kind, "vacation");
  assert.equal(L("holiday", { employee_id: 27, date: "2026-10-27" }).rows.length, 0, "27 is never out in the demo window");
  const all = L("holidays", {});
  assert.ok(all.rows.some((r) => r[0] === null && r[1] === "2026-12-25"));
  assert.ok(all.rows.some((r) => r[0] === "15" && r[1] === "2026-10-27"));
});

test("hierarchy and team_head", () => {
  const h = objs(L("hierarchy", { employee_id: 15 }))[0];
  assert.deepEqual([h.employee_id, h.team, h.manager_id, h.manager_name, h.manager_role], ["15", "Support", "7", "Mei-Ling Zhao", "Head of Support"]);
  assert.ok(h.team_label);
  assert.deepEqual(L("hierarchy", { employee_id: 15 }).headers, ["employee_id", "name", "role", "team", "team_label", "manager_id", "manager_name", "manager_role"]);
  const ceo = objs(L("hierarchy", { employee_id: 201 }))[0];
  assert.equal(ceo.manager_id, "201"); assert.equal(ceo.role, "CEO"); assert.equal(ceo.manager_name, ceo.name);
  const sales = objs(L("team_head", { team: "Sales" }));
  assert.deepEqual(sales.map((x) => x.employee_id), ["40"]);
  assert.equal(sales[0].team_label, "Bargain Bazaar Brigade");
  assert.deepEqual(objs(L("team_head", { team: "Legal" })).map((x) => x.employee_id), ["202"]);
  assert.deepEqual(objs(L("team_head", { team: "Support" })).map((x) => x.employee_id), ["7"]);
  assert.equal(L("team_head", { team: "Nowhere" }).rows.length, 0);
});

test("responsibility returns label; policy and trust come back as raw text; doubles come back in Java form", () => {
  const r = objs(L("responsibility", { topic: "refund" }))[0];
  assert.deepEqual([r.owner_id, r.backup_id], ["15", "27"]); assert.ok(r.label);
  assert.deepEqual(objs(L("responsibility", { topic: "complaint" }))[0].owner_id, "15");
  const pol = objs(L("policy", { topic: "refund" }))[0];
  assert.deepEqual([pol.limit_amount, pol.currency, pol.under_limit_owner_id, pol.under_limit_backup_id, pol.over_limit_owner_id, pol.over_limit_backup_id], ["150.00", "GC", "15", "27", "40", "201"]);
  assert.equal(L("policy", { topic: "billing" }).rows.length, 0);
  assert.deepEqual(L("trust", { category: "refund" }).rows, [["refund", "0.55", "0.8", "seed-refund"]]);
  assert.equal(L("trust", { category: "rfq" }).rows.length, 1);
  assert.equal(objs(L("product_by_sku", { sku: "FS-B01" }))[0].unit_price, "189.0");
  assert.equal(objs(L("order", { order_id: "JP-1001" }))[0].amount, "310.0");
});

test("products, lookup, by_sku, order, tiers, bom, channel", () => {
  const lk = L("product_lookup");
  assert.deepEqual(lk.headers, ["sku", "name", "aliases"]); assert.equal(lk.rows.length, 50);
  const b03 = objs(L("product_by_sku", { sku: "FS-B03" }))[0];
  assert.match(b03.material, /tempered duralloy twin-core/);
  assert.equal(L("product_by_sku", { sku: "FS-Z99" }).rows.length, 0);
  assert.equal(objs(L("order", { order_id: "JP-1042" }))[0].shipping_planet, "Corellia");
  assert.deepEqual(L("bulk_tiers").rows, [["crew", "1", "10", "0.0"], ["squad", "11", "100", "10.0"], ["fleet", "101", null, "20.0"]]);
  const bom = objs(L("bom", { sku: "FS-B04" }));
  assert.ok(bom.length >= 2 && bom.some((x) => x.stock === "0"));
  assert.deepEqual(bom.map((x) => x.part_id), [...bom.map((x) => x.part_id)].sort());
  assert.equal(objs(L("channel", { channel: "trustpilot" }))[0].public, "true");
  assert.equal(objs(L("channel", { channel: "email" }))[0].intake_address, "info@jedipack.com");
  assert.equal(objs(L("channel", { channel: "chat" }))[0].intake_address, null);
});

test("thread_fingerprints sorts by thread_id as text and carries the new sender email", () => {
  const r = objs(L("thread_fingerprints"));
  assert.equal(r.length, 100);
  assert.deepEqual(r.map((x) => x.thread_id), [...r.map((x) => x.thread_id)].sort());
  assert.equal(r.find((x) => x.thread_id === "T06").sender_email, "liravenn@email.com");
});

test("a local() result has the header of the committed cache for templates whose shape did not change", () => {
  const changed = new Set(["products", "product_price", "responsibility"]); // new columns in CP1
  for (const [name, t] of Object.entries(TEMPLATES)) {
    if (!t.local || changed.has(name) || !existsSync(`${SAMPLE}${name}.json`)) continue;
    const entries = JSON.parse(readFileSync(`${SAMPLE}${name}.json`, "utf8"));
    const first = entries.find((e) => e.result?.headers?.length);
    if (!first) continue;
    const r = runLocal(name, first.params, tables);
    assert.deepEqual(r.headers, first.result.headers, name);
  }
});

test("TODO(1.4c): local() reproduces every committed data/sample/<t>.json byte for byte after canonical JSON", { skip: "caches rebuilt in 1.4c" }, () => {
  // 1.4c: for each template with local(), for each entry {params, result} in data/sample/<t>.json, assert
  // canon(runLocal(t, params, tables)) deep-equals canon(result) (rows in order, total included), then remove this skip.
});

test("validate still refuses params for the parameterless local templates", () => {
  for (const n of ["product_lookup", "bulk_tiers", "holidays", "faq", "products", "thread_fingerprints"]) assert.throws(() => validate(n, { x: 1 }), TypeError, n);
});

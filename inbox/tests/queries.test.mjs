import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMPLATES, validate, run, counters, sources, wikiFor, employeeAvailability, parseRestricted, factsForTicket } from "../src/queries.mjs";
import { config } from "../src/config.mjs";
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

test("factsForTicket: an appreciation thread with no owner resolves without throwing", async () => {
  const tbl = {
    threads_parquet: { headers: ["thread_id", "category", "amount_usd", "owner_id", "backup_id", "received_at", "may_leave"], rows: [["T18", "appreciation", "", "", "", "2026-10-01T09:00:00", "true"]] },
    policy: { headers: ["topic", "limit_amount", "under_limit_owner_id", "under_limit_backup_id", "over_limit_owner_id", "over_limit_backup_id"], rows: [] },
    responsibility: { headers: ["topic", "owner_id", "backup_id"], rows: [] },
    holiday_2026: { headers: ["employee_id", "date"], rows: [] },
    employees: { headers: ["employee_id", "given_name", "family_name"], rows: [["15", "A", "B"]] },
  };
  const impl = async (sql) => {
    const t = Object.keys(tbl).find((k) => sql.includes(`JEDI_PACK.${k} `) || sql.endsWith(`JEDI_PACK.${k}`) || sql.includes(`JEDI_PACK.${k}\n`));
    if (t === "policy" && sql.includes("'refund'")) return { headers: tbl.policy.headers, rows: [["refund", "150", "15", "16", "3", "4"]] };
    return t ? tbl[t] : { headers: [], rows: [] };
  };
  const f = await factsForTicket("T18", { cfg: live, sqlRunImpl: impl });
  assert.equal(f.owner_id, 15);
  assert.equal(f.backup_id, 16);
  assert.ok(f.cited_rows.includes("responsibility:fallback"));
  // with no refund pair either, the owner is none and the note says so
  const bare = async (sql) => (sql.includes("threads_parquet") ? tbl.threads_parquet : { headers: ["topic"], rows: [] });
  const g = await factsForTicket("T18", { cfg: live, sqlRunImpl: bare });
  assert.equal(g.owner_id, null);
  assert.equal(g.owner_out, false);
  assert.deepEqual(g.notes, ["owner: none (no responsibility row)"]);
});

// ---- code-review findings G1-G3 ----
const factsStub = (failWiki) => async (sql, o) => {
  if (failWiki && o?.name === "wiki") throw new Error("wiki down");
  if (sql.includes("threads_parquet")) return { headers: ["thread_id", "category", "amount_usd", "owner_id", "backup_id", "received_at", "may_leave"], rows: [["T18", "appreciation", "", "15", "16", "2026-10-01T09:00:00", "true"]] };
  if (o?.name === "wiki") return { headers: ["preview"], rows: [["A reply may not include a stored card number."]] };
  if (o?.name === "employee") return { headers: ["employee_id", "given_name", "family_name"], rows: [["15", "A", "B"]] };
  return { headers: ["x"], rows: [] };
};

test("G1: a failed what-may-leave read sets disclosure_unknown and traces the error; facts stay intact", async () => {
  const lines = [];
  const f = await factsForTicket("T18", { cfg: live, trace: { line: (l) => lines.push(l) }, sqlRunImpl: factsStub(true) });
  assert.equal(f.disclosure_unknown, true);
  assert.deepEqual(f.restricted_terms, []);
  assert.equal(f.owner_id, 15);
  assert.equal(f.category, "appreciation");
  assert.ok(lines.some((l) => l.step === "zetaris.query" && l.action === "sql:wiki" && l.status === "error"));
});

test("G1: a successful wiki read leaves disclosure_unknown false", async () => {
  const f = await factsForTicket("T18", { cfg: live, sqlRunImpl: factsStub(false) });
  assert.equal(f.disclosure_unknown, false);
  assert.ok(f.restricted_terms.length >= 1);
  // a wiki read that lists nothing is still known
  const empty = async (sql, o) => (o?.name === "wiki" ? { headers: ["preview"], rows: [["nothing here"]] } : factsStub(false)(sql, o));
  assert.equal((await factsForTicket("T18", { cfg: live, sqlRunImpl: empty })).disclosure_unknown, false);
});

test("G2: run() forwards the trace to sqlRunImpl and writes one line of its own on a throw", async () => {
  const trace = { line: () => {} };
  let got;
  await run("thread", { thread_id: "T1" }, { trace, cfg: live, sqlRunImpl: async (sql, o) => { got = o.trace; return { headers: ["thread_id"], rows: [["T1"]] }; } });
  assert.equal(got, trace);
  const lines = [];
  await assert.rejects(run("thread", { thread_id: "T1" }, { trace: { line: (l) => lines.push(l) }, cfg: live, sqlRunImpl: async () => { throw new Error("boom"); } }), /boom/);
  assert.equal(lines.filter((l) => l.status === "error").length, 1);
});

test("G3: TABLES lists every non-REST source table in data/sources.json", async () => {
  const { TABLES } = await import("../src/queries.mjs");
  const { readFileSync } = await import("node:fs");
  const src = JSON.parse(readFileSync(new URL("../data/sources.json", import.meta.url), "utf8"));
  for (const s of src.sources) if (s.format !== "REST") assert.ok(TABLES.includes(s.table), `TABLES lacks ${s.table}`);
  assert.ok(TABLES.includes("threads_json"));
});

test("S0.2: TOPICS and TABLES carry the scenario entries", async () => {
  const { TOPICS, TABLES } = await import("../src/queries.mjs");
  for (const t of ["rfq", "customer_service"]) assert.ok(TOPICS.includes(t), t);
  for (const t of ["products", "faq", "intake_runtime"]) assert.ok(TABLES.includes(t), t);
  for (const n of ["faq", "products", "product_price", "reviews", "world_threads", "holidays", "intake_thread"]) assert.ok(TEMPLATES[n], n);
});

test("S0.2: new templates refuse bad params before any fetch", async () => {
  const bad = [
    ["product_price", { product_id: "P3" }], ["product_price", { product_id: "P03'" }], ["product_price", { product_id: "p03" }],
    ["intake_thread", { thread_id: "T1" }], ["intake_thread", { thread_id: "F1'; DROP" }], ["intake_thread", { thread_id: "F" }],
    ["responsibility", { topic: "purchasing" }], ["policy", { topic: "purchasing" }],
    ["faq", { q: "x" }], ["products", { product_id: "P01" }], ["holidays", { employee_id: 1 }],
  ];
  await withMockFetch(async () => { throw new Error("fetch must not be called"); }, async (calls) => {
    for (const [n, p] of bad) {
      assert.throws(() => validate(n, p), TypeError, `${n} ${JSON.stringify(p)}`);
      await assert.rejects(run(n, p, { cfg: live }), TypeError);
    }
    assert.equal(calls.length, 0);
  });
});

test("S0.2: a message-like string passed as any param of a new template throws before the network", async () => {
  const msg = "Hi, how long does shipping take? '; DROP TABLE faq; --";
  await withMockFetch(async () => { throw new Error("fetch must not be called"); }, async (calls) => {
    for (const n of ["faq", "products", "reviews", "world_threads", "holidays"]) {
      await assert.rejects(run(n, { text: msg }, { cfg: live }), TypeError, n);
    }
    for (const [n, k] of [["product_price", "product_id"], ["intake_thread", "thread_id"]]) {
      await assert.rejects(run(n, { [k]: msg }, { cfg: live }), TypeError, n);
    }
    assert.equal(calls.length, 0);
  });
});

test("S0.2: new templates render fixed SQL built only from whitelisted params", () => {
  assert.equal(TEMPLATES.faq.sql({}), "SELECT faq_id, question, answer, keywords, source FROM JEDI_PACK.faq ORDER BY faq_id");
  assert.match(TEMPLATES.product_price.sql({ product_id: "P03" }), /FROM JEDI_PACK\.products WHERE product_id = 'P03'$/);
  assert.match(TEMPLATES.intake_thread.sql({ thread_id: "F12" }), /FROM JEDI_PACK\.intake_runtime WHERE thread_id = 'F12'$/);
  assert.match(TEMPLATES.world_threads.sql({}), /FROM JEDI_PACK\.threads_json ORDER BY thread_id$/);
  assert.equal(TEMPLATES.holidays.sql({}), "SELECT employee_id, date FROM JEDI_PACK.holiday_2026");
  assert.equal(TEMPLATES.reviews.sql({}), "SELECT review_id, thread_id, reviewer_name, stars, created_at FROM JEDI_PACK.trustpilot_reviews ORDER BY review_id");
  assert.deepEqual(TEMPLATES.faq.cite({}, [{ faq_id: "Q01" }]), ["faq:Q01"]);
  assert.deepEqual(TEMPLATES.product_price.cite({}, [{ product_id: "P03" }]), ["products:P03"]);
  assert.deepEqual(TEMPLATES.intake_thread.cite({}, [{ thread_id: "F1" }]), ["intake_runtime:F1"]);
});

test("S0.2: every number in a FAQ answer appears in a policy row or a wiki page (contract drift)", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../data/synthetic/", import.meta.url);
  const parse = (txt) => {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (q) { if (c === '"' && txt[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && txt[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.length > 1 || row[0]) rows.push(row); row = []; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  };
  const faq = parse(readFileSync(new URL("faq.csv", dir), "utf8"));
  assert.deepEqual(faq[0], ["faq_id", "question", "answer", "keywords", "source"]);
  assert.equal(faq.length - 1, 12);
  const nums = (s) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const backing = new Set(readFileSync(new URL("policy.csv", dir), "utf8").split(/\r?\n/).flatMap(nums));
  for (const f of readdirSync(new URL("wiki/", dir))) for (const n of nums(readFileSync(new URL(`wiki/${f}`, dir), "utf8"))) backing.add(n);
  let numbered = 0;
  for (const [id, , answer, , source] of faq.slice(1)) {
    assert.ok(source, `${id} has a source`);
    for (const n of nums(answer)) { numbered++; assert.ok(backing.has(n), `${id}: number ${n} has no policy or wiki row behind it`); }
  }
  assert.ok(numbered >= 1, "the returns answer quotes the refund limit");
  const returns = faq.find((r) => /refund/i.test(r[1]));
  assert.match(returns[2], /150/);
  assert.match(returns[4], /refund-policy/);
});

test("S0.2: products have one price each and no tier columns", async () => {
  const { readFileSync } = await import("node:fs");
  const lines = readFileSync(new URL("../data/synthetic/products.csv", import.meta.url), "utf8").trim().split("\n");
  assert.equal(lines[0], "product_id,name,unit_price_usd,currency,min_order_qty,lead_days");
  assert.equal(lines.length, 11);
  assert.deepEqual(lines.slice(1).map((l) => Number(l.split(",")[2])).sort((a, b) => a - b), [29, 39, 49, 59, 79, 99, 119, 149, 189, 249]);
});

// ---- S1.1: free-text (F) tickets ----
const sampleCfg = config({ SAMPLE_MODE: "true" });
const intakeRow = (over = {}) => ({ thread_id: "F1", received_at: "2026-10-20T09:00:00.000Z", channel: "chat", sender_name: "", sender_email: "a@example.com",
  subject: "hello", body: "hello", scenario: "", category: "", ...over });
const intakeFacts = (topic, extra = {}) => factsForTicket("F1", { ticketSource: "intake", intakeRow: intakeRow(), topic, as_of: "2026-10-20", cfg: sampleCfg, ...extra });

test("F ticket, rfq: owner 6 / backup 14, both in, cited local", async () => {
  const f = await intakeFacts("rfq");
  assert.equal(f.category, "rfq");
  assert.equal(f.owner_id, 6); assert.equal(f.backup_id, 14);
  assert.equal(f.owner_out, false); assert.equal(f.backup_out, false);
  assert.equal(f.category_weight, 0.4); assert.equal(f.floor, 0.8);
  assert.ok(f.cited_rows.includes("intake_runtime:F1 (local)"));
  assert.ok(f.cited_rows.includes("responsibility:rfq"));
  assert.equal(f.may_leave, true); // a free-text ticket carries no authored flag
  assert.equal(f.as_of, "2026-10-20");
});

test("F ticket, refund with a typed amount over the limit goes to the over-limit owners", async () => {
  const f = await intakeFacts("refund", { amount: 400 });
  assert.equal(f.policy_limit_usd, 150);
  assert.equal(f.amount_usd, 400);
  assert.equal(f.owner_id, 3); assert.equal(f.backup_id, 4);
  assert.ok(f.cited_rows.includes("amount from the message"));
  const under = await intakeFacts("refund", { amount: 50 });
  assert.equal(under.owner_id, 15);
});

test("F ticket, customer_service: 7 / 15; owner 7 is out on 2026-10-23", async () => {
  const a = await intakeFacts("customer_service");
  assert.equal(a.owner_id, 7); assert.equal(a.backup_id, 15);
  assert.equal(a.owner_out, false);
  const b = await intakeFacts("customer_service", { as_of: "2026-10-23" });
  assert.equal(b.owner_out, true);
  assert.equal(b.backup_out, false);
  assert.ok(b.cited_rows.includes("holiday_2026:7@2026-10-23"));
});

test("F ticket read through intake_thread when published, cited without (local)", async () => {
  const seen = [];
  const sqlRunImpl = async (sql, opts) => {
    seen.push(opts.name);
    if (opts.name === "intake_thread") return { headers: Object.keys(intakeRow()), rows: [Object.values(intakeRow({ subject: "from zetaris" }))] };
    const { queryByName } = await import("../src/adapters/sample.mjs");
    return queryByName(opts.name, opts.params, { cfg: sampleCfg });
  };
  const f = await factsForTicket("F1", { ticketSource: "intake", intakeRow: intakeRow(), published: true, topic: "rfq", as_of: "2026-10-20", cfg: sampleCfg, sqlRunImpl });
  assert.ok(seen.includes("intake_thread"));
  assert.ok(seen.includes("holidays"));
  assert.equal(f.subject, "from zetaris");
  assert.ok(f.cited_rows.includes("intake_runtime:F1"));
  assert.ok(!f.cited_rows.some((c) => c.includes("(local)")));
});

test("a thread ticket read is unchanged by the intake switch", async () => {
  const f = await factsForTicket("T02", { cfg: sampleCfg });
  assert.equal(f.thread_id, "T02");
  assert.ok(f.cited_rows[0] === "threads_parquet:T02");
  assert.ok(!f.cited_rows.some((c) => c.startsWith("intake_runtime")));
});

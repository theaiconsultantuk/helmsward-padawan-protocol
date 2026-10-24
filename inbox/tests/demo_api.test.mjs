// GET /faq, GET /demo/scenarios, GET /demo/client and the 14 demo scenarios end to end in sample mode.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";
import { readCsv, loadTables } from "../src/csv.mjs";
import { runLocal } from "../src/queries.mjs";
import { GIVEN_NAMES, FAMILY_NAMES } from "../src/demo_names.mjs";

const inboxRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const synthetic = join(inboxRoot, "data", "synthetic");
const mk = (p) => mkdtempSync(join(tmpdir(), p));
const mkServer = async (cfgOver) => {
  const server = createServer({
    cfg: config({ SAMPLE_MODE: "true", ...cfgOver }),
    deps: { dir: mk("demo-rt-"), runtimeDir: mk("demo-intake-"), logsDir: mk("demo-logs-"), memoryDir: mk("demo-mem-"), quiet: true, publish: async () => ({ published: true, uncached: true }) },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};
let S, T; // open instance, token instance
before(async () => { S = await mkServer({ API_TOKEN: "" }); T = await mkServer({ API_TOKEN: "demo-token" }); });
after(() => { S.server.close(); T.server.close(); });
const get = (p, s = S) => fetch(s.base + p);
const customers = readCsv(join(synthetic, "customers.csv"));
const senders = new Set(readFileSync(join(synthetic, "threads", "threads.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).sender_email.toLowerCase()));

test("GET /faq returns the faq rows with exactly four fields and no source", async () => {
  const r = await get("/faq");
  assert.equal(r.status, 200);
  const rows = await r.json();
  const csv = readCsv(join(synthetic, "faq.csv"));
  assert.equal(rows.length, csv.length);
  rows.forEach((x, i) => {
    assert.deepEqual(Object.keys(x), ["faq_id", "question", "answer", "keywords"]);
    for (const k of ["faq_id", "question", "answer", "keywords"]) assert.equal(x[k], csv[i][k], `${x.faq_id}.${k}`);
  });
});

test("GET /demo/scenarios returns the 14 entries of the file; every reason of the set appears", async () => {
  const r = await get("/demo/scenarios");
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.deepEqual(list, JSON.parse(readFileSync(join(inboxRoot, "public", "demo-scenarios.json"), "utf8")));
  assert.equal(list.length, 14);
  assert.deepEqual(list.map((d) => d.id), Array.from({ length: 14 }, (_, i) => `s${String(i + 1).padStart(2, "0")}`));
  const set = ["Refund", "Question", "Quote", "Complaint", "Other", "Review", "Email"];
  for (const d of list) {
    assert.ok(set.includes(d.reason), `${d.id} reason ${d.reason}`);
    assert.deepEqual(Object.keys(d), ["id", "label", "scenario", "reason", "channel", "name", "email", "message", "as_of", "expected", "client"]);
    assert.ok(["random", "seeded-second-refund", "seeded-order-owner"].includes(d.client));
  }
  for (const r2 of set) assert.ok(list.some((d) => d.reason === r2), `no entry with reason ${r2}`);
  assert.equal(list.find((d) => d.id === "s13").channel, "trustpilot");
  assert.equal(list.find((d) => d.id === "s14").channel, "email");
  assert.equal(list.filter((d) => d.client === "seeded-second-refund").map((d) => d.id).join(), "s04");
  assert.equal(list.filter((d) => d.client === "seeded-order-owner").map((d) => d.id).join(), "s10");
  // the entries' own clients never collide with a seeded customer or an authored sender, except the seeded ones (s04's refund client, s10's order owner)
  for (const d of list.filter((x) => x.id !== "s04" && x.id !== "s10")) assert.ok(!senders.has(d.email) && !customers.some((c) => c.email === d.email), `${d.id} ${d.email}`);
});

test("the name lists are 40 + 40 distinct fictional parts and no combination hits customers.csv or a thread sender", () => {
  assert.equal(new Set(GIVEN_NAMES).size, 40);
  assert.equal(new Set(FAMILY_NAMES).size, 40);
  const names = new Set(customers.map((c) => c.name.toLowerCase()));
  for (const g of GIVEN_NAMES) for (const f of FAMILY_NAMES) {
    assert.ok(!names.has(`${g} ${f}`.toLowerCase()), `${g} ${f} is a customer`);
    assert.ok(!senders.has(`${g}${f}@email.com`.toLowerCase()), `${g}${f} is a sender`);
  }
});

test("GET /demo/client: 20 draws are 20 generated clients, none a customer or a thread sender; no-store", async () => {
  for (let i = 0; i < 20; i++) {
    const r = await get("/demo/client?scenario=s01");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const c = await r.json();
    assert.deepEqual(Object.keys(c), ["name", "email", "generated"]);
    assert.equal(c.generated, true);
    const [g, f] = c.name.split(" ");
    assert.ok(GIVEN_NAMES.includes(g) && FAMILY_NAMES.includes(f), c.name);
    assert.equal(c.email, `${g}${f}@email.com`.toLowerCase());
    assert.ok(!senders.has(c.email) && !customers.some((x) => x.email.toLowerCase() === c.email && x.name === c.name), c.email);
  }
  assert.equal((await get("/demo/client")).status, 200, "no scenario is a generated client too");
  assert.equal((await get("/demo/client?scenario=s99")).status, 400);
});

test("GET /demo/client?scenario=s04 is the seeded customers.csv row, with a prior refund on record", async () => {
  const r = await get("/demo/client?scenario=s04");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const c = await r.json();
  assert.equal(c.seeded_prior_refund, true);
  assert.equal(c.generated, false);
  const row = customers.find((x) => x.customer_id === c.customer_id);
  assert.ok(row && row.name === c.name && row.email === c.email);
  const entry = (await (await get("/demo/scenarios")).json()).find((d) => d.id === "s04");
  assert.equal(entry.email, c.email);
  const prior = runLocal("prior_refunds", { email: c.email, thread_id: "T99", received_at: "2026-10-30T00:00:00Z" }, loadTables(synthetic));
  assert.ok(prior.total >= 1, `prior refunds ${prior.total}`);
});

test("GET /demo/client?scenario=s10 is the customer on order JP-1001, the only sender the delivery road answers", async () => {
  const r = await get("/demo/client?scenario=s10");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const c = await r.json();
  assert.equal(c.generated, false);
  assert.equal(c.order_owner, true);
  const row = customers.find((x) => x.customer_id === c.customer_id);
  assert.ok(row && row.name === c.name && row.email === c.email);
  const entry = (await (await get("/demo/scenarios")).json()).find((d) => d.id === "s10");
  assert.equal(entry.email, c.email);
  assert.equal(entry.name, c.name);
});

test("the token applies to POST only: reads stay open, POST /run needs the bearer", async () => {
  for (const p of ["/faq", "/demo/scenarios", "/demo/client"]) assert.equal((await get(p, T)).status, 200, p);
  const body = JSON.stringify({ input: { thread_id: "T01" } });
  const bare = await fetch(T.base + "/run", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal(bare.status, 401);
  const ok = await fetch(T.base + "/run", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer demo-token" }, body });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(S.base + "/faq", { method: "POST", body: "{}" })).status, 405);
});

// who the run is with: output.owner, set on every decision (an auto reply names the default owner of the team it was sent on behalf of)
const ownerOf = (out) => out.owner?.employee_id ?? null;

test("the 14 demo scenarios, POSTed as the page does, yield exactly their expected block", async () => {
  const list = await (await get("/demo/scenarios")).json();
  for (const d of list) {
    const r = await fetch(S.base + "/run", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: `demo-${d.id}`, input: { message: d.message, from: d.email, name: d.name, channel: d.channel, scenario: d.scenario, as_of: d.as_of } }) });
    assert.equal(r.status, 200, d.id);
    const run = await r.json();
    const o = run.output, e = d.expected;
    assert.equal(o.decision, e.decision, `${d.id} decision: ${o.reasons?.[0]}`);
    assert.equal(run.branch_id, e.branch, `${d.id} branch`);
    assert.equal(ownerOf(o), e.owner_id, `${d.id} owner`);
    assert.equal(o.team, e.team, `${d.id} team`);
    assert.equal(o.auto_reply, e.auto_reply, `${d.id} auto_reply`);
    assert.equal(o.status, e.status, `${d.id} status`);
    assert.equal(Boolean(o.draft?.text), e.draft, `${d.id} draft`);
    assert.equal(Boolean(o.memory_note), e.memory_note ?? false, `${d.id} memory_note`);
    assert.deepEqual((o.cc ?? []).map((x) => x.id), e.cc ?? [], `${d.id} cc`);
  }
});

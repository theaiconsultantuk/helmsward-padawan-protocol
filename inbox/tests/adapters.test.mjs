import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.mjs";
import * as zetaris from "../src/adapters/zetaris.mjs";
import * as nightshift from "../src/adapters/nightshift.mjs";
import { fromFetchError, toApiError } from "../src/adapters/errors.mjs";
import { withMockFetch, mockRefused, mockTimeout } from "./helpers/mock_fetch.mjs";

const cfg = config({
  ZETARIS_REST_URL: "http://zetaris.test/api", ZETARIS_ORG_ID: "7", ZETARIS_API_KEY: "test-zet-key-0001",
  METERLESS_BASE_URL: "http://ns.test/v1/", METERLESS_RUNTIME_TOKEN: "test-ns-token-0001",
  NIGHTSHIFT_ROUTE_PRIMARY: "meterless/nemo", NIGHTSHIFT_ROUTE_FALLBACK: "meterless/local",
  NIGHTSHIFT_TIMEOUT_MS: "5000", SAMPLE_MODE: "false", FAULT_ZETARIS_REFUSE_ONCE: "false",
});
const fakeTrace = () => { const lines = []; return { lines, line: (l) => lines.push(l) }; };
// Stand-in for adapters/sample.mjs. Real contract assumed: queryByName(name, params, { cfg }) -> {headers, rows, total}.
const sampleImpl = { queryByName: async (name) => ({ headers: ["id"], rows: [[1], [2]], total: 2, name }) };
const chatOk = (model) => ({ body: { model, choices: [{ message: { content: " hi " } }] } });

test("errors: classification and api shape", () => {
  assert.equal(fromFetchError(mockTimeout()).name, "UpstreamTimeout");
  assert.equal(fromFetchError(mockRefused()).name, "UpstreamRefused");
  const nested = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("x"), { code: "ENOTFOUND" }) });
  assert.equal(fromFetchError(nested).name, "UpstreamRefused");
  assert.equal(fromFetchError(new Error("weird")).name, "BadResponse");
  assert.deepEqual(toApiError(fromFetchError(mockTimeout())).recoverable, true);
});

test("zetaris happy path maps data to rows with the right headers and body", async () => {
  zetaris.resetFaults();
  const tr = fakeTrace();
  await withMockFetch([{ match: () => true, reply: () => ({ body: { headers: ["a"], data: [[1], [2], [3]], total: 3, timeUsed: 12 } }) }], async (calls) => {
    const r = await zetaris.sqlRun("SELECT a", { name: "q1", cfg, trace: tr, limit: 5 });
    assert.deepEqual(r.rows, [[1], [2], [3]]);
    assert.equal(r.source, "live");
    assert.equal(calls[0].url, "http://zetaris.test/api/sql-editor/sqls/run");
    const h = calls[0].init.headers;
    assert.equal(h.Authorization, "Bearer test-zet-key-0001");
    assert.equal(h["X-Org-ID"], "7");
    assert.ok(h["X-Request-ID"]);
    const b = JSON.parse(calls[0].init.body);
    assert.equal(b.sql, "SELECT a"); assert.equal(b.source, "SqlEditor"); assert.equal(b.limit, 5); assert.ok(b.queryId);
  });
  assert.equal(tr.lines[0].step, "zetaris.query");
  assert.equal(tr.lines[0].status, "success");
  assert.equal(tr.lines[0].sponsor, "zetaris");
  assert.match(tr.lines[0].output_summary, /q1: 3 rows in 12 ms/);
});

test("zetaris 401 is Unauthorized, 500 is BadResponse", async () => {
  await withMockFetch([{ match: () => true, reply: () => ({ status: 401, body: {} }) }], async () => {
    await assert.rejects(zetaris.sqlRun("x", { cfg }), { name: "Unauthorized" });
  });
  await withMockFetch([{ match: () => true, reply: () => ({ status: 500, body: {} }) }], async () => {
    await assert.rejects(zetaris.sqlRun("x", { cfg }), (e) => e.name === "BadResponse" && e.status === 500);
  });
});

test("zetaris fault switch: genuine refusal on a closed loopback port, then cached rows, error then recovery", async () => {
  zetaris.resetFaults();
  const tr = fakeTrace();
  const fcfg = { ...cfg, FAULT_ZETARIS_REFUSE_ONCE: "true" };
  const r = await zetaris.sqlRun("SELECT 1", { name: "q1", cfg: fcfg, trace: tr, sampleImpl }); // real fetch to a closed local port
  assert.equal(r.source, "cache");
  assert.deepEqual(r.rows, [[1], [2]]);
  assert.deepEqual(tr.lines.map((l) => [l.step, l.status]), [["zetaris.query", "error"], ["recovery", "success"]]);
  assert.equal(tr.lines[1].output_summary, "Zetaris refused once; answered from the cached rows");
  // second call is no longer faulted: goes to the (mocked) live service
  await withMockFetch([{ match: () => true, reply: () => ({ body: { headers: ["a"], data: [[9]], total: 1, timeUsed: 1 } }) }], async () => {
    assert.equal((await zetaris.sqlRun("SELECT 1", { name: "q1", cfg: fcfg, sampleImpl })).source, "live");
  });
  zetaris.resetFaults();
});

test("zetaris without the switch retries a refusal once, then falls back to cache", async () => {
  zetaris.resetFaults();
  const tr = fakeTrace();
  await withMockFetch([{ match: () => true, reply: () => { throw mockRefused(); } }], async (calls) => {
    const r = await zetaris.sqlRun("SELECT 1", { name: "q1", cfg, trace: tr, sampleImpl, retryDelayMs: 1 });
    assert.equal(r.source, "cache");
    assert.equal(calls.length, 2);
  });
  assert.deepEqual(tr.lines.map((l) => [l.step, l.status]), [["zetaris.query", "error"], ["recovery", "success"]]);
});

test("zetaris sample mode answers from cache without network and needs a name", async () => {
  const scfg = { ...cfg, SAMPLE_MODE: "true" };
  await withMockFetch([], async (calls) => {
    assert.equal((await zetaris.sqlRun("x", { name: "q1", cfg: scfg, sampleImpl })).source, "cache");
    await assert.rejects(zetaris.sqlRun("x", { cfg: scfg, sampleImpl }), { name: "BadResponse" });
    assert.equal(calls.length, 0);
  });
});

test("nightshift status: 401 unauthorized, meterless ids online, otherwise offline; no /v1/v1", async () => {
  await withMockFetch([{ match: () => true, reply: () => ({ status: 401, body: {} }) }], async () => {
    assert.equal((await nightshift.status({ cfg })).state, "unauthorized");
  });
  await withMockFetch([{ match: () => true, reply: () => ({ body: { data: [{ id: "meterless/local" }, { id: "x" }] } }) }], async (calls) => {
    const s = await nightshift.status({ cfg });
    assert.equal(s.state, "online");
    assert.deepEqual(s.models, ["meterless/local", "x"]);
    assert.equal(calls[0].url, "http://ns.test/v1/models");
    assert.equal(calls[0].init.headers["meterless-app"], "jedi-pack-inbox");
  });
  await withMockFetch([{ match: () => true, reply: () => ({ body: { data: [{ id: "other" }] } }) }], async () => {
    assert.equal((await nightshift.status({ cfg })).state, "offline");
  });
});

test("nightshift primary timeout then fallback 200: one retry line, route meterless/local, no /v1/v1", async () => {
  const tr = fakeTrace();
  const routes = [
    { match: (u, i) => JSON.parse(i.body).model === "meterless/nemo", reply: () => { throw mockTimeout(); } },
    { match: (u, i) => JSON.parse(i.body).model === "meterless/local", reply: () => chatOk("local-model") },
  ];
  await withMockFetch(routes, async (calls) => {
    const r = await nightshift.draft([{ role: "user", content: "hi" }], { cfg, trace: tr });
    assert.equal(r.route, "meterless/local");
    assert.equal(r.model, "local-model");
    assert.equal(r.text, "hi");
    assert.equal(calls.length, 2);
    for (const c of calls) { assert.equal(c.url, "http://ns.test/v1/chat/completions"); assert.ok(!c.url.includes("/v1/v1")); }
    const h = calls[0].init.headers;
    assert.equal(h["meterless-scope"], "user"); assert.equal(h.Authorization, "Bearer test-ns-token-0001");
  });
  const retries = tr.lines.filter((l) => l.step === "retry");
  assert.equal(retries.length, 1);
  assert.equal(retries[0].status, "retrying");
  assert.match(retries[0].output_summary, /meterless\/nemo.*UpstreamTimeout.*meterless\/local/);
});

test("nightshift primary 404 model_not_found fires the fallback", async () => {
  const routes = [
    { match: (u, i) => JSON.parse(i.body).model === "meterless/nemo", reply: () => ({ status: 404, body: { error: { code: "model_not_found" } } }) },
    { match: () => true, reply: () => chatOk("m") },
  ];
  await withMockFetch(routes, async (calls) => {
    assert.equal((await nightshift.draft([], { cfg })).route, "meterless/local");
    assert.equal(calls.length, 2);
  });
});

test("nightshift Unauthorized on primary is thrown with no fallback call; plain 400 does not retry", async () => {
  await withMockFetch([{ match: () => true, reply: () => ({ status: 401, body: {} }) }], async (calls) => {
    await assert.rejects(nightshift.draft([], { cfg }), { name: "Unauthorized" });
    assert.equal(calls.length, 1);
  });
  await withMockFetch([{ match: () => true, reply: () => ({ status: 400, body: { error: "bad" } }) }], async (calls) => {
    await assert.rejects(nightshift.draft([], { cfg }), (e) => e.name === "BadResponse" && !e.recoverable);
    assert.equal(calls.length, 1);
  });
});

test("nightshift fallback failure rethrows; sample mode makes no call", async () => {
  await withMockFetch([{ match: () => true, reply: () => ({ status: 503, body: {} }) }], async (calls) => {
    await assert.rejects(nightshift.draft([], { cfg }), (e) => e.status === 503);
    assert.equal(calls.length, 2);
  });
  await withMockFetch([], async (calls) => {
    const r = await nightshift.draft([], { cfg: { ...cfg, SAMPLE_MODE: "true" } });
    assert.equal(r.model, "sample/rules"); assert.equal(r.text, null); assert.equal(calls.length, 0);
  });
});

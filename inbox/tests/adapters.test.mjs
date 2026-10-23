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

test("nightshift primary timeout twice then fallback 200: retry_primary then fallback_route, route meterless/local, no /v1/v1", async () => {
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
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).model), ["meterless/nemo", "meterless/nemo", "meterless/local"]);
    for (const c of calls) { assert.equal(c.url, "http://ns.test/v1/chat/completions"); assert.ok(!c.url.includes("/v1/v1")); }
    const h = calls[0].init.headers;
    assert.equal(h["meterless-scope"], "user"); assert.equal(h.Authorization, "Bearer test-ns-token-0001");
  });
  const retries = tr.lines.filter((l) => l.step === "retry");
  assert.equal(retries.length, 2);
  assert.equal(retries[0].action, "retry_primary"); assert.equal(retries[0].retry_count, 1); assert.equal(retries[0].status, "retrying");
  assert.match(retries[0].output_summary, /meterless\/nemo failed \(UpstreamTimeout\); trying meterless\/nemo once more/);
  assert.equal(retries[1].action, "fallback_route"); assert.equal(retries[1].retry_count, 2); assert.equal(retries[1].status, "retrying");
  assert.match(retries[1].output_summary, /meterless\/nemo.*UpstreamTimeout.*meterless\/local/);
});

test("nightshift primary timeout once then 200 on the second attempt: route stays primary, one retry_primary line, no fallback call", async () => {
  const tr = fakeTrace();
  let n = 0;
  const routes = [
    { match: (u, i) => JSON.parse(i.body).model === "meterless/nemo", reply: () => { n += 1; if (n === 1) throw mockTimeout(); return chatOk("nemo-model"); } },
    { match: () => true, reply: () => chatOk("never") },
  ];
  await withMockFetch(routes, async (calls) => {
    const r = await nightshift.draft([{ role: "user", content: "hi" }], { cfg, trace: tr });
    assert.equal(r.route, "meterless/nemo");
    assert.equal(r.model, "nemo-model");
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => JSON.parse(c.init.body).model === "meterless/nemo"));
  });
  const retries = tr.lines.filter((l) => l.step === "retry");
  assert.equal(retries.length, 1);
  assert.equal(retries[0].action, "retry_primary"); assert.equal(retries[0].sponsor, "meterless");
});

test("nightshift primary 502 is retried once on the primary; 404 unknown model is not", async () => {
  const tr = fakeTrace();
  const routes = [
    { match: (u, i) => JSON.parse(i.body).model === "meterless/nemo", reply: () => ({ status: 502, body: {} }) },
    { match: () => true, reply: () => chatOk("local-model") },
  ];
  await withMockFetch(routes, async (calls) => {
    assert.equal((await nightshift.draft([], { cfg, trace: tr })).route, "meterless/local");
    assert.equal(calls.length, 3);
  });
  assert.deepEqual(tr.lines.filter((l) => l.step === "retry").map((l) => l.action), ["retry_primary", "fallback_route"]);
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
    assert.equal(calls.length, 3); // primary, primary once more, fallback
  });
  await withMockFetch([], async (calls) => {
    const r = await nightshift.draft([], { cfg: { ...cfg, SAMPLE_MODE: "true" } });
    assert.equal(r.model, "sample/rules"); assert.equal(r.text, null); assert.equal(calls.length, 0);
  });
});

// ---- task 0.9: direct local lane (only when the Nightshift endpoint itself is unreachable) ----
const laneCfg = { ...cfg, LOCAL_LANE_BASE_URL: "http://lane.test/v1", LOCAL_LANE_MODELS: "meta/muse-glimmer,ternary-bonsai-2-27b-mlx,qwen/qwen3.8-27b", LOCAL_LANE_TIMEOUT_MS: "5000" };
const isLane = (u) => u.startsWith("http://lane.test/");
const withoutLaneEnv = async (fn) => {
  const saved = ["LOCAL_LANE_BASE_URL", "LOCAL_LANE_MODELS", "LOCAL_LANE_TIMEOUT_MS"].map((k) => [k, process.env[k]]);
  for (const [k] of saved) delete process.env[k];
  try { return await fn(); } finally { for (const [k, v] of saved) if (v !== undefined) process.env[k] = v; }
};

test("local lane: both Nightshift routes refused -> lane serves, two retry lines, route and model from the lane", () => withoutLaneEnv(async () => {
  const tr = fakeTrace();
  const routes = [
    { match: (u) => !isLane(u), reply: () => { throw mockRefused(); } },
    { match: isLane, reply: () => chatOk("meta/muse-glimmer") },
  ];
  await withMockFetch(routes, async (calls) => {
    const r = await nightshift.draft([{ role: "user", content: "hi" }], { cfg: laneCfg, trace: tr });
    assert.equal(r.route, "local-lane:meta/muse-glimmer");
    assert.equal(r.model, "meta/muse-glimmer");
    assert.equal(r.lane, "local-lane"); assert.equal(r.sponsor, null); assert.equal(r.text, "hi");
    assert.equal(calls.length, 3);
    const laneCall = calls[2];
    assert.equal(laneCall.url, "http://lane.test/v1/chat/completions");
    assert.equal(laneCall.init.headers.Authorization, undefined);
    const b = JSON.parse(laneCall.init.body);
    assert.equal(b.temperature, 0.2); assert.equal(b.max_tokens, 1024);
  });
  const retries = tr.lines.filter((l) => l.step === "retry");
  assert.equal(retries.length, 2);
  assert.equal(retries[1].retry_count, 2); assert.equal(retries[1].action, "fallback_local_lane"); assert.equal(retries[1].agent_name, "Provider");
  assert.match(retries[1].output_summary, /Nightshift unreachable \(UpstreamRefused\); trying local lane meta\/muse-glimmer/);
}));

test("local lane: Nightshift answered 503 twice (it is up) -> no lane call, the 503 is rethrown", () => withoutLaneEnv(async () => {
  await withMockFetch([{ match: () => true, reply: () => ({ status: 503, body: {} }) }], async (calls) => {
    await assert.rejects(nightshift.draft([], { cfg: laneCfg }), (e) => e.status === 503);
    assert.equal(calls.length, 3); // primary, primary once more, fallback; never the lane
    assert.ok(!calls.some((c) => isLane(c.url)));
  });
}));

test("local lane: first model refused, second answers -> route names the second", () => withoutLaneEnv(async () => {
  const routes = [
    { match: (u, i) => isLane(u) && JSON.parse(i.body).model === "meta/muse-glimmer", reply: () => { throw mockRefused(); } },
    { match: (u, i) => isLane(u) && JSON.parse(i.body).model === "ternary-bonsai-2-27b-mlx", reply: () => chatOk("ternary-bonsai-2-27b-mlx") },
  ];
  await withMockFetch(routes, async (calls) => {
    const r = await nightshift.localLane([{ role: "user", content: "hi" }], { cfg: laneCfg });
    assert.equal(r.route, "local-lane:ternary-bonsai-2-27b-mlx");
    assert.equal(r.model, "ternary-bonsai-2-27b-mlx");
    assert.equal(calls.length, 2);
  });
  await withMockFetch([{ match: isLane, reply: () => { throw mockRefused(); } }], async (calls) => {
    await assert.rejects(nightshift.localLane([], { cfg: laneCfg }), { name: "UpstreamRefused" });
    assert.equal(calls.length, 3);
  });
}));

test("local lane: LOCAL_LANE_BASE_URL empty -> disabled, draft behaves as before", () => withoutLaneEnv(async () => {
  await withMockFetch([{ match: () => true, reply: () => { throw mockRefused(); } }], async (calls) => {
    await assert.rejects(nightshift.draft([], { cfg: { ...laneCfg, LOCAL_LANE_BASE_URL: "" } }), { name: "UpstreamRefused" });
    assert.equal(calls.length, 2);
    assert.ok(!calls.some((c) => isLane(c.url)));
  });
}));

test("local lane: Unauthorized from Nightshift never retries and never reaches the lane", () => withoutLaneEnv(async () => {
  await withMockFetch([{ match: () => true, reply: () => ({ status: 401, body: {} }) }], async (calls) => {
    await assert.rejects(nightshift.draft([], { cfg: laneCfg }), { name: "Unauthorized" });
    assert.equal(calls.length, 1);
  });
}));

test("F3: local lane fallback with a real Trace -> draft resolves, retry line has no sponsor key", () => withoutLaneEnv(async () => {
  const { Trace } = await import("../src/trace.mjs");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const logsDir = mkdtempSync(`${tmpdir()}/ns-trace-`);
  const tr = Trace.open("f3-run", { logsDir, secrets: [], stdout: false });
  const routes = [
    { match: (u) => !isLane(u), reply: () => { throw mockRefused(); } },
    { match: isLane, reply: () => chatOk("meta/muse-glimmer") },
  ];
  await withMockFetch(routes, async () => {
    const r = await nightshift.draft([{ role: "user", content: "hi" }], { cfg: laneCfg, trace: tr });
    assert.equal(r.route, "local-lane:meta/muse-glimmer");
  });
  const lines = readFileSync(tr.path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const lane = lines.find((l) => l.action === "fallback_local_lane");
  assert.ok(lane);
  assert.ok(!("sponsor" in lane));
}));

test("F3b: local lane next-model retry with a real Trace does not throw and carries no sponsor key", () => withoutLaneEnv(async () => {
  const { Trace } = await import("../src/trace.mjs");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tr = Trace.open("f3b-run", { logsDir: mkdtempSync(`${tmpdir()}/ns-trace-`), secrets: [], stdout: false });
  let n = 0;
  await withMockFetch([{ match: isLane, reply: () => (n++ === 0 ? { status: 503, body: {} } : chatOk("ternary-bonsai-2-27b-mlx")) }], async () => {
    const r = await nightshift.localLane([{ role: "user", content: "hi" }], { cfg: laneCfg, trace: tr });
    assert.equal(r.model, "ternary-bonsai-2-27b-mlx");
  });
  const l = readFileSync(tr.path, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x)).find((x) => x.action === "local_lane_next_model");
  assert.ok(l && !("sponsor" in l));
}));

test("(b) draft() forwards the run's AbortSignal to fetch: a hanging call is aborted when the signal aborts", async () => {
  let fetchSignal = null;
  const fetchImpl = (url, init) => new Promise((_, rej) => {
    fetchSignal = init.signal;
    init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const ac = new AbortController();
  const p = nightshift.draft([{ role: "user", content: "hi" }], { cfg, fetchImpl, signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(p, (e) => e.name === "UpstreamTimeout" && e.cause?.name === "AbortError");
  assert.equal(fetchSignal.aborted, true);
});

test("(b) first attempt times out, the run aborts during the second attempt: exactly two primary calls, no fallback call", async () => {
  let n = 0;
  const ac = new AbortController();
  const fetchImpl = (url, init) => {
    n += 1;
    if (n === 1) return Promise.reject(mockTimeout());
    return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  };
  const tr = fakeTrace();
  const p = nightshift.draft([{ role: "user", content: "hi" }], { cfg, fetchImpl, trace: tr, signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(p, (e) => e.name === "UpstreamTimeout");
  assert.equal(n, 2);
  assert.deepEqual(tr.lines.filter((l) => l.step === "retry").map((l) => l.action), ["retry_primary"]);
});

test("(b) openjev systemone() forwards the AbortSignal to fetch", async () => {
  const { systemone } = await import("../src/adapters/openjev.mjs");
  let fetchSignal = null;
  const fetchImpl = (url, init) => new Promise((_, rej) => {
    fetchSignal = init.signal;
    init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const ac = new AbortController();
  const p = systemone("s", {}, { cfg, fetchImpl, signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(p, { name: "UpstreamTimeout" });
  assert.equal(fetchSignal.aborted, true);
});

test("(14) zetaris keeps the first 300 chars of a non-ok body in message and detail", async () => {
  const body = "[TABLE_OR_VIEW_NOT_FOUND] The table or view `JEDI_PACK`.`x` cannot be found. " + "y".repeat(500);
  await withMockFetch([{ match: () => true, reply: () => ({ status: 400, body }) }], async () => {
    await assert.rejects(zetaris.sqlRun("x", { cfg }), (e) =>
      e.name === "BadResponse" && e.status === 400 && /TABLE_OR_VIEW_NOT_FOUND/.test(e.message) && e.detail.length <= 300 && e.detail.startsWith("[TABLE_OR_VIEW_NOT_FOUND]"));
  });
});

test("nightshift: the receipt's routed_model wins over body.model, and the phases are kept", () => {
  const raw = { body: { model: "nvidia/nemotron-3.5-lightning-30b-a3b", meterless: { schema: "meterless.compute_receipt.v1", receipt_id: "rcpt_x", requested_model: "nvidia/nemotron-3.5-lightning-30b-a3b", routed_model: "webllm/SmolLM2-1.7B-Instruct-q4f16_1-MLC", phases: [{ phase: "final_synthesis", model: "webllm/SmolLM2-1.7B-Instruct-q4f16_1-MLC", ms: 200 }] } }, headers: {} };
  assert.equal(nightshift.handledModel(raw), "webllm/SmolLM2-1.7B-Instruct-q4f16_1-MLC", "the lane that served, not the echoed request");
  const r = nightshift.receiptOf(raw);
  assert.equal(r.requested_model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.deepEqual(r.phases, [{ phase: "final_synthesis", model: "webllm/SmolLM2-1.7B-Instruct-q4f16_1-MLC" }]);
  assert.equal(nightshift.handledModel({ body: { model: "m-only" }, headers: {} }), "m-only", "no receipt: body.model as before");
  assert.equal(nightshift.receiptOf({ body: { model: "m-only" } }), null);
});

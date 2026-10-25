// Boundary: fallback answers retain their provenance without exposing adapter error messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.mjs";
import * as ns from "../src/adapters/nightshift.mjs";
const cfg = config({ SAMPLE_MODE: "false", METERLESS_BASE_URL: "http://nightshift.test/v1", NIGHTSHIFT_ROUTE_PRIMARY: "nvidia/nemotron-x", NIGHTSHIFT_ROUTE_FALLBACK: "meterless/local", LOCAL_LANE_BASE_URL: "http://lane.test/v1", LOCAL_LANE_MODELS: "llama-x" });
const ok = () => new Response(JSON.stringify({ model: "llama-x", choices: [{ message: { content: "hello" } }] }));
test("fallback route carries the first failure and preserves retries; primary and sample have no marker", async () => {
  const lines = []; let n = 0;
  const r = await ns.draft([], { cfg, trace: { line: (l) => lines.push(l) }, fetchImpl: async () => ++n < 3 ? new Response("private /opt/path", { status: 503 }) : ok() });
  assert.deepEqual(r.fallback, { reason: "BadResponse HTTP 503", route: "meterless/local" });
  assert.deepEqual(lines.map((l) => l.action), ["retry_primary", "fallback_route"]);
  assert.equal(ns.fallbackOf(await ns.draft([], { cfg, fetchImpl: async () => ok() })), null);
  assert.equal(ns.fallbackOf(await ns.draft([], { cfg: { ...cfg, SAMPLE_MODE: "true" } })), null);
});
test("refused Nightshift falls through to local lane; malformed markers are absent", async () => {
  const saved = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith("LOCAL_LANE_")).map((k) => [k, process.env[k]]));
  for (const k of Object.keys(saved)) delete process.env[k];
  try {
    const r = await ns.draft([], { cfg, fetchImpl: async (url) => { if (url.startsWith("http://lane.test/")) return ok(); throw Object.assign(new Error("/home/private"), { code: "ECONNREFUSED" }); } });
    assert.deepEqual(ns.fallbackOf(r), { reason: "UpstreamRefused", route: "local-lane" });
    assert.equal(r.lane, "local-lane");
    for (const v of [null, {}, { fallback: {} }]) assert.equal(ns.fallbackOf(v), null);
  } finally { Object.assign(process.env, saved); }
});

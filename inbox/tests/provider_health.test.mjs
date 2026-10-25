// Boundary: health remains available through failed/hanging probes and refreshes without model work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProviderHealth } from "../src/provider_health.mjs";
const keys = ["mode", "reachable", "probe", "nemotron_listed", "checked_at", "last_primary_answer_at", "last_fallback_at", "last_fallback_reason", "fallback_in_use"];
test("cold probe, cached TTL refresh, passive outcomes and offline errors have the exact safe contract", async () => {
  let t = 1000, n = 0;
  const h = createProviderHealth({ sample: false, now: () => t, ttlMs: 60, statusFn: async () => { n++; return { state: n === 1 ? "online" : "offline", models: n === 1 ? ["meterless/auto", "nvidia/nemotron-x"] : [], error: "/opt/private" }; } });
  const first = await h.snapshot(); assert.deepEqual(Object.keys(first), keys); assert.equal(first.reachable, true); assert.equal(first.nemotron_listed, true);
  await h.snapshot(); assert.equal(n, 1);
  h.note({ primary_used: true }); t++; h.note({ primary_used: false, fallback_reason: "draft: failed" }); assert.equal((await h.snapshot()).fallback_in_use, true);
  t++; h.note({ primary_used: true }); assert.equal((await h.snapshot()).fallback_in_use, false);
  t += 100; assert.equal((await h.snapshot()).reachable, true);
  await new Promise((r) => setImmediate(r)); const offline = await h.snapshot(); assert.equal(n, 2); assert.equal(offline.reachable, false); assert.equal(offline.nemotron_listed, false); assert.equal(offline.fallback_in_use, true); assert.ok(!JSON.stringify(offline).includes("/opt/"));
  const down = createProviderHealth({ sample: false, statusFn: async () => { throw Error("private"); } }); assert.equal((await down.snapshot()).probe, "offline");
});
test("sample never probes; first hanging probe has a bounded wait and concurrent requests share it", async () => {
  let n = 0; const h = createProviderHealth({ sample: true, statusFn: () => { n++; } }); assert.equal((await h.snapshot()).mode, "sample"); assert.equal(n, 0);
  const live = createProviderHealth({ sample: false, firstWaitMs: 20, statusFn: () => { n++; return new Promise(() => {}); } }); const keep = setTimeout(() => {}, 1000);
  try { const start = Date.now(); const a = live.snapshot(); const b = live.snapshot(); assert.equal((await b).reachable, null); assert.equal((await a).reachable, null); assert.ok(Date.now() - start < 500); assert.equal(n, 1); } finally { clearTimeout(keep); }
});

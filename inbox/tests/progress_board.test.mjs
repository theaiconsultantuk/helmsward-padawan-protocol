// Boundaries: concurrent work, fallback provenance, immutable completion and stored projection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createProgressBoard, providerSummary, progressFromStored, stepOf, isNemotron } from "../src/progress.mjs";
const line = { step: "nvidia.model", agent_name: "Drafter", action: "draft_reply", model: "nvidia/nemotron-x", status: "success", duration_ms: 123, input_summary: "/opt/private", output_summary: "/home/private", detail: "/tmp/private" };
test("board lifecycle keeps concurrent work and retry provenance, freezes at first finish and matches stored projection", () => {
  let t = 1000; const b = createProgressBoard({ cap: 1, now: () => t });
  assert.equal(b.get("empty"), null);
  const e = b.start("r", { mode: "live", fallbackRoute: "local" }); assert.equal(b.start("r", { mode: "sample" }), e);
  const endD = b.work("r", { purpose: "draft" }); const endC = b.work("r", { purpose: "critique" });
  t = 2000; assert.equal(b.get("r").working.length, 2);
  const retry = { ...line, step: "retry", action: "fallback_route", input_summary: "draft" }; b.line("r", retry);
  assert.equal(b.get("r").working[0].engine, "Nightshift (local)"); assert.equal(b.get("r").provider.primary_used, false);
  endD({ primary: false, reason: "draft: fallback" }); endC({ primary: true }); assert.equal(b.get("r").provider.fallback_reason, "draft: fallback");
  const early = { decision: "escalate", branch_id: "over-limit", draft_pending: true, why: "over limit", at_s: 1 };
  b.decided("r", early); b.decided("r", { decision: "close" }); b.line("r", line);
  assert.deepEqual(Object.keys(stepOf(line)), ["step", "agent", "label", "tech", "status", "seconds", "ran_s", "seen_s"]);
  const result = { run_id: "r", status: "success", output: { decision: "escalate" }, execution_time_seconds: 1.234, decision_early: early, provider: providerSummary([{ primary: false, reason: "draft: fallback" }], "live") };
  b.finish("r", result); const done = b.get("r"); t = 10000;
  b.line("r", line); b.decided("r", {}); endD({ primary: true }); b.work("r", { purpose: "draft" })(); b.finish("r", { status: "error" }); assert.deepEqual(b.get("r"), done);
  assert.deepEqual(progressFromStored(result, [retry, line]), done);
  b.start("running", { mode: "sample" }); b.start("new", { mode: "sample" }); b.finish("new", {});
  assert.equal(b.get("r"), null); assert.equal(b.get("running").state, "running");
});
test("provider summary distinguishes no calls, primary, fallback, failure and sample; doctor candidate ids agree", () => {
  assert.equal(providerSummary([], "live").primary_used, null); assert.equal(providerSummary([{ primary: true }], "live").primary_used, true);
  assert.equal(providerSummary([{ primary: false, reason: null }, { primary: false, reason: "critique: failed" }], "live").fallback_reason, "critique: failed");
  assert.deepEqual(providerSummary([{ primary: false, reason: "x" }], "sample"), { mode: "sample", primary_used: null, fallback_reason: null, calls: 1 });
  const candidates = readFileSync(new URL("../src/cli.mjs", import.meta.url), "utf8").match(/const CANDIDATES = \[([\s\S]*?)\];/)[1].match(/"[^"]+"/g).map(JSON.parse);
  for (const id of candidates) assert.equal(isNemotron(id), id.startsWith("nvidia/nemotron"));
});

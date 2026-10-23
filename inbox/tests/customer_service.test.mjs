// The customer-service route through runTicket in sample mode (S3.1): a recommendation and a draft with blanks, held for the Support Lead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { hardRisk } from "../src/gates.mjs";
import { blanks } from "../src/scenarios.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
const example = (n) => JSON.parse(readFileSync(join(INBOX_ROOT, "input_examples", `example_${n}.json`), "utf8")).input;
async function go(run_id, input, extra = {}) {
  const d = { logsDir: mkdtempSync(join(tmpdir(), "cs-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "cs-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "cs-run-")), quiet: true, ...extra };
  const result = await runTicket(null, { run_id, cfg, as_of: input.as_of, input, deps: d });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines };
}

test("example 9 resolves to customer service and holds a recommendation plus a draft with blanks for the Support Lead", async () => {
  const { result, lines } = await go("cs-9", example(9));
  const o = result.output;
  assert.equal(result.scenario, "customer_service");
  assert.ok(["none", "unrouted"].includes(result.resolved_how), result.resolved_how);
  assert.equal(result.branch_id, "customer-service");
  assert.equal(o.decision, "hold");
  assert.equal(o.queued_for.owner_id, 7);
  assert.ok(o.recommendation.length > 0);
  assert.ok(o.draft.text);
  assert.ok(o.draft.blanks.length >= 1, "draft.blanks lists the unknowns");
  const listed = o.draft.blanks.map((b) => b.what.toLowerCase());
  for (const w of blanks(o.draft.text)) assert.ok(listed.includes(w.toLowerCase()), `blank "${w}" is listed`);
  assert.deepEqual(hardRisk({ restricted_terms: ["card number"], policy_limit_usd: 150, may_leave: true }, o.draft).reasons, []);
  const rec = lines.find((l) => l.step === "nvidia.model" && l.action === "recommend");
  assert.ok(rec, "nvidia.model recommend line");
  assert.equal(rec.agent_name, "Recommender");
  assert.ok(lines.some((l) => l.step === "meterless.engine" && l.action === "world_context"));
});

test("a draft naming an amount above the limit is withheld: Risk refuses, the ticket still holds with the recommendation", async () => {
  const drafter = async () => ({ model: "stub/nemotron", text: JSON.stringify({ recommendation: "customer wants an address change; confirm the order", draft: "Hello Lea,\n\nWe will refund 400 USD to you today.\n\nBest regards,\nJedi Pack Support", blanks: [] }) });
  const { result, lines } = await go("cs-withheld", example(9), { drafter });
  const o = result.output;
  assert.equal(o.decision, "hold");
  assert.equal(o.queued_for.owner_id, 7);
  assert.equal(o.recommendation, "customer wants an address change; confirm the order");
  assert.ok(!o.draft, "no draft in the result");
  assert.match(o.reasons.join(" "), /draft withheld/);
  const risks = lines.filter((l) => l.step === "risk.signoff");
  assert.equal(risks.at(-1).status, "refused");
  assert.match(risks.at(-1).output_summary, /400/);
  assert.equal(lines.filter((l) => l.step === "nvidia.model" && l.action === "recommend").length, 2, "one rewrite only");
});

test("blanks the model forgot to list are added, not failed", async () => {
  const drafter = async () => ({ model: "stub/nemotron", text: JSON.stringify({ recommendation: "check the order", draft: "Hello,\n\nWe will look at order [[blank: order number]] for you.\n\nBest regards,\nJedi Pack Support", blanks: [] }) });
  const { result } = await go("cs-blanks", example(9), { drafter });
  assert.equal(result.output.decision, "hold");
  assert.deepEqual(result.output.draft.blanks.map((b) => b.what), ["order number"]);
});

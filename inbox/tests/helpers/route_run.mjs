// A message run through runTicket in sample mode with its own temp dirs: the shared start of the route tests.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../src/config.mjs";
import { runTicket } from "../../src/loop.mjs";

export const cfg = () => ({ ...config(), SAMPLE_MODE: "true" });
export const dirs = (runtimeDir = mkdtempSync(join(tmpdir(), "route-rt-")), memoryDir = mkdtempSync(join(tmpdir(), "route-mem-"))) =>
  ({ logsDir: mkdtempSync(join(tmpdir(), "route-logs-")), memoryDir, runtimeDir, quiet: true });

export async function runMessage(input, { as_of = "2026-10-20", d = dirs(), run_id = "route", extra = {} } = {}) {
  const result = await runTicket(null, { run_id, cfg: cfg(), as_of, input, deps: { ...d, ...extra } });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines, d };
}

export const msg = (message, channel = "chat", from = "a@email.com", extra = {}) => ({ message, from, channel, ...extra });

// auto_reply true => a sent draft; a hold or escalate is never an auto reply. Checked on the output and on the queue file when there is one.
export function assertAutoReplyInvariant(assert, result, label = "") {
  const o = result.output;
  if (o.auto_reply) assert.ok(o.decision === "send" && o.draft?.text, `${label} auto_reply is a sent draft`);
  if (o.decision !== "send") assert.equal(o.auto_reply, false, `${label} ${o.decision} is never an auto reply`);
  if (o.queued_for) assert.equal(o.queued_for.auto_reply, o.auto_reply, `${label} queued_for agrees`);
}

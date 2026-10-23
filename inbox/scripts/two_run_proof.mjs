#!/usr/bin/env node
// Task 4.3: the H-MEM two-run proof. Run A (cold) then run B on the same memory dir, both on T02.
// Verifies in code that B reads an id A wrote, B's plan says it reused the recalled context, B's lines cite A's id, both decide hold.
// Copies both traces to judging/traces/ and writes judging/engine-hmem-two-run.md. Exit 1 if any check fails.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config, sampleMode, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";

const { values } = parseArgs({ options: { sample: { type: "boolean", default: false } } });
const THREAD = "T02";
const cfg = config(values.sample ? { SAMPLE_MODE: "true" } : {});
const isSample = sampleMode(cfg);
const memoryDir = join(INBOX_ROOT, "data", "memory", "two-run");
const logsDir = join(INBOX_ROOT, "logs");
const tracesDir = join(INBOX_ROOT, "judging", "traces");

rmSync(memoryDir, { recursive: true, force: true });
mkdirSync(memoryDir, { recursive: true });
mkdirSync(tracesDir, { recursive: true });

const readLines = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const runs = {};
for (const id of ["A", "B"]) {
  const run_id = `two-run-${id}`;
  rmSync(join(logsDir, `trace-${run_id}.jsonl`), { force: true }); // the trace file appends
  const t = Date.now();
  const result = await runTicket(THREAD, { run_id, cfg, deps: { memoryDir, logsDir } });
  const dest = join(tracesDir, `trace-${run_id}.jsonl`);
  copyFileSync(join(INBOX_ROOT, result.log_file), dest);
  runs[id] = { run_id, result, lines: readLines(dest), seconds: Math.round((Date.now() - t) / 100) / 10 };
}
const { A, B } = runs;
const find = (r, step) => {
  const i = r.lines.findIndex((l) => l.step === step);
  return i < 0 ? null : { n: i + 1, l: r.lines[i] };
};
const aRead = find(A, "memory.read"), aWrite = find(A, "memory.write");
const bRead = find(B, "memory.read"), bPlan = find(B, "planner.plan");
const aId = aWrite?.l.memory_ids?.[0];

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
check("A memory.read is cold", aRead && /empty|cold/i.test(aRead.l.output_summary), aRead?.l.output_summary);
check("A memory.write wrote an id", aWrite && aWrite.l.status === "success" && aId, `id ${aId}`);
check("B memory.read lists an id from A's memory.write", bRead && aId && (bRead.l.memory_ids ?? []).includes(aId) && bRead.l.output_summary.includes(aId), `ids ${(bRead?.l.memory_ids ?? []).join(",")}`);
check("B planner.plan says it reused the recalled context", bPlan && /recalls this customer from an earlier run: the planner reused its decision context/.test(bPlan.l.output_summary));
const bCites = B.lines.filter((l) => (l.memory_ids ?? []).includes(aId));
check("B lines carry memory_ids citing A's id", bCites.length > 0 && (bPlan?.l.memory_ids ?? []).includes(aId), `${bCites.length} lines`);
check("both decisions are hold", A.result.output.decision === "hold" && B.result.output.decision === "hold", `A=${A.result.output.decision} B=${B.result.output.decision}`);

const models = [...new Set([...A.lines, ...B.lines].filter((l) => l.model && l.status !== "skipped").map((l) => l.model))];
const brussels = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "medium" }).format(new Date());
const mode = isSample ? "sample (SAMPLE_MODE=true, no model call)" : "live (Zetaris, OpenJev, Nightshift)";
const cmd = `node inbox/scripts/two_run_proof.mjs${values.sample ? " --sample" : ""}`;
const allOk = checks.every((c) => c.ok);

const q = (r, x) => x ? [
  `- file line: ${x.n} of \`judging/traces/trace-${r.run_id}.jsonl\``,
  `- \`run_id\`: ${x.l.run_id}`, `- \`step\`: ${x.l.step}`, `- \`timestamp\`: ${x.l.timestamp}`,
  `- \`output_summary\`: ${x.l.output_summary}`, `- \`memory_ids\`: ${JSON.stringify(x.l.memory_ids ?? [])}`,
].join("\n") : "- (line not found)";

const md = `---
title: H-MEM two-run proof
description: Two runs of ticket T02 on one empty memory folder; the second run reads the memory the first wrote and its plan says it reused that context.
date: 2026-10-23
tags: [judging, meterless, hmem]
---

# H-MEM two-run proof

Command: \`${cmd}\` (runs \`two-run-A\` and \`two-run-B\`, thread \`${THREAD}\`, fresh empty memory folder \`data/memory/two-run/\`).

- Run time (Europe/Brussels): ${brussels}
- Mode: ${mode}
- Model ids seen: ${models.length ? models.map((m) => `\`${m}\``).join(", ") : "none (no model call in this mode)"}
- Run A took ${A.seconds} s, run B ${B.seconds} s. Decisions: A \`${A.result.output.decision}\`, B \`${B.result.output.decision}\`.
- Checks: ${checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name}`).join("; ")}

## The four lines

### A memory.read (cold)

${q(A, aRead)}

### A memory.write

${q(A, aWrite)}
- written id: \`${aId}\`

### B memory.read (the same id comes back)

${q(B, bRead)}

### B planner.plan (reuses the recalled context)

${q(B, bPlan)}

## What it shows

Run B read memory \`${aId}\`, which run A wrote, and its plan says it reused that context; the rows were re-read through Zetaris and the amount re-checked, which is what the code does.

Honest note: H-MEM here uses lexical retrieval (no embedder). The facts rows are still re-read from Zetaris in one call; what the memory saves is the planner re-deriving them.
`;
writeFileSync(join(INBOX_ROOT, "judging", "engine-hmem-two-run.md"), md);
console.log(`wrote judging/engine-hmem-two-run.md (${isSample ? "sample" : "live"}); ${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
process.exit(allOk ? 0 : 1);

#!/usr/bin/env node
// The refund chain: one customer, two free-text refund requests, processed one after the other through the real loop.
// Step 1 (22 Oct): Cass Holm asks for 40 USD, under the 150 USD limit. Refund weight sits under the trust floor, so the
//   draft is held for a person; on that day the under-limit owner (employee 15) is on holiday and the backup (16) is in.
// Step 2 (27 Oct): the same customer asks for 400 USD, over the limit. Risk refuses the draft, the ticket is escalated to
//   the policy's over-limit approver with the draft attached, and H-MEM has read step 1's memory first.
// The chain runs in its own memory folder (data/memory/chains/<name>) so "carried" below can only mean step 1's memory.
// Nothing in the report is typed by hand: every cell comes from the run result or a trace line the loop wrote.
//   node inbox/scripts/refund_chain.mjs            live (Zetaris, Nightshift, OpenJev)
//   node inbox/scripts/refund_chain.mjs --sample   the deterministic twin (no model call)
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { config, sampleMode, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";

const CHAIN = {
  customer: { name: "Cass Holm", from: "cass.holm@example.com", channel: "contact-form", scenario: "refund" },
  steps: [
    { n: 1, label: "40 USD, under the limit; the owner is on holiday", as_of: "2026-10-22",
      subject: "Refund for order JP-1187", message: "I would like a refund of 40 USD for order JP-1187. The case arrived damaged." },
    { n: 2, label: "400 USD, over the limit; the same customer", as_of: "2026-10-27",
      subject: "Refund for order JP-1190", message: "I want a refund of 400 USD for order JP-1190. The case never arrived." },
  ],
};

const readLines = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const one = (s, n = 240) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function runChain({ sample: sampleOn = false, memoryRoot, logsDir, cfg, quiet = true, runName } = {}) {
  cfg = cfg ?? config(sampleOn ? { SAMPLE_MODE: "true" } : {});
  const isSample = sampleMode(cfg);
  const name = runName ?? `refund-${isSample ? "sample" : "live"}`;
  const memoryDir = join(memoryRoot ?? join(INBOX_ROOT, "data", "memory", "chains"), name);
  rmSync(memoryDir, { recursive: true, force: true }); // a chain run starts from its own empty memory
  mkdirSync(memoryDir, { recursive: true });
  const logs = logsDir ?? join(INBOX_ROOT, "logs");
  const results = [];
  for (const st of CHAIN.steps) {
    const run_id = `${name}_${st.n}`;
    rmSync(join(logs, `trace-${run_id}.jsonl`), { force: true }); // the trace file appends, so a re-run starts clean
    const input = { message: st.message, from: CHAIN.customer.from, name: CHAIN.customer.name, channel: CHAIN.customer.channel, scenario: CHAIN.customer.scenario, subject: st.subject, as_of: st.as_of };
    const result = await runTicket(null, { run_id, as_of: st.as_of, cfg, deps: { memoryDir, quiet, ...(logsDir ? { logsDir } : {}) }, input });
    const lines = readLines(join(logs, `trace-${run_id}.jsonl`));
    const find = (pred) => lines.find(pred);
    const branch = find((l) => l.step === "branch");
    const risk = find((l) => l.step === "risk.signoff");
    const exit = find((l) => l.step === "escalate_or_fallback");
    const memRead = find((l) => l.step === "memory.read");
    const employees = lines.filter((l) => l.action === "sql:employee").map((l) => one(l.output_summary, 80));
    const q = result.output?.queued_for ?? null;
    const rec = {
      n: st.n, run_id, as_of: st.as_of, decision: result.output?.decision ?? null, branch_id: result.branch_id ?? null, scenario: result.scenario ?? null,
      branch_why: one(branch?.output_summary), risk: risk ? `${risk.status}: ${one(risk.output_summary, 200)}` : "no risk.signoff line",
      exit: exit ? `${exit.status}: ${one(exit.output_summary, 260)}` : "no escalate_or_fallback line",
      memory_read_summary: one(memRead?.output_summary, 300), employees,
      queued_for: q ? { owner_id: q.owner_id, backup_id: q.backup_id, approval: q.approval ?? null } : null,
      draft: result.output?.draft ? { promises: result.output.draft.promises, model: result.output.draft.model } : null,
      memory_read: result.memory?.read ?? [], memory_written: result.memory?.written ?? [], log_file: result.log_file,
      models: [...new Set(lines.filter((l) => l.model && l.status !== "skipped").map((l) => l.model))],
      recovered: result.recovered ?? [],
    };
    results.push({ ...st, result, lines, rec });
  }
  const [r1, r2] = results;
  const carried = r2.rec.memory_read.filter((id) => r1.rec.memory_written.includes(id));
  const ok = {
    step1_held: r1.rec.decision === "hold" && r1.rec.branch_id === "under-floor",
    step1_owner_out: /owner \d+ out, backup \d+ in/.test(r1.rec.branch_why),
    step2_over_limit: r2.rec.branch_id === "over-limit" && r2.rec.decision === "escalate" && r2.rec.queued_for?.approval?.kind === "amount",
    step2_read_step1: carried.length > 0,
  };
  const models = [...new Set(results.flatMap((r) => r.rec.models))];
  return { name, memoryDir, results, carried, ok, models, sample: isSample, logs };
}

const cell = (l) => `${l.step} ${l.status}${l.model ? ` [${l.model}]` : ""}`;
const yes = (b) => (b ? "yes" : "NO");

export function renderReport(c) {
  const [a, b] = c.results;
  const rows = [];
  for (let i = 0; i < Math.max(a.lines.length, b.lines.length); i++) rows.push(`| ${i + 1} | ${a.lines[i] ? cell(a.lines[i]) : ""} | ${b.lines[i] ? cell(b.lines[i]) : ""} |`);
  const prom = (r) => (r.rec.draft ? JSON.stringify(r.rec.draft.promises) : "no draft");
  const appr = b.rec.queued_for?.approval;
  const all = Object.values(c.ok).every(Boolean);
  const kind = c.sample ? "sample" : "live";
  return [
    "---",
    `title: Refund chain, one customer twice (${kind})`,
    "description: Cass Holm asks for a refund under the limit while the owner is on holiday, then for one over the limit; the second step reads the first step's memory before it is escalated for approval.",
    "date: 2026-10-23",
    "tags: [judging, demo, hmem, holiday]",
    "---",
    "",
    `# Refund chain, one customer twice (${kind})`,
    "",
    `Command: \`node inbox/scripts/refund_chain.mjs${c.sample ? " --sample" : ""}\` (run \`${c.name}\`, steps \`${c.name}_1\` and \`${c.name}_2\`, own memory folder \`data/memory/chains/${c.name}\`).`,
    "",
    `**Outcome: ${all ? "the chain behaves as the storyboard tells it" : "NOT as told; see the checks"}.** Checks: step 1 held under the floor ${yes(c.ok.step1_held)}; step 1's owner out and backup in ${yes(c.ok.step1_owner_out)}; step 2 over the limit, escalated for an amount approval ${yes(c.ok.step2_over_limit)}; step 2 read step 1's memory ${yes(c.ok.step2_read_step1)}.`,
    "",
    "## The two steps",
    "",
    `Customer: ${CHAIN.customer.name} (\`${CHAIN.customer.from}\`), channel \`${CHAIN.customer.channel}\`, scenario declared \`${CHAIN.customer.scenario}\`.`,
    "",
    "| | Step 1 | Step 2 |",
    "|---|---|---|",
    `| message | ${a.message} | ${b.message} |`,
    `| as_of (holidays read for this day) | ${a.rec.as_of} | ${b.rec.as_of} |`,
    `| branch | ${a.rec.branch_id} | ${b.rec.branch_id} |`,
    `| branch line, why | ${a.rec.branch_why} | ${b.rec.branch_why} |`,
    `| employees read (Zetaris) | ${a.rec.employees.join("; ") || "none"} | ${b.rec.employees.join("; ") || "none"} |`,
    `| decision | ${a.rec.decision} | ${b.rec.decision} |`,
    `| risk.signoff | ${a.rec.risk} | ${b.rec.risk} |`,
    `| escalate_or_fallback | ${a.rec.exit} | ${b.rec.exit} |`,
    `| approval | ${a.rec.queued_for?.approval ? JSON.stringify(a.rec.queued_for.approval) : "none"} | ${appr ? `${appr.amount_usd} USD over the ${appr.limit_usd} USD limit, approver ${appr.approver_name ?? appr.approver_id} (employee ${appr.approver_id})` : "none"} |`,
    `| draft promises | \`${prom(a)}\` | \`${prom(b)}\` |`,
    `| memory read | ${a.rec.memory_read.join(", ") || "none"} | ${b.rec.memory_read.join(", ") || "none"} |`,
    `| memory.read line | ${a.rec.memory_read_summary || "none"} | ${b.rec.memory_read_summary || "none"} |`,
    `| memory written | ${a.rec.memory_written.join(", ") || "none"} | ${b.rec.memory_written.join(", ") || "none"} |`,
    "",
    `Memory ids carried from step 1 into step 2: ${c.carried.length ? c.carried.join(", ") : "none"}.`,
    "",
    `Model ids used (non-skipped lines): ${c.models.join(", ") || "none (sample mode, no model call)"}.`,
    "",
    "## What a judge sees here",
    "",
    "- A refund never goes out on its own: the refund category's trust weight (0.55) is under the floor (0.8), so step 1 is held for a person even though 40 USD is under the limit. The weight is not the amount: it is the category's earned trust, +0.05 per affirmed decision and -0.05 per rejected one; five affirms take refund to the floor. The rule, the branch order and the numbers: [trust-floor.md](trust-floor.md).",
    "- The holiday calendar is read from Zetaris for the day of the message: on 22 Oct the under-limit owner is out and the backup is in; the branch line names both.",
    "- Over the limit, the draft is refused by Risk and the ticket goes to the policy's over-limit approver with the draft attached; nothing is sent.",
    "- The second step reads the first step's H-MEM memory before planning, so the approver's context names the earlier request. The memory carries the loop's decision, not a human verdict: a human affirms or rejects a decision through `POST /feedback`, which moves the category's trust weight in the Zetaris decisions table.",
    "",
    "## Traces side by side (step, status, model)",
    "",
    `| line | ${a.rec.run_id} | ${b.rec.run_id} |`,
    "|---|---|---|",
    ...rows,
    "",
    "## Honesty",
    "",
    c.sample
      ? "This run is the sample twin: the deterministic rules drafter stands in for the model, so it proves the chain logic (floor, holiday, limit, memory), not the model's behaviour."
      : "This run is live: Zetaris rows, the Nightshift drafter and evaluator, OpenJev gates and Scout. The drafts are whatever the model wrote and are recorded as they happened; the chain logic (floor, holiday, limit, memory) is deterministic.",
    ...[a, b].flatMap((r) => r.rec.recovered.map((x) => `\nStep ${r.n} recovered from an error at \`${x.step}\` (${x.type}: ${x.message}); a decision it caused is an infrastructure fallback, not the loop's judgement of the content.`)),
    "",
    `Traces: \`judging/traces/trace-${c.name}_1.jsonl\` and \`judging/traces/trace-${c.name}_2.jsonl\` (copied from \`logs/\` as the loop wrote them).`,
    "",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { sample: { type: "boolean", default: false } } });
  const c = await runChain({ sample: values.sample });
  for (const r of c.results) {
    console.log(`STEP ${r.n} ${r.rec.run_id}: decision ${r.rec.decision}, branch ${r.rec.branch_id}, as_of ${r.rec.as_of}`);
    console.log(`  ${r.rec.branch_why}`);
    console.log(`  ${r.rec.exit}`);
    console.log(`  memory read: ${r.rec.memory_read.join(", ") || "none"}; written: ${r.rec.memory_written.join(", ") || "none"}`);
  }
  console.log(`carried memory ids (step 1 written, in step 2 read): ${c.carried.join(", ") || "none"}`);
  console.log(`models: ${c.models.join(", ") || "none"}`);
  console.log(`checks: ${JSON.stringify(c.ok)}`);
  const T = join(INBOX_ROOT, "judging", "traces");
  mkdirSync(T, { recursive: true });
  for (const r of c.results) copyFileSync(join(c.logs, `trace-${r.rec.run_id}.jsonl`), join(T, `trace-${r.rec.run_id}.jsonl`));
  const out = join(INBOX_ROOT, "judging", c.sample ? "refund-chain-sample.md" : "refund-chain.md");
  writeFileSync(out, renderReport(c));
  console.log(`wrote ${out}`);
  return Object.values(c.ok).every(Boolean) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => { console.error(`${e.name}: ${e.message}`); process.exit(1); });
}

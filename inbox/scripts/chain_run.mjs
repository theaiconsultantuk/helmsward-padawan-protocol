#!/usr/bin/env node
// Task 3.5: the Seraphine (T01) email chain processed sequentially through the real loop.
// Step 1 = her original email (received 22 Oct 09:14Z), run as a fresh replacement request, NOT as a misread.
// Step 2 = her follow-up (22 Oct 14:05Z), run with step 1's saved draft promises (deps.priorDraft) and the same memory dir.
// Two genuine outcomes, both recorded as they happen: (a) step 1 promised a refund, step 2 detects the misread and escalates;
// (b) step 1 drafted a correct replacement, step 2 ends on its own decision. Nothing in the report is typed by hand.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { config, sampleMode, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { mentionsRefund } from "../src/prompts.mjs";
import { factsForTicket } from "../src/queries.mjs";
import * as sample from "../src/adapters/sample.mjs";

// The two messages' own Date headers (kristof/data/intakes/email/T01.eml and T01-reply.eml).
const CHAINS = {
  T01: {
    customer: "Seraphine Kaelborn",
    steps: [
      { n: 1, label: "original email (asks for a replacement)", received_at: "2026-10-22T09:14:00Z" },
      { n: 2, label: "follow-up (\"you misunderstood me\")", received_at: "2026-10-22T14:05:00Z" },
    ],
  },
};
const day = (iso) => iso.slice(0, 10);

const readLines = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

export async function runChain({ chain = "T01", sample: sampleOn = false, seed = "correct", memoryRoot, logsDir, cfg, quiet = false, runName } = {}) {
  const spec = CHAINS[chain];
  if (!spec) throw new Error(`unknown chain ${chain}`);
  if (!["correct", "misread"].includes(seed)) throw new Error(`bad seed ${seed}`);
  cfg = cfg ?? config(sampleOn ? { SAMPLE_MODE: "true" } : {});
  const isSample = sampleMode(cfg);
  const name = runName ?? `padme-${isSample ? `sample-${seed}` : "live"}`;
  const memoryDir = join(memoryRoot ?? join(INBOX_ROOT, "data", "memory", "chains"), name);
  rmSync(memoryDir, { recursive: true, force: true }); // a chain run starts from its own empty memory
  mkdirSync(memoryDir, { recursive: true });
  const stateFile = join(memoryDir, `ticket-${chain}.json`);
  const state = { thread_id: chain, customer: spec.customer, steps: [] };
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");

  // sample twin: the loop always asks the sample drafter for seed "correct" in round 1; the chain's seed replaces it there.
  const sampleDrafter = (t, f, o = {}) => sample.draft(t, f, { seed: o.seed === "correct" ? seed : o.seed });
  const base = { memoryDir, quiet, ...(logsDir ? { logsDir } : {}), sampleDrafter };

  const results = [];
  for (const st of spec.steps) {
    const run_id = `${name}_${st.n}`;
    const as_of = day(st.received_at);
    // step 1 is a fresh request: the stored follow-up fields are removed from the facts and the ticket
    const facts = st.n === 1
      ? async (id, o) => {
        const f = await factsForTicket(id, { ...o, cfg });
        const clean = { ...f.ticket, follow_up_kind: "", follow_up_body: "", agent_category: "", parent_thread_id: "" };
        return { ...f, follow_up_kind: null, follow_up_body: null, parent_thread_id: null, received_at: st.received_at, ticket: { ...clean, received_at: st.received_at } };
      }
      : async (id, o) => {
        const f = await factsForTicket(id, { ...o, cfg });
        return { ...f, received_at: st.received_at, ticket: { ...f.ticket, received_at: st.received_at } };
      };
    const prior = st.n === 2 ? (JSON.parse(readFileSync(stateFile, "utf8")).steps.at(-1)?.draft ?? undefined) : undefined;
    rmSync(join(logsDir ?? join(INBOX_ROOT, "logs"), `trace-${run_id}.jsonl`), { force: true }); // the trace file appends, so a re-run starts clean
    const result = await runTicket(chain, { run_id, as_of, cfg, deps: { ...base, facts, ...(prior ? { priorDraft: prior } : {}) } });
    const lines = readLines(join(logsDir ?? join(INBOX_ROOT, "logs"), `trace-${run_id}.jsonl`));
    const rec = {
      n: st.n, run_id, as_of_message: st.received_at, as_of_day: as_of, decision: result.output.decision, branch_id: result.branch_id,
      draft: result.output.draft ? { text: result.output.draft.text, promises: result.output.draft.promises, model: result.output.draft.model, cited_rows: result.output.cited_rows ?? [] } : null,
      memory_read: result.memory.read, memory_written: result.memory.written, log_file: result.log_file, queued_for: result.output.queued_for ?? null,
    };
    const s = JSON.parse(readFileSync(stateFile, "utf8"));
    s.steps.push(rec);
    writeFileSync(stateFile, JSON.stringify(s, null, 2) + "\n");
    results.push({ ...st, result, lines, rec, priorUsed: Boolean(prior) });
  }

  const [r1, r2] = results;
  const carried = r2.result.memory.read.filter((id) => r1.result.memory.written.includes(id));
  const misread = r2.result.branch_id === "misread";
  // (c): step 1's first draft named a refund on her replacement ticket, Risk refused it on round 1 (refunds are mentioned only on refund
  // requests), round 2 was signed off and the draft handed over carries no refund; each of the three is read from the trace or the draft
  const riskAt = (n) => r1.lines.find((l) => l.step === "risk.signoff" && l.retry_count === n);
  const caught = Boolean(riskAt(0)?.status === "needs_revision" && /refund wording on a/.test(String(riskAt(0).output_summary)) && riskAt(1)?.status === "success" && r1.rec.draft && !mentionsRefund(r1.rec.draft));
  const evaluatorToo = r1.lines.some((l) => l.step === "critique" && l.retry_count === 0 && l.status === "needs_revision");
  const outcome = !r2.priorUsed ? "other" : misread && r2.result.output.decision === "escalate" ? "a" : !misread ? (caught ? "c" : "b") : "other";
  const models = [...new Set(results.flatMap((r) => r.lines.filter((l) => l.model && l.status !== "skipped").map((l) => l.model)))];
  return { name, memoryDir, stateFile, results, carried, outcome, evaluatorToo, models, sample: isSample, seed };
}

const cell = (l) => `${l.step} ${l.status}${l.model ? ` [${l.model}]` : ""}`;

export function renderReport(c, extra = {}) {
  const [a, b] = c.results;
  const rows = [];
  for (let i = 0; i < Math.max(a.lines.length, b.lines.length); i++) rows.push(`| ${i + 1} | ${a.lines[i] ? cell(a.lines[i]) : ""} | ${b.lines[i] ? cell(b.lines[i]) : ""} |`);
  const prom = (r) => (r.rec.draft ? JSON.stringify(r.rec.draft.promises) : "no draft");
  const which = c.outcome === "a"
    ? "(a) misread detected: step 1's draft promised a refund she did not ask for, step 2 compared that promise with her ask (a replacement), took the `misread` branch, failed the critique and queued the ticket for a human."
    : c.outcome === "b"
      ? "(b) correct: step 1's draft promised the replacement she asked for, so step 2 was not a misread and ended on its own decision."
      : c.outcome === "c"
        ? `(c) caught at step 1: step 1's first draft named a refund on her replacement ticket; Risk refused it on round 1 (refunds are mentioned only on refund requests)${c.evaluatorToo ? ", as did the Evaluator" : ""}; round 2 was signed off and the draft handed over carries no refund, so step 2 was not a misread and ended on its own decision.`
        : "neither (a) nor (b): step 1 produced no draft to hand over, so step 2 could only fall back to the authored misread rule; this run does not count as either outcome.";
  return [
    "---",
    "title: Seraphine email chain, run sequentially",
    "description: Her original email and her follow-up processed one after the other through the real loop, with the first draft's promises and memory carried into the second step.",
    "date: 2026-10-23",
    "tags: [judging, demo]",
    "---",
    "",
    "# Seraphine email chain, run sequentially",
    "",
    `Command: \`node inbox/scripts/chain_run.mjs --chain T01${c.sample ? ` --sample --seed ${c.seed}` : ""}\` (run \`${c.name}\`, steps \`${c.name}_1\` and \`${c.name}_2\`).`,
    "",
    `**Outcome: ${which}**`,
    "",
    "## The two steps",
    "",
    "| | Step 1: original email | Step 2: follow-up |",
    "|---|---|---|",
    `| received (as_of) | ${a.rec.as_of_message} | ${b.rec.as_of_message} |`,
    `| branch | ${a.rec.branch_id} | ${b.rec.branch_id} |`,
    `| decision | ${a.rec.decision} | ${b.rec.decision} |`,
    `| draft promises | \`${prom(a)}\` | \`${prom(b)}\` |`,
    `| memory read | ${a.rec.memory_read.join(", ") || "none"} | ${b.rec.memory_read.join(", ") || "none"} |`,
    `| memory written | ${a.rec.memory_written.join(", ") || "none"} | ${b.rec.memory_written.join(", ") || "none"} |`,
    `| step 1 draft handed over | n/a | ${b.priorUsed ? "yes (deps.priorDraft)" : "no draft to hand over"} |`,
    "",
    `Memory ids carried from step 1 into step 2: ${c.carried.length ? c.carried.join(", ") : "none"}.`,
    "",
    `Model ids used (non-skipped lines): ${c.models.join(", ") || "none (sample mode, no model call)"}.`,
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
      ? `This run is the sample twin: the deterministic rules drafter, seeded \`${c.seed}\` for step 1, stands in for the model, so it proves the chain logic, not the model's behaviour. It is the deterministic twin of the authored sample (T01 in the grid), where the earlier reply is supplied as authored data; here the earlier reply is produced by step 1.`
      : "This run is live: Zetaris rows, the Nightshift drafter and evaluator, and Scout. Step 1's draft is whatever the model wrote; whether it misread is the model's doing and is recorded as it happened. The sample path is the deterministic twin of the authored sample, where the earlier reply is supplied as authored data.",
    ...[a, b].flatMap((r) => (r.result.recovered ?? []).map((x) => `\nStep ${r.n} recovered from an error at \`${x.step}\` (${x.type}: ${x.message}); a decision it caused is an infrastructure fallback, not the loop's judgement of the content.`)),
    ...(extra.note ? ["", extra.note] : []),
    "",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { chain: { type: "string", default: "T01" }, sample: { type: "boolean", default: false }, seed: { type: "string", default: "correct" } } });
  const c = await runChain({ chain: values.chain, sample: values.sample, seed: values.seed });
  for (const r of c.results) {
    console.log(`STEP ${r.n} ${r.rec.run_id}: decision ${r.rec.decision}, branch ${r.rec.branch_id}, as_of ${r.rec.as_of_message}`);
    console.log(`  promises: ${r.rec.draft ? JSON.stringify(r.rec.draft.promises) : "no draft"}  draft model: ${r.rec.draft?.model ?? "none"}`);
    console.log(`  memory read: ${r.rec.memory_read.join(", ") || "none"}; written: ${r.rec.memory_written.join(", ") || "none"}`);
  }
  console.log(`carried memory ids (step 1 written, in step 2 read): ${c.carried.join(", ") || "none"}`);
  console.log(`models: ${c.models.join(", ") || "none"}`);
  console.log(`outcome: ${c.outcome}`);
  const out = join(INBOX_ROOT, "judging", "padme-chain.md");
  writeFileSync(out, renderReport(c));
  console.log(`wrote ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (e) => { console.error(`${e.name}: ${e.message}`); process.exit(1); });
}

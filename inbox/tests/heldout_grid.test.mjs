// P10: Paul's sealed held-out set (<repo>/drafts/heldout/) run through the loop in sample mode.
// The folder is not on main yet (checked 24 Oct 2026), so this skips until it lands. When it does, the loader below takes either
//   one JSON/JSONL file of {id?, input, label} records, or an inputs file and a labels file joined on id
// and fails clearly on any other shape (read his README there first and tighten the loader to it).
// The pass count must stay at or above the floor pinned in tests/fixtures/heldout_pin.json (14 of 20 today); 20/20 is a later PR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { runMessage, msg } from "./helpers/route_run.mjs";

const DIR = join(INBOX_ROOT, "..", "drafts", "heldout");
const PIN = JSON.parse(readFileSync(new URL("./fixtures/heldout_pin.json", import.meta.url), "utf8"));

const readRecords = (file) => {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".jsonl")) return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const v = JSON.parse(text);
  if (Array.isArray(v)) return v;
  for (const k of ["cases", "items", "records", "rows", "data"]) if (Array.isArray(v?.[k])) return v[k];
  throw new Error(`held-out file ${file}: unknown JSON shape (expected an array or {cases|items|records|rows|data: [...]})`);
};
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

export function loadHeldout(dir) {
  const files = walk(dir).filter((f) => /\.jsonl?$/.test(f));
  if (!files.length) throw new Error(`held-out folder ${dir} holds no .json or .jsonl file; read its README and extend the loader`);
  const all = files.flatMap((f) => readRecords(f).map((r, i) => ({ r, f, i })));
  const paired = all.filter(({ r }) => r && typeof r === "object" && "input" in r && "label" in r);
  if (paired.length) return paired.map(({ r, i }) => ({ id: String(r.id ?? r.case_id ?? `H${String(i + 1).padStart(2, "0")}`), input: r.input, label: r.label }));
  const isLabel = (f) => /label|sealed|expected|answer/i.test(f);
  const labels = new Map(all.filter(({ f }) => isLabel(f)).map(({ r }) => [String(r.id ?? r.case_id), r]));
  const inputs = all.filter(({ f }) => !isLabel(f));
  if (!labels.size || !inputs.length || inputs.some(({ r }) => (r.id ?? r.case_id) == null)) {
    throw new Error(`held-out set shape not recognised in ${dir}: files ${files.join(", ")}; expected {id?, input, label} records or an inputs file and a labels file joined on id`);
  }
  return inputs.map(({ r }) => {
    const id = String(r.id ?? r.case_id);
    if (!labels.has(id)) throw new Error(`held-out case ${id} has no sealed label`);
    return { id, input: r.input ?? r, label: labels.get(id) };
  });
}

const wantOf = (label) => {
  const d = typeof label === "string" ? label : (label?.decision ?? label?.expected_decision ?? label?.outcome ?? label?.expected);
  if (typeof d !== "string") throw new Error(`held-out label has no decision: ${JSON.stringify(label)}`);
  return d.toLowerCase();
};
const toMsg = (i) => {
  if (typeof i === "string") return msg(i);
  const message = i.message ?? i.body ?? i.text;
  if (typeof message !== "string") throw new Error(`held-out input has no message/body/text: ${JSON.stringify(i)}`);
  return msg(message, i.channel ?? "chat", i.from ?? i.sender_email ?? i.email ?? "heldout@email.com", { name: i.name ?? i.sender_name, subject: i.subject });
};

test("held-out grid: sample mode passes at least the pinned count", async (t) => {
  if (!existsSync(DIR)) return t.skip("held-out set not on main");
  const cases = loadHeldout(DIR);
  assert.ok(cases.length > 0, "no held-out cases");
  const rows = [];
  for (const c of cases) {
    const want = wantOf(c.label), wantBranch = typeof c.label === "object" ? (c.label.branch_id ?? c.label.branch ?? null) : null;
    const { result } = await runMessage(toMsg(c.input), { run_id: `heldout-${c.id}` });
    const got = result.output.decision;
    rows.push({ id: c.id, want, got, branch: result.branch_id, pass: got === want && (wantBranch == null || wantBranch === result.branch_id) });
  }
  console.log("\nid   | want     | got      | branch");
  for (const r of rows) console.log(`${r.id.padEnd(4)} | ${r.want.padEnd(8)} | ${String(r.got).padEnd(8)} | ${r.branch}${r.pass ? "" : "   <-- FAIL"}`);
  const passed = rows.filter((r) => r.pass).length;
  console.log(`${passed}/${rows.length} pass (floor ${PIN.min_pass} of ${PIN.of})`);
  assert.ok(passed >= PIN.min_pass, `held-out pass count ${passed} fell below the pinned ${PIN.min_pass}`);
});

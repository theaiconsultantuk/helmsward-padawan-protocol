// Owners from the company hierarchy (companyhierarchy.csv): over the limit the approver is the Sales head, their backup is the head's manager (the CEO).
// The head is out on 2026-10-29 only (seeded); every other date in the demo window finds them in. Sample mode, owner-out through private sample copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { factsForTicket } from "../src/queries.mjs";
import { queryByName } from "../src/adapters/sample.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
function cfgWithOut(pairs) {
  const dir = mkdtempSync(join(tmpdir(), "hi-sample-"));
  cpSync(join(INBOX_ROOT, "data", "sample"), dir, { recursive: true });
  const read = (n) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
  const all = read("holidays");
  const full = all.find((e) => Object.keys(e.params ?? {}).length === 0).result;
  for (const [id, date] of pairs) full.rows.push([String(id), date]);
  full.total = full.rows.length;
  writeFileSync(join(dir, "holidays.json"), JSON.stringify(all));
  writeFileSync(join(dir, "holiday.json"), JSON.stringify(read("holiday").filter((e) => !pairs.some(([id, date]) => String(e.params?.employee_id) === String(id) && e.params?.date === date))));
  return { ...cfg, SAMPLE_DIR: dir };
}
const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "hi-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "hi-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "hi-run-")), quiet: true });
let n = 0;
const refund = (as_of, runCfg = cfg, amount = 400) => {
  n += 1;
  return runTicket(null, { run_id: `hi-${n}`, cfg: runCfg, as_of, deps: dirs(), input: { message: `I want a refund of ${amount} GC for my cracked saber`, from: `hier.client${n}@email.com`, name: "Hier Client", channel: "chat", scenario: "refund", as_of } });
};

test("the Sales head is read from the hierarchy, not the policy ids: a refund over the limit goes to the head (25 Oct and the hero day 19 Oct)", async () => {
  for (const day of ["2026-10-25", "2026-10-19"]) {
    const r = await refund(day);
    assert.equal(r.branch_id, "over-limit", day);
    assert.equal(r.output.decision, "escalate");
    assert.equal(r.output.queued_for.owner_id, 40, day);
    assert.equal(r.output.queued_for.approval.approver_id, 40);
    assert.equal(r.output.queued_for.backup_id, 201);
    assert.equal(r.output.team, "Sales");
    assert.equal(r.output.backup_team, "Executive");
    assert.ok(r.output.team_label && r.output.queued_for.team_label);
    assert.ok(r.output.cited_rows.includes("companyhierarchy:40"), "the head's hierarchy row is cited");
    assert.ok(r.output.cited_rows.includes("companyhierarchy:201"), "the manager's hierarchy row is cited");
  }
});

test("the Sales head out on 29 Oct: the approver climbs to the CEO, Paul Jedi (201)", async () => {
  const r = await refund("2026-10-29");
  assert.equal(r.branch_id, "over-limit");
  assert.equal(r.output.decision, "escalate");
  assert.equal(r.output.queued_for.owner_id, 40);
  assert.equal(r.output.queued_for.approval.approver_id, 201);
  assert.equal(r.output.queued_for.approval.approver_name, "Paul Jedi");
  assert.equal(r.output.team, "Executive", "the CEO holds it");
  assert.equal(r.output.queued_for.backup_name, "Paul Jedi");
});

test("both out (head and CEO): the owner-out branch escalates to the default contact", async () => {
  const r = await refund("2026-10-29", cfgWithOut([[201, "2026-10-29"]]));
  assert.equal(r.branch_id, "over-limit");
  assert.equal(r.output.decision, "escalate");
  assert.equal(r.output.queued_for.fallback_contact?.email, "contact@jedipack.com");
  assert.equal(r.output.queued_for.role, "default contact");
});

test("the policy's over-limit ids still agree with the hierarchy: no disagreement note", async () => {
  const f = await factsForTicket("F1", { ticketSource: "intake", intakeRow: { thread_id: "F1", received_at: "2026-10-25T09:00:00.000Z", channel: "chat", sender_name: "A", sender_email: "a.hier@email.com", subject: "refund", body: "refund 400 GC", scenario: "refund", category: "" }, topic: "refund", amount: 400, as_of: "2026-10-25", needs: ["limit"], cfg });
  assert.equal(f.owner_id, 40); assert.equal(f.backup_id, 201);
  assert.deepEqual(f.notes, []);
  assert.equal(f.owner_team, "Sales"); assert.equal(f.backup_team, "Executive");
  assert.equal(f.backup_name, "Paul Jedi", "201 has no employees row: the hierarchy gives the name");
  assert.equal(f.backup_role, "CEO");
});

test("a policy that disagrees with the hierarchy is overruled by it, with a note", async () => {
  const sqlRunImpl = async (sql, opts) => {
    if (opts.name === "policy") return { headers: ["topic", "limit_amount", "currency", "under_limit_owner_id", "under_limit_backup_id", "over_limit_owner_id", "over_limit_backup_id"], rows: [["refund", "150.00", "GC", "15", "27", "3", "4"]], total: 1 };
    return queryByName(opts.name, opts.params, { cfg });
  };
  const f = await factsForTicket("F1", { ticketSource: "intake", intakeRow: { thread_id: "F1", received_at: "2026-10-25T09:00:00.000Z", channel: "chat", sender_name: "A", sender_email: "a.hier@email.com", subject: "refund", body: "refund 400 GC", scenario: "refund", category: "" }, topic: "refund", amount: 400, as_of: "2026-10-25", needs: ["limit"], cfg, sqlRunImpl });
  assert.equal(f.owner_id, 40); assert.equal(f.backup_id, 201);
  assert.ok(f.notes.some((x) => /disagree with the hierarchy/.test(x)), JSON.stringify(f.notes));
});

test("a stored thread keeps the owners named on it, and cites the hierarchy it checked them against (T03)", async () => {
  const f = await factsForTicket("T03", { cfg });
  assert.equal(f.owner_id, 40); assert.equal(f.backup_id, 201);
  assert.ok(f.cited_rows.includes("companyhierarchy:40"));
  assert.equal(f.owner_team, "Sales");
});

test("a company-wide day (blank employee_id) takes a free-text ticket's owner out too (P15)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hi-co-"));
  cpSync(join(INBOX_ROOT, "data", "sample"), dir, { recursive: true });
  const all = JSON.parse(readFileSync(join(dir, "holidays.json"), "utf8"));
  const full = all.find((e) => Object.keys(e.params ?? {}).length === 0).result;
  full.rows.push([null, "2026-12-25"]); full.total = full.rows.length;
  writeFileSync(join(dir, "holidays.json"), JSON.stringify(all));
  const f = await factsForTicket("F1", { ticketSource: "intake", intakeRow: { thread_id: "F1", received_at: "2026-12-25T09:00:00.000Z", channel: "chat", sender_name: "A", sender_email: "a.co@email.com", subject: "hello", body: "hello", scenario: "", category: "" }, topic: "question", as_of: "2026-12-25", cfg: { ...cfg, SAMPLE_DIR: dir } }); // no `needs`: the legacy intake read, which filters the whole holidays table
  assert.equal(f.owner_out, true);
  assert.equal(f.backup_out, true);
});

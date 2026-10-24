// Channel rules are rows (channels.csv), not code: a public channel changes how a refund with no amount is held and how severity is scored,
// never an automatic escalation. A fact that may not leave is escalated (fact-block) even when a check is also unavailable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { runTicket, decideBranch, restrictedInMessage } from "../src/loop.mjs";
import { factsForTicket } from "../src/queries.mjs";

const cfg = { ...config(), SAMPLE_MODE: "true" };
const dirs = () => ({ logsDir: mkdtempSync(join(tmpdir(), "ch-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "ch-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "ch-run-")), quiet: true });
let n = 0;
async function thread(id, deps = dirs()) {
  n += 1;
  const run_id = `ch-${n}`;
  const result = await runTicket(id, { run_id, cfg, deps });
  return { result, o: result.output, lines: readFileSync(join(deps.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}
async function message(text, { channel, scenario, from = `ch.client${n}@email.com` } = {}) {
  n += 1;
  const deps = dirs();
  const run_id = `ch-m-${n}`;
  const result = await runTicket(null, { run_id, cfg, as_of: "2026-10-25", deps, input: { message: text, from, name: "Channel Client", channel, scenario, as_of: "2026-10-25" } });
  return { result, o: result.output, lines: readFileSync(join(deps.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

test("the channel row is read and cited for every ticket: public, autonomous, label", async () => {
  const tp = await factsForTicket("T05", { cfg });
  assert.equal(tp.channel_public, true); assert.equal(tp.channel_autonomous, false); assert.equal(tp.channel_label, "Trustpilot review");
  assert.ok(tp.cited_rows.includes("channels:trustpilot"));
  const em = await factsForTicket("T02", { cfg });
  assert.equal(em.channel_public, false); assert.equal(em.channel_autonomous, true); assert.equal(em.channel_label, "Direct email");
  assert.ok(em.cited_rows.includes("channels:email"));
});

test("T05: a Trustpilot refund with no amount holds, says why, and cites channels:trustpilot", async () => {
  const { o, lines } = await thread("T05");
  assert.equal(o.decision, "hold");
  assert.ok(o.cited_rows.includes("channels:trustpilot"));
  assert.match(lines.find((l) => l.step === "branch").output_summary, /no amount stated on a public channel \(channels:trustpilot\)/);
  assert.match(o.reasons.join(" "), /no amount stated on a public channel/);
  assert.equal(o.channel_label, "Trustpilot review");
});

test("a refund with no amount on a private channel holds without the public-channel wording", async () => {
  const f = await factsForTicket("T05", { cfg });
  const email = { ...f, channel: "email", channel_public: false };
  const b = decideBranch(email, null, []);
  assert.equal(b.branch_id, "under-floor");
  assert.match(b.why, /no amount stated/);
  assert.doesNotMatch(b.why, /public channel/);
});

test("a Trustpilot complaint that is not severe holds with a draft: no branch is keyed on the channel name", async () => {
  const t10 = await thread("T10");
  assert.equal(t10.o.decision, "hold");
  assert.ok(t10.o.draft?.text);
  assert.ok(!["public-channel"].includes(t10.result.branch_id));
  const m = await message("The parcel arrived with a dented box and a scuffed grip. I would like someone to look at it, thanks.", { channel: "trustpilot", scenario: "complaint" });
  assert.match(m.result.branch_id, /^complaint-(genuine|vent)$/, m.result.branch_id);
  assert.equal(m.o.decision, "hold");
  assert.ok(m.o.draft?.text);
  assert.ok(m.o.cited_rows.includes("channels:trustpilot"));
});

test("fact-block wins over data-block: may_leave=false with the checks unavailable still escalates", async () => {
  const facts = async (id, { trace }) => ({ ...(await factsForTicket(id, { trace, cfg })), may_leave: false, disclosure_unknown: true });
  const findDuplicate = async () => { throw Object.assign(new Error("zetaris down"), { name: "UpstreamRefused" }); };
  const d = dirs();
  const result = await runTicket("T04", { run_id: "ch-fact-wins", cfg, deps: { ...d, facts, findDuplicate } });
  assert.equal(result.branch_id, "fact-block");
  assert.equal(result.output.decision, "escalate");
  assert.ok(!result.output.draft);
  assert.ok(existsSync(result.output.queued_for.queue_file));
});

test("pure: decideBranch puts fact-block before data-block, duplicate, over-limit and the trust floor", () => {
  const base = { category: "refund", amount: 900, policy_limit: 150, category_weight: 0.55, floor: 0.8, owner_id: 15, backup_id: 27, may_leave: false, disclosure_unknown: true, ticket: {} };
  assert.equal(decideBranch(base, null, [], { duplicate_of: { thread_id: "T1" }, checks_unavailable: ["duplicate check"] }).branch_id, "fact-block");
  assert.equal(decideBranch({ ...base, may_leave: true, restricted_terms: [], body: "", subject: "" }, null, [], { checks_unavailable: ["x"] }).branch_id, "over-limit");
  assert.equal(decideBranch({ ...base, may_leave: true, amount: 100, owner_out: false }, null, [], { checks_unavailable: ["x"] }).branch_id, "under-floor");
  assert.equal(decideBranch({ ...base, may_leave: true, amount: 100, category_weight: 0.9 }, null, [], { checks_unavailable: ["x"] }).branch_id, "data-block");
});

test("H16: a restricted fact in the message (a card number) holds as data-block and wins over the trust floor", async () => {
  const text = "Please refund 100 GC to my card number 4111 1111 1111 1111, the saber arrived cracked.";
  const m = await message(text, { channel: "chat", scenario: "refund" });
  assert.equal(m.result.branch_id, "data-block");
  assert.equal(m.o.decision, "hold");
  assert.ok(!m.o.draft);
  assert.ok(!m.o.queued_for?.queue_file, "held, not escalated");
  const plain = await message("Please refund 100 GC, the saber arrived cracked.", { channel: "chat", scenario: "refund" });
  assert.equal(plain.result.branch_id, "under-floor");
  assert.equal(restrictedInMessage({ restricted_terms: ["stored card number"], subject: "JP-1042 and FS-B02", body: "order JP-1042 FS-B02" }), null, "order and sku ids are not card numbers");
  assert.equal(restrictedInMessage({ restricted_terms: ["staff home address"], subject: "", body: "Do you have a card?" }), null);
});

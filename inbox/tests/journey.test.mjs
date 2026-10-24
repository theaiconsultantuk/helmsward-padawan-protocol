// Journey derivation tests. Results are matched to traces by run id: judging/traces/trace-<run_id>.jsonl
// pairs with output_examples/<name>.json whose run_id equals <run_id> (example-1..3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveJourney, replyFor, labelFor } from "../src/journey.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const readLines = (id) =>
  readFileSync(`${ROOT}judging/traces/trace-${id}.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const readResult = (n) => JSON.parse(readFileSync(`${ROOT}output_examples/example_${n}.json`, "utf8"));
const cases = [1, 2, 3].map((n) => {
  const result = readResult(n);
  return { n, result, lines: readLines(result.run_id) };
});
const KIND = { send: "auto_reply", hold: "draft_for_human", escalate: "escalation", close: "none" };

test("node count equals line count, retained is a subset of consulted", () => {
  for (const { result, lines } of cases) {
    const j = deriveJourney(result, lines);
    assert.equal(j.nodes.length, lines.length);
    j.nodes.forEach((n, i) => {
      assert.equal(n.n, i + 1);
      for (const id of n.retained) assert.ok(n.consulted.includes(id));
    });
  }
});

test("human.reply.kind matches the decision", () => {
  for (const { result, lines } of cases) {
    const j = deriveJourney(result, lines);
    assert.equal(j.decision, result.output.decision);
    assert.equal(j.human.reply.kind, KIND[result.output.decision]);
  }
});

test("the escalation example reaches a human on escalate_or_fallback", () => {
  const { result, lines } = cases[2];
  const j = deriveJourney(result, lines);
  const hits = j.nodes.filter((n) => n.reached_human);
  assert.deepEqual(hits.map((n) => n.step), ["escalate_or_fallback"]);
  assert.equal(j.reached_human.who.employee_id, 8);
  assert.ok(j.reached_human.queue_file);
});

test("skipped lines read 'not reached' and drop out of the path", () => {
  const { result, lines } = cases[0];
  const j = deriveJourney(result, lines);
  const sk = j.nodes.filter((n) => n.status === "skipped");
  assert.ok(sk.length > 0);
  for (const n of sk) assert.match(n.route, /^not reached: /);
  assert.ok(j.human.path.includes("Branch: under-floor"));
  assert.equal(j.human.path.at(-1), "Reply");
});

test("truncated trace still returns a journey; empty result gives decision null", () => {
  const { result, lines } = cases[0];
  const j = deriveJourney(result, lines.slice(0, 4));
  assert.equal(j.nodes.length, 4);
  assert.equal(j.decision, "hold");
  const e = deriveJourney({}, lines.slice(0, 4));
  assert.equal(e.nodes.length, 4);
  assert.equal(e.decision, null);
});

test("a result lacking the new fields yields nulls, never a throw", () => {
  const { result, lines } = cases[1];
  const j = deriveJourney(result, lines);
  assert.equal(j.scenario, null);
  assert.equal(j.resolved_how, null);
  assert.equal(j.input.text, null);
  assert.equal(j.input.from, null);
});

test("deriveJourney({}, []) and junk input are total", () => {
  for (const args of [[{}, []], [null, null], [undefined, undefined], [{ output: 5 }, [null, 3, {}]]]) {
    const j = deriveJourney(...args);
    assert.ok(Array.isArray(j.nodes));
    assert.equal(j.decision, null);
  }
  const j = deriveJourney({}, []);
  assert.deepEqual(j.nodes, []);
  assert.equal(j.run_id, null);
  assert.equal(j.reached_human, null);
  assert.equal(j.human.reply.kind, "none");
  assert.deepEqual(j.human.reply.blanks, []);
});

test("sql:faq line: three consulted, one retained", () => {
  const line = {
    step: "zetaris.query", agent_name: "Executor", action: "sql:faq", input_summary: "the faq {}",
    output_summary: "3 rows: faq:Q01, faq:Q02, faq:Q03", status: "success", timestamp: "2026-10-23T00:00:00Z",
  };
  const j = deriveJourney({ run_id: "x", output: { decision: "send", cited_rows: ["faq:Q02"] } }, [line]);
  assert.deepEqual(j.nodes[0].consulted, ["faq:Q01", "faq:Q02", "faq:Q03"]);
  assert.deepEqual(j.nodes[0].retained, ["faq:Q02"]);
  assert.equal(j.nodes[0].label, "Zetaris: the FAQ");
});

test("world_context ids tail and memory_ids are consulted", () => {
  const w = { step: "executor.act", agent_name: "World", action: "world_context", input_summary: "i", output_summary: "context; ids: threads_json:T01, threads_json:T02", status: "success" };
  const m = { step: "memory.read", agent_name: "Memory", action: "memory_read", input_summary: "i", output_summary: "2 memories", status: "success", memory_ids: ["mem-3", "mem-7"] };
  const j = deriveJourney({}, [m, w]);
  assert.deepEqual(j.nodes[0].consulted, ["mem-3", "mem-7"]);
  assert.deepEqual(j.nodes[1].consulted, ["threads_json:T01", "threads_json:T02"]);
  assert.equal(j.nodes[1].label, "World Model context");
  assert.equal(labelFor("nvidia.model", { action: "typed_gates" }), "Typed gates");
  assert.equal(labelFor("nvidia.model", { action: "draft_reply" }), "Draft");
});

test("hold with a draft: draft_for_human, reached_human on the final synthesis", () => {
  const lines = readLines("example-1");
  const j = deriveJourney(readResult(1), lines);
  assert.equal(j.human.reply.kind, "draft_for_human");
  const hits = j.nodes.filter((n) => n.reached_human);
  assert.deepEqual(hits.map((n) => n.step), ["synthesis"]);
  assert.equal(hits[0].n, lines.length);
  assert.ok(j.reached_human.what.includes("the draft"));
});

test("hold without a draft is none; ask result is answer", () => {
  assert.equal(replyFor({ output: { decision: "hold" } }).kind, "none");
  assert.equal(replyFor({ output: { decision: "close" } }).kind, "none");
  assert.equal(replyFor({ answer: "Seven days." }).kind, "answer");
  assert.equal(replyFor({ answer: "Seven days." }).text, "Seven days.");
});

test("blank markers are extracted from the draft", () => {
  const r = replyFor({ output: { decision: "hold", draft: { text: "Hi,\nPlease send [[blank: order number]] and [[blank: colour]]." } } });
  assert.deepEqual(r.blanks, ["order number", "colour"]);
  assert.equal(r.kind, "draft_for_human");
});

test("queued_for owner fields and attachments map into reply.to", () => {
  const r = replyFor({ output: { decision: "escalate", queued_for: { owner_id: 6, owner_name: "Tomas Keller", role: "rfq owner", attachments: ["products:FS-C01", { id: "faq:Q01" }] } } });
  assert.deepEqual(r.to, { employee_id: 6, name: "Tomas Keller", role: "rfq owner" });
  assert.deepEqual(r.attachments, ["products:FS-C01", "faq:Q01"]);
  assert.equal(r.kind, "escalation");
});

const FB = { email: "contact@jedipack.com", label: "Jedi Pack contact desk", cited: "contacts:default" };
test("both out: the contact desk is the reply target and queued_for keeps the pair", () => {
  const q = { owner_id: 5, owner_name: "Priya Raman", backup_id: 6, role: "default contact", fallback_contact: FB };
  const result = { output: { decision: "escalate", queued_for: q } };
  assert.deepEqual(replyFor(result).to, { employee_id: null, name: "Jedi Pack contact desk", role: "default contact", email: "contact@jedipack.com" });
  const j = deriveJourney(result, []);
  assert.equal(j.reached_human.who.email, "contact@jedipack.com");
  assert.equal(j.reached_human.who.employee_id, null);
  assert.equal(q.owner_id, 5);
});

test("a fallback contact without a label or role uses the email and 'default contact'", () => {
  const r = replyFor({ output: { decision: "escalate", queued_for: { owner_id: 5, fallback_contact: { email: "a@b.c" } } } });
  assert.deepEqual(r.to, { employee_id: null, name: "a@b.c", role: "default contact", email: "a@b.c" });
});

test("an approval still wins over a fallback contact", () => {
  const result = { output: { decision: "escalate", queued_for: { owner_id: 5, owner_name: "O", fallback_contact: FB,
    approval: { approver_id: "E9", approver_name: "Backup Boss" } } } };
  const r = replyFor(result);
  assert.equal(r.to.employee_id, "E9");
  assert.equal(r.to.email, undefined);
  assert.equal(deriveJourney(result, []).reached_human.who.email, undefined);
});

test("a malformed fallback contact is ignored and never throws", () => {
  for (const fc of [null, 7, "x", [], {}, { email: 3 }]) {
    const r = replyFor({ output: { decision: "escalate", queued_for: { owner_id: 5, owner_name: "O", role: "r", fallback_contact: fc } } });
    assert.deepEqual(r.to, { employee_id: 5, name: "O", role: "r" });
  }
});

test("object attachments contribute their cited id strings", () => {
  const r = replyFor({ output: { decision: "escalate", queued_for: { owner_id: 6, attachments: { prices: [{ sku: "FS-B01" }], quantities: [100], cited: ["products:FS-B01"] } } } });
  assert.deepEqual(r.attachments, ["products:FS-B01"]);
});

// ---- S5.3 review fixes (16, 18, 19) ----
test("(16) an over-limit approval names the approver, not the owner, in reply.to and reached_human.who", () => {
  const result = { run_id: "syn", output: { decision: "escalate", draft: { text: "d" }, queued_for: {
    owner_id: "E1", owner_name: "Away Owner", queue_file: "/q/x.json", approval: { approver_id: "E9", approver_name: "Backup Boss", amount: 900, limit: 500 } } } };
  const lines = [{ step: "escalate_or_fallback", status: "success", output_summary: "escalated; both critiques stored" }];
  const j = deriveJourney(result, lines);
  assert.equal(j.human.reply.to.employee_id, "E9");
  assert.equal(j.reached_human.who.employee_id, "E9");
  assert.equal(j.reached_human.who.name, "Backup Boss");
});

test("(18) a failed queue write is not reached_human and stores nothing", () => {
  const result = { run_id: "syn", output: { decision: "escalate", draft: { text: "d" }, queued_for: { owner_id: "E1", owner_name: "O", queue_file: null } } };
  const lines = [{ step: "escalate_or_fallback", status: "incomplete", output_summary: "escalated; the queue write failed, both critiques are in this trace" }];
  const j = deriveJourney(result, lines);
  assert.equal(j.nodes[0].reached_human, false);
  assert.equal(j.reached_human.queue_file, null);
  assert.deepEqual(j.reached_human.what, ["nothing stored: the queue write failed"]);
});

test("a line's detail is carried into its node as is; a line without one, or a skipped line, gives null", () => {
  const base = { step: "zetaris.query", agent_name: "Executor", action: "sql:employee", input_summary: "the employee record", status: "success" };
  const lines = [
    { ...base, output_summary: "1 rows: employees:15", detail: "Soren Adey · Support Agent · Support" },
    { ...base, output_summary: "1 rows: employees:16" },
    { ...base, status: "skipped", output_summary: "", detail: "never shown" },
  ];
  const j = deriveJourney({ run_id: "d", output: { decision: "hold", cited_rows: ["employees:15"] } }, lines);
  assert.equal(j.nodes[0].detail, "Soren Adey · Support Agent · Support");
  assert.deepEqual(j.nodes[0].consulted, ["employees:15"]);
  assert.deepEqual(j.nodes[0].retained, ["employees:15"]);
  assert.equal(j.nodes[1].detail, null);
  assert.equal(j.nodes[2].detail, null);
});

test("(19) the world line's 'ids: none' sentinel gives consulted []", () => {
  const lines = [{ step: "nvidia.model", action: "world_context", output_summary: "5 entities, 3 relationships; customer none: 0 earlier threads; ids: none", status: "success" }];
  const j = deriveJourney({ run_id: "syn", output: {} }, lines);
  assert.deepEqual(j.nodes[0].consulted, []);
});

// ---- S3.1: timing, tech, returned, top-level queue fields ----
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { runTicket } from "../src/loop.mjs";
import { techOf } from "../src/journey.mjs";

const THREAD_IDS = readFileSync(`${ROOT}data/synthetic/threads/threads.jsonl`, "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l).thread_id).slice(0, 24);
async function sampleRun(id) {
  const d = { logsDir: mkdtempSync(join(tmpdir(), "jny-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "jny-mem-")), quiet: true };
  const run_id = `jny-${id}`;
  const result = await runTicket(id, { run_id, cfg: { ...config(), SAMPLE_MODE: "true" }, deps: d });
  const lines = readFileSync(join(d.logsDir, `trace-${run_id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { result, lines };
}

test("invariant sweep: all 24 threads in sample mode, every node has a known tech, duration_ms >= 0, top-level fields present", async () => {
  assert.equal(THREAD_IDS.length, 24);
  for (const id of THREAD_IDS) {
    const { result, lines } = await sampleRun(id);
    const j = deriveJourney(result, lines);
    assert.equal(j.nodes.length, lines.length, id);
    for (const n of j.nodes) {
      assert.notEqual(n.tech, "unknown", `${id} node ${n.n} ${n.step}`);
      assert.ok(typeof n.duration_ms === "number" && n.duration_ms >= 0, `${id} node ${n.n}`);
      if (n.tech === "Zetaris") assert.ok(n.returned === null || Array.isArray(n.returned), `${id} node ${n.n}`);
    }
    for (const k of ["team", "team_label", "topic_label", "cc", "also", "status", "auto_reply", "memory_note", "channel_label", "trusted_to_send"]) {
      assert.ok(k in j, `${id} missing ${k}`);
    }
    assert.equal(typeof j.trusted_to_send, "boolean");
    assert.equal(typeof j.auto_reply, "boolean");
    assert.ok(Array.isArray(j.cc) && Array.isArray(j.also));
    assert.equal(j.status, result.output.status, id);
    // returned holds only cited hits
    for (const n of j.nodes) {
      if (n.tech !== "Zetaris" || !n.returned) continue;
      for (const r of n.returned) assert.ok(result.output.cited_rows.includes(r.id) || JSON.stringify(result).includes(r.id), `${id}: ${r.id}`);
    }
  }
});

test("tech is read from the line's own step, agent, sponsor, model and gate_source, never guessed", () => {
  assert.equal(techOf({ sponsor: "zetaris" }), "Zetaris");
  assert.equal(techOf({ step: "meterless.engine", sponsor: "meterless", agent_name: "Scout" }), "Meterless (Scout contract)");
  assert.equal(techOf({ step: "meterless.engine", sponsor: "meterless", agent_name: "WorldModel" }), "Meterless (World Model)");
  assert.equal(techOf({ sponsor: "nvidia", model: "nemotron-x", agent_name: "Drafter" }), "Nightshift (nemotron-x)");
  assert.equal(techOf({ model: "nemotron-x", agent_name: "Evaluator" }), "Nightshift (nemotron-x)");
  assert.equal(techOf({ sponsor: "nvidia", model: "openjev-0.1 (openjev-0.1)", gate_source: "openjev", agent_name: "Severity" }), "OpenJev (openjev-0.1)");
  assert.equal(techOf({ sponsor: "nvidia", model: "rules", gate_source: "rules", agent_name: "Severity" }), "rules");
  assert.equal(techOf({ step: "risk.signoff", sponsor: "meterless", agent_name: "Risk" }), "rules");
  assert.equal(techOf({ sponsor: "nvidia", model: "sample/rules", agent_name: "Drafter" }), "rules");
  assert.equal(techOf({ agent_name: "Memory", step: "memory.read" }), "H-MEM");
  assert.equal(techOf({ agent_name: "Planner", step: "branch" }), "rules");
  assert.equal(techOf({ step: "nvidia.model", agent_name: "Drafter", status: "skipped" }), "not run");
  assert.equal(techOf({ step: "branch" }), "unknown");
  assert.equal(techOf(null), "unknown");
});

test("every label on a real live trace (jedi.blastworks.ai, 24 Oct): Nemotron is Nightshift, the Scout contract and World Model are the Meterless engine, OpenJev only for the openjev gate", () => {
  const { lines } = JSON.parse(readFileSync(new URL("./fixtures/live_trace_tech.json", import.meta.url), "utf8"));
  // pinned by hand from what each step is, keyed step|agent|skipped
  const want = {
    "memory.read|Memory|": "H-MEM", "memory.write|Memory|": "H-MEM",
    "planner.plan|Planner|": "rules", "delegate|Planner|": "rules", "branch|Planner|": "rules", "synthesis|Planner|": "rules",
    "retry|Planner|skipped": "not run", "recovery|Planner|skipped": "not run",
    "zetaris.query|Executor|": "Zetaris", "zetaris.query|Scout|": "Zetaris", "executor.act|Executor|": "Zetaris",
    "meterless.engine|Scout|": "Meterless (Scout contract)", "meterless.engine|WorldModel|": "Meterless (World Model)",
    "nvidia.model|Gates|": "OpenJev (openjev-0.1)",
    "nvidia.model|Drafter|": "Nightshift (nvidia/nemotron-3.5-lightning-30b-a3b)",
    "nvidia.model|RefundReader|": "Nightshift (nvidia/nemotron-3.5-lightning-30b-a3b)",
    "nvidia.model|Recommender|": "Nightshift (nvidia/nemotron-3.5-lightning-30b-a3b)",
    "critique|Evaluator|": "Nightshift (nvidia/nemotron-3.5-lightning-30b-a3b)",
    "nvidia.model|Drafter|skipped": "not run", "critique|Evaluator|skipped": "not run",
    "risk.signoff|Risk|": "rules", "risk.signoff|Risk|skipped": "not run",
    "escalate_or_fallback|Escalator|": "rules", "escalate_or_fallback|Escalator|skipped": "not run",
  };
  assert.ok(lines.length >= 20, "the fixture holds the live lines");
  for (const l of lines) {
    const k = `${l.step}|${l.agent_name}|${l.status === "skipped" ? "skipped" : ""}`;
    assert.ok(k in want, `a live line kind with no pinned label: ${k}`);
    assert.equal(techOf(l), want[k], k);
  }
});

test("a Zetaris node returns only the hit row with its key fields; a model node returns its reply as recorded; a skipped node returns null", () => {
  const z = { step: "zetaris.query", agent_name: "Executor", action: "sql:faq", input_summary: "the faq", output_summary: "3 rows: faq:Q01, faq:Q02, faq:Q03", status: "success", sponsor: "zetaris", timestamp: "2026-10-24T10:00:00.250Z", duration_ms: 250 };
  const m = { step: "nvidia.model", agent_name: "Drafter", action: "draft_reply", input_summary: "round 1", output_summary: "Hello, seven days.", status: "success", sponsor: "nvidia", model: "nemotron-x", timestamp: "2026-10-24T10:00:01.000Z" };
  const s = { ...m, status: "skipped", output_summary: "not called" };
  const j = deriveJourney({ run_id: "r", output: { decision: "send", cited_rows: ["faq:Q02"] } }, [z, m, s]);
  assert.deepEqual(j.nodes[0].returned, [{ id: "faq:Q02", table: "faq", key: "Q02" }]);
  assert.equal(j.nodes[0].tech, "Zetaris");
  assert.equal(j.nodes[0].duration_ms, 250);
  assert.equal(j.nodes[1].returned, "Hello, seven days.");
  assert.equal(j.nodes[1].tech, "Nightshift (nemotron-x)");
  assert.equal(j.nodes[1].duration_ms, 750, "older trace without duration_ms: gap to the previous timestamp");
  assert.equal(j.nodes[2].returned, null);
});

test("pairing with the stored example traces is tolerant of second vs millisecond timestamp precision", () => {
  // judging/traces are regenerated later; until then they carry whole-second timestamps and no duration_ms, so the pairing
  // asserts on run_id and node shape, never on the timestamp format.
  for (const { result, lines } of cases) {
    const j = deriveJourney(result, lines);
    assert.equal(j.run_id, lines[0].run_id);
    for (const [i, n] of j.nodes.entries()) {
      assert.match(n.timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/);
      assert.ok(n.duration_ms === null || n.duration_ms >= 0);
      assert.notEqual(n.tech, "unknown", `node ${i + 1}`);
    }
  }
});

test("FAQ question in sample mode: the faq node's returned is exactly the hit row, the scanned rows are not listed", async () => {
  const d = { logsDir: mkdtempSync(join(tmpdir(), "jny-logs-")), memoryDir: mkdtempSync(join(tmpdir(), "jny-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "jny-run-")), quiet: true };
  const input = { message: "What is your returns and refund policy?", from: "new.customer@example.com", name: "Rey Kanata", channel: "chat", as_of: "2026-10-20" };
  const result = await runTicket(null, { run_id: "jny-faq", cfg: { ...config(), SAMPLE_MODE: "true" }, as_of: input.as_of, input, deps: d });
  const lines = readFileSync(join(d.logsDir, "trace-jny-faq.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(result.branch_id, "faq-hit");
  const j = deriveJourney(result, lines);
  const node = j.nodes.find((n) => n.step === "zetaris.query" && n.action === undefined && /faq/.test(n.label)) ?? j.nodes.find((n) => n.label === "Zetaris: the FAQ");
  assert.ok(node, "a faq node exists");
  assert.ok(node.consulted.length > 1, "several faq rows were read");
  const hit = result.output.cited_rows.filter((id) => id.startsWith("faq:"));
  assert.equal(hit.length, 1);
  assert.deepEqual(node.returned.map((r) => r.id), hit);
  assert.equal(node.returned[0].table, "faq");
  assert.equal(node.tech, "Zetaris");
});

test("sent: nonsense status is null, no extras gives sent null and Plan 1's status", () => {
  assert.equal(deriveJourney({}, [], { sent: { status: "nonsense" } }).sent.status, null);
  assert.equal(deriveJourney({}, [], { sent: "x" }).sent, null);
  // explicit expectations: none of the three committed examples carries a status (output.status or queued_for.status), so each is null
  const EXPECTED_STATUS = { 1: null, 2: null, 3: null };
  for (const { n, result, lines } of cases) {
    assert.equal(result.output?.status, undefined, `example ${n} carries no output.status`);
    const j = deriveJourney(result, lines);
    assert.equal(j.sent, null);
    assert.equal(j.status, EXPECTED_STATUS[n], `example ${n}`);
    assert.equal(j.ticket_status, EXPECTED_STATUS[n], `example ${n}`);
  }
  // the fallback: with no output.status the queued_for.status is used, and output.status wins when both exist
  const { result: r3, lines: l3 } = cases[2];
  const viaQueue = { ...r3, output: { ...r3.output, queued_for: { ...r3.output.queued_for, status: "follow_up" } } };
  assert.equal(deriveJourney(viaQueue, l3).status, "follow_up");
  assert.equal(deriveJourney(viaQueue, l3).ticket_status, "follow_up");
  const both = { ...viaQueue, output: { ...viaQueue.output, status: "handled" } };
  assert.equal(deriveJourney(both, l3).status, "handled");
  const j0 = deriveJourney({}, []);
  assert.equal(j0.sent, null);
});

test("sent: round-trip overrides status, ticket_status is the alias, nonsense status does not override", () => {
  const sent = { by: "Priya Raman", at: "2026-10-24T18:00:00Z", body: "x", status: "follow_up" };
  const { result, lines } = cases[0];
  const j = deriveJourney(result, lines, { sent });
  assert.deepEqual(j.sent, { by: "Priya Raman", at: "2026-10-24T18:00:00Z", body: "x", status: "follow_up", ticket_id: null, queue_file: null });
  assert.equal(j.status, "follow_up");
  assert.equal(j.ticket_status, "follow_up");
  const base = deriveJourney(result, lines);
  const bad = deriveJourney(result, lines, { sent: { ...sent, status: "nonsense" } });
  assert.equal(bad.status, base.status);
  assert.equal(bad.sent.status, null);
});

test("sent: node shapes are identical with and without extras", () => {
  for (const { result, lines } of cases) {
    const a = deriveJourney(result, lines);
    const b = deriveJourney(result, lines, { sent: { by: "P", at: "t", body: "b", status: "handled", ticket_id: "T1", queue_file: "f.json" } });
    assert.equal(JSON.stringify(b.nodes), JSON.stringify(a.nodes));
    assert.deepEqual(b.human, a.human);
  }
});

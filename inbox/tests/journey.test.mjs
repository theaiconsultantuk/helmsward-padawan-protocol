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
  const r = replyFor({ output: { decision: "escalate", queued_for: { owner_id: 6, owner_name: "Tomas Keller", role: "rfq owner", attachments: ["products:P03", { id: "faq:Q01" }] } } });
  assert.deepEqual(r.to, { employee_id: 6, name: "Tomas Keller", role: "rfq owner" });
  assert.deepEqual(r.attachments, ["products:P03", "faq:Q01"]);
  assert.equal(r.kind, "escalation");
});

test("object attachments contribute their cited id strings", () => {
  const r = replyFor({ output: { decision: "escalate", queued_for: { owner_id: 6, attachments: { prices: [{ product_id: "P01" }], quantities: [100], cited: ["products:P01"] } } } });
  assert.deepEqual(r.attachments, ["products:P01"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HMEM } from "../src/engines/hmem/index.mjs";

const T0 = 1_800_000_000_000;
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "hmem-"));
const fixed = () => T0;

function scenario(dir) {
  const a = new HMEM({ persistDir: dir, clock: fixed });
  a.query("refund policy", { threshold: 0 });
  const rec = a.add({ content: "Refund policy allows refunds within 30 days", source: "test", tags: ["policy"] });
  const b = new HMEM({ persistDir: dir, clock: fixed });
  b.query("refund policy", { threshold: 0 });
  return rec.id;
}

test("cold start then warm second run", () => {
  const dir = mk();
  const a = new HMEM({ persistDir: dir, clock: fixed });
  const r1 = a.query("refund policy");
  assert.equal(r1.memories.length, 0);
  assert.match(r1.trace.retrievalReason, /cold/);
  const rec = a.add({ content: "Refund policy allows refunds within 30 days", source: "test" });
  assert.equal(rec.id, "mem-1");
  const b = new HMEM({ persistDir: dir, clock: fixed });
  const r2 = b.query("refund policy", { threshold: 0 });
  assert.equal(r2.memories.length, 1);
  assert.ok(r2.memories[0].relevance > 0);
  assert.ok(["minimal", "personal", "comprehensive"].includes(r2.trace.strategy));
  const s = r2.trace.scores[rec.id];
  for (const k of ["sem", "kw", "tag", "domain", "entity", "layer", "recency", "superseded", "confidence", "total"]) {
    assert.equal(typeof s[k], "number", k);
  }
  assert.equal(b.ledger.history(rec.id)[0].op, "create");
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
  assert.equal(state.records[0].accessCount, 1);
  assert.equal(r2.context, rec.content);
});

test("two identical runs are byte-identical", () => {
  const d1 = mk(), d2 = mk();
  scenario(d1); scenario(d2);
  for (const f of ["state.json", "ledger.jsonl"]) {
    assert.equal(fs.readFileSync(path.join(d1, f), "utf-8"), fs.readFileSync(path.join(d2, f), "utf-8"), f);
  }
});

test("add without source throws", () => {
  const m = new HMEM({ persistDir: mk(), clock: fixed });
  assert.throws(() => m.add({ content: "x" }));
  assert.throws(() => m.add({ content: "x", source: "  " }));
});

test("feedback adjusts confidence", () => {
  const m = new HMEM({ persistDir: mk(), clock: fixed });
  const { id } = m.add({ content: "a fact", source: "test" });
  m.feedback(id, "helpful");
  assert.equal(m.all()[0].confidence, 0.75);
  m.feedback(id, "not_helpful");
  assert.equal(m.all()[0].confidence, 0.72);
  m.feedback(id, "wrong");
  assert.equal(m.all()[0].confidence, 0.52);
  assert.ok(m.all()[0].tags.includes("review"));
  assert.throws(() => m.feedback("mem-99", "wrong"));
  assert.equal(m.ledger.history(id).filter((e) => e.op === "feedback").length, 3);
});

test("queueForHuman writes cc, also and status into the queue file", () => {
  const dir = mk();
  const m = new HMEM({ persistDir: dir, clock: fixed });
  const cc = [{ id: 7, name: "A", role: "Head", email: "a@x" }], also = [{ id: 203 }];
  m.queueForHuman({ id: "T-9", thread_id: "th9" }, [{ reason: "legal" }], { owner: { id: 15 }, cc, also, status: "open" });
  const q = JSON.parse(fs.readFileSync(path.join(dir, "queue", "th9.json"), "utf-8"));
  assert.deepEqual(q.cc, cc); assert.deepEqual(q.also, also); assert.equal(q.status, "open");
  m.queueForHuman({ id: "T-10", thread_id: "th10" }, []);
  const q2 = JSON.parse(fs.readFileSync(path.join(dir, "queue", "th10.json"), "utf-8"));
  assert.ok(!("cc" in q2) && !("also" in q2) && !("status" in q2));
});

test("query: entity matching is case-insensitive (an email entity matches)", () => {
  const m = new HMEM({ persistDir: mk(), clock: fixed });
  m.add({ content: "refund for the blade", source: "t", entities: ["LiraVenn@Email.com"] });
  const hit = m.query("zzz", { threshold: 0.01, entities: ["liravenn@email.com"] });
  assert.equal(hit.memories.length, 1);
  assert.ok(Object.values(hit.trace.scores).every((s) => s.entity === 1));
});

test("queueForHuman writes queue file and tagged memory", () => {
  const dir = mk();
  const m = new HMEM({ persistDir: dir, clock: fixed });
  const critiques = [{ reason: "low confidence" }, { reason: "policy gap" }, { source: "Draft", reason: "Hello Zyxquorn Testerly, your proposed reply" }];
  const id = m.queueForHuman({ id: "T-1", thread_id: "th1" }, critiques);
  const q = JSON.parse(fs.readFileSync(path.join(dir, "queue", "th1.json"), "utf-8"));
  assert.deepEqual(q.critiques, critiques, "the approval queue retains the complete personalised draft");
  assert.equal(q.ticket.id, "T-1");
  assert.equal(q.queuedAt, T0);
  const rec = m.all().find((r) => r.id === id);
  assert.deepEqual(rec.tags, ["queue:human"]);
  assert.equal(rec.source, "loop");
  assert.equal(rec.content, "ticket T-1 escalated: low confidence; policy gap");
});

test("threshold 0 returns everything", () => {
  const m = new HMEM({ persistDir: mk(), clock: fixed });
  for (const c of ["alpha", "beta", "gamma"]) m.add({ content: c, source: "test" });
  const r = m.query("zzz unrelated", { threshold: 0, topN: 10 });
  assert.equal(r.memories.length, 3);
  assert.equal(r.trace.strategy, "comprehensive");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { systemone, status } from "../src/adapters/openjev.mjs";
import * as sample from "../src/adapters/sample.mjs";
import { withMockFetch, mockRefused } from "./helpers/mock_fetch.mjs";

const cfg = config({ OPENJEV_BASE_URL: "http://openjev.test", OPENJEV_API_KEY: "test-key-not-real" });
const Q = { is_ping: { type: "noul", instructions: "Is this a ping?", criteria: { true: "the state says ping", false: "anything else" } } };
const isOj = (u) => u.endsWith("/v1/systemone");

test("status() sends the real noul shape (criteria object) and reports the served model", async () => {
  let sent;
  const routes = [{ match: isOj, reply: (u, init) => { sent = JSON.parse(init.body); return { status: 200, body: { model: "openjev-0.1", answers: { is_ping: { type: "noul", noul: 0.99 } } } }; } }];
  await withMockFetch(routes, async () => {
    const r = await status({ cfg });
    assert.equal(r.ok, true);
    assert.equal(r.model, "openjev-0.1");
    assert.equal(typeof sent.questions.is_ping.criteria, "object");
    assert.equal(typeof sent.questions.is_ping.criteria.true, "string");
  });
});

test("529 with retry-after then 200 returns answers after exactly two calls", async () => {
  let n = 0;
  const routes = [{ match: isOj, reply: () => (++n === 1
    ? { status: 529, headers: { "retry-after": "1" }, body: { error: "busy" } }
    : { status: 200, body: { answers: { is_ping: 0.97 }, model: "openjev-0.1" } }) }];
  await withMockFetch(routes, async (calls) => {
    const r = await systemone("ping", Q, { cfg, retryDelayMs: 5 });
    assert.deepEqual(r.answers, { is_ping: 0.97 });
    assert.equal(r.model, "openjev-0.1");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.headers.Authorization, "Bearer test-key-not-real");
  });
});

test("401 throws Unauthorized", async () => {
  await withMockFetch([{ match: isOj, reply: () => ({ status: 401, body: {} }) }], async () => {
    await assert.rejects(systemone("x", Q, { cfg }), (e) => e.name === "Unauthorized");
  });
});

test("refused throws UpstreamRefused", async () => {
  await withMockFetch([{ match: isOj, reply: () => { throw mockRefused(); } }], async () => {
    await assert.rejects(systemone("x", Q, { cfg }), (e) => e.name === "UpstreamRefused");
  });
});

const dir = mkdtempSync(join(tmpdir(), "oj-sample-"));
writeFileSync(join(dir, "q.json"), JSON.stringify([
  { params: {}, result: { headers: ["a"], rows: [[0]], total: 1 } },
  { params: { a: 1, b: 2 }, result: { headers: ["a"], rows: [[1], [2]], total: 2 } },
]));
writeFileSync(join(dir, "strict.json"), JSON.stringify([{ params: { a: 1 }, result: { headers: [], rows: [] } }]));
const scfg = config({ SAMPLE_DIR: dir });

test("queryByName: key order independent, {} fallback, no match, bad name", () => {
  assert.equal(sample.queryByName("q", { b: 2, a: 1 }, { cfg: scfg }).total, 2);
  assert.equal(sample.queryByName("q", { z: 9 }, { cfg: scfg }).rows[0][0], 0);
  assert.equal(sample.queryByName("q", {}, { cfg: scfg }).timeUsed, 0);
  assert.throws(() => sample.queryByName("strict", { a: 2 }, { cfg: scfg }), /no cached rows for strict/);
  assert.throws(() => sample.queryByName("../etc/passwd", {}, { cfg: scfg }), /bad query name/);
});

const ticket = { thread_id: "T03", subject: "Refund over the limit", body: "I want a refund of 400.00 GC", sender_name: "Cass Holm", category: "refund", amount: 400 };
const facts = { policy_limit: 150, category: "refund", weight: 0.55, floor: 0.8, owner: "Ann", backup: "Bo", owner_out: false, backup_out: false, may_leave: true, cited_rows: ["policy:refund"], restricted_terms: ["margin"] };

test("draft/critique: over-limit refund fails, revised passes, restricted term and nobody-available fail", () => {
  const d = sample.draft(ticket, facts);
  assert.equal(d.promises.refund_amount, 400);
  const c = sample.critique(d, facts);
  assert.equal(c.pass, false);
  assert.match(c.reason, /above the limit in policy row/);
  const r = sample.draft(ticket, facts, { seed: "revised" });
  assert.equal(r.promises.refund_amount, null);
  assert.match(r.text, /Bo/);
  assert.equal(sample.critique(r, facts).pass, true);
  assert.equal(sample.critique({ ...r, text: "Our margin is high" }, facts).pass, false);
  assert.equal(sample.critique(r, { ...facts, owner_out: true, backup_out: true }).pass, false);
  const rep = { ...ticket, category: "replacement", amount: 50 };
  assert.equal(sample.draft(rep, { ...facts, category: "replacement" }).promises.replacement, true);
  assert.equal(sample.draft(rep, { ...facts, category: "replacement" }, { seed: "misread" }).promises.refund_amount, 50);
});

test("gates: money words raise asks_for_money; deterministic", () => {
  const g = sample.gates({ subject: "Help", body: "I want my money back" });
  assert.ok(g.answers.asks_for_money >= 0.5);
  assert.equal(g.gate_source, "rules");
  assert.equal(g.confidence, 0.5);
  assert.deepEqual(g, sample.gates({ subject: "Help", body: "I want my money back" }));
  assert.equal(sample.gates({ subject: "Hi", body: "thanks, love it" }).answers.asks_for_money, 0.1);
});

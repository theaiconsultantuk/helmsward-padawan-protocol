import { test } from "node:test";
import assert from "node:assert/strict";
import { ulid, canonicalJson, sign, issueContract, verifyContract } from "../src/engines/scout/contract.mjs";

const T0 = Date.parse("2026-10-24T08:00:00Z");
const args = (extra = {}) => ({
  traceId: "trace-1",
  intent: { primary: { id: "inbox.triage" }, parameters: { n: 5 }, references: {}, confidence: 0.9, alternates: [] },
  risk: { level: "low", flags: [], redactions: [], approvals: [] },
  toolPlan: [{ capability: "mail.read", tool: "gmail.list", input: { q: "x" } }],
  modelProfile: "fast",
  scope: { user: "u1", surface: "inbox", capabilities: ["mail.read"] },
  registryVersion: 1,
  policyPackVersion: "default@1",
  clock: () => T0,
  secret: "A",
  ...extra,
});

test("contract-drift: issue/verify", () => {
  const c = issueContract(args());
  assert.equal(c.signedBy, "scout");
  assert.equal(c.expiresAt, new Date(T0 + 300000).toISOString());
  assert.deepEqual(verifyContract(c, { secret: "A", clock: () => T0 + 1000 }), { ok: true, reason: null });
  assert.equal(verifyContract(c, { secret: "B", clock: () => T0 }).reason, "signature");
});

test("tamper nested field -> signature", () => {
  const c = structuredClone(issueContract(args()));
  c.toolPlan[0].capability = "mail.send";
  assert.equal(verifyContract(c, { secret: "A", clock: () => T0 }).reason, "signature");
});

test("expired", () => {
  const c = issueContract(args());
  assert.equal(verifyContract(c, { secret: "A", clock: () => T0 + 300001 }).reason, "expired");
});

test("signedBy altered, missing", () => {
  const c = { ...issueContract(args()), signedBy: "evil" };
  assert.equal(verifyContract(c, { secret: "A", clock: () => T0 }).reason, "signedBy");
  assert.equal(verifyContract(null, { secret: "A" }).reason, "missing");
  assert.equal(verifyContract({}, { secret: "A" }).reason, "missing");
});

test("canonicalJson stable and order independent", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } }), '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.equal(sign({ a: 1, b: 2, signature: "x" }, "s"), sign({ b: 2, a: 1 }, "s"));
});

test("ulid shape and time monotonic", () => {
  const a = ulid(() => T0), b = ulid(() => T0 + 1), c = ulid(() => T0 + 100000);
  for (const u of [a, b, c]) assert.match(u, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(a.slice(0, 10) < b.slice(0, 10) && b.slice(0, 10) < c.slice(0, 10));
});

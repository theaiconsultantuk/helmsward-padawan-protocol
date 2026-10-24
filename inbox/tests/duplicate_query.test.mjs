// The duplicate check goes through the thread_fingerprints Zetaris template; customer text never reaches SQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.mjs";
import { TEMPLATES, findDuplicate, earliestDuplicate } from "../src/queries.mjs";

const HEADERS = ["thread_id", "sender_email", "subject", "body", "received_at"];
const row = (id, at, body = "same body", sender = "a@example.com", subject = "same subject") => [id, sender, subject, body, at];
const stub = (rows) => async () => ({ headers: HEADERS, rows, total: rows.length });
const ticket = (o = {}) => ({ thread_id: "T9", sender_email: "a@example.com", subject: "same subject", body: "same body", received_at: "2026-10-22T10:00:00Z", ...o });

test("the template takes no parameters and its SQL carries no customer text", () => {
  assert.deepEqual(Object.keys(TEMPLATES.thread_fingerprints.params), []);
  assert.match(TEMPLATES.thread_fingerprints.sql(), /^SELECT thread_id, sender_email, subject, body, received_at FROM JEDI_PACK\.threads_json/);
});

test("(c) an identical earlier thread is returned, the earliest of several; never the thread itself", async () => {
  const rows = [row("T9", "2026-10-22T10:00:00Z"), row("T5", "2026-10-22T09:30:00Z"), row("T3", "2026-10-22T08:00:00Z"), row("T7", "2026-10-22T09:45:00Z", "other body")];
  assert.deepEqual(await findDuplicate(ticket(), { sqlRunImpl: stub(rows) }), { thread_id: "T3", received_at: "2026-10-22T08:00:00Z" });
});

test("(c) null when nothing matches, or only later threads match", async () => {
  assert.equal(await findDuplicate(ticket(), { sqlRunImpl: stub([row("T1", "2026-10-22T08:00:00Z", "different"), row("T2", "2026-10-22T08:00:00Z", "same body", "b@example.com")]) }), null);
  assert.equal(await findDuplicate(ticket(), { sqlRunImpl: stub([row("T9", "2026-10-22T10:00:00Z"), row("T8", "2026-10-22T11:00:00Z")]) }), null);
  assert.equal(earliestDuplicate(ticket(), []), null);
});

test("a failed query throws (the loop turns that into dup = null and a trace line)", async () => {
  await assert.rejects(findDuplicate(ticket(), { sqlRunImpl: async () => { throw new Error("down"); } }), /down/);
});

test("(d) sample mode serves the fingerprints from the cache with no network", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network used"); };
  try {
    const lines = [];
    const cfg = config({ SAMPLE_MODE: "true" });
    const d = await findDuplicate(ticket({ thread_id: "T24", sender_email: "", subject: "", body: "", received_at: "2026-10-22T10:24:00Z" }), { cfg, trace: { line: (l) => lines.push(l) } });
    assert.equal(d, null, "an empty fingerprint matches nothing");
    // T24 repeats T11 in the authored data
    const all = await (await import("../src/queries.mjs")).run("thread_fingerprints", {}, { cfg, limit: 1000 });
    const t24 = all.objects.find((o) => o.thread_id === "T24");
    assert.equal(all.rows.length, 100);
    assert.deepEqual(await findDuplicate({ ...t24 }, { cfg }), { thread_id: "T11", received_at: "2026-10-22T10:22:00Z" });
    assert.equal(lines.at(-1).step, "zetaris.query");
    assert.match(lines.at(-1).output_summary, /^100 rows: threads_json/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("P13/H13 runtime intake rows: same sender_email + same body within 7 days is a duplicate, subject aside; later, other sender or stale is not", async () => {
  const { earliestIntakeDuplicate } = await import("../src/queries.mjs");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { INTAKE_HEADER, appendIntake } = await import("../src/intake.mjs");
  assert.ok(INTAKE_HEADER.includes("sender_email"));
  const dir = mkdtempSync(join(tmpdir(), "dup-rt-"));
  const a = await appendIntake({ message: "Where is my order?", from: "x@email.com", subject: "one", received_at: "2026-10-20T10:00:00Z" }, { runtimeDir: dir });
  const b = await appendIntake({ message: "where is  my order?", from: "X@email.com", subject: "two", received_at: "2026-10-22T10:00:00Z" }, { runtimeDir: dir });
  const c = await appendIntake({ message: "Where is my order?", from: "y@email.com", received_at: "2026-10-22T11:00:00Z" }, { runtimeDir: dir });
  const old = await appendIntake({ message: "Where is my order?", from: "x@email.com", received_at: "2026-11-05T10:00:00Z" }, { runtimeDir: dir });
  const stub = async () => ({ headers: HEADERS, rows: [], total: 0 });
  assert.deepEqual(await findDuplicate(b.row, { sqlRunImpl: stub, runtimeDir: dir }), { thread_id: a.thread_id, received_at: "2026-10-20T10:00:00Z" });
  assert.equal(await findDuplicate(a.row, { sqlRunImpl: stub, runtimeDir: dir }), null, "the first message has no earlier twin");
  assert.equal(await findDuplicate(c.row, { sqlRunImpl: stub, runtimeDir: dir }), null, "another sender");
  assert.equal(await findDuplicate(old.row, { sqlRunImpl: stub, runtimeDir: dir }), null, "more than 7 days after the last twin");
  assert.equal(earliestIntakeDuplicate({ thread_id: "F9", sender_email: "", body: "same", received_at: "2026-10-22T10:00:00Z" }, [{ thread_id: "F1", sender_email: "", body: "same", received_at: "2026-10-21T10:00:00Z" }]), null, "an empty sender never matches");
});

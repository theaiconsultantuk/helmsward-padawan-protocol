import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { WorldModel } from "../src/engines/world-model/index.mjs";
import { getWorld, resetWorldCache, complaintContext, worldLine, ingestThreads, worldIngestObservations, mentionedProducts, toObjects } from "../src/engines/world-model/world.mjs";

const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "sample");
const load = (n) => JSON.parse(fs.readFileSync(path.join(SAMPLE, `${n}.json`), "utf8"))[0].result;
const rowsToObjects = (r) => toObjects(r);
const rows = { world_threads: load("world_threads"), products: load("products"), reviews: load("reviews") };
const threads = rowsToObjects(rows.world_threads);
const products = rowsToObjects(rows.products);

test("build on the sample rows takes under 2 s", async () => {
  resetWorldCache();
  const t0 = performance.now();
  const w = await getWorld({ rows });
  const ms = performance.now() - t0;
  console.log(`world build: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 2000, `build took ${ms}`);
  assert.ok(w.view("graph").query({ type: "customer" }).length > 10);
});

test("getWorld twice with the same rows is the same instance; object rows work too", async () => {
  const a = await getWorld({ rows });
  const b = await getWorld({ rows: { world_threads: threads, products, reviews: rowsToObjects(rows.reviews) } });
  assert.equal(a, b);
});

test("tilda.moss: 3 earlier threads, 2 when the current thread is hers; ids and ids: tail", async () => {
  const w = await getWorld({ rows });
  const hers = threads.filter((t) => t.sender_email === "tilda.moss@example.com");
  assert.equal(hers.length, 3);
  const c = complaintContext(w, { sender_email: "tilda.moss@example.com", thread_id: "F1" });
  assert.equal(c.summary.earlier_threads, 3);
  assert.ok(c.provenance.length >= 4);
  for (const t of hers) assert.ok(c.provenance.some((p) => p.id === `thread:jedi:${t.thread_id}`));
  assert.match(c.text, /3 earlier threads/);
  const c2 = complaintContext(w, { sender_email: "tilda.moss@example.com", thread_id: hers[1].thread_id });
  assert.equal(c2.summary.earlier_threads, 2);
  assert.ok(!c2.provenance.some((p) => p.id === `thread:jedi:${hers[1].thread_id}`));
  const own = hers.filter((t) => t.category === "complaint").length;
  assert.equal(c.summary.complaints, own);
  const line = worldLine(w, c);
  assert.match(line, /^\d+ entities, \d+ relationships; customer customer:email:tilda\.moss@example\.com: 3 earlier threads, \d+ complaints, public (yes|no); product none: 0 complaints; ids: \S+/);
  assert.ok(line.endsWith(c.provenance.map((p) => p.id).join(",")));
});

test("unknown email: no earlier threads, empty provenance, ids: none", async () => {
  const w = await getWorld({ rows });
  const c = complaintContext(w, { sender_email: "nobody@example.com" });
  assert.equal(c.text, "no earlier threads for this sender");
  assert.deepEqual(c.provenance, []);
  assert.deepEqual(c.summary, { earlier_threads: 0, complaints: 0, public_before: false, product_complaints: {} });
  assert.match(worldLine(w, c), /ids: none$/);
});

test("product complaint count matches a direct count over the rows, and the fact", async () => {
  const w = await getWorld({ rows });
  const counts = products.map((p) => [String(p.sku), threads.filter((t) => t.category === "complaint" && mentionedProducts(t.subject, products).includes(String(p.sku))).length]);
  const [pid, n] = counts.sort((a, b) => b[1] - a[1])[0];
  console.log(`most-complained product in the sample rows: ${pid} with ${n}`);
  const c = complaintContext(w, { sender_email: "nobody@example.com", skus: [pid] });
  assert.equal(c.summary.product_complaints[pid], n);
  const f = w.view("facts").about(`product:jedi:${pid}`).find((x) => x.predicate === "complaint_count");
  assert.equal(f.value, n);
  assert.equal(f.confidence, 1);
  assert.ok(c.provenance.some((p) => p.id === f.id));
  assert.match(worldLine(w, c), new RegExp(`product ${pid}: ${n} complaints`));
});

test("a product mentioned in 2 complaint threads reports 2 (built rows)", async () => {
  const mk = (id, email, cat, subject) => ({ thread_id: id, sender_email: email, sender_name: email, category: cat, channel: "email", received_at: `2026-10-2${id}T09:00:00Z`, owner_id: "7", outcome: "hold", subject });
  const custom = {
    world_threads: [mk("1", "a@example.com", "complaint", "My Strand Emitter Hilt is cracked"), mk("2", "b@example.com", "complaint", "Strand Emitter Hilt arrived late"),
      mk("3", "c@example.com", "refund", "Money back for my Strand Emitter Hilt"), mk("4", "a@example.com", "complaint", "Tell everyone: bad service")],
    products,
    reviews: [],
  };
  const w = await getWorld({ rows: custom });
  const c = complaintContext(w, { sender_email: "a@example.com", skus: ["FS-B02"], thread_id: "4" });
  assert.equal(c.summary.product_complaints["FS-B02"], 2);
  assert.equal(c.summary.earlier_threads, 1);
  assert.equal(c.summary.complaints, 1);
  const other = complaintContext(w, { sender_email: "zed@example.com", skus: ["FS-B02"], thread_id: "1" });
  assert.equal(other.summary.product_complaints["FS-B02"], 1, "the current thread is excluded");
  assert.equal(w.view("facts").about("product:jedi:FS-B02").find((f) => f.predicate === "complaint_count").value, 2);
  assert.match(worldLine(w, c), /product FS-B02: 2 complaints/);
  resetWorldCache();
});

test("customer facts equal direct counts; records carry data timestamps", async () => {
  const w = await getWorld({ rows });
  const email = "tilda.moss@example.com";
  const fv = (p) => w.view("facts").about(`customer:email:${email}`).find((f) => f.predicate === p).value;
  assert.equal(fv("thread_count"), 3);
  const reviewed = new Set(rowsToObjects(rows.reviews).map((r) => r.thread_id));
  const pub = threads.filter((t) => t.sender_email === email && (t.channel === "trustpilot" || reviewed.has(t.thread_id))).length;
  assert.equal(fv("public_complaints"), pub);
  for (const e of w.events()) assert.ok(!e.at.startsWith("2026-10-23") || threads.some((t) => t.received_at.startsWith("2026-10-23")), "no wall-clock stamps");
});

test("ingestThreads: changed true then false, byte-identical shape; local file replays", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "world-"));
  try {
    const w = new WorldModel({ namespace: "jedi-pack", storage: "local", directory: dir });
    const r1 = await ingestThreads(w, threads, products);
    const shape1 = w.stateShapeCanonical();
    const r2 = await ingestThreads(w, threads, products);
    const shape2 = w.stateShapeCanonical();
    assert.equal(r1.changed, true);
    assert.equal(r2.changed, false);
    assert.equal(shape1, shape2);
    assert.equal(worldIngestObservations(threads, products).length, threads.length);
    const file = path.join(dir, ".world", "jedi-pack.json");
    assert.ok(fs.existsSync(file));
    const again = new WorldModel({ namespace: "jedi-pack", storage: "local", directory: dir });
    assert.equal(again.audit().length, w.audit().length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("getWorld with local storage persists and a rebuild is idempotent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "world-"));
  try {
    resetWorldCache();
    const w = await getWorld({ rows, storage: "local", persistDir: dir });
    assert.ok(fs.existsSync(path.join(dir, ".world", "jedi-pack.json")));
    const again = new WorldModel({ namespace: "jedi-pack", storage: "local", directory: dir });
    assert.equal(again.audit().length, w.audit().length);
    resetWorldCache();
    const w2 = await getWorld({ rows, storage: "local", persistDir: dir });
    assert.equal(w2.view("graph").query({}).length, w.view("graph").query({}).length);
    assert.equal(w2.view("facts").about("customer:email:tilda.moss@example.com").length, w.view("facts").about("customer:email:tilda.moss@example.com").length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); resetWorldCache(); }
});

test("(15) same row counts, one changed outcome: a different instance", async () => {
  resetWorldCache();
  const a = await getWorld({ rows });
  const changed = threads.map((t, i) => (i === 0 ? { ...t, outcome: `${t.outcome ?? ""}-changed` } : t));
  const b = await getWorld({ rows: { world_threads: changed, products, reviews: rowsToObjects(rows.reviews) } });
  assert.notEqual(a, b);
  const c = await getWorld({ rows: { world_threads: changed, products, reviews: rowsToObjects(rows.reviews) } });
  assert.equal(b, c);
});

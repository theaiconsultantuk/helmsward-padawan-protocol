// Jedi Pack domain layer on the Meterless World Model (Apache-2.0 bundle, built from engines/world-model).
// One WorldModel per process, built from the world_threads / products / reviews rows.
// Every record timestamp comes from the data (never the wall clock), so a rebuild is idempotent.
//
// Id grammar (the engine's `type:system:id`, see engines/world-model/docs/stable-ids.md):
//   customer  customer:email:<email lower-case>
//   product   product:jedi:<sku>            e.g. product:jedi:FS-B01
//   employee  employee:jedi:emp-<owner_id>         e.g. employee:jedi:emp-7
//   thread    thread:jedi:<thread_id>              (an entity, so edges can point at it)
//   channel   channel:jedi:<name>                  (a context)
//   thread ctx thread-ctx:jedi:<thread_id>         (a context, parent = the channel context; carries wrote / owned_by)
//   mention ctx mention:jedi:<thread_id>:<sku> (a context, parent = thread ctx; carries mentions / complained_about)
// One context per edge target because the engine closes an open edge with the same from+type+context and a different target.
// Facts carry the engine's content-addressed ids (fact_<hex>). Names live in attrs, never in a key.
import path from "node:path";
import { createHash } from "node:crypto";
import { WorldModel } from "./index.mjs";

const SYSTEM = "jedi";
const RUN_ID = "world-build";
const EPOCH = "1970-01-01T00:00:00Z";

const customerKey = (email) => ({ system: "email", id: String(email).trim().toLowerCase() });
export const customerId = (email) => `customer:email:${customerKey(email).id}`;
export const productId = (id) => `product:${SYSTEM}:${id}`;
export const employeeId = (id) => `employee:${SYSTEM}:emp-${id}`;
export const threadId = (id) => `thread:${SYSTEM}:${id}`;
export const channelId = (name) => `channel:${SYSTEM}:${name}`;
export const threadCtxId = (id) => `thread-ctx:${SYSTEM}:${id}`;
export const mentionCtxId = (tid, pid) => `mention:${SYSTEM}:${tid}:${pid}`;

const META = new WeakMap(); // world -> { entities, relationships, facts, products, threadCount }
const CACHE = { key: null, promise: null, world: null };

/** Accept arrays of objects, `{headers, rows}`, `{objects}` (queries.run), or a sample-cache entry list. */
export function toObjects(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    if (input.length && input[0] && input[0].result && !Array.isArray(input[0])) return toObjects(input[0].result);
    return input.map((r) => (Array.isArray(r) ? r : { ...r }));
  }
  if (Array.isArray(input.objects)) return input.objects.map((r) => ({ ...r }));
  if (Array.isArray(input.headers) && Array.isArray(input.rows)) {
    return input.rows.map((r) => Object.fromEntries(input.headers.map((h, i) => [h, r[i]])));
  }
  return [];
}

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "not", "set"]);
function toks(text) {
  return String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)).map((t) => t.replace(/s$/, ""));
}

/** Product ids mentioned in a subject: the whole product name, or a name token that belongs to one product only. */
export function mentionedProducts(subject, products) {
  const st = new Set(toks(String(subject ?? "").replace(/jedi\s+pack/gi, " ")));
  if (!st.size) return [];
  const nameToks = products.map((p) => toks(p.name));
  const owners = new Map();
  nameToks.forEach((ts, i) => ts.forEach((t) => owners.set(t, (owners.get(t) ?? new Set()).add(i))));
  const out = [];
  products.forEach((p, i) => {
    const ts = nameToks[i];
    if (!ts.length) return;
    if (ts.every((t) => st.has(t)) || ts.some((t) => st.has(t) && owners.get(t).size === 1)) out.push(String(p.sku));
  });
  return out;
}

const iso = (v, fallback) => (v ? String(v) : fallback);

async function build({ rows, clock, storage, persistDir, namespace }) {
  const threads = toObjects(rows.world_threads);
  const products = toObjects(rows.products);
  const reviews = toObjects(rows.reviews);
  const world = new WorldModel({ namespace, storage, directory: persistDir, clock });
  const firstAt = threads.reduce((m, t) => (t.received_at && t.received_at < m ? t.received_at : m), "9999") ;
  const baseAt = firstAt === "9999" ? EPOCH : firstAt;
  const src = (at) => ({ kind: "pipeline", by: "inbox", at, runId: RUN_ID });
  const reviewed = new Set(reviews.map((r) => String(r.thread_id)));
  const pById = new Map(products.map((p) => [String(p.sku), p]));

  for (const p of products) {
    await world.upsertEntity({ type: "product", externalKey: { system: SYSTEM, id: String(p.sku) }, name: p.name,
      attrs: { name: p.name, currency: p.currency, min_order_qty: Number(p.min_order_qty), lead_days: Number(p.lead_days) }, source: src(baseAt) });
    await world.assertFact({ about: productId(p.sku), predicate: "unit_price", value: Number(p.unit_price), confidence: 1, source: src(baseAt) });
  }
  const channelsSeen = new Set();
  const cust = new Map(); // email -> {at, threads, complaints, publics}
  const prod = new Map(); // sku -> {at, complaints}
  const employees = new Set();
  for (const t of threads) {
    const at = iso(t.received_at, baseAt);
    const email = customerKey(t.sender_email).id;
    const isPublic = t.channel === "trustpilot" || reviewed.has(String(t.thread_id));
    const isComplaint = t.category === "complaint";
    const pids = mentionedProducts(t.subject, products);
    if (!channelsSeen.has(t.channel)) {
      channelsSeen.add(t.channel);
      await world.upsertContext({ type: "channel", externalKey: { system: SYSTEM, id: t.channel }, attrs: { name: t.channel }, source: src(at) });
    }
    await world.upsertContext({ type: "thread-ctx", externalKey: { system: SYSTEM, id: String(t.thread_id) }, attrs: { thread_id: t.thread_id }, parent: channelId(t.channel), source: src(at) });
    await world.upsertEntity({ type: "customer", externalKey: customerKey(email), name: t.sender_name,
      attrs: { email, name: t.sender_name }, source: src(at) });
    await world.upsertEntity({ type: "thread", externalKey: { system: SYSTEM, id: String(t.thread_id) }, name: String(t.thread_id),
      attrs: { thread_id: t.thread_id, category: t.category, channel: t.channel, subject: t.subject, received_at: at, outcome: t.outcome ?? null, public: isPublic }, source: src(at) });
    await world.relate({ from: customerId(email), type: "wrote", to: threadId(t.thread_id), context: threadCtxId(t.thread_id), validFrom: at, source: src(at) });
    for (const pid of pids) {
      // One context per (thread, product): the engine closes an open edge with the same from+type+context and a different target.
      const mctx = mentionCtxId(t.thread_id, pid);
      await world.upsertContext({ type: "mention", externalKey: { system: SYSTEM, id: `${t.thread_id}:${pid}` }, attrs: { thread_id: t.thread_id, sku: pid }, parent: threadCtxId(t.thread_id), source: src(at) });
      await world.relate({ from: threadId(t.thread_id), type: "mentions", to: productId(pid), context: mctx, validFrom: at, source: src(at) });
      if (isComplaint) {
        await world.relate({ from: customerId(email), type: "complained_about", to: productId(pid), context: mctx, validFrom: at, source: src(at) });
        const p = prod.get(pid) ?? { at, complaints: 0 };
        p.complaints += 1; if (at > p.at) p.at = at; prod.set(pid, p);
      }
    }
    if (t.owner_id !== null && t.owner_id !== undefined && t.owner_id !== "") {
      if (!employees.has(String(t.owner_id))) {
        employees.add(String(t.owner_id));
        await world.upsertEntity({ type: "employee", externalKey: { system: SYSTEM, id: `emp-${t.owner_id}` }, name: `employee ${t.owner_id}`, attrs: { employee_id: String(t.owner_id) }, source: src(at) });
      }
      await world.relate({ from: threadId(t.thread_id), type: "owned_by", to: employeeId(t.owner_id), context: threadCtxId(t.thread_id), validFrom: at, source: src(at) });
    }
    const c = cust.get(email) ?? { at, threads: 0, complaints: 0, publics: 0 };
    c.threads += 1; if (isComplaint) c.complaints += 1; if (isPublic) c.publics += 1; if (at > c.at) c.at = at;
    cust.set(email, c);
  }
  for (const [email, c] of cust) {
    const s = src(c.at);
    await world.assertFact({ about: customerId(email), predicate: "thread_count", value: c.threads, confidence: 1, source: s });
    await world.assertFact({ about: customerId(email), predicate: "complaint_count", value: c.complaints, confidence: 1, source: s });
    await world.assertFact({ about: customerId(email), predicate: "public_complaints", value: c.publics, confidence: 1, source: s });
  }
  for (const p of products) {
    const n = prod.get(String(p.sku));
    await world.assertFact({ about: productId(p.sku), predicate: "complaint_count", value: n ? n.complaints : 0, confidence: 1, source: src(n ? n.at : baseAt) });
  }
  const graph = world.view("graph");
  META.set(world, {
    entities: graph.query({}).length,
    relationships: world.events().filter((e) => e.kind === "relate").length,
    products: pById, threads: threads.length,
  });
  return world;
}

// a content fingerprint of what the build reads: changed rows with the same counts must rebuild
function fingerprint(rows) {
  const h = createHash("sha256");
  const f = (...v) => h.update(v.map((x) => String(x ?? "")).join("|") + "\n");
  for (const t of toObjects(rows.world_threads)) f("t", t.thread_id, t.sender_email, t.category, t.outcome, t.owner_id);
  for (const p of toObjects(rows.products)) f("p", p.sku);
  for (const r of toObjects(rows.reviews)) f("r", r.review_id);
  return h.digest("hex");
}

/** One WorldModel per process, cached by a content fingerprint of the rows; rebuilt when they change. */
export async function getWorld({ rows, clock, storage = "memory", persistDir, namespace = "jedi-pack" } = {}) {
  if (!rows) throw new Error("getWorld: rows { world_threads, products, reviews } required");
  if (storage === "local" && !persistDir) storage = "memory";
  const key = [fingerprint(rows), storage, persistDir ?? "", namespace].join("|");
  if (CACHE.key === key && CACHE.promise) return CACHE.promise;
  CACHE.key = key;
  CACHE.promise = build({ rows, clock, storage, persistDir: persistDir ? path.resolve(persistDir) : undefined, namespace })
    .catch((e) => { if (CACHE.key === key) { CACHE.key = null; CACHE.promise = null; } throw e; });
  return CACHE.promise;
}

/** Test hook: forget the cached world. */
export function resetWorldCache() { CACHE.key = null; CACHE.promise = null; }

export function worldStats(world) {
  const m = META.get(world);
  return m ? { entities: m.entities, relationships: m.relationships } : { entities: world.view("graph").query({}).length, relationships: world.events().filter((e) => e.kind === "relate").length };
}

function factValue(world, id, predicate) {
  const live = world.view("facts").about(id).filter((f) => f.predicate === predicate && !f.supersededBy);
  return live.length ? live[live.length - 1] : undefined;
}

/** Read the record of a sender (and the products in play); earlier threads exclude `thread_id`. */
export function complaintContext(world, { sender_email, skus = [], thread_id, channel } = {}) {
  const graph = world.view("graph");
  const cid = sender_email ? customerId(sender_email) : null;
  const customer = cid ? graph.entity(cid) : undefined;
  const prodIds = [...new Set((skus ?? []).map(String))].filter((p) => graph.entity(productId(p)));
  const provenance = [];
  const summary = { earlier_threads: 0, complaints: 0, public_before: false, product_complaints: {} };
  const skip = thread_id ? threadId(thread_id) : null;
  let text;
  if (customer) {
    const earlier = graph.neighborsOf(cid, { via: "wrote" }).filter((t) => t.type === "thread" && t.id !== skip)
      .sort((a, b) => String(a.attrs.received_at).localeCompare(String(b.attrs.received_at)));
    summary.earlier_threads = earlier.length;
    summary.complaints = earlier.filter((t) => t.attrs.category === "complaint").length;
    summary.public_before = earlier.some((t) => t.attrs.public === true);
    provenance.push({ kind: "entity", id: cid });
    for (const t of earlier) provenance.push({ kind: "thread", id: t.id });
    const cited = (id, pred, expect) => { const f = factValue(world, id, pred); if (f && f.value === expect) provenance.push({ kind: "fact", id: f.id }); };
    if (!skip || !graph.neighborsOf(cid, { via: "wrote" }).some((t) => t.id === skip)) {
      cited(cid, "thread_count", summary.earlier_threads);
      cited(cid, "complaint_count", summary.complaints);
    }
  }
  for (const p of prodIds) {
    const complainers = graph.incoming(productId(p), { via: "mentions" }).filter((t) => t.attrs.category === "complaint" && t.id !== skip);
    summary.product_complaints[p] = complainers.length;
    provenance.push({ kind: "entity", id: productId(p) });
    const f = factValue(world, productId(p), "complaint_count");
    if (f && f.value === complainers.length) provenance.push({ kind: "fact", id: f.id });
  }
  if (!customer) {
    text = "no earlier threads for this sender";
  } else {
    text = `${summary.earlier_threads} earlier thread${summary.earlier_threads === 1 ? "" : "s"} from this sender, ${summary.complaints} of them complaints, ${summary.public_before ? "at least one" : "none"} public`;
  }
  if (prodIds.length) {
    text += `; ` + prodIds.map((p) => `${graph.entity(productId(p)).name} has ${summary.product_complaints[p]} complaint${summary.product_complaints[p] === 1 ? "" : "s"}`).join(", ");
  }
  const seen = new Set();
  const prov = provenance.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  return { text, provenance: prov, summary, customer_id: customer ? cid : null, skus: prodIds };
}

/** The `output_summary` of the trace line; the `ids:` tail is what the journey parses. */
export function worldLine(world, ctx) {
  const { entities, relationships } = worldStats(world);
  const s = ctx.summary;
  const pids = ctx.skus ?? Object.keys(s.product_complaints);
  const prod = pids.length ? pids.map((p) => `${p}: ${s.product_complaints[p] ?? 0} complaints`).join(", ") : "none: 0 complaints";
  const ids = ctx.provenance.length ? ctx.provenance.map((p) => p.id).join(",") : "none";
  return `${entities} entities, ${relationships} relationships; customer ${ctx.customer_id ?? "none"}: ${s.earlier_threads} earlier threads, ${s.complaints} complaints, public ${s.public_before ? "yes" : "no"}; product ${prod}; ids: ${ids}`;
}

/** Thread rows -> the engine's IngestObservation (externalId = thread_id; customer + mentioned products as entities). */
export function worldIngestObservations(rows, productRows = []) {
  const products = toObjects(productRows);
  return toObjects(rows).map((t) => ({
    externalId: String(t.thread_id),
    type: "thread",
    title: String(t.subject ?? t.thread_id),
    text: `${t.category ?? ""} via ${t.channel ?? ""} from ${t.sender_email ?? ""}`.trim(),
    at: iso(t.received_at, EPOCH),
    source: { kind: "pipeline", by: "inbox", at: iso(t.received_at, EPOCH), runId: "world-ingest" },
    entities: [
      ...(t.sender_email ? [{ type: "customer", name: t.sender_email }] : []),
      ...mentionedProducts(t.subject, products).map((pid) => ({ type: "product", name: products.find((p) => String(p.sku) === pid).name })),
    ],
  }));
}

/** Run the engine's own ingest() over thread rows; returns its IngestReport. */
export function ingestThreads(world, rows, productRows = []) {
  return world.ingest(worldIngestObservations(rows, productRows));
}

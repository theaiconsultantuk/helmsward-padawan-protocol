// H-MEM memory engine for the Jedi Pack inbox.
// Follows the Meterless H-MEM reference (types.ts, memoryStore, memoryRetrieval).
// Deviations: no embedder (sem is lexical Jaccard overlap, local-first), and
// query() persists accessCount/lastAccessed (the reference does not).
import fs from "node:fs";
import path from "node:path";

const STOP = new Set(("a an and are as at be but by for from has have i if in into is it its of on or so that the their " +
  "them then there these they this to was we were what when which who will with you your not no do does did can could " +
  "should would our us me my he she his her than too very").split(" "));
const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_LIFE_MS = 7 * DAY_MS;
const LAYER_W = { long_term: 1, working: 0.6, short_term: 0.3 };
const DELTAS = { helpful: 0.05, not_helpful: -0.03, wrong: -0.2 };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const round = (x) => Math.round(x * 1e6) / 1e6;

export function tokenize(text) {
  const out = String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return out.filter((t) => !STOP.has(t));
}

// case-insensitive, so an email entity matches however it was written
function overlap(requested, have) {
  if (!requested.length) return 0;
  const h = new Set(have.map((x) => String(x).toLowerCase()));
  return requested.filter((r) => h.has(String(r).toLowerCase())).length / requested.length;
}

function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, file);
}

export class HMEM {
  #dir; #clock; #ns; #domain; #seq = 0; #records = new Map();

  constructor({ persistDir, clock = () => Date.now(), namespace = "jedi-pack", domain = "support-inbox" } = {}) {
    if (!persistDir) throw new Error("H-MEM: persistDir is required");
    this.#dir = persistDir;
    this.#clock = clock;
    this.#ns = namespace;
    this.#domain = domain;
    fs.mkdirSync(persistDir, { recursive: true });
    const sf = path.join(persistDir, "state.json");
    if (fs.existsSync(sf)) {
      const saved = JSON.parse(fs.readFileSync(sf, "utf-8"));
      this.#seq = saved.seq;
      for (const r of saved.records) this.#records.set(r.id, r);
    }
  }

  #persist() {
    const records = [...this.#records.values()].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
    atomicWrite(path.join(this.#dir, "state.json"), JSON.stringify({ seq: this.#seq, records }, null, 2) + "\n");
  }

  #log(entry) {
    fs.appendFileSync(path.join(this.#dir, "ledger.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
  }

  add({ content, source, type = "general", layer = "working", tags = [], confidence = 0.7, entities = [],
    relatedTo = [], chatId, missionId, goalRunId, provenance } = {}) {
    if (typeof source !== "string" || source.trim() === "") {
      throw new Error("H-MEM: a memory record with no source is rejected by construction");
    }
    const now = this.#clock();
    const id = `mem-${++this.#seq}`;
    const rec = {
      id, content, type, layer, timestamp: now, lastAccessed: now, accessCount: 0,
      tags: [...tags], embedding: [], confidence: clamp01(confidence), source,
      provenance: provenance ?? { origin: source, learnedAt: now, label: type },
      domain: this.#domain, namespace: this.#ns,
      entities: [...entities].slice(0, 10), relatedTo: [...relatedTo].slice(0, 5),
    };
    if (chatId !== undefined) rec.chatId = chatId;
    if (missionId !== undefined) rec.missionId = missionId;
    if (goalRunId !== undefined) rec.goalRunId = goalRunId;
    this.#records.set(id, rec);
    this.#log({ op: "create", id, at: now, source });
    this.#persist();
    return structuredClone(rec);
  }

  query(text, { topN = 5, threshold = 0.35, tags = [], entities = [] } = {}) {
    const now = this.#clock();
    const qTokens = [...new Set(tokenize(text))];
    const qSet = new Set(qTokens);
    const scores = {};
    const scored = [];
    for (const rec of this.#records.values()) {
      const rTokens = new Set(tokenize(rec.content));
      let inter = 0;
      for (const t of qSet) if (rTokens.has(t)) inter++;
      const union = qSet.size + rTokens.size - inter;
      const sem = union ? inter / union : 0;
      const kw = qSet.size ? inter / qSet.size : 0;
      const tag = overlap(tags, rec.tags);
      const domain = rec.domain === this.#domain ? 1 : 0;
      const entity = overlap(entities, rec.entities);
      const layer = LAYER_W[rec.layer] ?? 0;
      const recency = Math.exp(-Math.LN2 * Math.max(0, now - rec.timestamp) / HALF_LIFE_MS);
      const superseded = rec.supersededBy ? 1 : 0;
      const total = (0.35 * sem + 0.2 * kw + 0.1 * tag + 0.1 * domain + 0.15 * entity + 0.05 * layer +
        0.05 * recency - 0.2 * superseded) * rec.confidence;
      scores[rec.id] = { sem: round(sem), kw: round(kw), tag: round(tag), domain, entity: round(entity),
        layer, recency: round(recency), superseded, confidence: rec.confidence, total: round(total) };
      scored.push({ rec, total });
    }
    const kept = scored.filter((s) => s.total >= threshold)
      .sort((a, b) => b.total - a.total || Number(a.rec.id.slice(4)) - Number(b.rec.id.slice(4)))
      .slice(0, topN);
    const keptIds = new Set(kept.map((k) => k.rec.id));
    for (const id of Object.keys(scores)) if (!keptIds.has(id)) delete scores[id];
    // keep scores for every candidate scored? trace keeps the kept ones plus the rest for audit
    const strategy = kept.length <= 1 ? "minimal"
      : kept.some((k) => k.rec.type === "personal" || k.rec.type === "preference") ? "personal" : "comprehensive";
    const retrievalReason = this.#records.size === 0
      ? "cold start: empty memory"
      : `${kept.length} of ${this.#records.size} memories kept (threshold ${threshold}, strategy ${strategy})`;
    for (const k of kept) { k.rec.accessCount += 1; k.rec.lastAccessed = now; }
    const ids = kept.map((k) => k.rec.id);
    this.#log({ op: "query", ids, at: now, text: String(text ?? "") });
    if (kept.length) this.#persist();
    return {
      memories: kept.map((k) => ({ memory: structuredClone(k.rec), relevance: round(k.total) })),
      context: kept.map((k) => k.rec.content).join("\n"),
      trace: { retrievalReason, strategy, scores },
    };
  }

  feedback(id, verdict) {
    const rec = this.#records.get(id);
    if (!rec) throw new Error(`H-MEM: unknown memory id ${id}`);
    if (!(verdict in DELTAS)) throw new Error(`H-MEM: unknown verdict ${verdict}`);
    const before = rec.confidence;
    rec.confidence = round(clamp01(rec.confidence + DELTAS[verdict]));
    if (verdict === "wrong" && !rec.tags.includes("review")) rec.tags.push("review");
    this.#log({ op: "feedback", id, at: this.#clock(), verdict, before, after: rec.confidence });
    this.#persist();
    return structuredClone(rec);
  }

  queueForHuman(ticket, critiques = [], extra = null) {
    const qdir = path.join(this.#dir, "queue");
    fs.mkdirSync(qdir, { recursive: true });
    const now = this.#clock();
    const tid = String(ticket.thread_id ?? ticket.id).replace(/[^A-Za-z0-9._-]/g, "_");
    atomicWrite(path.join(qdir, `${tid}.json`), JSON.stringify({ ticket, critiques, queuedAt: now, ...(extra?.owner ? { owner: extra.owner } : {}), ...(extra?.scenario ? { scenario: extra.scenario } : {}), ...(extra?.recommendation != null ? { recommendation: extra.recommendation } : {}), ...(extra?.attachments != null ? { attachments: extra.attachments } : {}), ...(extra?.escalation != null ? { escalation: extra.escalation } : {}), ...(extra?.cc != null ? { cc: extra.cc } : {}), ...(extra?.also != null ? { also: extra.also } : {}), ...(extra?.status != null ? { status: extra.status } : {}) }, null, 2) + "\n");
    const reason = (Array.isArray(critiques) ? critiques : [critiques])
      .map((c) => (typeof c === "string" ? c : c?.reason)).filter(Boolean).join("; ");
    const rec = this.add({
      content: `ticket ${ticket.id ?? ticket.thread_id} escalated: ${reason}`,
      source: "loop", type: "factual", tags: ["queue:human"],
    });
    return rec.id;
  }

  get ledger() {
    const file = path.join(this.#dir, "ledger.jsonl");
    return {
      history: (id) => {
        if (!fs.existsSync(file)) return [];
        return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
          .filter((e) => e.id === id || (Array.isArray(e.ids) && e.ids.includes(id)));
      },
    };
  }

  all() {
    return structuredClone([...this.#records.values()]);
  }
}

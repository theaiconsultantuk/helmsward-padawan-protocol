// Live progress is a projection of trace metadata, never a store of raw trace bodies.
// Build C, CodexBWAI.
import { labelFor, techOf } from "./journey.mjs";
export const isNemotron = (s) => /nemotron/i.test(String(s ?? ""));
export const WORK = {
  draft: { agent: "Drafter", label: "Drafter writing" },
  complaint_read: { agent: "Drafter", label: "Reading the complaint" },
  recommendation: { agent: "Drafter", label: "Writing the recommendation" },
  critique: { agent: "Evaluator", label: "Evaluator checking the draft" },
  refund_read: { agent: "RefundReader", label: "Refund read" },
  gates: { agent: "Gates", label: "Typed gates", engine: "OpenJev" },
  severity: { agent: "Severity", label: "Severity gate", engine: "OpenJev" },
  facts: { agent: "Executor", label: "Facts from Zetaris", engine: "Zetaris" },
  duplicate: { agent: "Executor", label: "Duplicate check", engine: "Zetaris" },
  ledger: { agent: "Executor", label: "Trust ledger", engine: "Zetaris" },
  intake: { agent: "Executor", label: "Saving the message to Zetaris", engine: "Zetaris" },
};
export const nightshiftEngine = (cfg) => !cfg.NIGHTSHIFT_ROUTE_PRIMARY || isNemotron(cfg.NIGHTSHIFT_ROUTE_PRIMARY) ? "Nemotron" : `Nightshift (${cfg.NIGHTSHIFT_ROUTE_PRIMARY})`;
export function stepOf(line) {
  return { step: line.step, agent: line.agent_name, label: labelFor(line.step, line), tech: techOf(line), status: line.status, seconds: Math.round((Number(line.duration_ms) || 0) / 10) / 100, ran_s: Number.isFinite(line.ran_s) ? line.ran_s : tenth(Number(line.elapsed_ms) || 0), seen_s: Number.isFinite(line.seen_s) ? line.seen_s : tenth(Number(line.elapsed_ms) || 0) };
}
export function providerSummary(calls, mode) {
  const bad = calls.filter((c) => c.primary === false);
  return { mode, primary_used: mode === "sample" || !calls.length ? null : !bad.length, fallback_reason: mode === "sample" ? null : bad.find((c) => c.reason != null)?.reason ?? null, calls: calls.length };
}
const tenth = (ms) => Math.round(ms / 100) / 10;
const publicProvider = (p) => ({ primary_used: p?.primary_used ?? null, fallback_reason: p?.fallback_reason ?? null });
export function progressPayload(entry, nowMs) {
  return {
    run_id: entry.run_id, state: entry.state, mode: entry.mode,
    elapsed_s: entry.state === "done" ? entry.elapsed_s : tenth(nowMs - entry.t0),
    working: entry.working.map((w) => ({ agent: w.agent, label: w.label, engine: w.engine, since_s: tenth(nowMs - w.at) })),
    steps: entry.lines.map((l) => ({ ...l })), decision_early: entry.early ? { ...entry.early } : null,
    decision: entry.decision, status: entry.status,
    provider: publicProvider(entry.finishedProvider ?? providerSummary([...entry.provider.values()], entry.mode)),
  };
}
export function progressFromStored(result, lines) {
  return { run_id: result.run_id, state: "done", mode: result.provider?.mode ?? null, elapsed_s: result.execution_time_seconds,
    working: [], steps: lines.map(stepOf), decision_early: result.decision_early ?? null, decision: result.output?.decision ?? null,
    status: result.status ?? null, provider: publicProvider(result.provider) };
}
export function createProgressBoard({ cap = 50, now = Date.now } = {}) {
  const entries = new Map(); let serial = 0;
  const running = (id) => { const e = entries.get(id); return e?.state === "running" ? e : null; };
  return {
    start(run_id, { mode, cfg, fallbackRoute = cfg?.NIGHTSHIFT_ROUTE_FALLBACK ?? null, primaryEngine = cfg ? nightshiftEngine(cfg) : "Nemotron" }) {
      if (running(run_id)) return running(run_id);
      const e = { run_id, mode, fallbackRoute, primaryEngine, t0: now(), state: "running", lines: [], working: [], early: null, provider: new Map(), decision: null, status: null };
      entries.set(run_id, e); return e;
    },
    line(id, line) {
      const e = running(id); if (!e) return;
      line.seen_s = tenth(now() - e.t0);
      e.lines.push(stepOf(line));
      if (line.step === "retry" && ["fallback_route", "fallback_local_lane"].includes(line.action)) {
        for (const w of e.working.filter((w) => w.purpose === line.input_summary)) {
          w.engine = line.action === "fallback_local_lane" ? "local lane" : `Nightshift (${e.fallbackRoute})`;
          e.provider.set(w.key, { purpose: w.purpose, primary: false, reason: null });
        }
      }
    },
    work(id, { purpose, engine }) {
      const e = running(id); const info = WORK[purpose]; if (!e || !info) return () => {};
      const key = ++serial;
      e.working.push({ key, purpose, agent: info.agent, label: info.label, engine: engine ?? info.engine ?? e.primaryEngine, at: now() });
      let ended = false;
      return ({ primary, reason = null } = {}) => {
        if (ended || running(id) !== e) return; ended = true;
        e.working = e.working.filter((w) => w.key !== key);
        if (typeof primary === "boolean") e.provider.set(key, { purpose, primary, reason });
      };
    },
    decided(id, early) { const e = running(id); if (e && !e.early) { early.seen_s = tenth(now() - e.t0); e.early = { ...early }; } },
    finish(id, result) {
      const e = running(id); if (!e) return;
      e.state = "done"; e.decision = result?.output?.decision ?? null; e.status = result?.status ?? null;
      e.working = []; e.elapsed_s = result?.execution_time_seconds ?? tenth(now() - e.t0);
      if (result?.provider) e.finishedProvider = { ...result.provider };
      // Completion order, independent of how long each run took. Running entries never count against cap.
      entries.delete(id); entries.set(id, e);
      const done = [...entries].filter(([, v]) => v.state === "done");
      for (const [key] of done.slice(0, Math.max(0, done.length - cap))) entries.delete(key);
    },
    get(id) { const e = entries.get(id); return e ? progressPayload(e, now()) : null; },
  };
}

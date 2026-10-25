// Cached GET /models plus passive run outcomes; never calls a model. Build C, CodexBWAI.
import * as nightshift from "./adapters/nightshift.mjs";
import { isNemotron } from "./progress.mjs";
export function createProviderHealth({ cfg, sample, statusFn = () => nightshift.status({ cfg }), ttlMs = 60000, firstWaitMs = 2000, now = Date.now }) {
  const state = { mode: sample ? "sample" : "live", reachable: null, probe: null, nemotron_listed: null, checked_at: null,
    last_primary_answer_at: null, last_fallback_at: null, last_fallback_reason: null };
  let flight = null, checkedMs = null, first = true;
  const probe = () => {
    if (!flight) flight = Promise.resolve().then(statusFn).catch(() => ({ state: "offline", models: [] })).then((r) => {
      state.probe = ["online", "offline", "unauthorized"].includes(r?.state) ? r.state : "offline";
      state.reachable = state.probe === "online"; state.nemotron_listed = (r?.models ?? []).some(isNemotron);
      checkedMs = now(); state.checked_at = new Date(checkedMs).toISOString();
    }).finally(() => { flight = null; });
    return flight;
  };
  const value = () => ({ ...state, fallback_in_use: state.reachable === false || (state.last_fallback_at !== null && (state.last_primary_answer_at === null || state.last_fallback_at > state.last_primary_answer_at)) });
  return {
    async snapshot() {
      if (sample) return value();
      if (first) {
        first = false; let timer;
        try { await Promise.race([probe(), new Promise((r) => { timer = setTimeout(r, firstWaitMs); timer.unref?.(); })]); }
        finally { clearTimeout(timer); }
      } else if (checkedMs === null || now() - checkedMs > ttlMs) { void probe(); }
      return value();
    },
    note(p) {
      if (sample || p?.mode === "sample") return;
      if (p?.primary_used === true) state.last_primary_answer_at = new Date(now()).toISOString();
      if (p?.primary_used === false) { state.last_fallback_at = new Date(now()).toISOString(); state.last_fallback_reason = p.fallback_reason ?? null; }
    },
  };
}

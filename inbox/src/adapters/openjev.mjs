// OpenJev "systemone" adapter: one POST per read. No dependencies.
import { config } from "../config.mjs";
import { unauthorized, badResponse, fromFetchError } from "./errors.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function systemone(state, questions, {
  timeoutMs = 30000, cfg = config(), fetchImpl = globalThis.fetch,
  model = "openjev-latest", retryDelayMs,
} = {}) {
  const base = String(cfg.OPENJEV_BASE_URL ?? "").replace(/\/+$/, "");
  const url = `${base}/v1/systemone`;
  const payload = JSON.stringify({ model, state, questions });
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.OPENJEV_API_KEY ?? ""}`, "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw fromFetchError(e, "openjev");
    }
    if (res.status === 401 || res.status === 403) {
      throw unauthorized(`openjev: ${res.status} ${res.status === 403 ? "missing" : "wrong"} API key`, { status: res.status, service: "openjev" });
    }
    if ((res.status === 503 || res.status === 529) && attempt === 0) {
      const ra = Number.parseFloat(res.headers.get("retry-after"));
      const secs = Math.min(Number.isFinite(ra) && ra >= 0 ? ra : 1, 5);
      await sleep(retryDelayMs ?? secs * 1000);
      continue;
    }
    const headers = Object.fromEntries(res.headers.entries());
    const text = await res.text();
    if (!res.ok) {
      throw badResponse(`openjev: HTTP ${res.status}`, { status: res.status, service: "openjev", recoverable: res.status >= 500 });
    }
    let body;
    try { body = JSON.parse(text); } catch (e) {
      throw badResponse("openjev: response is not JSON", { status: res.status, cause: e, service: "openjev" });
    }
    return {
      answers: body?.answers ?? body,
      model: body?.model ?? headers["x-model"] ?? "openjev-latest",
      latencyMs: Date.now() - started,
      raw: { status: res.status, headers, body },
    };
  }
}

// Real schema (openjev/api.py): a noul question carries criteria as an object {true, false}, never a string.
export const PING_QUESTIONS = {
  is_ping: { type: "noul", instructions: "Is this a ping?", criteria: { true: "the state says ping", false: "anything else" } },
};

export async function status({ cfg = config(), fetchImpl = globalThis.fetch } = {}) {
  const t = Date.now();
  try {
    const r = await systemone("ping", PING_QUESTIONS, { cfg, fetchImpl, timeoutMs: 30000 });
    return { ok: true, model: r.model, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, model: null, ms: Date.now() - t, error: e.message };
  }
}

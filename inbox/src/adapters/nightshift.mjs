// Nightshift (Meterless) adapter: status, models, chat, and draft with primary -> fallback routes.
import { config, sampleMode } from "../config.mjs";
import { badResponse, fromFetchError, isAdapterError, unauthorized } from "./errors.mjs";

const APP = "jedi-pack-inbox";

function authHeaders(cfg, extra = {}) {
  return { Authorization: `Bearer ${cfg.METERLESS_RUNTIME_TOKEN}`, "meterless-app": APP, ...extra };
}

// One place to change how the concrete model is read (decided in task 0.6).
export function handledModel(raw) {
  if (raw?.body && typeof raw.body.model === "string" && raw.body.model) return raw.body.model;
  for (const h of ["x-meterless-model", "x-model", "x-upstream-model"]) {
    if (raw?.headers?.[h]) return raw.headers[h];
  }
  return null;
}

async function get(path, cfg, fetchImpl, timeoutMs = 15000) {
  try {
    return await fetchImpl(`${cfg.METERLESS_BASE_URL}${path}`, {
      method: "GET", signal: AbortSignal.timeout(timeoutMs), headers: authHeaders(cfg),
    });
  } catch (e) {
    throw fromFetchError(e, "nightshift");
  }
}

export async function models({ cfg = config(), fetchImpl = globalThis.fetch } = {}) {
  const res = await get("/models", cfg, fetchImpl);
  if (res.status === 401 || res.status === 403) throw unauthorized(`nightshift: HTTP ${res.status}`, { status: res.status, service: "nightshift" });
  if (!res.ok) throw badResponse(`nightshift: HTTP ${res.status}`, { status: res.status, service: "nightshift", recoverable: res.status >= 500 });
  try {
    return await res.json();
  } catch (e) {
    throw badResponse("nightshift: /models was not JSON", { cause: e, service: "nightshift" });
  }
}

export async function status({ cfg = config(), fetchImpl = globalThis.fetch } = {}) {
  const t0 = Date.now();
  try {
    const body = await models({ cfg, fetchImpl });
    const ids = (body?.data ?? []).map((m) => m?.id).filter(Boolean);
    const online = ids.some((id) => String(id).startsWith("meterless/"));
    return { state: online ? "online" : "offline", models: ids, ms: Date.now() - t0 };
  } catch (e) {
    const state = e.name === "Unauthorized" ? "unauthorized" : "offline";
    return { state, models: [], ms: Date.now() - t0, error: `${e.name}: ${e.message}` };
  }
}

const UNKNOWN_MODEL = /model_not_found|unknown model|no such model/i;

export async function chat(messages, { route, timeoutMs, purpose = "draft", cfg = config(), fetchImpl = globalThis.fetch } = {}) {
  const ms = timeoutMs ?? Number(cfg.NIGHTSHIFT_TIMEOUT_MS);
  const t0 = Date.now();
  let res;
  try {
    res = await fetchImpl(`${cfg.METERLESS_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(ms),
      headers: authHeaders(cfg, { "meterless-scope": "user", "Content-Type": "application/json" }),
      body: JSON.stringify({ model: route, messages, temperature: 0.2 }),
    });
  } catch (e) {
    throw fromFetchError(e, "nightshift");
  }
  const status = res.status;
  const text = await res.text().catch(() => "");
  if (status === 401 || status === 403) throw unauthorized(`nightshift: HTTP ${status}`, { status, service: "nightshift" });
  if (status >= 500) throw badResponse(`nightshift: HTTP ${status} on ${route}`, { status, service: "nightshift", recoverable: true });
  if (status >= 400) {
    const unknown = (status === 404 || status === 400) && UNKNOWN_MODEL.test(text);
    throw badResponse(`nightshift: HTTP ${status} on ${route}${unknown ? " (unknown model)" : ""}`, { status, service: "nightshift", recoverable: unknown });
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw badResponse("nightshift: response was not JSON", { status, cause: e, service: "nightshift" });
  }
  const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  const raw = { status, headers, body };
  const out = body?.choices?.[0]?.message?.content;
  if (typeof out !== "string") throw badResponse("nightshift: response has no message content", { status, service: "nightshift" });
  return { text: out.trim(), model: handledModel(raw), route, latencyMs: Date.now() - t0, raw };
}

export async function draft(messages, { cfg = config(), trace = null, purpose = "draft", fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  if (sampleMode(cfg)) return { text: null, model: "sample/rules", route: "sample", latencyMs: 0, sample: true };
  const primary = cfg.NIGHTSHIFT_ROUTE_PRIMARY;
  const fallback = cfg.NIGHTSHIFT_ROUTE_FALLBACK;
  try {
    return await chat(messages, { route: primary, timeoutMs, purpose, cfg, fetchImpl });
  } catch (e) {
    if (!isAdapterError(e) || e.name === "Unauthorized" || !e.recoverable) throw e;
    trace?.line({
      step: "retry", agent_name: "Provider", action: "fallback_route", input_summary: purpose,
      output_summary: `${primary} failed (${e.name}); trying ${fallback}`,
      status: "retrying", retry_count: 1, sponsor: "nightshift",
    });
    return chat(messages, { route: fallback, timeoutMs, purpose, cfg, fetchImpl });
  }
}

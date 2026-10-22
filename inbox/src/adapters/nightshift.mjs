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

// Direct local lane (task 0.9): einh's Bionic server reached through LM Link. NOT through Nightshift.
// Fires only when Nightshift itself is unreachable. Models are tried in order; the last error is thrown.
// Probed live 23 Oct: reasoning:{effort:"none"} and chat_template_kwargs.enable_thinking=false are accepted
// (HTTP 200) but change nothing (the model still thinks), so neither is sent.
const LOCAL_LANE_TIMEOUT_MS = 180000;
const laneSetting = (cfg, key) => String(process.env[key] ?? cfg?.[key] ?? "").trim();
const laneBase = (cfg) => laneSetting(cfg, "LOCAL_LANE_BASE_URL").replace(/\/+$/, "");
const laneModels = (cfg) => laneSetting(cfg, "LOCAL_LANE_MODELS").split(",").map((m) => m.trim()).filter(Boolean);

export async function localLane(messages, { cfg = config(), trace = null, timeoutMs, maxTokens = 1024, fetchImpl = globalThis.fetch } = {}) {
  const base = laneBase(cfg);
  const ids = laneModels(cfg);
  if (!base || !ids.length) throw badResponse("local lane: LOCAL_LANE_BASE_URL or LOCAL_LANE_MODELS is empty", { service: "local-lane" });
  const ms = timeoutMs ?? (Number(laneSetting(cfg, "LOCAL_LANE_TIMEOUT_MS")) || LOCAL_LANE_TIMEOUT_MS);
  let last;
  for (const id of ids) {
    const t0 = Date.now();
    try {
      let res;
      try {
        res = await fetchImpl(`${base}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(ms),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: id, messages, temperature: 0.2, max_tokens: maxTokens }),
        });
      } catch (e) {
        throw fromFetchError(e, "local-lane");
      }
      const text = await res.text().catch(() => "");
      if (res.status >= 400) throw badResponse(`local-lane: HTTP ${res.status} on ${id}`, { status: res.status, service: "local-lane", recoverable: true });
      let body;
      try {
        body = JSON.parse(text);
      } catch (e) {
        throw badResponse("local-lane: response was not JSON", { status: res.status, cause: e, service: "local-lane" });
      }
      const out = body?.choices?.[0]?.message?.content;
      if (typeof out !== "string") throw badResponse("local-lane: response has no message content", { status: res.status, service: "local-lane" });
      const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
      return { text: out.trim(), model: (typeof body.model === "string" && body.model) || id, route: `local-lane:${id}`, latencyMs: Date.now() - t0, raw: { status: res.status, headers, body }, lane: "local-lane" };
    } catch (e) {
      last = e;
      trace?.line?.({ step: "retry", agent_name: "Provider", action: "local_lane_next_model", input_summary: id, output_summary: `local lane ${id} failed (${e.name ?? "Error"}); trying next model`, status: "retrying", sponsor: null });
    }
  }
  throw last;
}

const NIGHTSHIFT_DOWN = new Set(["UpstreamRefused", "UpstreamTimeout"]);
const nightshiftUnreachable = (e) => isAdapterError(e) && e.service === "nightshift" && NIGHTSHIFT_DOWN.has(e.name);

export async function draft(messages, { cfg = config(), trace = null, purpose = "draft", fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  if (sampleMode(cfg)) return { text: null, model: "sample/rules", route: "sample", latencyMs: 0, sample: true };
  const primary = cfg.NIGHTSHIFT_ROUTE_PRIMARY;
  const fallback = cfg.NIGHTSHIFT_ROUTE_FALLBACK;
  let second;
  try {
    return await chat(messages, { route: primary, timeoutMs, purpose, cfg, fetchImpl });
  } catch (e) {
    if (!isAdapterError(e) || e.name === "Unauthorized" || !e.recoverable) throw e;
    trace?.line({
      step: "retry", agent_name: "Provider", action: "fallback_route", input_summary: purpose,
      output_summary: `${primary} failed (${e.name}); trying ${fallback}`,
      status: "retrying", retry_count: 1, sponsor: "meterless",
    });
    try {
      return await chat(messages, { route: fallback, timeoutMs, purpose, cfg, fetchImpl });
    } catch (e2) {
      second = e2;
    }
  }
  const ids = laneModels(cfg);
  if (!laneBase(cfg) || !ids.length || !nightshiftUnreachable(second)) throw second;
  trace?.line({
    step: "retry", agent_name: "Provider", action: "fallback_local_lane", input_summary: purpose,
    output_summary: `Nightshift unreachable (${second.name}); trying local lane ${ids[0]}`,
    status: "retrying", retry_count: 2, sponsor: null,
  });
  const r = await localLane(messages, { cfg, trace, fetchImpl });
  return { ...r, sponsor: null };
}

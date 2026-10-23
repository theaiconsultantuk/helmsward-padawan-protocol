// Zetaris Lightning REST adapter. Sample mode and recovery answer from adapters/sample.mjs by query name.
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { config, sampleMode, secrets } from "../config.mjs";
import { mask } from "../trace.mjs";
import { badResponse, fromFetchError, isAdapterError, unauthorized } from "./errors.mjs";

// Port 1 is on fetch's blocked-port list ("bad port", never a connect), so a genuine ECONNREFUSED needs a
// loopback port that is free right now: bind port 0, read it, close it.
async function closedPortUrl() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve("http://127.0.0.1:2"));
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve("http://127.0.0.1:" + port));
    });
  });
}
let refuseUsed = false;

export function resetFaults() {
  refuseUsed = false;
}

async function loadSample(sampleImpl) {
  return sampleImpl ?? (await import("./sample.mjs"));
}

async function fromSample(name, params, cfg, sampleImpl) {
  if (!name) throw badResponse("zetaris: a query name is required to answer from the cached rows", { service: "zetaris" });
  const s = await loadSample(sampleImpl);
  const r = await s.queryByName(name, params, { cfg });
  return { headers: r.headers, rows: r.rows, total: r.total ?? r.rows.length, timeUsed: r.timeUsed ?? 0, source: "cache" };
}

async function post(baseUrl, sql, { limit, timeoutMs, cfg, fetchImpl }) {
  const url = `${baseUrl}/sql-editor/sqls/run`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${cfg.ZETARIS_API_KEY}`,
        "X-Org-ID": String(cfg.ZETARIS_ORG_ID ?? ""),
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit }),
    });
  } catch (e) {
    throw fromFetchError(e, "zetaris");
  }
  if (res.status === 401 || res.status === 403) {
    throw unauthorized(`zetaris: HTTP ${res.status}`, { status: res.status, service: "zetaris" });
  }
  if (!res.ok) {
    // keep the first 300 chars of the body (masked): a bare HTTP 400 cannot tell a missing table from a bad request
    let detail = "";
    try { detail = String(mask(String(await res.text()).slice(0, 300), secrets(cfg))).replace(/\s+/g, " ").trim(); } catch { detail = ""; }
    const err = badResponse(`zetaris: HTTP ${res.status}${detail ? `: ${detail}` : ""}`, { status: res.status, service: "zetaris" });
    err.detail = detail;
    throw err;
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw badResponse("zetaris: response was not JSON", { status: res.status, cause: e, service: "zetaris" });
  }
  if (!body || !Array.isArray(body.data) || !Array.isArray(body.headers)) {
    throw badResponse("zetaris: response lacks headers/data", { status: res.status, service: "zetaris" });
  }
  return { headers: body.headers, rows: body.data, total: body.total ?? body.data.length, timeUsed: body.timeUsed ?? null, source: "live" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sqlRun(sql, {
  name = null, params = {}, limit = 100, timeoutMs = 30000, trace = null, cfg = config(),
  fetchImpl = globalThis.fetch, retryDelayMs = 2000, sampleImpl = null,
} = {}) {
  if (sampleMode(cfg)) return fromSample(name, params, cfg, sampleImpl);

  const label = name ?? "sql";
  const opts = { limit, timeoutMs, cfg, fetchImpl };
  const faulting = String(cfg.FAULT_ZETARIS_REFUSE_ONCE) === "true" && !refuseUsed;
  if (faulting) refuseUsed = true;

  const recover = async (err) => {
    trace?.line({
      step: "zetaris.query", agent_name: "Scout", action: "sql_run", input_summary: label,
      output_summary: `${err.name}: ${err.message}`, status: "error", sponsor: "zetaris",
    });
    const r = await fromSample(name, params, cfg, sampleImpl);
    trace?.line({
      step: "recovery", agent_name: "Scout", action: "cached_rows", input_summary: label,
      output_summary: "Zetaris refused once; answered from the cached rows", status: "success", sponsor: "zetaris",
    });
    return r;
  };

  let result;
  try {
    result = await post(faulting ? await closedPortUrl() : cfg.ZETARIS_REST_URL, sql, opts);
  } catch (e) {
    if (!isAdapterError(e) || e.name !== "UpstreamRefused") throw e;
    if (faulting) return recover(e);
    await sleep(retryDelayMs);
    try {
      result = await post(cfg.ZETARIS_REST_URL, sql, opts);
    } catch (e2) {
      if (isAdapterError(e2) && e2.name === "UpstreamRefused") return recover(e2);
      throw e2;
    }
  }
  trace?.line({
    step: "zetaris.query", agent_name: "Scout", action: "sql_run", input_summary: label,
    output_summary: `${label}: ${result.rows.length} rows in ${result.timeUsed ?? "?"} ms`, status: "success", sponsor: "zetaris",
  });
  return result;
}

export async function status({ cfg = config(), fetchImpl = globalThis.fetch } = {}) {
  const t0 = Date.now();
  try {
    await post(cfg.ZETARIS_REST_URL, "SELECT 1", { limit: 1, timeoutMs: 15000, cfg, fetchImpl });
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: `${e.name}: ${e.message}` };
  }
}

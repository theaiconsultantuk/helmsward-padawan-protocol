// Typed adapter errors. The loop logs an `error` status line, then a `recovery` line; the API returns toApiError(e).
export class AdapterError extends Error {
  constructor(name, message, { recoverable = false, status = null, cause = null, service = null } = {}) {
    super(message);
    this.name = name;
    this.recoverable = recoverable;
    this.status = status;
    this.service = service;
    if (cause) this.cause = cause;
  }
}

export const upstreamTimeout = (message, extra) => new AdapterError("UpstreamTimeout", message, { recoverable: true, ...extra });
export const upstreamRefused = (message, extra) => new AdapterError("UpstreamRefused", message, { recoverable: true, ...extra });
export const unauthorized = (message, extra) => new AdapterError("Unauthorized", message, { recoverable: false, ...extra });
export const badResponse = (message, extra) => new AdapterError("BadResponse", message, { recoverable: false, ...extra });

export function isAdapterError(e) {
  return e instanceof AdapterError;
}

const REFUSED_CODES = new Set(["ECONNREFUSED", "ENETUNREACH", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"]);

function chain(e) {
  const out = [];
  for (let x = e, i = 0; x && i < 6; x = x.cause, i++) out.push(x);
  return out;
}

export function fromFetchError(e, service = null) {
  if (isAdapterError(e)) return e;
  const links = chain(e);
  const where = service ? `${service}: ` : "";
  if (links.some((x) => x.name === "AbortError" || x.name === "TimeoutError")) {
    return upstreamTimeout(`${where}request timed out`, { cause: e, service });
  }
  const hit = links.find((x) => REFUSED_CODES.has(x.code));
  if (hit) return upstreamRefused(`${where}connection failed (${hit.code})`, { cause: e, service });
  return badResponse(`${where}${e?.message ?? "request failed"}`, { cause: e, service });
}

export function toApiError(e) {
  return { type: e?.name ?? "Error", message: e?.message ?? String(e), recoverable: Boolean(e?.recoverable) };
}

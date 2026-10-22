// Swap globalThis.fetch for the duration of fn. routes: array of { match, reply } or one function.
export async function withMockFetch(routes, fn) {
  const original = globalThis.fetch;
  const calls = [];
  const list = typeof routes === "function" ? null : routes;
  const handler = async (url, init = {}) => {
    const u = typeof url === "string" ? url : url?.url ?? String(url);
    calls.push({ url: u, init });
    if (typeof routes === "function") return toResponse(await routes(u, init));
    const route = list.find((r) => r.match(u, init));
    if (!route) throw new Error(`mock_fetch: no route for ${u}`);
    return toResponse(await route.reply(u, init));
  };
  if (list) list.calls = calls;
  else routes.calls = calls;
  globalThis.fetch = handler;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function toResponse(r) {
  if (r instanceof Response) return r;
  const { status = 200, headers = {}, body } = r ?? {};
  const h = new Headers(headers);
  let text = "";
  if (typeof body === "string") text = body;
  else if (body !== undefined && body !== null) {
    text = JSON.stringify(body);
    if (!h.has("content-type")) h.set("content-type", "application/json");
  }
  const nullBody = [204, 205, 304].includes(status);
  return new Response(nullBody ? null : text, { status, headers: h });
}

export function mockRefused() {
  const e = new Error("connect ECONNREFUSED 127.0.0.1");
  e.code = "ECONNREFUSED";
  return e;
}

export function mockTimeout() {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  e.code = 23;
  return e;
}

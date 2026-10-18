import { parseCsv } from "../../src/rank-core.mjs";
import { GIFTS_CSV, WATCH } from "./_data.js";

export const gifts = parseCsv(GIFTS_CSV);
export const watch = WATCH;
export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const enc = new TextEncoder();
export async function sign(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Optional KV counter (binding JP_KV). Returns the new count, or 0 if KV is not bound.
export async function bump(env, key, ttl) {
  if (!env.JP_KV) return 0;
  const n = Number((await env.JP_KV.get(key)) || 0) + 1;
  await env.JP_KV.put(key, String(n), { expirationTtl: ttl });
  return n;
}

import { json } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  const text = String(b.text || "").slice(0, 2000).trim();
  if (!text) return json({ error: "empty" }, 400);
  if (!env.JP_KV) return json({ error: "feedback store not configured" }, 503);
  const id = `fb:${Date.now()}`;
  await env.JP_KV.put(id, JSON.stringify({ at: new Date().toISOString(), who: String(b.who || "").slice(0, 60), text }), { expirationTtl: 60 * 60 * 24 * 60 });
  return json({ ok: true });
}

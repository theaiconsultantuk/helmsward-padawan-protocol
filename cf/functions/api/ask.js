import { ask } from "../../../src/ask.mjs";
import { gifts, json, bump } from "../_lib.js";

const DAILY_CAP = 300; // AI calls per day across the whole site; protects the free NVIDIA key
export async function onRequestGet({ request, env }) {
  const q = (new URL(request.url).searchParams.get("q") || "").slice(0, 300);
  if (!q.trim()) return json({ error: "Type a request first." });
  const day = new Date().toISOString().slice(0, 10);
  if ((await bump(env, `ask:${day}`, 90000)) > DAILY_CAP) return json({ error: "Daily AI limit reached. Try again tomorrow or use the filters." });
  try { return json(await ask(q, gifts, env)); }
  catch (e) { return json({ error: "The AI is unavailable right now: " + e.message }); }
}

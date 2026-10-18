// Passcode gate for every request. Cookie = HMAC(SESSION_SECRET, "jedi-pack-ok"), set after the right passcode.
import { sign, safeEqual, bump } from "./_lib.js";

const loginPage = (msg = "") => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Jedi Pack</title>
<style>body{font:16px system-ui;background:#0b0d14;color:#e8e6df;max-width:420px;margin:15vh auto;padding:0 1rem}h1{color:#ffe81f}
input,button{font:inherit;padding:.6rem;border-radius:6px;border:1px solid #333;background:#161a26;color:#e8e6df;width:100%;box-sizing:border-box;margin:.3rem 0}
button{background:#ffe81f;color:#000;font-weight:700;cursor:pointer}</style>
<h1>JEDI PACK</h1><p>Team demo. Enter the team passcode.</p><p style="color:#f66">${msg}</p>
<form method=post action=/login><input type=password name=passcode autofocus autocomplete=current-password placeholder=Passcode><button>Enter</button></form>`,
  { status: 401, headers: { "content-type": "text/html", "cache-control": "no-store" } });

export async function onRequest({ request, env, next }) {
  if (!env.GATE_PASSCODE || !env.SESSION_SECRET) return new Response("Not configured", { status: 503 });
  const url = new URL(request.url);
  const good = await sign(env.SESSION_SECRET, "jedi-pack-ok");
  const cookie = (request.headers.get("cookie") || "").match(/(?:^|;\s*)jp=([a-f0-9]+)/)?.[1] || "";

  if (url.pathname === "/login" && request.method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") || "x";
    if ((await bump(env, `login:${ip}`, 600)) > 8) return loginPage("Too many attempts. Wait 10 minutes.");
    const form = await request.formData();
    const given = String(form.get("passcode") || "");
    if (!safeEqual(await sign(env.SESSION_SECRET, given), await sign(env.SESSION_SECRET, env.GATE_PASSCODE))) return loginPage("Wrong passcode.");
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `jp=${good}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600` } });
  }
  if (!cookie || !safeEqual(cookie, good)) return loginPage();
  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set("x-robots-tag", "noindex, nofollow");
  out.headers.set("cache-control", "no-store");
  return out;
}

// The storefront pages (contact, FAQ, nav) and the one scenarios file, served by the real server in sample mode.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { config } from "../src/config.mjs";
import { createServer, CHANNELS } from "../src/server.mjs";
import { SCENARIOS } from "../src/scenarios.mjs";

const INBOX = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOP = join(INBOX, "public", "shop");
const dir = mkdtempSync(join(tmpdir(), "shop-runtime-"));
const logsDir = mkdtempSync(join(tmpdir(), "shop-logs-"));
const memoryDir = mkdtempSync(join(tmpdir(), "shop-mem-"));
let server, base;

before(async () => {
  server = createServer({
    cfg: config({ API_TOKEN: "", SAMPLE_MODE: "true" }),
    deps: { dir, runtimeDir: dir, logsDir, memoryDir, quiet: true, publish: async () => ({ published: true, uncached: true }) },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (p) => fetch(base + p);
const page = async (p) => {
  const r = await get(p);
  assert.equal(r.status, 200, p);
  return r.text();
};
const readShop = (rel) => readFileSync(join(SHOP, rel), "utf8");

// RFC 4180 enough for faq.csv: quoted fields, doubled quotes, embedded commas and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((x) => x !== "")) rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const REASONS = ["Refund", "Question", "Quote", "Complaint", "Other", "Review", "Email"];

test("(1) GET /demo/scenarios: 14 entries with the declared shape", async () => {
  const r = await get("/demo/scenarios");
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.equal(list.length, 14);
  assert.deepEqual(list.map((e) => e.id), Array.from({ length: 14 }, (_, i) => `s${String(i + 1).padStart(2, "0")}`));
  for (const e of list) {
    assert.ok(SCENARIOS.includes(e.scenario), `${e.id} scenario ${e.scenario}`);
    assert.ok(CHANNELS.includes(e.channel), `${e.id} channel ${e.channel}`);
    assert.ok(REASONS.includes(e.reason), `${e.id} reason ${e.reason}`);
    assert.ok(["send", "hold", "escalate", "close"].includes(e.expected?.decision), `${e.id} decision`);
    assert.ok(!("rating" in e) && !("rating" in (e.review ?? {})), `${e.id} carries no rating`);
  }
  assert.equal(list.filter((e) => e.client === "seeded-second-refund").length, 1);
  assert.equal(list.find((e) => e.client === "seeded-second-refund").id, "s04");
  assert.deepEqual(list.filter((e) => e.channel === "trustpilot").map((e) => e.id), ["s13"]);
  const s14 = list[13];
  assert.equal(s14.channel, "email");
  assert.ok(s14.to && s14.subject, "s14 carries to and subject");
  assert.equal(s14.to, "info@jedipack.com");
  assert.equal(s14.subject, s14.message.slice(0, 60));
  assert.ok(list[12].review?.title, "s13 carries review.title");

  const s04 = await (await get("/demo/client?scenario=s04")).json();
  assert.equal(s04.seeded_prior_refund, true);
  const s01 = await (await get("/demo/client?scenario=s01")).json();
  assert.equal(s01.generated, true);
});

test("(2) contact.html: form, static flow head, no inline script, no external URLs, script allow-list", async () => {
  const html = await page("/shop/contact.html");
  assert.match(html, /<select/);
  for (const v of ["refund", "question", "rfq", "complaint", "free_text"]) assert.ok(html.includes(`value="${v}"`), `option ${v}`);
  assert.ok(html.includes('<h2 class="flow__title">How a person sees it</h2>'));
  assert.ok(html.includes("Under the hood"));
  assert.ok(html.includes('<meta name="api-base" content="">'));
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\bsrc=/, "no inline script body");
    assert.equal(m[2].trim(), "", "script tag with src has no body");
  }
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "no on*= handlers");
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(html), "no external URLs");
  const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  const allowed = [/^shared\/vendor\//, /^shared\/brand\.js$/, /^js\/core\.js$/, /^js\/flow-render\.js$/, /^js\/contact\.js$/];
  for (const s of srcs) assert.ok(allowed.some((re) => re.test(s)), `script src ${s} is allowed`);
  assert.ok(srcs.includes("js/flow-render.js") && srcs.includes("js/contact.js"));
  assert.ok(srcs.indexOf("js/flow-render.js") < srcs.indexOf("js/contact.js"), "flow-render loads before contact");
});

test("(3) faq.html: native details, no source leak", async () => {
  const html = await page("/shop/faq.html");
  // the questions are built by faq.js as native <details>; the served page holds the list they go into
  assert.match(html, /class="faq__list"/);
  assert.match(html, /src="js\/faq\.js"/);
  assert.match(readFileSync(new URL("../public/shop/js/faq.js", import.meta.url), "utf8"), /createElement\("details"\)/);
  assert.ok(!html.includes("wiki/"));
  assert.ok(!html.includes(".csv"));
  assert.ok(!/authored/.test(html));
});

test("(4) the five storefront pages each link faq.html three times", async () => {
  for (const f of ["index.html", "shop.html", "product.html", "faq.html", "contact.html"]) {
    const html = await page(`/shop/${f}`);
    assert.equal(html.split('href="faq.html"').length - 1, 3, f);
  }
  assert.ok(readShop("js/product.js").includes("contact.html?scenario=refund&product="));
});

test("(5) no invented names and no HTML-string sinks in the new page code", () => {
  const files = ["js/contact.js", "js/flow-render.js", "js/faq.js", "contact.html", "faq.html"];
  const names = /claude-sonnet|zetaris-mcp|helmsward-(router|guard|dispatch|policy|drafter|refunds)|sample-faq|sample-custom|Elena Vance|Mina Sato|Soren Lind|JP-\d{4}/;
  const sinks = /innerHTML|outerHTML|insertAdjacentHTML|document\.write/;
  for (const f of files) {
    assert.ok(existsSync(join(SHOP, f)), `${f} exists`);
    const t = readShop(f);
    assert.ok(!names.test(t), `${f} invented name`);
    assert.ok(!sinks.test(t), `${f} HTML sink`);
  }
});

test("(6) data/faq.json equals faq.csv on the four public columns", () => {
  const csv = parseCsv(readFileSync(join(INBOX, "data", "synthetic", "faq.csv"), "utf8"));
  assert.equal(csv.length, 18);
  const json = JSON.parse(readShop("data/faq.json"));
  assert.ok(Array.isArray(json));
  const cols = ["faq_id", "question", "answer", "keywords"];
  assert.deepEqual(json, csv.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))));
  for (const row of json) {
    assert.deepEqual(Object.keys(row).sort(), [...cols].sort());
    assert.ok(!("source" in row));
  }
});

test("(7) the old scenarios copy is gone; faq.json is served as JSON", async () => {
  const gone = await get("/shop/data/demo-scenarios.json");
  assert.equal(gone.status, 404);
  const r = await get("/shop/data/faq.json");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^application\/json/);
});

test("(8) faq.js never reads a `source` field, and /faq rows carry exactly the four public keys", async () => {
  const js = readShop("js/faq.js");
  assert.doesNotMatch(js, /\.source\b/);
  assert.doesNotMatch(js, /\[\s*["']source["']\s*\]/);
  const rows = await (await get("/faq")).json();
  assert.ok(Array.isArray(rows) && rows.length > 0);
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ["answer", "faq_id", "keywords", "question"], JSON.stringify(r));
});

test("(9) contact.js token handling: the token survives throwing storage and a throwing history, and a failed strip is reported", async () => {
  assert.equal(typeof globalThis.document, "undefined");
  await import("../public/shop/js/contact.js");
  const { resolveToken } = globalThis.JP_CONTACT_TEST;
  assert.equal(typeof resolveToken, "function");
  const boom = () => { throw new Error("blocked"); };
  const throwingStorage = { setItem: boom, getItem: boom };
  const goodHistory = () => { const calls = []; return { calls, replaceState: (...a) => calls.push(a) }; };

  // storage throws: the token is still held, and the address bar is still cleaned
  const h1 = goodHistory();
  const r1 = resolveToken({ search: "?token=abc&x=1", href: "http://h.test/shop/contact.html?token=abc&x=1#f", storage: throwingStorage, history: h1 });
  assert.equal(r1.token, "abc");
  assert.equal(r1.stripFailed, false);
  assert.equal(h1.calls.length, 1);
  assert.equal(h1.calls[0][2], "/shop/contact.html?x=1#f");

  // history throws: the token is held and stored, and the failure is flagged for the status line
  const stored = {};
  const r2 = resolveToken({ search: "?token=abc", href: "http://h.test/shop/contact.html?token=abc",
    storage: { setItem: (k, v) => { stored[k] = v; }, getItem: (k) => stored[k] }, history: { replaceState: boom } });
  assert.equal(r2.token, "abc");
  assert.equal(r2.stripFailed, true);
  assert.equal(stored.jp_token, "abc");

  // both throw
  const r3 = resolveToken({ search: "?token=zz", href: "http://h.test/c?token=zz", storage: throwingStorage, history: { replaceState: boom } });
  assert.deepEqual(r3, { token: "zz", stripFailed: true });

  // no query token: storage read, and a throwing read gives an empty token
  assert.equal(resolveToken({ search: "", href: "http://h.test/c", storage: { getItem: () => "kept" }, history: goodHistory() }).token, "kept");
  assert.equal(resolveToken({ search: "", href: "http://h.test/c", storage: throwingStorage, history: goodHistory() }).token, "");

  // the status line reports a failed strip through textContent only
  const src = readShop("js/contact.js");
  assert.match(src, /stripFailed\) setStatus\(/);
});

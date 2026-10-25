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

// The storefront prices in GC and its public catalogue carries no internal fields (Codex review 33 finding 1).
const INTERNAL_FIELDS = ["inbox_agent", "brand_file", "refund_limit_usd", "refund_limit_source",
  "over_refund_limit", "inbox_product_map", "thread_refs"];
const SHOP_HTML = ["index.html", "shop.html", "product.html", "faq.html", "contact.html"];

test("the served catalogue and every embedded copy carry no internal fields, and GC is the currency", async () => {
  const served = await page("/shop/data/catalogue.json");
  const blobs = [];
  for (const f of SHOP_HTML) {
    const html = await page("/shop/" + f);
    const m = html.match(/<script type="application\/json" id="catalogue-data">([\s\S]*?)<\/script>/);
    if (m) blobs.push([f, m[1]]);
    else assert.ok(f === "contact.html", `${f} should embed the catalogue`);
  }
  assert.ok(blobs.length >= 4, "index, shop, product and faq embed a catalogue copy");
  for (const [name, text] of [["catalogue.json", served], ...blobs]) {
    for (const k of INTERNAL_FIELDS) assert.ok(!text.includes(`"${k}"`), `${name} exposes ${k}`);
    const cat = JSON.parse(text);
    assert.ok(cat.products.length > 0, name);
    for (const p of cat.products) {
      assert.equal(typeof p.price_usd, "number", `${name} ${p.id}`);
      assert.equal(p.currency, "GC", `${name} ${p.id}`);
    }
  }
});

test("no served shop page shows a dollar sign before a number or USD to the visitor", async () => {
  for (const f of [...SHOP_HTML, "data/catalogue.json"]) {
    const text = await page("/shop/" + f);
    assert.ok(!/\$\s?\d/.test(text), `${f} shows $ before a number`);
    assert.ok(!/\bUSD\b/.test(text), `${f} shows USD`);
  }
  // the price formatter the pages share prints GC
  assert.match(readShop("js/core.js"), /const usd = n => `\$\{n\} GC`;/);
});

test("(judges) the scenario heading carries the muted Judges' corner line", () => {
  const html = readShop("contact.html");
  assert.match(html, /id="sc-title">Try a scenario<\/h2>\s*<p class="sc__note" id="sc-judges">Judges' corner \(hackOS\): pick one and watch the agent work it live\. Some take a few minutes\.<\/p>/);
  assert.match(html, /<div id="scenarios"><\/div>/);
});

// Static checks on contact.js, in the style of the page tests above: the scenario click only fills.
const fnBody = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, name);
  const j = src.indexOf("\n  function ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

test("(judges) a scenario click fills the form, never starts a run, and hands focus to Submit", () => {
  const js = readShop("js/contact.js");
  const pick = fnBody(js, "pickScenario");
  assert.ok(!/\brun\(|requestSubmit|\.submit\(|\.click\(\)|dispatchEvent/.test(pick), "pickScenario must not start a run");
  assert.match(pick, /Ready: check the message, then press Submit dispatch\./);
  assert.match(pick, /focusSubmit\(\$\("submit"\), from\)/);
  const focus = fnBody(js, "focusSubmit");
  assert.match(focus, /scrollIntoView/);
  assert.match(focus, /\.focus\(/);
  assert.match(pick, /seq !== pickSeq/, "the pickSeq guard stays");
});

test("(judges) the Reason is filled from the entry's reason, falling back to its scenario", () => {
  const js = readShop("js/contact.js");
  assert.match(fnBody(js, "pickScenario"), /setReason\(reasonValueFor\(e\)\)/);
  const f = fnBody(js, "reasonValueFor");
  assert.match(f, /str\(e\.reason\)/);
  assert.match(f, /str\(e\.scenario\)/);
  assert.match(js, /Question: "question"/);
});

test("(judges) the Submit button shows Running… while busy and is restored", () => {
  const js = readShop("js/contact.js");
  const busy = fnBody(js, "setBusy");
  assert.match(busy, /on \? "Running\\u2026" : "Submit dispatch"/);
  assert.match(busy, /b\.disabled = on/);
  assert.match(readShop("contact.html"), /id="submit">Submit dispatch<\/button>/);
});

test("(judges) a rendered journey nudges Under the hood without opening the drawer; opening or a new run clears it", () => {
  const js = readShop("js/contact.js");
  const html = readShop("contact.html");
  assert.match(html, /<span class="flow__hint" id="drawer-hint" hidden>See how the agent decided<\/span>/);
  const nudge = fnBody(js, "nudgeDrawer");
  assert.match(nudge, /is-nudge/);
  assert.ok(!/showModal|setAttribute\("open"/.test(nudge), "the nudge must not open the drawer");
  assert.match(fnBody(js, "renderJourney"), /nudgeDrawer\(\)/);
  assert.match(fnBody(js, "run"), /clearNudge\(\)/);
  assert.match(fnBody(js, "openDrawer"), /clearNudge\(\)/);
  const css = readShop("css/totality.css");
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{\.btn-line\.is-nudge\{animation:nudge/);
});

test("(judges) the form and the flow clear the fixed masthead when scrolled to", () => {
  assert.match(readShop("css/totality.css"), /#contact-form,#flow\{scroll-margin-top:calc\(var\(--mast,72px\) \+ 16px\)\}/);
});

test("(judges) a held Enter on a scenario button cannot press Submit, and focus is not stolen", () => {
  const js = readShop("js/contact.js");
  const focus = fnBody(js, "focusSubmit");
  assert.match(focus, /document\.activeElement/);
  assert.match(focus, /stillThere && btn/, "focus moves only if the judge is still on the scenario button or nowhere");
  assert.match(focus, /focusMovedAt = Date\.now\(\)/);
  assert.match(fnBody(js, "pickScenario"), /var from = document\.activeElement/);
  assert.match(js, /focusSubmit\(\$\("submit"\), from\)/);
  assert.match(js, /if \(scKeyHeld \|\| Date\.now\(\) - focusMovedAt < 600\) return;/, "the submit handler ignores a held key and the first 600 ms");
  assert.match(js, /ev\.target\.closest\("\.sc__btn"\)\) scKeyHeld = true/);
  assert.match(js, /keyup[\s\S]{0,120}scKeyHeld = false/);
});

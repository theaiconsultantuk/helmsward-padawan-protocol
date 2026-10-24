// The two pages and the closed static route, in sample mode (same harness as api.test.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { config } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";
import { SCENARIOS } from "../src/scenarios.mjs";

const dir = mkdtempSync(join(tmpdir(), "pages-runtime-"));
const logsDir = mkdtempSync(join(tmpdir(), "pages-logs-"));
const memoryDir = mkdtempSync(join(tmpdir(), "pages-mem-"));
let server, base;

before(async () => {
  server = createServer({
    cfg: config({ API_TOKEN: "",  SAMPLE_MODE: "true" }),
    deps: { dir, runtimeDir: dir, logsDir, memoryDir, quiet: true, publish: async () => ({ published: true, uncached: true }) },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const notFound = async (p) => {
  const r = await get(p);
  assert.equal(r.status, 404, p);
  const b = await r.json();
  assert.equal(b.status, "error", p);
  assert.equal(b.error.type, "NotFound", p);
};

test("GET /dashboard is html with a correct Content-Length and no-store", async () => {
  const r = await get("/dashboard");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(r.headers.get("cache-control"), "no-store");
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(Number(r.headers.get("content-length")), buf.length);
});

test("static files carry their content type", async () => {
  const js = await get("/static/dashboard.js");
  assert.equal(js.status, 200);
  assert.equal(js.headers.get("content-type"), "application/javascript; charset=utf-8");
  assert.equal(js.headers.get("cache-control"), "no-store");
  const css = await get("/static/style.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /^text\/css/);
});

test("static route is a closed list: traversal, unlisted names and the bare folder are 404", async () => {
  for (const p of ["/static/../package.json", "/static/%2e%2e/package.json", "/static/..%2fpackage.json", "/static/server.mjs", "/static/index.html", "/static/dashboard.html", "/static/", "/static", "/static/%00", "/static/%zz"]) {
    if (p === "/static") continue; // not under /static/: plain no-route 404, covered below
    await notFound(p);
  }
  await notFound("/static");
  assert.equal((await post("/dashboard", {})).status, 405);
});

test("the dashboard html loads only /static/ scripts, has no inline handlers, and names the api base", async () => {
  const html = await (await get("/dashboard")).text();
  assert.match(html, /<meta name="api-base"/);
  for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) assert.match(m[1], /^\/static\//, m[0]);
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(html), "no inline script bodies");
  assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(html), "no on*= handler");
  assert.ok(!/https?:\/\//i.test(html.replace(/<!doctype[^>]*>/i, "")), "no external request");
  const js = await (await get("/static/dashboard.js")).text();
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js), "dashboard.js never builds html from data");
});

test("after a sample RFQ run and an affirm, the counters count it and the queue lists the escalation", async () => {
  const r = await post("/run", { run_id: "pg-rfq", input: { message: "Incoming RFQ for price difference between ordering 100000 Arc Blade Trainers and 100", from: "buyer@example.com", channel: "chat", scenario: "rfq" } });
  assert.equal(r.status, 200);
  const run = await r.json();
  assert.equal(run.output.decision, "escalate");
  const before = await (await get("/counters")).json();
  const fb = await post("/feedback", { run_id: "pg-rfq", verdict: "affirm" });
  assert.equal(fb.status, 200);
  const c = await (await get("/counters")).json();
  assert.equal(c.affirmed, before.affirmed + 1);
  assert.ok(c.escalate >= 1);
  const q = await (await get("/queue")).json();
  assert.ok(q.length >= 1);
  assert.ok(q.some((x) => x.category === "rfq" || x.scenario === "rfq"), JSON.stringify(q));
  const runs = await (await get("/runs?limit=50")).json();
  assert.ok(runs.some((x) => x.run_id === "pg-rfq"));
});

const here = dirname(fileURLToPath(import.meta.url));
const inboxRoot = join(here, "..");

test("GET / is html with a correct Content-Length", async () => {
  const r = await get("/");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(Number(r.headers.get("content-length")), buf.length);
  const html = buf.toString("utf8");
  for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) assert.match(m[1], /^\/static\//, m[0]);
});

test("the front page has the five radio values, both titles, the api-base meta and no inline handlers", async () => {
  const html = await (await get("/")).text();
  for (const v of ["refund", "question", "rfq", "complaint", "free_text"]) assert.ok(html.includes(`value="${v}"`), v);
  assert.equal((html.match(/type="radio"/g) || []).length, 5);
  assert.match(html, /<input type="radio" name="scenario" value="free_text" checked>/);
  assert.ok(html.includes("How a person sees it"));
  assert.ok(html.includes("Under the hood"));
  assert.match(html, /<meta name="api-base"/);
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(html), "no inline script bodies");
  assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(html), "no on*= handler");
  assert.ok(!/https?:\/\//i.test(html), "no external request");
});

test("GET /static/app.js is javascript, never builds html from data, reads the journey", async () => {
  const r = await get("/static/app.js");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/javascript; charset=utf-8");
  const js = await r.text();
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js));
  assert.ok(!/https?:\/\//i.test(js), "no absolute url literal");
  assert.ok(js.includes("/runs/") && js.includes("/journey"));
});

test("demo-scenarios.json parses; fourteen entries s01..s14, known scenarios, as_of, messages equal the input examples", async () => {
  const r = await get("/static/demo-scenarios.json");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
  const list = await r.json();
  assert.equal(list.length, 14);
  list.forEach((d, i) => {
    assert.equal(d.id, `s${String(i + 1).padStart(2, "0")}`);
    assert.ok(SCENARIOS.includes(d.scenario), d.scenario);
    assert.ok(d.as_of, `${d.label} lacks as_of`);
    assert.ok(typeof d.message === "string" && d.message.length > 0, `${d.label} lacks a message`);
    const ex = JSON.parse(readFileSync(join(inboxRoot, "input_examples", `example_${i + 10}.json`), "utf8")).input;
    assert.equal(d.message, ex.message, d.label);
  });
});

// HTTP response boundary: cache policy, conditional requests and wire compression.
// Raw node:http preserves compressed bytes; fetch transparently decompresses them.
// CodexBWAI: no public fixtures are created or changed by this suite.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";

const root = mkdtempSync(join(tmpdir(), "static-cache-"));
let server;
before(async () => {
  server = createServer({
    cfg: config({ SAMPLE_MODE: "true", API_TOKEN: "", CORS_ORIGIN: "https://cache-test.example" }),
    deps: { dir: root, runtimeDir: root, logsDir: join(root, "logs"), memoryDir: join(root, "memory"), quiet: true },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});
const get = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port: server.address().port, path, headers }, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    res.on("error", reject);
  });
  req.on("error", reject);
  req.end();
});
const file = (path) => join(INBOX_ROOT, "public", path.replace(/^\/shop\//, "shop/").replace(/^\/static\//, ""));
const model = "/shop/models/orbit-stand.glb";

for (const [path, policy] of [
  [model, "public, max-age=86400"],
  ["/shop/index.html", "no-cache"],
  ["/shop/js/contact.js", "public, max-age=300"],
  ["/shop/shared/vendor/gsap.min.js", "public, max-age=86400"],
  ["/", "no-cache"], ["/inbox", "no-cache"], ["/dashboard", "no-cache"],
  ["/static/style.css", "public, max-age=300"],
  ["/static/demo-scenarios.json", "public, max-age=300"],
  ["/shop", "no-store"], ["/counters", "no-store"], ["/health", "no-store"],
]) test(`cache policy: ${path}`, async () => {
  const r = await get(path);
  assert.equal(r.status, path === "/shop" ? 302 : 200);
  assert.equal(r.headers["cache-control"], policy);
});

for (const path of [model, "/shop/index.html", "/static/app.js"]) {
  test(`weak size/mtime ETag and conditional GET: ${path}`, async () => {
    const r = await get(path);
    const st = statSync(file(path));
    const tag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    assert.equal(r.headers.etag, tag);
    // GET uses weak comparison, including strong-form equivalents and tag lists.
    for (const match of [tag, `"other", ${tag}`, "*", tag.slice(2)]) {
      const cached = await get(path, { "If-None-Match": match });
      assert.equal(cached.status, 304, match);
      assert.equal(cached.body.length, 0);
      assert.equal(cached.headers.etag, tag);
      assert.equal(cached.headers["cache-control"], r.headers["cache-control"]);
    }
    assert.equal((await get(path, { "If-None-Match": 'W/"other"' })).status, 200);
  });
}

for (const path of ["/shop/js/contact.js", model, "/static/style.css", "/static/demo-scenarios.json", "/shop/images/logo-shop.svg", "/shop/index.html"]) {
  test(`gzip preserves file bytes and wire Content-Length: ${path}`, async () => {
    const original = readFileSync(file(path));
    const plain = await get(path);
    assert.deepEqual(plain.body, original);
    assert.equal(plain.headers["content-encoding"], undefined);
    assert.equal(plain.headers.vary, "Origin, Accept-Encoding");
    for (let i = 0; i < 2; i++) {
      const zipped = await get(path, { "Accept-Encoding": "br, gzip" });
      assert.equal(zipped.headers["content-encoding"], "gzip");
      assert.equal(Number(zipped.headers["content-length"]), zipped.body.length);
      assert.deepEqual(gunzipSync(zipped.body), original);
      assert.equal(zipped.headers.etag, plain.headers.etag);
    }
    const refused = await get(path, { "Accept-Encoding": "gzip;q=0, br" });
    assert.equal(refused.headers["content-encoding"], undefined);
    assert.deepEqual(refused.body, original);
  });
}

// The repository has no PNG fixture; WebP exercises the same image exclusion.
for (const path of ["/shop/images/orbit-stand.webp", "/shop/fonts/manrope-latin-400-normal.woff2"]) {
  test(`binary media stays uncompressed: ${path}`, async () => {
    const r = await get(path, { "Accept-Encoding": "gzip" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-encoding"], undefined);
    assert.deepEqual(r.body, readFileSync(file(path)));
  });
}

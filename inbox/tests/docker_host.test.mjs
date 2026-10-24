// The shipped container must be reachable through `docker run -p` even when the env file says HOST=127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listenHost, isLoopback, main } from "../src/server.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

test("loopback is recognised in every spelling; other addresses are not", () => {
  for (const h of ["127.0.0.1", "127.0.0.2", "127.255.255.254", "localhost", "LOCALHOST", "::1", "[::1]", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001", "::ffff:127.0.0.1", "[::ffff:127.0.0.1]"]) {
    assert.equal(isLoopback(h), true, h);
  }
  for (const h of ["0.0.0.0", "10.0.0.5", "128.0.0.1", "1270.0.0.1", "127.999.0.1", "127.0.0.256", "1:2:3:4:5:6:7:8::1", "::ffff:".repeat(12) + "1", "x".repeat(300), "::", "::2", "fe80::1", "::ffff:10.0.0.1", "", "example.com", "127.0.0.1:8000", ":::1", "::1::", "::ffff:::1", "1::", "1::1", "0:0:0:0:0:0:0:0:1", "00000::1", null, undefined, 7]) {
    assert.equal(isLoopback(h), false, h);
  }
});

test("with the marker a loopback HOST binds 0.0.0.0 and says what it ignored; without it HOST is honoured", () => {
  assert.deepEqual(listenHost({ HOST: "127.0.0.1" }, { JEDI_IN_CONTAINER: "1" }), { host: "0.0.0.0", overrode: "127.0.0.1" });
  assert.deepEqual(listenHost({ HOST: "0:0:0:0:0:0:0:1" }, { JEDI_IN_CONTAINER: "1" }), { host: "0.0.0.0", overrode: "0:0:0:0:0:0:0:1" });
  assert.deepEqual(listenHost({ HOST: "10.0.0.5" }, { JEDI_IN_CONTAINER: "1" }), { host: "10.0.0.5", overrode: null });
  assert.deepEqual(listenHost({ HOST: "127.0.0.1" }, {}), { host: "127.0.0.1", overrode: null });
  assert.deepEqual(listenHost({ HOST: "127.0.0.1" }, { JEDI_IN_CONTAINER: "0" }), { host: "127.0.0.1", overrode: null });
  assert.deepEqual(listenHost({}, { JEDI_IN_CONTAINER: "1" }), { host: "0.0.0.0", overrode: "127.0.0.1" });
});

test("the entry point itself listens on the overridden address and logs the override", async () => {
  const saved = process.env.JEDI_IN_CONTAINER;
  const listening = (server) => new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const closed = (server) => new Promise((r) => server.close(r));
  try {
    process.env.JEDI_IN_CONTAINER = "1";
    const lines = [];
    const s1 = main({ cfg: { HOST: "127.0.0.1", PORT: "0", SAMPLE_MODE: "true" }, log: (l) => lines.push(l) });
    try {
      await listening(s1);
      assert.equal(s1.address().address, "0.0.0.0");
      assert.match(lines[0], /listening on http:\/\/0\.0\.0\.0:0 .*\(HOST=127\.0\.0\.1 ignored: JEDI_IN_CONTAINER=1\)$/);
    } finally {
      await closed(s1);
    }
    delete process.env.JEDI_IN_CONTAINER;
    const lines2 = [];
    const s2 = main({ cfg: { HOST: "127.0.0.1", PORT: "0", SAMPLE_MODE: "true" }, log: (l) => lines2.push(l) });
    try {
      await listening(s2);
      assert.equal(s2.address().address, "127.0.0.1");
      assert.doesNotMatch(lines2[0], /ignored/);
    } finally {
      await closed(s2);
    }
  } finally {
    if (saved === undefined) delete process.env.JEDI_IN_CONTAINER; else process.env.JEDI_IN_CONTAINER = saved;
  }
});

test("the Dockerfile sets the marker and the README documents the self-check's Docker facts", () => {
  const df = readFileSync(`${ROOT}Dockerfile`, "utf8");
  assert.match(df, /^ENV .*\bJEDI_IN_CONTAINER=1\b/m);
  const readme = readFileSync(`${ROOT}README.md`, "utf8");
  const docker = readme.slice(readme.indexOf("### Docker")).replace(/\\\n\s*/g, " "); // a command wrapped with shell continuations reads as one line
  assert.ok(docker.length > 200, "README has a Docker section");
  for (const fact of [/docker build\b/, /docker run\b[^\n]*-p 8000:8000/, /docker run\b[^\n]*--env-file/, /docker run\b[^\n]*SAMPLE_MODE=true/, /host\.docker\.internal/, /--network host/, /JEDI_IN_CONTAINER=1/]) {
    assert.match(docker, fact);
  }
});

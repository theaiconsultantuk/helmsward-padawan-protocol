// The shipped container must be reachable through `docker run -p` even when the env file says HOST=127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listenHost } from "../src/server.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

test("inside the container a loopback HOST binds 0.0.0.0 and says what it ignored; anywhere else HOST is honoured", () => {
  assert.deepEqual(listenHost({ HOST: "127.0.0.1" }, { JEDI_IN_CONTAINER: "1" }), { host: "0.0.0.0", overrode: "127.0.0.1" });
  assert.deepEqual(listenHost({ HOST: "localhost" }, { JEDI_IN_CONTAINER: "1" }), { host: "0.0.0.0", overrode: "localhost" });
  assert.deepEqual(listenHost({ HOST: "10.0.0.5" }, { JEDI_IN_CONTAINER: "1" }), { host: "10.0.0.5", overrode: null });
  assert.deepEqual(listenHost({ HOST: "127.0.0.1" }, {}), { host: "127.0.0.1", overrode: null });
  assert.deepEqual(listenHost({ HOST: "127.0.0.1" }, { JEDI_IN_CONTAINER: "0" }), { host: "127.0.0.1", overrode: null });
  assert.deepEqual(listenHost({}, { JEDI_IN_CONTAINER: "1" }), { host: "0.0.0.0", overrode: "127.0.0.1" });
});

test("the Dockerfile sets JEDI_IN_CONTAINER=1 and the README carries the build and run lines the checklist uses", () => {
  const df = readFileSync(`${ROOT}Dockerfile`, "utf8");
  assert.match(df, /^ENV .*\bJEDI_IN_CONTAINER=1\b/m);
  const readme = readFileSync(`${ROOT}README.md`, "utf8");
  for (const line of ["docker build -t jedi-pack-inbox .", "docker run --rm -p 8000:8000 --env-file .env jedi-pack-inbox", "docker run --rm -p 8000:8000 -e SAMPLE_MODE=true jedi-pack-inbox", "host.docker.internal"]) {
    assert.ok(readme.includes(line), `README lacks: ${line}`);
  }
});

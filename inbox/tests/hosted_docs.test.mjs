// Pins the hosted instance's docs truth (hackathon team-access change, 23 Oct 2026).
// The team instance at https://jedi.blastworks.ai opts into API_TOKEN, so the POST routes need a bearer token.
// docs/FRONTEND-SPEC.md and openapi.yaml must say so, must not claim "no credentials", must name the hosted
// origin (openapi `servers:` exactly once), and must never carry a secret-shaped string next to the word "token".
// INBOX_ROOT lets the orchestrator point this same test at an old checkout to prove it fails there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = process.env.INBOX_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  "docs/FRONTEND-SPEC.md": readFileSync(path.join(root, "docs", "FRONTEND-SPEC.md"), "utf8"),
  "openapi.yaml": readFileSync(path.join(root, "openapi.yaml"), "utf8"),
};

test("both docs mention Bearer", () => {
  for (const [name, text] of Object.entries(files)) assert.ok(text.includes("Bearer"), `${name} lacks "Bearer"`);
});

test("neither doc claims there are no credentials", () => {
  for (const [name, text] of Object.entries(files)) {
    for (const phrase of ["no auth and no credential", "there are no credentials"]) {
      assert.ok(!text.includes(phrase), `${name} still says "${phrase}"`);
    }
  }
});

test("FRONTEND-SPEC names jedi.blastworks.ai", () => {
  assert.ok(files["docs/FRONTEND-SPEC.md"].includes("jedi.blastworks.ai"));
});

test("openapi servers lists https://jedi.blastworks.ai exactly once", () => {
  const doc = parse(files["openapi.yaml"]);
  const urls = (doc.servers ?? []).map((s) => s.url);
  assert.equal(urls.filter((u) => u === "https://jedi.blastworks.ai").length, 1, `servers: ${JSON.stringify(urls)}`);
});

test("secret-shape sweep: no 40+ char token-like run on a line mentioning token", () => {
  for (const [name, text] of Object.entries(files)) {
    text.split("\n").forEach((line, i) => {
      if (/token/i.test(line)) {
        assert.ok(!/[A-Za-z0-9_-]{40,}/.test(line), `${name}:${i + 1} has a 40+ character run on a token line`);
      }
    });
  }
});

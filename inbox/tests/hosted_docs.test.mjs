// Pins the hosted instance's docs truth (hackathon team-access change, 23 Oct 2026).
// The team instance at https://jedi.blastworks.ai opts into API_TOKEN, so the POST routes need a bearer token.
// docs/FRONTEND-SPEC.md and openapi.yaml must say so conditionally (API_TOKEN set), must not claim the API is
// credential-free without that condition, must name the hosted origin (openapi `servers:` exactly once), and must
// never carry a secret-shaped string next to the word "token". The test reads its OWN checkout only (no override):
// pointing it at another tree would let a stale tree vouch for this one (Codex review of PR #10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  "docs/FRONTEND-SPEC.md": readFileSync(path.join(root, "docs", "FRONTEND-SPEC.md"), "utf8"),
  "openapi.yaml": readFileSync(path.join(root, "openapi.yaml"), "utf8"),
};

test("both docs carry the conditional bearer rule: API_TOKEN, Bearer, and the three POST routes", () => {
  for (const [name, text] of Object.entries(files)) {
    for (const needle of ["API_TOKEN", "Bearer", "/run", "/ask", "/feedback"]) {
      assert.ok(text.includes(needle), `${name} lacks "${needle}"`);
    }
  }
});

test("neither doc makes an unconditional no-credentials claim", () => {
  const forbidden = [
    /no auth and no credential/i,
    /there are no credentials/i,
    /\bno credentials\b/i,
    /API is unauthenticated/i,
  ];
  for (const [name, text] of Object.entries(files)) {
    text.split("\n").forEach((line, i) => {
      for (const re of forbidden) assert.ok(!re.test(line), `${name}:${i + 1} still says ${re}`);
    });
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

test("secret-shape sweep: no 40+ char base64/hex/url-safe run on a line mentioning token, code spans joined", () => {
  for (const [name, text] of Object.entries(files)) {
    text.split("\n").forEach((line, i) => {
      if (!/token/i.test(line)) return;
      // A token split across adjacent code spans (`abc``def`) is one run once the backticks go.
      const joined = line.replace(/`/g, "");
      assert.ok(!/[A-Za-z0-9+\/_=-]{40,}/.test(joined), `${name}:${i + 1} has a 40+ character secret-shaped run on a token line`);
    });
  }
});

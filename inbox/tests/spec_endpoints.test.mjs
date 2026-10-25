// The front-end spec and openapi.yaml name the same endpoints.
// Convention in docs/FRONTEND-SPEC.md: an endpoint is a line that starts with a backtick, a method (GET or POST)
// and a path, and ends there: `GET /runs/{id}`. Query strings are written outside the backticks' path part.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const LINE = /^`(GET|POST) (\/[^`\s?]*)(?:\?[^`\s]*)?`\s*$/;
const norm = (p) => p.replace(/\{[^}]*\}/g, "{}");

export function specEndpoints(text) {
  const out = new Set();
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (m) out.add(`${m[1]} ${norm(m[2])}`);
  }
  return out;
}

async function openapiEndpoints() {
  let yaml;
  try {
    yaml = (await import("yaml")).default ?? (await import("yaml"));
  } catch {
    return null;
  }
  const doc = yaml.parse(readFileSync(join(root, "openapi.yaml"), "utf8"));
  const out = new Set();
  for (const [p, ops] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(ops)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) out.add(`${method.toUpperCase()} ${norm(p)}`);
    }
  }
  return out;
}

test("the spec names at least the core endpoints", () => {
  const spec = specEndpoints(readFileSync(join(root, "docs", "FRONTEND-SPEC.md"), "utf8"));
  for (const e of ["POST /run", "GET /runs/{}", "GET /runs/{}/trace", "GET /runs/{}/journey", "GET /runs/{}/progress", "GET /runs", "GET /queue", "GET /counters", "POST /feedback", "POST /ask"]) {
    assert.ok(spec.has(e), `spec lacks ${e}`);
  }
});

test(
  "spec endpoints equal openapi.yaml paths",
  async (t) => {
    const api = await openapiEndpoints();
    if (!api) return t.skip("the yaml package is not installed");
    const spec = specEndpoints(readFileSync(join(root, "docs", "FRONTEND-SPEC.md"), "utf8"));
    const onlySpec = [...spec].filter((e) => !api.has(e)).sort();
    const onlyApi = [...api].filter((e) => !spec.has(e)).sort();
    if (process.env.SPEC_DIFF) console.log(JSON.stringify({ onlySpec, onlyApi }));
    assert.deepEqual({ onlySpec, onlyApi }, { onlySpec: [], onlyApi: [] });
  },
);

test("(13) the response scenario enum allows legacy and customer_service, apart from the request enum", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "openapi.yaml"), "utf8");
  const m = /\n    ResolvedScenario:\n(?:      .*\n)+/.exec(text);
  assert.ok(m, "ResolvedScenario schema exists");
  assert.match(m[0], /enum: \[[^\]]*\blegacy\b[^\]]*\]/);
  assert.match(m[0], /enum: \[[^\]]*\bcustomer_service\b[^\]]*\]/);
  assert.match(text, /scenario: \{ \$ref: "#\/components\/schemas\/ResolvedScenario" \}/);
  const req = /MessageInput:[\s\S]*?scenario: \{ type: string, enum: \[([^\]]*)\]/.exec(text);
  assert.ok(req && !/legacy|customer_service/.test(req[1]), "the request enum stays the declared set");
});

// Boundary: generated clients must validate /ask answers against the result, not the request shape.
test("POST /ask 200 references AskResult", async (t) => {
  let yaml;
  try { yaml = (await import("yaml")).default; }
  catch { return t.skip("the yaml package is not installed"); }
  const doc = yaml.parse(readFileSync(join(root, "openapi.yaml"), "utf8"));
  assert.equal(doc.paths["/ask"].post.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/AskResult");
});

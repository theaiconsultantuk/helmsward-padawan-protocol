// Sample-mode proof: the server answers the three input examples with no network and no model call.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";

const EXPECT = { 1: "hold", 2: "send", 3: "escalate" };
let server, base, logsDir;

before(async () => {
  const cfg = { ...config(), SAMPLE_MODE: "true", API_TOKEN: "" };
  server = createServer({ cfg, deps: { logsDir: (logsDir = mkdtempSync(join(tmpdir(), "sm-logs-"))), memoryDir: mkdtempSync(join(tmpdir(), "sm-mem-")), runtimeDir: mkdtempSync(join(tmpdir(), "sm-rt-")), dir: mkdtempSync(join(tmpdir(), "sm-dec-")), quiet: true } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

// NO_NETWORK=1 replaces global fetch, so the test client speaks node:http.
const call = (method, path, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
  const req = request(`${base}${path}`, { method, headers: data ? { "Content-Type": "application/json" } : {} }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(t) }));
  });
  req.on("error", reject);
  if (data) req.write(data);
  req.end();
});
const post = (body) => call("POST", "/run", body);

test("NO_NETWORK=1 is in force for this proof", { skip: process.env.NO_NETWORK !== "1" && "run with NO_NETWORK=1 for the proof" }, () => {
  assert.equal(process.env.NO_NETWORK, "1", "run with SAMPLE_MODE=true NO_NETWORK=1");
});

test("GET /health says sample_mode true", async () => {
  const { status, json: j } = await call("GET", "/health");
  assert.equal(status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.sample_mode, true);
  assert.equal(typeof j.version, "string");
  assert.equal(typeof j.uptime_s, "number");
});

for (const n of [1, 2, 3]) {
  test(`example_${n}: ${EXPECT[n]}, nvidia.model skipped with a reason, escalate_or_fallback present`, async () => {
    const input = JSON.parse(readFileSync(join(INBOX_ROOT, "input_examples", `example_${n}.json`), "utf8"));
    const { status, json } = await post({ ...input, run_id: `smtest-${n}-${Date.now().toString(36)}` });
    assert.equal(status, 200);
    assert.equal(json.status, "success");
    assert.equal(json.output.decision, EXPECT[n]);
    assert.ok(Array.isArray(json.agents) && json.agents.length > 0);
    assert.ok(json.trace_id);
    const file = join(logsDir, json.log_file.split("/").pop());
    assert.ok(existsSync(file), `log_file ${json.log_file} exists`);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const nv = lines.filter((l) => l.step === "nvidia.model");
    assert.ok(nv.length > 0, "nvidia.model lines present");
    for (const l of nv) {
      assert.equal(l.status, "skipped");
      assert.ok(l.output_summary && l.output_summary.length > 0, "a skip reason");
    }
    assert.ok(lines.some((l) => l.step === "escalate_or_fallback"), "escalate_or_fallback present (reached or skipped)");
  });
}

test("malformed body: 400 BadRequest, structured error", async () => {
  for (const body of ["{not json", JSON.stringify({ options: {} }), JSON.stringify({ input: { thread_id: "T02", as_of: "yesterday" } })]) {
    const { status, json } = await post(body);
    assert.equal(status, 400);
    assert.equal(json.status, "error");
    assert.equal(json.error.type, "BadRequest");
    assert.equal(typeof json.error.message, "string");
    assert.equal(typeof json.error.recoverable, "boolean");
    assert.ok("execution_time_seconds" in json);
  }
});

test("unknown thread: 404 with a structured error", async () => {
  const { status, json } = await post({ run_id: "smtest-unknown", input: { thread_id: "T999" } });
  assert.equal(status, 404);
  assert.equal(json.status, "error");
  assert.equal(json.run_id, "smtest-unknown");
  assert.equal(json.error.type, "NotFound");
});

test("free-text input runs in sample mode with no network: scenario question, send, intake publish not reached", async () => {
  const { status, json } = await post({ run_id: "smtest-msg", input: { message: "How long does shipping take?", from: "a@example.com", channel: "chat", as_of: "2026-10-20" } });
  assert.equal(status, 200);
  assert.equal(json.status, "success");
  assert.equal(json.scenario, "question");
  assert.equal(json.output.decision, "send");
  const lines = readFileSync(join(logsDir, json.log_file.split("/").pop()), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const pub = lines.find((l) => l.action === "intake_publish");
  assert.ok(pub, "trace has an intake_publish line");
  assert.match(pub.output_summary, /published: false/);
});

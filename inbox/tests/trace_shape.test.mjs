import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Trace, STEPS, STATUSES, mask } from "../src/trace.mjs";

const base = { step: "executor.act", agent_name: "Executor", action: "read_rows", input_summary: "in", output_summary: "out", status: "success" };
const SECRET = "configured-secret-value-1234";

function open(extra = {}, { stdout = false } = {}) {
  const logsDir = mkdtempSync(join(tmpdir(), "trace-test-"));
  return { logsDir, t: Trace.open("demo-001", { logsDir, secrets: [SECRET], stdout, ...extra }) };
}
function fileLines(t) {
  return readFileSync(t.path, "utf8").split("\n").filter(Boolean);
}
function captureStdout(fn) {
  const orig = console.log;
  const got = [];
  console.log = (...a) => got.push(a.join(" "));
  try { fn(); } finally { console.log = orig; }
  return got.join("\n");
}

test("vocabularies have 15 steps and 7 statuses", () => {
  assert.equal(STEPS.length, 15);
  assert.equal(STATUSES.length, 7);
});

test("detail is an optional field: kept when given, absent when not, masked like any string", () => {
  const { t } = open();
  const a = t.line({ ...base, detail: `Soren Adey · Support Agent · ${SECRET}` });
  assert.equal(a.detail, "Soren Adey · Support Agent · [masked]");
  assert.equal(JSON.parse(fileLines(t)[0]).detail, a.detail);
  const b = t.line({ ...base });
  assert.equal("detail" in b, false);
});

test("unknown step throws", () => {
  const { t } = open();
  assert.throws(() => t.line({ ...base, step: "bogus" }), /unknown step/);
});

test("unknown status throws", () => {
  const { t } = open();
  assert.throws(() => t.line({ ...base, status: "great" }), /unknown status/);
});

test("missing required field and bad sponsor throw", () => {
  const { t } = open();
  assert.throws(() => t.line({ ...base, action: undefined }), /missing required/);
  assert.throws(() => t.line({ ...base, sponsor: "acme" }), /sponsor/);
  assert.equal(t.line({ ...base, sponsor: "zetaris" }).sponsor, "zetaris");
});

test("48-char fake token is masked in file and stdout", () => {
  const { t } = open({}, { stdout: true });
  const tok = "aB3".repeat(16);
  assert.equal(tok.length, 48);
  const out = captureStdout(() => t.line({ ...base, output_summary: `token ${tok} leaked` }));
  assert.ok(!out.includes(tok));
  assert.ok(out.includes("[masked]"));
  const f = readFileSync(t.path, "utf8");
  assert.ok(!f.includes(tok));
  assert.ok(f.includes("[masked]"));
});

test("configured secret, Bearer token and sk- token are masked", () => {
  const { t } = open();
  t.line({ ...base, output_summary: `a ${SECRET} b Bearer abcdefgh12345678 c sk-abcdefgh1234`, memory_ids: [SECRET] });
  const f = readFileSync(t.path, "utf8");
  assert.ok(!f.includes(SECRET));
  assert.ok(!f.includes("abcdefgh12345678"));
  assert.ok(!f.includes("sk-abcdefgh1234"));
  assert.ok(f.includes("Bearer [masked]"));
});

test("60-char path and 64-hex signature survive", () => {
  const { t } = open();
  const p = "inbox/judging/traces/trace-demo-recovery-first-run-0001.jsonl";
  assert.ok(p.length >= 60);
  const sig = "0123456789abcdef".repeat(4);
  const l = t.line({ ...base, output_summary: `${p} sig ${sig}` });
  assert.ok(l.output_summary.includes(p));
  assert.ok(l.output_summary.includes(sig));
  assert.ok(readFileSync(t.path, "utf8").includes(sig));
  assert.equal(mask("x".repeat(40) + ".jsonl", []).includes("[masked]"), false);
});

test("one JSON line per call, timestamp Z, close() returns relative log_file", () => {
  const { t } = open();
  t.line(base);
  t.line({ ...base, step: "synthesis" });
  t.line({ ...base, step: "recovery", confidence: 0.5 });
  const lines = fileLines(t);
  assert.equal(lines.length, 3);
  const o = JSON.parse(lines[0]);
  assert.match(o.timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(o.run_id, "demo-001");
  assert.equal(o.trace_id, "demo-001");
  assert.equal(t.lines.length, 3);
  assert.deepEqual(t.close(), { log_file: "logs/trace-demo-001.jsonl", lines: 3 });
});

test("stdout form", () => {
  const { t } = open({}, { stdout: true });
  const out = captureStdout(() => t.line(base));
  assert.equal(out, "[INFO] run_id=demo-001 Executor read_rows: out");
});

test("F1: lower/upper-case bearer tokens are masked", () => {
  for (const w of ["bearer", "BEARER", "Bearer"]) {
    const s = mask(`auth: ${w} abcdef.ghijkl-123`);
    assert.ok(!s.includes("abcdef.ghijkl-123"), s);
    assert.match(s, /Bearer \[masked\]/);
  }
});

test("F2: console line masks a run_id that carries a secret or Bearer token", () => {
  const logsDir = mkdtempSync(join(tmpdir(), "trace-test-"));
  const t1 = Trace.open("topsecretvalue1", { logsDir, secrets: ["topsecretvalue1"], stdout: true });
  const out1 = captureStdout(() => t1.line(base));
  assert.ok(!out1.includes("topsecretvalue1"), out1);
  assert.ok(out1.includes("[masked]"), out1);
  const t2 = Trace.open("run-Bearer abcdefghijkl", { logsDir, secrets: [], stdout: true });
  const out2 = captureStdout(() => t2.line(base));
  assert.ok(!out2.includes("abcdefghijkl"), out2);
  assert.ok(out2.includes("[masked]"), out2);
});

test("duration_ms measures explicit work only; elapsed_ms stays monotonic", async () => {
  const { t } = open();
  const a = t.line(base);
  const started_at = Date.now();
  await new Promise((r) => setTimeout(r, 15));
  const b = t.line({ ...base, step: "synthesis", started_at });
  const c = t.line({ ...base, step: "recovery" });
  assert.ok(a.elapsed_ms >= 0 && a.elapsed_ms < 1000);
  assert.equal(a.duration_ms, 0); // no operation span, so no inherited run time
  for (const l of [a, b, c]) assert.ok(Number.isInteger(l.duration_ms) && l.duration_ms >= 0);
  assert.ok(b.duration_ms >= 10, `slept 15ms, got ${b.duration_ms}`);
  assert.ok(a.elapsed_ms <= b.elapsed_ms && b.elapsed_ms <= c.elapsed_ms);
  assert.equal(c.duration_ms, 0); // a same-millisecond bookkeeping line cannot repeat work
  assert.deepEqual(JSON.parse(fileLines(t)[2]).elapsed_ms, c.elapsed_ms);
  // a second run starts its own clock
  const other = Trace.open("demo-002", { logsDir: t.logsDir, secrets: [], stdout: false });
  assert.ok(other.line(base).elapsed_ms < 1000);
});

test("a buffered line keeps the moment it was recorded: its timestamp is `at`, and `at` is never written out", () => {
  const { t } = open();
  const t0 = Date.now() - 5000;
  const a = t.line({ ...base, at: t0 });
  const b = t.line({ ...base, at: t0 + 1200 });
  assert.equal(a.timestamp, new Date(t0).toISOString());
  assert.equal(a.duration_ms, 0, "recorded before the run started: clamped, never negative");
  assert.equal(b.duration_ms, 0); // at is completion, not an operation start
  assert.equal("at" in a, false);
  assert.equal("at" in JSON.parse(fileLines(t)[1]), false);
  const c = t.line({ ...base, at: t0 + 200 }); // flushed after a later line: its own time, never a negative duration
  assert.equal(c.timestamp, new Date(t0 + 200).toISOString());
  assert.equal(c.duration_ms, 0); // buffer order cannot manufacture work
});

test("lines recorded at t0, t0+100, t0+300 but written in order 0, 300, 100: explicit own spans survive flush order", () => {
  const { t } = open();
  const t0 = t._start + 1000;
  const a = t.line({ ...base, at: t0, started_at: t._start });
  const c = t.line({ ...base, at: t0 + 300, started_at: t0 + 100 });
  const b = t.line({ ...base, at: t0 + 100, started_at: t0 });
  assert.equal(a.duration_ms, 1000); // since the run start
  assert.equal(a.elapsed_ms, 1000);
  assert.equal(c.duration_ms, 200); // only its explicit work span
  assert.equal(c.elapsed_ms, 1300);
  assert.equal(b.duration_ms, 100); // its span is independent of flush order
  assert.equal(b.elapsed_ms, 1100);
  assert.deepEqual([a, b, c].map((l) => l.timestamp), [t0, t0 + 100, t0 + 300].map((x) => new Date(x).toISOString()));
});

// Build F: own spans cannot inherit preceding work or double-count a paired/parallel span.
test("own durations exclude overlap and unmeasured bookkeeping is zero", () => {
  const { t } = open(); const start = t._start;
  const a = t.line({ ...base, at: start + 100, started_at: start });
  const paired = t.line({ ...base, at: start + 100 });
  const parallel = t.line({ ...base, at: start + 150, started_at: start + 50 });
  assert.deepEqual([a.duration_ms, paired.duration_ms, parallel.duration_ms], [100, 0, 50]);
});

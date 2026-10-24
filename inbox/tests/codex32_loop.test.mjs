// Codex review 32 (5ac6442), loop findings: #2 no order facts through memory, #4 no host paths in public text, #5 team and label from one owner,
// #6 an uncertain sentence boundary never cuts a quote, #8 the trust detail describes weight and floor only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_ROOT } from "../src/config.mjs";
import { runMessage, dirs, msg } from "./helpers/route_run.mjs";
import { deriveJourney } from "../src/journey.mjs";
import { quotable, draft } from "../src/adapters/sample.mjs";

const DEMO = JSON.parse(readFileSync(join(INBOX_ROOT, "public", "demo-scenarios.json"), "utf8"));
const everything = (r) => JSON.stringify([r.result, r.lines, deriveJourney(r.result, r.lines)]);

test("#2 an order's facts written by the owner's run never reach a later non-owner run that shares the memory dir", async () => {
  const d = dirs();
  const ask = (from, name, run_id) => runMessage({ message: "Where is my order JP-1001? It was meant to arrive weeks ago.", from, name, channel: "contact-form", scenario: "free_text" }, { as_of: "2026-10-25", run_id, d });
  const owner = await ask("cass.holm@example.com", "Cass Holm", "c32-own");
  assert.equal(owner.result.branch_id, "delivery-suspended");
  assert.match(owner.result.output.draft.text, /Alderaan/, "the owner is told");
  // same display name, other address: recall by name must not carry the order
  for (const [from, name, id] of [["nosy@example.com", "Cass Holm", "c32-a"], ["other@example.com", "Someone Else", "c32-b"]]) {
    const r = await ask(from, name, id);
    assert.equal(r.result.branch_id, "delivery-not-owner", id);
    const all = everything(r);
    for (const w of ["Alderaan", "suspended", "shipping_rules", "FS-", "delivered", "in transit"]) assert.ok(!all.includes(w), `${id}: "${w}" leaked`);
    assert.ok(!/"amount":\s*\d/.test(all) && !/GC/.test(r.result.output.reasons.join(" ")), `${id}: no amount`);
    assert.ok(!r.result.output.draft, "no draft");
  }
  const rec = readFileSync(join(d.memoryDir, readdirOne(d.memoryDir)), "utf8");
  assert.ok(!rec.includes("Alderaan"), "the memory store holds no planet");
});
import { readdirSync } from "node:fs";
const readdirOne = (dir) => readdirSync(dir).find((f) => f.endsWith(".jsonl") || f === "state.json") ?? readdirSync(dir)[0];

test("#4 a queue write failure puts no host path in the trace, the result or the journey", async () => {
  const secret = "/opt/blastworks/hidden-root/data/memory/queue/F9.json";
  const hmem = {
    query: () => ({ memories: [], context: "" }), add: () => ({ id: "mem-x" }),
    queueForHuman: () => { throw Object.assign(new Error(`EACCES: permission denied, open '${secret}' (also C:\\Users\\einh\\mem\\queue\\F9.json)`), { name: "Error" }); },
  };
  const r = await runMessage(msg("I want a refund of 400 GC for my cracked saber", "email", "path.test@email.com", { name: "Pat Hh", scenario: "refund" }), { as_of: "2026-10-25", run_id: "c32-path", extra: { hmem } });
  const all = everything(r);
  assert.ok(r.lines.some((l) => l.status === "error"), "the failure is in the trace");
  assert.ok(!all.includes("/opt/blastworks"), "no absolute host path");
  assert.ok(!all.includes("hidden-root") && !all.includes("C:\\\\Users"), "no path parts");
  assert.match(all, /EACCES: permission denied, open '<path>\/F9\.json'/);
});

test("#4 a one-segment root path (a container volume such as /data) is redacted too", async () => {
  const { redactHostPaths } = await import("../src/loop.mjs");
  assert.equal(redactHostPaths("ENOENT: no such file or directory, mkdir '/data'"), "ENOENT: no such file or directory, mkdir '<path>/data'");
  assert.equal(redactHostPaths("EROFS: open '/app/queue/F1.json' and/or retry"), "EROFS: open '<path>/F1.json' and/or retry");
  assert.equal(redactHostPaths("see https://example.com/docs/page"), "see https://example.com/docs/page");
});

test("#5 s11: a failing or empty hierarchy read never pairs Support with the Product owner's label", async () => {
  const sc = DEMO.find((s) => s.id === "s11");
  const input = { message: sc.message, from: sc.email, name: sc.name, channel: sc.channel, scenario: sc.scenario };
  for (const [label, hierarchy] of [["fails", async () => { throw new Error("hierarchy down"); }], ["no row", async () => ({ objects: [] })], ["null label", async () => ({ objects: [{ employee_id: 15, team: "Support", team_label: null }] })]]) {
    const r = await runMessage(input, { as_of: sc.as_of, run_id: `c32-h-${label.length}`, extra: { hierarchy } });
    const o = r.result.output, j = deriveJourney(r.result, r.lines);
    assert.equal(o.decision, "send");
    for (const [who, team, tl] of [["owner", o.owner.team, o.owner.team_label], ["output", o.team, o.team_label], ["journey", j.team, j.team_label]]) {
      assert.equal(team, "Support", `${label} ${who} team`);
      assert.notEqual(tl, "Gizmo Forge", `${label} ${who} borrowed Product's label`);
      assert.equal(tl, null, `${label} ${who} label stays null`);
    }
  }
});

test("#6 quotable: an abbreviation is not a sentence end", () => {
  const t = (body) => quotable({ subject: `${body.slice(0, 60)}\u2026`, body });
  assert.equal(t("I had a call from Mr. Venn yesterday about my order. Please help."), "I had a call from Mr. Venn yesterday about my order. Please help");
  assert.equal(t("Dr. Who ordered a cloak for St. Mary's school."), "Dr. Who ordered a cloak for St. Mary's school");
  assert.equal(t("It is e.g. a hilt that splits. Please write back."), "It is e.g. a hilt that splits. Please write back");
  assert.equal(t("J. Venn here, my parcel is late. Thanks."), "J. Venn here, my parcel is late. Thanks");
  // too long and uncertain: no quote at all
  assert.equal(t(`Mr. Venn wrote ${"and wrote ".repeat(20)}to us. Thanks.`), null);
  // a certain boundary still quotes the first sentence; decimals are not boundaries
  assert.equal(t("My cloak tore. Mr. Venn knows why."), "My cloak tore");
  assert.equal(t("The cloak costs 4.5 GC. It tore at the seam."), "The cloak costs 4.5 GC");
  const d = draft({ sender_name: "Lee", category: "question", subject: "x", body: "x" }, { category: "question" });
  assert.ok(d.text);
});

test("#8 the trust detail describes weight and floor only", async () => {
  const { run } = await import("../src/queries.mjs");
  const { config } = await import("../src/config.mjs");
  const lines = [];
  const r = await run("trust", { category: "refund" }, { cfg: { ...config(), SAMPLE_MODE: "true" }, trace: { line: (l) => lines.push(l) }, runtimeDir: null }).catch(() => null);
  const text = JSON.stringify(lines);
  if (r) { assert.match(text, /refund: trust weight 0\.55, floor 0\.8/); assert.ok(!/a send needs/.test(text)); }
});

// ---- every public string of a successful run: no absolute host path anywhere ----
const ABS = /(?:^|[\s'"(=:,])(?:\/(?:opt|tmp|home|var|usr|etc|mnt|root|private|Users|srv)\b[^\s'")]*|[A-Za-z]:[\\/][^\s'")]*)/;
function walk(v, path, hits) {
  if (typeof v === "string") { if (ABS.test(v)) hits.push(`${path}: ${v.slice(0, 120)}`); }
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, hits));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, hits);
}
test("a successful run served by the real server carries no absolute host path in POST /run, GET /runs/:id, /trace or /journey", async () => {
  const { createServer } = await import("../src/server.mjs");
  const { config } = await import("../src/config.mjs");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const logsDir = mkdtempSync(join(tmpdir(), "c32-logs-")), memoryDir = mkdtempSync(join(tmpdir(), "c32-mem-")), runtimeDir = mkdtempSync(join(tmpdir(), "c32-rt-"));
  const server = createServer({ cfg: { ...config(), SAMPLE_MODE: "true" }, deps: { logsDir, memoryDir, runtimeDir, quiet: true } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const inputs = [
      { message: "I want a refund of 400 GC for my cracked saber", from: "abs.one@email.com", name: "Abs One", channel: "email", scenario: "refund" },
      { message: "Do you offer gift wrapping?", from: "abs.two@email.com", name: "Abs Two", channel: "chat" },
      { message: "Where is my order JP-1001?", from: "cass.holm@example.com", name: "Cass Holm", channel: "contact-form", scenario: "free_text" },
    ];
    for (const [i, input] of inputs.entries()) {
      const run_id = `c32-abs-${i}`;
      const res = await fetch(`${base}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id, input: { ...input, as_of: "2026-10-25" } }) });
      const post = await res.json();
      assert.equal(post.status, "success", run_id);
      assert.equal(post.log_file, `logs/trace-${run_id}.jsonl`);
      const hits = [];
      walk(post, "POST /run", hits);
      for (const [name, path] of [["GET /runs/:id", ""], ["trace", "/trace"], ["journey", "/journey"]]) walk(await (await fetch(`${base}/runs/${run_id}${path}`)).json(), name, hits);
      assert.deepEqual(hits, [], run_id);
    }
  } finally { server.close(); }
});

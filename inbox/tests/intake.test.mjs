import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { appendIntake, readIntake, publishIntake, intakeSource, INTAKE_HEADER } from "../src/intake.mjs";
import { publish } from "../src/decisions.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "intake-"));
const live = () => config({ SAMPLE_MODE: "false" });

test("cold start writes F1 with the header; the second append is F2", async () => {
  const runtimeDir = tmp();
  const a = await appendIntake({ message: "How long does shipping take?", from: "a@example.com", channel: "chat", received_at: "2026-10-20T09:00:00.000Z" }, { runtimeDir });
  assert.equal(a.thread_id, "F1");
  assert.equal(readFileSync(join(runtimeDir, "intake.csv"), "utf8").split("\n")[0], INTAKE_HEADER.join(","));
  assert.equal(a.row.subject, "How long does shipping take?");
  assert.equal(a.row.sender_email, "a@example.com");
  assert.equal(a.row.sender_name, "");
  const b = await appendIntake({ message: "x".repeat(100), from: "Jo Smith", name: undefined, channel: "email" }, { runtimeDir });
  assert.equal(b.thread_id, "F2");
  assert.ok(b.row.subject.length <= 61 && b.row.subject.endsWith("\u2026"), "a long message gets a label cut with an ellipsis");
  assert.equal(b.row.sender_name, "Jo Smith");
  assert.equal(b.row.sender_email, "");
  assert.equal(b.row.category, "");
  assert.deepEqual(readIntake({ runtimeDir }).map((r) => r.thread_id), ["F1", "F2"]);
});

test("a message with commas, quotes and newlines round-trips", async () => {
  const runtimeDir = tmp();
  const message = 'Hello, "team",\nline two, with a comma\r\nand "quotes" ""';
  await appendIntake({ message, from: "a@example.com", subject: 'Re: "price", please', channel: "email" }, { runtimeDir });
  const [r] = readIntake({ runtimeDir });
  assert.equal(r.body, message);
  assert.equal(r.subject, 'Re: "price", please');
});

test("concurrent appends get distinct ids", async () => {
  const runtimeDir = tmp();
  const ids = (await Promise.all([1, 2, 3].map((i) => appendIntake({ message: `m${i}`, from: "a@example.com", channel: "chat" }, { runtimeDir })))).map((r) => r.thread_id);
  assert.deepEqual(ids.sort(), ["F1", "F2", "F3"]);
});

test("publishIntake and publish run one after the other on the one chain", async () => {
  const runtimeDir = tmp();
  await appendIntake({ message: "hi", from: "a@example.com", channel: "chat" }, { runtimeDir });
  const events = [];
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = async (cmd, args) => { if (args.includes("mkdir")) events.push("start"); await delay(25); };
  const spawnImpl = (cmd, args) => { events.push(`tar:${args.at(-1)}`); return { stdout: {}, on(ev, cb) { if (ev === "close") setImmediate(() => cb(0)); } }; };
  const runSql = async (sql) => { await delay(25); events.push(`end:${/TABLE (\w+)/.exec(sql)[1]}`); };
  const seams = { run, spawnImpl, runSql };
  const [a, b] = await Promise.all([
    publishIntake({ cfg: live(), runtimeDir, ...seams }),
    publish({ dir: runtimeDir, cfg: live(), ...seams }),
  ]);
  assert.deepEqual(a, { published: true, uncached: true });
  assert.equal(b.published, true);
  assert.deepEqual(events, ["start", "tar:intake.csv", "end:intake_runtime", "start", "tar:decisions.csv", "end:decisions"]);
});

test("publishIntake with docker failing reports the error and does not throw", async () => {
  const runtimeDir = tmp();
  await appendIntake({ message: "hi", from: "a@example.com", channel: "chat" }, { runtimeDir });
  const r = await publishIntake({ cfg: live(), runtimeDir, run: async () => { throw new Error("spawn docker ENOENT"); } });
  assert.equal(r.published, false);
  assert.match(r.error, /spawn docker ENOENT/);
});

test("sample mode publishes nothing; intakeSource maps the flag", async () => {
  const r = await publishIntake({ cfg: config({ SAMPLE_MODE: "true" }), runtimeDir: tmp() });
  assert.equal(r.published, false);
  assert.equal(intakeSource(true), "zetaris");
  assert.equal(intakeSource(false), "local");
});

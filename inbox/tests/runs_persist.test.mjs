// A restart must not blank the desk: finished runs are saved under <runtimeDir>/runs and reloaded; /queue says who holds each ticket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { createServer, runs } from "../src/server.mjs";

const dir = mkdtempSync(join(tmpdir(), "rp-runtime-"));
const logsDir = mkdtempSync(join(tmpdir(), "rp-logs-"));
const memoryDir = mkdtempSync(join(tmpdir(), "rp-mem-"));
const boot = async () => {
  const server = createServer({ cfg: config({ API_TOKEN: "", SAMPLE_MODE: "true" }), deps: { dir, runtimeDir: dir, logsDir, memoryDir, quiet: true, publish: async () => ({ published: true }) } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

test("a run, its queue row and its holder survive a restart", async () => {
  let { server, base } = await boot();
  const r = await fetch(base + "/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    input: { message: "The Strand Emitter Hilt split open in my hands and I have spoken to my lawyer. If I do not hear from you I will sue.", from: "restarttest@email.com", channel: "contact-form" }, options: { sample_mode: true } }) });
  const run = await r.json();
  assert.equal(run.status, "success");
  const id = run.run_id;
  const q1 = await (await fetch(base + "/queue")).json();
  const row1 = q1.find((x) => x.run_id === id || x.ticket_id === run.input?.thread_id);
  assert.ok(row1, "queued before the restart");
  assert.ok(row1.holder && row1.holder.employee_id != null, "holder says who has it");
  assert.ok(readdirSync(join(dir, "runs")).some((f) => f.startsWith(id)), "run file written");
  await new Promise((res) => server.close(res));

  runs.clear();   // the process forgot everything
  ({ server, base } = await boot());
  try {
    const got = await fetch(base + `/runs/${id}`);
    assert.equal(got.status, 200, "run served after restart");
    assert.equal((await got.json()).run_id, id);
    const list = await (await fetch(base + "/runs")).json();
    assert.ok(list.some((x) => x.run_id === id && x.at), "listed with its time");
    const q2 = await (await fetch(base + "/queue")).json();
    const row2 = q2.find((x) => x.run_id === id);
    assert.ok(row2 && row2.holder?.employee_id === row1.holder.employee_id, "same holder and run link after restart");
  } finally { await new Promise((res) => server.close(res)); }
});

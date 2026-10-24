import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { liveZetaris } from "./helpers/live_zetaris.mjs";

const INBOX = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = join(INBOX, "scripts", "zetaris_usl.sql");
const EXPECTED = ["employee", "customer", "ticket", "product", "policy", "responsibility", "faq", "holiday", "intake", "review", "decision", "wiki_page", "hierarchy", "client", "sales_order", "shipping_rule", "bulk_tier", "bom_part", "channel"];
const NS = "lightning.metastore.jedi_pack";

test("committed SQL declares the expected tables and every foreign key resolves", () => {
  const sql = readFileSync(SQL, "utf8");
  const names = [...sql.matchAll(/CREATE TABLE (\w+) \(/g)].map((m) => m[1]);
  assert.deepEqual(names, EXPECTED);
  for (const m of sql.matchAll(/REFERENCES (\w+)\(/g)) assert.ok(names.includes(m[1]), `FK target ${m[1]} is not a table`);
  assert.equal([...sql.matchAll(/ACTIVATE USL TABLE/g)].length, EXPECTED.length);
  assert.match(sql, /DDL CREATE TABLE employee/);
});

test("register_usl.mjs --print regenerates the committed SQL byte-equal", () => {
  const before = readFileSync(SQL);
  execFileSync(process.execPath, [join(INBOX, "scripts", "register_usl.mjs"), "--print"], { stdio: "pipe" });
  const after = readFileSync(SQL);
  assert.ok(before.equals(after), "scripts/zetaris_usl.sql drifted from register_usl.mjs");
});

const { live, why } = await liveZetaris();
test("live: the USL lists its tables and employee follows the raw count", { skip: live ? false : why }, async () => {
  const { config } = await import("../src/config.mjs");
  const zetaris = await import("../src/adapters/zetaris.mjs");
  const cfg = config();
  const shown = await zetaris.sqlRun(`SHOW TABLES IN ${NS}`, { cfg, limit: 100 });
  const listed = shown.rows.map((r) => String(r[0]).split(".").pop());
  for (const t of EXPECTED) assert.ok(listed.includes(t), `${t} missing from SHOW TABLES`);
  const usl = Number((await zetaris.sqlRun(`SELECT COUNT(*) FROM ${NS}.jedi_pack.employee`, { cfg })).rows[0][0]);
  const raw = Number((await zetaris.sqlRun("SELECT COUNT(*) FROM JEDI_PACK.employees", { cfg })).rows[0][0]);
  assert.equal(usl, raw);
});

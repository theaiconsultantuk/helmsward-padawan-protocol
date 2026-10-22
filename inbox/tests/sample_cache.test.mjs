import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { INBOX_ROOT, config } from "../src/config.mjs";
import { factsForTicket, wikiFor, counters } from "../src/queries.mjs";

const cfg = config({ SAMPLE_MODE: "true", SAMPLE_DIR: join(INBOX_ROOT, "data", "sample") });

test("T02 facts match live", async () => {
  const f = await factsForTicket("T02", { cfg });
  assert.equal(f.category_weight, 0.55);
  assert.equal(f.floor, 0.8);
  assert.equal(f.owner_out, true);
  assert.equal(f.backup_out, false);
  assert.equal(f.amount_usd, 40);
});

test("T03 is 400 over 150", async () => {
  const f = await factsForTicket("T03", { cfg });
  assert.equal(f.amount_usd, 400);
  assert.equal(f.policy_limit_usd, 150);
});

test("wiki row has a preview; counters are zero", async () => {
  const rows = await wikiFor("refund.request", { cfg });
  assert.ok(rows.length >= 1 && typeof rows[0].preview === "string" && rows[0].preview.length > 0);
  const c = await counters({ cfg });
  assert.equal(c.send + c.hold + c.escalate + c.queued + c.affirmed + c.rejected, 0);
});

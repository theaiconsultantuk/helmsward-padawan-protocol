// Scoped facts gather (factsForTicket with `needs`) and the default contact desk. Every call passes an explicit as_of.
import { test } from "node:test";
import assert from "node:assert/strict";
import { factsForTicket, validate, TEMPLATES, TABLES, TOPICS } from "../src/queries.mjs";
import { queryByName } from "../src/adapters/sample.mjs";
import { config } from "../src/config.mjs";

const cfg = config({ SAMPLE_MODE: "true" });
const intakeRow = (over = {}) => ({ thread_id: "F1", received_at: "2026-10-20T09:00:00.000Z", channel: "chat", sender_name: "", sender_email: "a@example.com",
  subject: "hello", body: "hello", scenario: "", category: "", ...over });

// records the template names (and params) of every read; `failContact` makes the contact read throw
function spy({ failContact = false } = {}) {
  const calls = [];
  const sqlRunImpl = async (sql, opts) => {
    calls.push({ name: opts.name, params: opts.params });
    if (failContact && opts.name === "contact") throw Object.assign(new Error("zetaris: HTTP 400"), { name: "BadResponse" });
    return queryByName(opts.name, opts.params, { cfg });
  };
  return { calls, names: () => calls.map((c) => c.name), sqlRunImpl };
}
const scoped = (topic, as_of, needs, extra = {}, s = spy()) =>
  factsForTicket("F1", { ticketSource: "intake", intakeRow: intakeRow(), topic, as_of, cfg, needs, sqlRunImpl: s.sqlRunImpl, ...extra }).then((facts) => ({ facts, s }));

test("scoped complaint, owner in: one holiday, one employee, no policy, no holidays", async () => {
  const { facts: f, s } = await scoped("complaint", "2026-10-20", []);
  assert.deepEqual(s.names(), ["responsibility", "holiday", "employee", "trust", "wiki"]);
  assert.ok(!f.cited_rows.some((c) => c.startsWith("policy:")));
  assert.equal(f.policy_limit_usd, null);
  assert.equal(f.owner_id, 5); assert.equal(f.backup_id, 6);
  assert.ok(f.owner_name); assert.equal(f.backup_name, null);
  assert.equal(f.owner_out, false); assert.equal(f.backup_out, false);
  assert.equal(f.fallback_contact, null);
});

test("scoped complaint, owner out, backup in: backup holiday and record read lazily", async () => {
  const { facts: f, s } = await scoped("complaint", "2026-01-05", []);
  assert.deepEqual(s.names(), ["responsibility", "holiday", "holiday", "employee", "employee", "trust", "wiki"]);
  const hols = s.calls.filter((c) => c.name === "holiday");
  assert.equal(hols[0].params.employee_id, 5);
  assert.equal(hols[1].params.employee_id, 6);
  assert.equal(f.owner_out, true); assert.equal(f.backup_out, false);
  assert.ok(f.backup_name);
  assert.equal(f.fallback_contact, null);
});

test("scoped complaint, both out: the default contact is read once, after both holidays", async () => {
  const { facts: f, s } = await scoped("complaint", "2026-09-29", []);
  assert.deepEqual(s.names(), ["responsibility", "holiday", "holiday", "employee", "employee", "contact", "trust", "wiki"]);
  assert.deepEqual(s.calls.find((c) => c.name === "contact").params, { topic: "default" });
  assert.deepEqual(f.fallback_contact, { email: "contact@jedipack.com", label: "Jedi Pack contact desk", cited: "contacts:default" });
  assert.equal(f.cited_rows.at(-1), "contacts:default");
  assert.ok(f.owner_out && f.backup_out);
});

test("scoped, both out, contact read throws: facts still return, fallback null, one error line traced", async () => {
  const lines = [];
  const s = spy({ failContact: true });
  const { facts: f } = await scoped("complaint", "2026-09-29", [], { trace: { line: (l) => lines.push(l) } }, s);
  assert.equal(f.fallback_contact, null);
  assert.ok(f.owner_out && f.backup_out);
  const errs = lines.filter((l) => l.status === "error");
  assert.equal(errs.length, 1);
  assert.equal(errs[0].action, "sql:contact");
});

test("every scoped read carries a why in the plan's voice", async () => {
  const lines = [];
  await scoped("complaint", "2026-09-29", [], { trace: { line: (l) => lines.push(l) } });
  const text = lines.map((l) => l.input_summary).join("\n");
  assert.match(text, /owner for complaint: responsibility:complaint/);
  assert.match(text, /backup: owner 5 out on 2026-09-29/);
  assert.match(text, /default contact: owner 5 and backup 6 both out on 2026-09-29/);
});

test("scoped refund with needs [limit]: policy first, over/under-limit owners, limit set", async () => {
  const over = await scoped("refund", "2026-10-20", ["limit"], { amount: 400 });
  assert.equal(over.s.names()[0], "policy");
  assert.equal(over.facts.owner_id, 3); assert.equal(over.facts.backup_id, 4);
  assert.equal(over.facts.policy_limit_usd, 150);
  assert.ok(over.facts.cited_rows.includes("policy:refund"));
  assert.ok(over.facts.cited_rows.includes("amount from the message"));
  const under = await scoped("refund", "2026-10-20", ["limit"], { amount: 50 });
  assert.equal(under.facts.owner_id, 15);
  assert.ok(!under.s.names().includes("holidays"));
});

test("scoped rfq (needs []): no policy read, owner 6 / backup 14", async () => {
  const { facts: f, s } = await scoped("rfq", "2026-10-20", []);
  assert.ok(!s.names().includes("policy"));
  assert.equal(f.owner_id, 6); assert.equal(f.backup_id, 14);
  assert.ok(f.cited_rows.includes("responsibility:rfq"));
});

test("legacy T02 (needs undefined): the query order is pinned, fallback_contact null", async () => {
  const s = spy();
  const f = await factsForTicket("T02", { cfg, sqlRunImpl: s.sqlRunImpl });
  assert.deepEqual(s.names(), ["thread", "policy", "responsibility", "holiday", "holiday", "employee", "employee", "trust", "wiki"]);
  assert.equal(f.fallback_contact, null);
});

test("legacy path, nobody in (einh's pick B): one contact read after the employees, before the trust row", async () => {
  const s = spy();
  const g = await factsForTicket("F1", { ticketSource: "intake", intakeRow: intakeRow(), topic: "complaint", as_of: "2026-09-29", cfg, sqlRunImpl: s.sqlRunImpl });
  assert.ok(g.owner_out && g.backup_out);
  const n = s.names();
  assert.equal(n.filter((x) => x === "contact").length, 1);
  assert.equal(n.indexOf("contact"), n.lastIndexOf("employee") + 1);
  assert.ok(n.indexOf("contact") < n.indexOf("trust"));
  assert.deepEqual(g.fallback_contact, { email: "contact@jedipack.com", label: "Jedi Pack contact desk", cited: "contacts:default" });
  assert.equal(g.cited_rows.at(-1), "contacts:default");
});

test("invariant sweep: scoped runs without limit never read policy or the holidays table", async () => {
  let declared = {};
  try { declared = (await import("../src/scenarios.mjs")).FACT_NEEDS ?? {}; } catch { declared = {}; }
  const lists = [[], ...Object.entries(declared).filter(([k]) => k !== "refund").map(([, v]) => v)];
  for (const needs of lists) {
    for (const topic of ["complaint", "rfq", "customer_service", "question"]) {
      for (const as_of of ["2026-10-20", "2026-01-05", "2026-09-29"]) {
        const { facts, s } = await scoped(topic, as_of, needs);
        if (!needs.includes("limit")) {
          assert.ok(!JSON.stringify(facts).includes("policy:"), `${topic} ${as_of}`);
          assert.ok(!s.names().includes("policy") && !s.names().includes("holidays"), `${topic} ${as_of}`);
        }
      }
    }
  }
});

test("contact template: validator, sql, raw layer, TABLES, TOPICS untouched", () => {
  assert.throws(() => validate("contact", { topic: "x'; DROP" }), TypeError);
  assert.doesNotThrow(() => validate("contact", { topic: "default" }));
  assert.doesNotThrow(() => validate("contact", { topic: "complaint" }));
  assert.equal(TEMPLATES.contact.sql({ topic: "default" }), "SELECT * FROM JEDI_PACK.contacts WHERE topic = 'default'");
  assert.equal(TEMPLATES.contact.layer, undefined);
  assert.ok(TABLES.includes("contacts"));
  assert.ok(!TOPICS.includes("default"));
});

// Codex review 7, MEDIUM: an absent backup counts as out when the owner is out, so nobody-in is one predicate everywhere.
test("owner out and no backup on the policy row: backup_out true and the contact desk is read", async () => {
  const s = spy();
  const base = s.sqlRunImpl;
  s.sqlRunImpl = async (sql, opts) => {
    if (opts.name === "policy") return { headers: ["topic", "limit_amount", "currency", "under_limit_owner_id", "under_limit_backup_id", "over_limit_owner_id", "over_limit_backup_id"], rows: [["refund", "150.00", "USD", "15", "", "3", "4"]], total: 1 };
    return base(sql, opts);
  };
  // employee 15 is out on 2026-01-27 (and 16 is not, which no longer matters: there is no backup)
  const { facts } = await scoped("refund", "2026-01-27", ["limit"], { amount: 50 }, s);
  assert.equal(facts.owner_id, 15);
  assert.equal(facts.backup_id, null);
  assert.equal(facts.owner_out, true);
  assert.equal(facts.backup_out, true);
  assert.equal(facts.fallback_contact?.email, "contact@jedipack.com");
  assert.equal(s.names().filter((n) => n === "holiday").length, 1, "no backup to look up");
});

// Builds public/shop/data/approval-chain.json from the synthetic CSVs: who signs what, and who stands in when the owner is out.
// Only the people the chains need are written, not the whole staff list. Run: node scripts/build_approval_chain.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = (f) => { const [h, ...r] = readFileSync(join(root, "data/synthetic", f), "utf8").trim().split(/\r?\n/); const k = h.split(","); return r.map((l) => Object.fromEntries(l.split(",").map((v, i) => [k[i], v]))); };
const emp = Object.fromEntries(rows("employees.csv").map((e) => [e.employee_id, e]));
const hier = rows("companyhierarchy.csv");
const policy = rows("policy.csv");
const resp = rows("responsibility.csv");
const headOf = (team) => hier.find((h) => h.role === `Head of ${team}`)?.employee_id;

const FINANCE = headOf("Finance");   // the second signature on money over the limit
const need = new Set([FINANCE]);
const topics = {};
for (const p of policy) {
  topics[p.topic] = { limit: Number(p.limit_amount), currency: p.currency, owner: p.under_limit_owner_id, backup: p.under_limit_backup_id, over_owner: p.over_limit_owner_id, over_backup: p.over_limit_backup_id };
  [p.under_limit_owner_id, p.under_limit_backup_id, p.over_limit_owner_id, p.over_limit_backup_id].forEach((i) => need.add(i));
}
const desks = {};
for (const r of resp) { desks[r.topic] = { owner: r.owner_id, backup: r.backup_id, label: r.label }; need.add(r.owner_id); need.add(r.backup_id); }
const people = {};
for (const id of need) { const e = emp[id]; const h = hier.find((x) => x.employee_id === id); if (e) people[id] = { name: `${e.given_name} ${e.family_name}`, email: e.email, team: e.team, role: h?.role || e.role }; }
const out = {
  note: "Built by scripts/build_approval_chain.mjs from employees.csv, policy.csv, responsibility.csv and companyhierarchy.csv. The signing flow that uses it is a simulation.",
  second_signer: { id: FINANCE, why: "Money over the policy limit needs the over-limit owner and the Head of Finance (a proposed rule; not enforced by the agent)" },
  topics, desks, people,
};
writeFileSync(join(root, "public/shop/data/approval-chain.json"), JSON.stringify(out, null, 1) + "\n");
console.log("approval-chain.json:", Object.keys(people).length, "people,", Object.keys(topics).length, "policy topics, second signer", people[FINANCE]?.name);

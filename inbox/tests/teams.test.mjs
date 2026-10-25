import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHOP = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "shop");
const read = (f) => readFileSync(join(SHOP, f), "utf8");

test("teams view: deadlines are labelled proposed, heads and CEO present, default exists", () => {
  const d = JSON.parse(read("data/deadlines.json"));
  assert.equal(d.status, "proposed");
  assert.ok(d.hours["default"] > 0 && d.hours.refund === 4 && d.hours.complaint === 2 && d.hours.legal === 1);
  assert.equal(d.heads.Support.name, "Mei-Ling Zhao");
  assert.equal(d.heads.Legal.employee_id, 202);
  assert.equal(d.ceo.employee_id, 201);
});

test("teams view: wired into the desk, text only, simulation stated", () => {
  const html = read("desk.html"), js = read("js/teams.js");
  assert.ok(html.includes("css/teams.css") && html.includes("js/teams.js") && html.includes('id="teams"'));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js));
  assert.ok(/Escalation is simulated/.test(js) && /1 min = 1 day/.test(js));
  assert.ok(js.indexOf("1440") > 0 && read("js/desk.js").includes("JP_TEAMS.render"));
});

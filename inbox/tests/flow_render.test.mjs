// Tests for public/shop/js/flow-render.js (JP_FLOW): pure functions on committed traces, plus the DOM builders on a tiny fake doc.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { deriveJourney, labelFor } from "../src/journey.mjs";

assert.equal(typeof globalThis.document, "undefined", "no document at load time");
globalThis.window = globalThis;
await import("../public/shop/js/flow-render.js");
const F = globalThis.JP_FLOW;

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = `${ROOT}public/shop/js/flow-render.js`;
const readLines = (id) =>
  readFileSync(`${ROOT}judging/traces/trace-${id}.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ex4 = JSON.parse(readFileSync(`${ROOT}output_examples/example_4.json`, "utf8"));

// 4-sample: the cited ids are the ones the trace's executor.act line names, plus the FAQ hit the canonical reply used
// (as output_examples/example_4.json shows for the same route).
const lines4 = readLines("scenario-4-sample");
const act4 = lines4.find((l) => l.step === "executor.act");
const cited4 = F.factsOf({ route: act4.output_summary }).cited;
const result4 = { ...ex4, run_id: "scenario-4-sample", output: { ...ex4.output, cited_rows: [...cited4, "faq:Q01"] } };
const j4 = deriveJourney(result4, lines4);
const lines8 = readLines("scenario-8-live");
const j8 = deriveJourney({ run_id: "scenario-8-live", output: { decision: "escalate", cited_rows: [] } }, lines8);
const linesH = readLines("hero-live");
const jH = deriveJourney({ run_id: "hero-live", output: { decision: "escalate", cited_rows: [] } }, linesH);
const threeTraces = [["4-sample", j4, lines4], ["8-live", j8, lines8], ["hero-live", jH, linesH]];

const CODE = new Set(["sample/rules", "rules", "none", "faq/canonical", "template/acknowledgement"]);

test("invariant on every committed trace: no label names a model the node lacks, no model call is labelled code", () => {
  const files = readdirSync(`${ROOT}judging/traces`).filter((f) => f.endsWith(".jsonl"));
  assert.ok(files.length > 30);
  let nodes = 0;
  let modelCalls = 0;
  for (const f of files) {
    const lines = readFileSync(`${ROOT}judging/traces/${f}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const n of deriveJourney({}, lines).nodes) {
      nodes++;
      const t = F.techOf(n);
      assert.ok(t.model === null || t.model === n.model, `${f} #${n.n}: label model ${t.model} vs node ${n.model}`);
      if (typeof n.model === "string" && n.model && !CODE.has(n.model)) {
        modelCalls++;
        assert.equal(t.model, n.model, `${f} #${n.n}: model call not shown`);
        assert.ok(!["rules", "planner", "hmem", "zetaris", "meterless"].includes(t.tech), `${f} #${n.n}: model call labelled ${t.tech}`);
        assert.ok(["nightshift", "openjev", "local"].includes(t.tech), `${f} #${n.n}: label ${t.label}`);
      }
    }
  }
  assert.ok(nodes > 500 && modelCalls > 20, `${nodes} nodes, ${modelCalls} model calls`);
});

test("techOf on the committed lines", () => {
  const gates8 = j8.nodes.find((n) => n.model === "openjev-0.1 (openjev-0.1)" && n.agent === "Gates");
  assert.deepEqual(F.techOf(gates8), { tech: "openjev", label: "OpenJev · NVIDIA DiffusionGemma", model: "openjev-0.1 (openjev-0.1)" });
  const gates4 = j4.nodes.find((n) => n.agent === "Gates");
  assert.equal(F.techOf(gates4).tech, "rules");
  assert.equal(F.techOf(gates4).model, null);
  const drafter8 = j8.nodes.find((n) => n.agent === "Drafter");
  assert.equal(F.techOf(drafter8).tech, "nightshift");
  assert.equal(F.techOf(drafter8).model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(F.techOf(j8.nodes.find((n) => n.agent === "Severity")).tech, "openjev");
  assert.equal(F.techOf(j8.nodes.find((n) => n.agent === "Reader")).tech, "nightshift");
  assert.equal(F.techOf(j8.nodes.find((n) => n.agent === "WorldModel")).label, "Meterless · World Model");
  assert.equal(F.techOf(j8.nodes.find((n) => n.step === "meterless.engine" && n.agent === "Scout")).label, "Meterless · Scout engine");
  assert.equal(F.techOf(j8.nodes.find((n) => n.step === "risk.signoff")).tech, "rules");
  assert.equal(F.techOf(j8.nodes.find((n) => n.step === "memory.read")).tech, "hmem");
  assert.equal(F.techOf(j4.nodes.find((n) => n.agent === "Drafter")).tech, "rules"); // FAQ canonical text, no model call
  assert.equal(F.techOf(j4.nodes.find((n) => n.label === "Zetaris: the FAQ")).tech, "zetaris");
});

test("techOf on synthetic nodes", () => {
  const local = "webllm/Llama-3.2-1B-Instruct-q4f16_1-MLC";
  const d = F.techOf({ agent: "Drafter", step: "nvidia.model", model: local });
  assert.deepEqual([d.tech, d.model], ["nightshift", local]);
  const p = F.techOf({ agent: "Planner", step: "planner.plan", model: local });
  assert.deepEqual([p.tech, p.model], ["local", local]);
  const r = F.techOf({ agent: "RefundReader", step: "nvidia.model", model: "nvidia/nemotron-3.5-lightning-30b-a3b" });
  assert.deepEqual([r.tech, r.model], ["nightshift", "nvidia/nemotron-3.5-lightning-30b-a3b"]);
  assert.equal(F.techOf({ agent: "Gates", model: "sample/rules" }).tech, "rules");
  assert.equal(F.techOf({ agent: "Drafter", model: "faq/canonical" }).tech, "zetaris");
  assert.equal(F.techOf({ agent: "Drafter", model: "template/acknowledgement" }).label, "Code template");
  assert.equal(F.techOf({}).tech, "planner");
  assert.equal(F.techOf(null).tech, "planner");
  // a model on a node that would otherwise be code (Zetaris, Risk, Scout) is still shown as a model call
  const z = F.techOf({ step: "zetaris.query", tech: "Zetaris", model: local });
  assert.equal(z.model, local);
});

test("drift: techOf against Plan 1's node.tech (agree on Zetaris and H-MEM; the rest is printed)", (t) => {
  const mapped = (tech) => {
    if (tech === "Zetaris") return "zetaris";
    if (tech === "H-MEM") return "hmem";
    if (/^OpenJev/.test(tech)) return "openjev";
    if (/^Nightshift/.test(tech)) return "nightshift";
    if (/^Meterless/.test(tech)) return "meterless";
    if (tech === "rules") return "rules";
    return null; // "not run", "unknown": no counterpart
  };
  const disagree = [];
  let pairs = 0;
  for (const [name, j] of threeTraces) {
    for (const n of j.nodes) {
      pairs++;
      const mine = F.techOf(n).tech;
      const theirs = mapped(n.tech);
      if (n.tech === "Zetaris") assert.equal(mine, "zetaris", `${name} #${n.n}`);
      if (n.tech === "H-MEM") assert.equal(mine, "hmem", `${name} #${n.n}`);
      if (theirs !== null && theirs !== mine) disagree.push(`${name} #${n.n} ${n.agent}/${n.step} model=${n.model}: Plan 1 "${n.tech}" vs here "${mine}"`);
      if (theirs === null && n.tech !== "not run") disagree.push(`${name} #${n.n} ${n.agent}/${n.step}: Plan 1 "${n.tech}" has no counterpart (here "${mine}")`);
    }
  }
  t.diagnostic(`drift: ${pairs} nodes, ${disagree.length} disagreements`);
  console.log(`# drift: ${pairs} nodes, ${disagree.length} disagreements`);
  for (const d of disagree) console.log(`#   ${d}`);
});

test("contract drift: lines journey.labelFor calls Typed gates / Draft are openjev-or-rules / nightshift here", () => {
  let gates = 0;
  let drafts = 0;
  for (const [name, j, lines] of threeTraces) {
    j.nodes.forEach((n, i) => {
      assert.equal(n.label, labelFor(lines[i].step, lines[i]));
      if (n.label === "Typed gates") {
        gates++;
        assert.ok(["openjev", "rules"].includes(F.techOf(n).tech), `${name} #${n.n}`);
        assert.notEqual(F.techOf(n).tech, "nightshift");
      }
      if (n.label === "Draft" && n.model && !CODE.has(n.model)) {
        drafts++;
        assert.equal(F.techOf(n).tech, "nightshift");
      }
    });
  }
  assert.ok(gates >= 3 && drafts >= 2);
});

test("statusText, durationOf, fmtMs", () => {
  for (const [, j] of threeTraces) {
    for (const n of j.nodes) {
      assert.equal(F.statusText(n), n.status);
      assert.equal(F.durationOf(n), typeof n.duration_ms === "number" ? n.duration_ms : null);
    }
  }
  const skipped = j4.nodes.find((n) => n.status === "skipped");
  assert.equal(F.statusSub(skipped), "not called");
  assert.equal(F.statusSub(j4.nodes[0]), "");
  assert.equal(F.durationOf({ duration_ms: null }), null);
  assert.equal(F.durationOf({}), null);
  assert.equal(F.fmtMs(94), "94 ms");
  assert.equal(F.fmtMs(49200), "49.2 s");
  assert.equal(F.fmtMs(null), "—");
});

test("foldRows on 8-live removes every sql_run timing line and carries the query's own ms", () => {
  const timing = j8.nodes.filter((n) => n.agent === "Scout" && /rows in \d+ ms$/.test(n.route));
  assert.ok(timing.length >= 10);
  const folded = F.foldRows(j8.nodes);
  assert.equal(folded.length, j8.nodes.length - timing.length);
  assert.equal(folded.filter((n) => n.agent === "Scout" && /rows in \d+ ms$/.test(n.route)).length, 0);
  // the committed trace carries "intake_thread: 1 rows in 94 ms" right before its sql: line
  const intake = timing.find((n) => /^intake_thread: 1 rows in (\d+) ms$/.test(n.route));
  const q = folded.find((n) => n.route === "1 rows: intake_runtime:F30");
  assert.equal(q.query_ms, Number(/in (\d+) ms/.exec(intake.route)[1]));
  assert.equal(q.query_ms, 94);
  // durations are summed when known, null when neither is known
  assert.equal(F.foldRows([{ agent: "Scout", route: "x: 1 rows in 5 ms", duration_ms: 3 }, { agent: "Executor", step: "zetaris.query", tech: "Zetaris", duration_ms: 4 }])[0].duration_ms, 7);
  assert.equal(F.foldRows([{ agent: "Scout", route: "x: 1 rows in 5 ms", duration_ms: null }, { agent: "Executor", step: "zetaris.query", tech: "Zetaris", duration_ms: null }])[0].duration_ms, null);
  // a timing node with no partner stays
  const lone = [{ agent: "Scout", step: "zetaris.query", route: "x: 1 rows in 5 ms" }];
  assert.equal(F.foldRows(lone).length, 1);
  // 4-sample has no sql_run lines: nothing folds
  assert.equal(F.foldRows(j4.nodes).length, j4.nodes.length);
});

test("factsOf and detailFor on 4-sample (what the committed trace carries)", () => {
  const act = j4.nodes.find((n) => n.step === "executor.act");
  const f = F.factsOf(act);
  assert.deepEqual(f.cited, cited4);
  assert.equal(f.cited.length, 8); // the trace says "8 rows cited"
  assert.equal(f.amount, "none");
  assert.equal(f.limit, "?");
  assert.equal(f.owner, "5 in");
  assert.equal(f.backup, "13 in");
  assert.equal(f.duplicate, "none");
  assert.equal(f.other, undefined);
  assert.deepEqual(F.factsOf({ route: "2 rows cited: a, b; something odd" }), { cited: ["a", "b"], other: ["something odd"] });
  assert.deepEqual(F.factsOf({}), {});
  assert.equal(F.detailFor("employees:5", j4.nodes), "Priya Raman · Product Specialist · Product");
  assert.equal(F.detailFor("employees:999", j4.nodes), null);
  // hero-live names two employees
  assert.equal(F.detailFor("employees:4", jH.nodes), "Nia Calder · People Partner · People");
});

test("faqHit and outcomeOf on 4-sample", () => {
  const faq = j4.nodes.find((n) => n.label === "Zetaris: the FAQ");
  const hit = F.faqHit(faq, j4);
  assert.deepEqual(hit.hits.map((h) => h.id), ["faq:Q01"]);
  assert.equal(hit.found, true);
  const scanned = Number(/^(\d+) rows/.exec(faq.route)[1]);
  assert.equal(hit.scanned, scanned);
  assert.equal(hit.scanned, 18); // the committed trace scanned 18 FAQ rows
  assert.match(hit.meaning, /^FAQ Q01 matches/);
  F.faqIndex["faq:Q01"] = "How long does shipping take?";
  assert.match(F.faqHit(faq, j4).hits[0].text, /Q01 · How long does shipping take\?/);
  F.faqIndex = {};
  // no hit: the count and the branch's reason
  const miss = F.faqHit({ route: "18 rows: faq:Q01", retained: [], returned: [] }, j4);
  assert.equal(miss.found, false);
  assert.match(miss.meaning, /^no match among 18 rows/);
  const o = F.outcomeOf(j4.nodes.find((n) => n.step === "synthesis"));
  assert.deepEqual([o.decision, o.cited], ["send", 8]);
  assert.equal(o.log_file, "logs/trace-scenario-4-sample.jsonl");
  assert.equal(F.outcomeOf({}).decision, null);
});

test("stateOf and routeOf", () => {
  assert.equal(F.stateOf(j4).kind, "auto");
  assert.equal(F.stateOf(j4).canSend, false);
  assert.equal(F.stateOf(jH).kind, "none"); // trace + bare result: no queued_for, no draft text
  const q = { owner_id: 5, owner_name: "Priya Raman", role: "Product Specialist" };
  const draft = deriveJourney({ run_id: "d", output: { decision: "hold", draft: { text: "Hello [[blank: order number]]" }, queued_for: q, team: "Product", team_label: "Product desk", cc: [{ id: 6, name: "Backup Person", role: "Lead", email: "b@example.com" }], recommendation: "Check the order." } }, []);
  assert.equal(F.stateOf(draft).kind, "draft");
  assert.equal(F.stateOf(draft).canSend, true);
  const rt = F.routeOf(draft);
  assert.deepEqual([rt.to.name, rt.to.role, rt.to.team, rt.to.team_label], ["Priya Raman", "Product Specialist", "Product", "Product desk"]);
  assert.equal(rt.cc.length, 1);
  assert.equal(rt.note, "Check the order.");
  assert.equal("courtesy_reply" in rt, false);
  const esc = deriveJourney({ run_id: "e", output: { decision: "escalate", queued_for: q } }, []);
  assert.equal(F.stateOf(esc).kind, "route");
  assert.equal(F.stateOf(esc).canSend, false);
  const escText = deriveJourney({ run_id: "e", output: { decision: "escalate", draft: { text: "Text" }, queued_for: q } }, []);
  assert.equal(F.stateOf(escText).kind, "escalation");
  // team falls back to the third segment of the employee node's detail
  const withNodes = { ...esc, team: null, nodes: j4.nodes, human: { reply: { kind: "escalation", to: { employee_id: 5, name: "Priya Raman", role: "x" } } } };
  assert.equal(F.routeOf(withNodes).to.team, "Product");
  assert.equal(F.routeOf({ courtesy_reply: true }).courtesy_reply, true);
  // sent overlays
  const sent = deriveJourney({ run_id: "d", output: { decision: "hold", draft: { text: "Hello" }, queued_for: q } }, [], { sent: { by: "Priya Raman", at: "2026-10-24T10:00:00.000Z", body: "Hello", status: "handled", ticket_id: "F1", queue_file: "queue/F1.json" } });
  assert.deepEqual([F.stateOf(sent).sent, F.stateOf(sent).status, F.stateOf(sent).canSend], [true, "handled", false]);
  for (const j of [{}, null, undefined, deriveJourney({}, [])]) {
    assert.ok(F.stateOf(j).kind);
    F.routeOf(j);
    F.writeRows(j);
    F.compareExpected({}, j);
  }
});

test("writeRows", () => {
  const q = { owner_id: 5, owner_name: "Priya Raman", role: "Product Specialist" };
  const mk = (status) => deriveJourney({ run_id: "d", output: { decision: "hold", draft: { text: "Hello" }, queued_for: q } }, [], { sent: { by: "Priya Raman", at: "2026-10-24T10:00:00.000Z", body: "Hello", status, ticket_id: "F1", queue_file: "queue/F1.json" } });
  const rows = F.writeRows(mk("handled"));
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r[0]), ["Ticket", "Status", "Sent by", "Sent at", "Reply body", "File"]);
  assert.equal(rows.find((r) => r[0] === "Status")[1], "HANDLED");
  assert.equal(F.writeRows(mk("follow_up")).find((r) => r[0] === "Status")[1], "FOLLOW UP");
  assert.deepEqual(F.writeRows(j4), []);
  assert.ok(F.writeRows(deriveJourney({}, [], { sent: { body: "x" } })).length === 1); // only rows whose value exists
});

test("compareExpected", () => {
  assert.equal(j4.human.path.includes("Branch: faq-hit"), true);
  assert.equal(F.compareExpected({ decision: "send", branch: "faq-hit" }, j4).ok, true);
  assert.equal(F.compareExpected({ decision: "send", branch: "faq-hit" }, j4).text, "as expected");
  const bad = F.compareExpected({ decision: "hold" }, j4);
  assert.equal(bad.ok, false);
  assert.match(bad.text, /got send/);
  assert.match(F.compareExpected({ decision: "send", branch: "other" }, j4).text, /got send · faq-hit/);
});

test("glossary: four sentences, the model id and DiffusionGemma, no invented or foreign names", () => {
  const g = F.glossary();
  assert.equal(g.length, 4);
  const all = g.join(" ");
  assert.ok(all.includes("nvidia/nemotron-3.5-lightning-30b-a3b"));
  assert.ok(all.includes("DiffusionGemma"));
  assert.ok(!/claude|gpt|zetaris-mcp|helmsward-/i.test(all));
});

// ---- DOM builders on a tiny fake doc ----
function makeDoc() {
  const byId = {};
  const sel = {};
  const mk = (tag) => {
    const e = {
      tag, children: [], attrs: {}, listeners: {}, className: "", _text: "", disabled: false, value: "",
      get firstChild() { return this.children[0] ?? null; },
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
      set textContent(v) { this._text = String(v); this.children = []; },
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      addEventListener(t, fn) { this.listeners[t] = fn; },
      querySelector(s) { return find(this, s)[0] ?? null; },
      all(s) { return find(this, s); },
    };
    return e;
  };
  const find = (root, s) => {
    const cls = s.replace(/^.*\./, "");
    const out = [];
    const walk = (n) => { for (const c of n.children) { if ((c.className || "").split(/\s+/).includes(cls)) out.push(c); walk(c); } };
    walk(root);
    return out;
  };
  const doc = {
    createElement: mk,
    getElementById: (id) => byId[id] ?? null,
    querySelector: (s) => sel[s] ?? null,
  };
  byId.thread = mk("div");
  sel[".flow__state"] = mk("div");
  sel["#drawer .dr__list"] = mk("ol");
  sel["#drawer .dr__glossary"] = mk("div");
  return { doc, thread: byId.thread, badge: sel[".flow__state"], list: sel["#drawer .dr__list"], gloss: sel["#drawer .dr__glossary"] };
}

test("renderFlow: auto reply fills the thread, badge and drawer; no SEND", () => {
  const d = makeDoc();
  F.renderFlow(d.doc, j4, {});
  assert.equal(d.badge.attrs["data-kind"], "auto");
  assert.equal(d.badge.textContent, "Replied automatically");
  assert.equal(d.thread.all(".thread__msg--customer").length, 1);
  assert.equal(d.thread.all(".thread__msg--agent").length, 1);
  assert.equal(d.thread.all(".thread__send").length, 0);
  assert.equal(d.list.children.length, F.foldRows(j4.nodes).length);
  d.list.children.forEach((row) => assert.ok(["zetaris", "meterless", "nightshift", "openjev", "local", "rules", "hmem", "planner", "file"].includes(row.attrs["data-tech"])));
  assert.equal(d.gloss.children.length, 4);
  // the FAQ row shows the hit and the meaning, not the scanned ids
  const faqRow = d.list.children.find((r) => r.textContent.includes("Zetaris: the FAQ"));
  assert.ok(faqRow.textContent.includes("faq:Q01") || faqRow.textContent.includes("Q01"));
  assert.ok(faqRow.textContent.includes("FAQ Q01 matches"));
  assert.ok(!faqRow.textContent.includes("faq:Q02"));
  // skipped rows read "not called"
  assert.ok(d.list.children.filter((r) => r.textContent.includes("skipped")).every((r) => r.textContent.includes("not called")));
  // the outcome row links the trace
  const out = d.list.children[d.list.children.length - 1];
  assert.ok(out.all(".dr__route").some((a) => a.attrs.href === "/runs/scenario-4-sample/trace"));
  // re-render clears
  F.renderFlow(d.doc, j4, {});
  assert.equal(d.thread.children.length, 1);
});

test("renderFlow: draft shows SEND once, passes the text and the routed name; sent state shows the bubble, chip and write list", () => {
  const q = { owner_id: 5, owner_name: "Priya Raman", role: "Product Specialist" };
  const base = { run_id: "d", output: { decision: "hold", draft: { text: "Hello [[blank: order number]]" }, queued_for: q, team: "Product", memory_note: "A note from memory." } };
  const j = deriveJourney(base, []);
  const calls = [];
  const d = makeDoc();
  F.renderFlow(d.doc, j, { onSend: (text, by) => calls.push([text, by]), onOpenDrawer: () => calls.push("open") });
  assert.equal(d.badge.attrs["data-kind"], "draft");
  const ta = d.thread.all(".thread__draft")[0];
  assert.equal(ta.value, "Hello [[blank: order number]]");
  assert.equal(d.thread.all(".thread__blank")[0].textContent, "order number");
  assert.equal(d.thread.all(".route__who")[0].textContent, "Priya Raman");
  assert.equal(d.thread.all(".route__note")[0].textContent, "A note from memory.");
  const send = d.thread.all(".thread__send");
  assert.equal(send.length, 1);
  ta.value = "Edited text";
  send[0].listeners.click();
  assert.deepEqual(calls, [["Edited text", "Priya Raman"]]);
  assert.equal(send[0].disabled, true);
  d.thread.all(".thread__under")[0].listeners.click();
  assert.equal(calls[1], "open");

  const sent = deriveJourney(base, [], { sent: { by: "Priya Raman", at: "2026-10-24T10:00:00.000Z", body: "Edited text", status: "follow_up", ticket_id: "F1", queue_file: "queue/F1.json" } });
  const d2 = makeDoc();
  F.renderFlow(d2.doc, sent, {});
  assert.equal(d2.thread.all(".thread__send").length, 0);
  assert.equal(d2.thread.all(".thread__draft").length, 0);
  assert.equal(d2.thread.all(".thread__msg--sent").length, 1);
  assert.equal(d2.thread.all(".thread__status")[0].attrs["data-status"], "follow_up");
  assert.equal(d2.thread.all(".thread__status")[0].textContent, "FOLLOW UP");
  assert.equal(d2.thread.all(".write__row").length, 6);
  assert.equal(d2.list.children[d2.list.children.length - 1].attrs["data-tech"], "file");
});

test("renderFlow: a route-only ticket shows the routed-to card and the no-draft line, no textarea, no SEND", () => {
  const q = { owner_id: 5, owner_name: "Priya Raman", role: "Product Specialist" };
  const j = deriveJourney({ run_id: "r", output: { decision: "escalate", queued_for: q, team: "Product", team_label: "Product desk" } }, []);
  const d = makeDoc();
  F.renderFlow(d.doc, j, { onSend() {} });
  assert.equal(d.badge.attrs["data-kind"], "route");
  assert.equal(d.thread.all(".thread__send").length, 0);
  assert.equal(d.thread.all(".thread__draft").length, 0);
  assert.equal(d.thread.all(".route__who")[0].textContent, "Priya Raman");
  assert.equal(d.thread.all(".route__team")[0].textContent, "Product desk");
  assert.ok(d.thread.textContent.includes("No draft: Priya Raman writes the reply"));
});

test("renderFlow is total on an empty journey; setBadge sets the kind", () => {
  const d = makeDoc();
  F.renderFlow(d.doc, deriveJourney({}, []), {});
  assert.equal(d.badge.attrs["data-kind"], "none");
  F.setBadge(d.doc, "error", "Run failed");
  assert.equal(d.badge.attrs["data-kind"], "error");
  assert.equal(d.badge.textContent, "Run failed");
  F.renderFlow(d.doc, null, {});
});

test("source sweep: no HTML-building APIs, no invented names", () => {
  const src = readFileSync(SRC, "utf8");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src));
  assert.ok(!/claude-sonnet|zetaris-mcp|helmsward-|Elena Vance|Mina Sato|Soren Lind|JP-\d{4}/.test(src));
  assert.ok(!/\bdocument\b/.test(src.replace(/\/\*[\s\S]*?\*\//, "")), "no bare document use outside the header comment");
});

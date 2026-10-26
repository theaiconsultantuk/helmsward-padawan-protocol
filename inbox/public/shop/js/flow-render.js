/* Jedi Pack flow renderers: pure functions over a journey (GET /runs/<id>/journey) plus DOM builders.
 *
 * A plain script. It defines globalThis.JP_FLOW and touches no DOM at load time; every DOM builder takes the
 * page's `doc` as its first argument and uses a local el() with textContent only (no HTML is ever built from data).
 *
 * HANDLERS (what the page, contact.js, passes in):
 *   handlers = {
 *     onSend(text, by),   // called when the SEND button is clicked. text = the textarea's current text,
 *                         // by = the routed person's name (journey.human.reply.to.name) or "".
 *                         // The page POSTs /runs/<id>/send, re-fetches the journey and calls renderFlow again.
 *     onOpenDrawer(),     // optional. When given, the thread ends with an "Under the hood" button that calls it.
 *   }
 *
 * DOM API (all return nothing unless stated):
 *   JP_FLOW.renderFlow(doc, journey, handlers)  fills doc.getElementById("thread"), sets the .flow__state badge
 *                                               (data-kind + text) and fills the drawer (renderDrawer).
 *   JP_FLOW.renderThread(doc, journey, handlers) -> the thread's child element (renderFlow appends it to #thread).
 *   JP_FLOW.renderDrawer(doc, journey)          fills "#drawer .dr__list" and ".dr__glossary".
 *   JP_FLOW.setBadge(doc, kind, text)           sets the .flow__state badge (kinds: auto draft route escalation none error);
 *                                               the page uses it for "running" and "error" too.
 *
 * Fields read are the real journey names (src/journey.mjs): node {n, step, agent, label, route, detail, consulted,
 * retained, status, model, duration_ms, tech, returned}; journey {team, team_label, cc, also, memory_note,
 * channel_label, sent, auto_reply, decision, input, nodes, human {input, path, reply}, reached_human}.
 */
(function () {
  "use strict";

  var str = function (v) { return typeof v === "string" ? v : ""; };
  var isObj = function (v) { return v !== null && typeof v === "object" && !Array.isArray(v); };
  var arr = function (v) { return Array.isArray(v) ? v : []; };

  // ---------- pure functions ----------

  // model strings that are code, not a model call
  var CODE_MODELS = { "sample/rules": 1, "rules": 1, "none": 1, "faq/canonical": 1, "template/acknowledgement": 1 };
  var MODEL_AGENTS = { Drafter: 1, Evaluator: 1, Reader: 1, RefundReader: 1 };

  function techOf(node) {
    var n = isObj(node) ? node : {};
    var model = str(n.model);
    var agent = str(n.agent);
    var step = str(n.step);
    var isModel = model !== "" && !Object.prototype.hasOwnProperty.call(CODE_MODELS, model); // a model call: never labelled code
    var t;
    if (!isModel && (step === "zetaris.query" || n.tech === "Zetaris")) t = { tech: "zetaris", label: "Zetaris", model: null };
    else if (!isModel && agent === "Scout" && step === "meterless.engine") t = { tech: "meterless", label: "Meterless · Scout engine", model: null };
    else if (!isModel && agent === "WorldModel") t = { tech: "meterless", label: "Meterless · World Model", model: null };
    else if (!isModel && step === "risk.signoff") t = { tech: "rules", label: "Code rules · Risk sign-off", model: null };
    else if (/^openjev/i.test(model)) t = { tech: "openjev", label: "OpenJev · DiffusionGemma (Google, NVIDIA NVFP4)", model: n.model };
    else if ((agent === "Gates" || agent === "Severity") && (!model || model === "sample/rules")) t = { tech: "rules", label: "Code rules (OpenJev not called)", model: null };
    else if (model === "sample/rules") t = { tech: "rules", label: "Code rules (sample mode)", model: null };
    else if (model === "faq/canonical") t = { tech: "zetaris", label: "Zetaris · FAQ text used verbatim", model: null };
    else if (model === "template/acknowledgement" || model === "none" || model === "rules") t = { tech: "rules", label: "Code template", model: null };
    else if (isModel && /^nvidia\//.test(model)) t = { tech: "nightshift", label: "Nightshift · NVIDIA Nemotron", model: n.model };
    else if (isModel && MODEL_AGENTS[agent]) t = { tech: "nightshift", label: "Nightshift · " + model, model: n.model };
    else if (isModel) t = { tech: "local", label: "Local lane · " + model, model: n.model };
    else if (agent === "Memory" || step === "memory.read" || step === "memory.write") t = { tech: "hmem", label: "Meterless · H-MEM", model: null };
    else if (step === "nvidia.model" || MODEL_AGENTS[agent]) t = { tech: "rules", label: "No model call", model: null };
    else t = { tech: "planner", label: "Planner (code)", model: null };
    return t;
  }

  function statusText(node) {
    var s = isObj(node) ? str(node.status) : "";
    return s || "—";
  }
  function statusSub(node) {
    return isObj(node) && node.status === "skipped" ? "not called" : "";
  }

  // A Scout timing node reads "<name>: N rows in M ms". The nodes carry no action, so match on agent and that route shape.
  var TIMING = /^(\S+): (\d+) rows in (\d+) ms$/;
  function timingOf(node) {
    if (!isObj(node) || node.agent !== "Scout") return null;
    var m = TIMING.exec(str(node.route));
    return m ? { name: m[1], rows: Number(m[2]), ms: Number(m[3]) } : null;
  }
  function sumMs(a, b) {
    var x = typeof a === "number" ? a : null;
    var y = typeof b === "number" ? b : null;
    return x === null && y === null ? null : (x || 0) + (y || 0);
  }
  // The timing node is written right before its query node; fold it into that next Zetaris node (adjacent in the trace).
  // The query node's label and route do not carry the template name (label "Zetaris: availability", route "0 rows: none"),
  // so adjacency is the match; a timing node with no partner stays.
  function foldRows(nodes) {
    var list = arr(nodes);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var t = timingOf(list[i]);
      var next = list[i + 1];
      if (t && isObj(next) && next.agent !== "Scout" && techOf(next).tech === "zetaris" && !timingOf(next)) {
        var merged = {};
        Object.keys(next).forEach(function (k) { merged[k] = next[k]; });
        merged.query_ms = t.ms;
        merged.duration_ms = sumMs(list[i].duration_ms, next.duration_ms);
        out.push(merged);
        i++;
      } else {
        out.push(list[i]);
      }
    }
    return out;
  }

  function durationOf(node) {
    return isObj(node) && typeof node.duration_ms === "number" ? node.duration_ms : null;
  }
  function fmtMs(n) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    return n < 1000 ? Math.round(n) + " ms" : (n / 1000).toFixed(1) + " s";
  }

  // executor.act route: "N rows cited: a, b, c; amount X vs limit Y; owner N in|out, backup M in|out; duplicate check: ...; <other>"
  function factsOf(node) {
    var facts = {};
    var route = isObj(node) ? str(node.route) : "";
    if (!route) return facts;
    route.split("; ").forEach(function (clause) {
      var c = clause.trim();
      var m;
      if ((m = /^\d+ rows cited: (.*)$/.exec(c))) facts.cited = m[1].split(", ").map(function (s) { return s.trim(); }).filter(Boolean);
      else if ((m = /^amount (.+?) vs limit (.+)$/.exec(c))) { facts.amount = m[1]; facts.limit = m[2]; }
      else if ((m = /^owner (\d+ \w+), backup (\d+ \w+)$/.exec(c))) { facts.owner = m[1]; facts.backup = m[2]; }
      else if ((m = /^duplicate check: (.*)$/.exec(c))) facts.duplicate = m[1];
      else if (c) (facts.other = facts.other || []).push(c);
    });
    return facts;
  }

  // the detail of the Zetaris query node that read this row id ("employees:5" -> "Priya Raman · Product Specialist · Product")
  function detailFor(id, nodes) {
    var want = str(id).replace(/ \(local\)$/, "");
    var list = arr(nodes);
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!isObj(n) || techOf(n).tech !== "zetaris" || n.step !== "zetaris.query") continue;
      var named = arr(n.consulted).indexOf(want) >= 0 ||
        str(n.route).replace(/^\d+ rows?:\s*/, "").split(/,\s*/).indexOf(want) >= 0;
      if (named) return str(n.detail) || null;
    }
    return null;
  }

  function branchNode(journey) {
    return arr(journey && journey.nodes).filter(function (n) { return isObj(n) && n.step === "branch"; })[0] || null;
  }

  function faqHit(node, journey) {
    var n = isObj(node) ? node : {};
    var ids = Array.isArray(n.returned) ? n.returned.map(function (r) { return { id: str(r.id), key: str(r.key), detail: str(r.detail) }; })
      : arr(n.retained).map(function (id) { return { id: str(id), key: str(id).replace(/^[^:]*:/, ""), detail: "" }; });
    var scannedM = /^(\d+) rows/.exec(str(n.route));
    var scanned = scannedM ? Number(scannedM[1]) : null;
    var index = JP_FLOW.faqIndex || {};
    var hits = ids.map(function (r) {
      var q = index[r.id] || index[r.key] || "";
      return { id: r.id, text: r.detail || (q ? r.key + " · " + q : r.key) };
    });
    var branch = branchNode(journey);
    var meaning = null;
    if (branch && /^FAQ Q/.test(str(branch.route))) meaning = branch.route;
    else {
      var sc = arr(journey && journey.nodes).filter(function (x) { return isObj(x) && x.step === "planner.plan" && /^scenario /.test(str(x.route)); })[0];
      meaning = sc ? sc.route : null;
    }
    if (!hits.length) {
      return { found: false, hits: [], scanned: scanned, meaning: "no match among " + (scanned === null ? "the" : scanned) + " rows" + (branch && branch.route ? ": " + branch.route : "") };
    }
    return { found: true, hits: hits, scanned: scanned, meaning: meaning };
  }

  function outcomeOf(node) {
    var m = /decision (\w+); cited (\d+) rows; (\S+)/.exec(isObj(node) ? str(node.route) : "");
    return m ? { decision: m[1], cited: Number(m[2]), log_file: m[3] } : { decision: null, cited: null, log_file: null };
  }

  function routeOf(journey) {
    var j = isObj(journey) ? journey : {};
    var reply = isObj(j.human && j.human.reply) ? j.human.reply : {};
    var toIn = isObj(reply.to) ? reply.to : null;
    var to = null;
    if (toIn) {
      var team = j.team || null;
      if (!team && toIn.employee_id !== undefined && toIn.employee_id !== null) {
        var d = detailFor("employees:" + toIn.employee_id, j.nodes);
        team = d ? (d.split(" · ")[2] || null) : null;
      }
      to = {
        name: toIn.name || null, role: toIn.role || null, team: team, team_label: j.team_label || null,
        employee_id: toIn.employee_id === undefined ? null : toIn.employee_id, email: toIn.email || null,
      };
    }
    var cc = arr(j.cc).length ? arr(j.cc) : (arr(reply.cc).length ? arr(reply.cc) : arr(j.reached_human && j.reached_human.cc));
    var out = {
      kind: str(reply.kind) || "none", to: to, cc: cc, also: arr(j.also),
      note: reply.recommendation || null, memory_note: j.memory_note || null, channel_label: j.channel_label || null,
    };
    if (j.courtesy_reply !== undefined) out.courtesy_reply = j.courtesy_reply;
    return out;
  }

  var BADGE = { auto: "Replied automatically", draft: "Draft for a person", escalation: "Escalated", route: "Routed to a person", none: "No reply", error: "Error" };
  function stateOf(journey) {
    var j = isObj(journey) ? journey : {};
    var reply = isObj(j.human && j.human.reply) ? j.human.reply : {};
    var kindIn = str(reply.kind);
    var hasText = typeof reply.text === "string" && reply.text !== "";
    var kind = "none";
    if (kindIn === "auto_reply" || j.auto_reply === true) kind = "auto";
    else if (kindIn === "draft_for_human") kind = "draft";
    else if (kindIn === "escalation" && hasText) kind = "escalation";
    else if ((kindIn === "escalation" || kindIn === "none") && isObj(reply.to) && !hasText) kind = "route";
    var sent = isObj(j.sent) && (j.sent.body || j.sent.at || j.sent.by) ? j.sent : null;
    return {
      kind: kind, text: BADGE[kind], sent: Boolean(sent),
      status: sent ? sent.status : null,
      canSend: (kind === "draft" || kind === "escalation") && !sent, // a route state never shows SEND
    };
  }

  function writeRows(journey) {
    var s = isObj(journey) && isObj(journey.sent) ? journey.sent : null;
    if (!s) return [];
    var local = "";
    if (s.at) { var d = new Date(s.at); if (!isNaN(d.getTime())) local = d.toLocaleString("en-GB"); }
    var rows = [
      ["Ticket", s.ticket_id],
      ["Status", s.status === "handled" ? "HANDLED" : s.status === "follow_up" ? "FOLLOW UP" : null],
      ["Sent by", s.by],
      ["Sent at", s.at ? (local ? s.at + " · " + local : s.at) : null],
      ["Reply body", s.body],
      ["File", s.queue_file],
    ];
    return rows.filter(function (r) { return r[1]; });
  }

  function compareExpected(expected, journey) {
    var e = isObj(expected) ? expected : {};
    var j = isObj(journey) ? journey : {};
    var path = arr(j.human && j.human.path);
    var b = path.filter(function (p) { return /^Branch: /.test(str(p)); })[0];
    var branch = b ? b.slice("Branch: ".length) : null;
    var okDecision = e.decision === undefined || e.decision === null || e.decision === j.decision;
    var okBranch = e.branch === undefined || e.branch === null || e.branch === branch;
    if (okDecision && okBranch) return { ok: true, text: "as expected" };
    return { ok: false, text: "differs: got " + (j.decision || "no decision") + (branch ? " · " + branch : "") };
  }

  // Paraphrases inbox/README.md (Providers, World Model, H-MEM sections) and inbox/judging/sponsor-explanation.md. No new claim.
  function glossary() {
    return [
      "Zetaris holds the data in two layers: the raw tables, and on top of them a semantic layer that the agent's queries read.",
      "Nightshift (Meterless) is the primary provider, pinned to nvidia/nemotron-3.5-lightning-30b-a3b; Nightshift chooses the lane, so the trace logs the model that answered.",
      "OpenJev serves Google's DiffusionGemma in NVIDIA's NVFP4 build for the typed gates and the complaint severity. It is called directly, beside Nightshift, and code rules take over (gate_source: rules) when it is down.",
      "H-MEM and the Scout engine are the two Meterless engines in the loop: H-MEM reads and writes the run's memory, Scout checks the message and issues the signed contract. The World Model, also a Meterless engine, holds the customer's history for complaints.",
    ];
  }

  // ---------- DOM builders (take doc; textContent only) ----------

  function el(doc, tag, text, cls) {
    var e = doc.createElement(tag);
    if (text !== null && text !== undefined) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function setBadge(doc, kind, text) {
    var badge = doc.querySelector(".flow__state");
    if (!badge) return;
    badge.setAttribute("data-kind", kind);
    var inner = badge.querySelector ? badge.querySelector(".flow__badge") : null;
    (inner || badge).textContent = text === undefined ? (BADGE[kind] || kind) : text;
  }

  function routeCard(doc, r) {
    var card = el(doc, "div", null, "route");
    if (r.to) {
      card.appendChild(el(doc, "div", r.to.name || "", "route__who"));
      var big = r.to.team_label || r.to.team || "";
      if (big) card.appendChild(el(doc, "div", big, "route__team"));
      var role = [r.to.role, r.to.team && r.to.team !== big ? r.to.team : null].filter(Boolean).join(" · ");
      if (role) card.appendChild(el(doc, "div", role, "route__role"));
    }
    var named = function (p) { return (p.name || p.email || p.id || "") + (p.role ? " · " + p.role : ""); };
    if (r.cc.length) card.appendChild(el(doc, "div", "CC: " + r.cc.map(named).join(", "), "route__cc"));
    if (r.also.length) card.appendChild(el(doc, "div", "Also told: " + r.also.map(named).join(", "), "route__cc"));
    if (r.memory_note) card.appendChild(el(doc, "div", r.memory_note, "route__note"));
    return card;
  }

  function renderThread(doc, journey, handlers) {
    var j = isObj(journey) ? journey : {};
    var h = isObj(handlers) ? handlers : {};
    var st = stateOf(j);
    var r = routeOf(j);
    var reply = isObj(j.human && j.human.reply) ? j.human.reply : {};
    var root = el(doc, "div", null, "thread__list");

    var input = isObj(j.input) ? j.input : {};
    var cust = el(doc, "div", null, "thread__msg thread__msg--customer");
    cust.appendChild(el(doc, "div", [input.from, r.channel_label || input.channel].filter(Boolean).join(" · "), "thread__meta"));
    cust.appendChild(el(doc, "div", input.text || (j.human && j.human.input) || "", "thread__body"));
    root.appendChild(cust);

    if (st.kind === "auto") {
      var a = el(doc, "div", null, "thread__msg thread__msg--agent");
      a.appendChild(el(doc, "div", "Reply sent automatically", "thread__meta"));
      a.appendChild(el(doc, "div", reply.text || "", "thread__body"));
      root.appendChild(a);
    } else if (st.kind === "draft" || st.kind === "escalation") {
      if (r.to) root.appendChild(routeCard(doc, r));
      if (r.note) {
        var note = el(doc, "div", null, "thread__msg thread__msg--internal");
        note.appendChild(el(doc, "div", "Note for the person", "thread__meta"));
        note.appendChild(el(doc, "div", r.note, "thread__body"));
        root.appendChild(note);
      }
      if (!st.sent) {
        var d = el(doc, "div", null, "thread__msg thread__msg--agent");
        d.appendChild(el(doc, "div", "Draft reply (editable)", "thread__meta"));
        var ta = el(doc, "textarea", null, "thread__draft");
        ta.value = reply.text || "";
        d.appendChild(ta);
        var blanks = arr(reply.blanks);
        if (blanks.length) {
          var bl = el(doc, "div", "Fill in: ", "thread__meta");
          blanks.forEach(function (b) { bl.appendChild(el(doc, "mark", b, "thread__blank")); });
          d.appendChild(bl);
        }
        if (st.canSend) {
          var btn = el(doc, "button", "SEND", "btn thread__send");
          btn.setAttribute("type", "button");
          btn.addEventListener("click", function () {
            btn.disabled = true;
            if (typeof h.onSend === "function") h.onSend(ta.value, (r.to && r.to.name) || "");
          });
          d.appendChild(btn);
        }
        root.appendChild(d);
      }
    } else if (st.kind === "route") {
      root.appendChild(routeCard(doc, r));
      if (r.note) {
        var rn = el(doc, "div", null, "thread__msg thread__msg--internal");
        rn.appendChild(el(doc, "div", r.note, "thread__body"));
        root.appendChild(rn);
      }
      root.appendChild(el(doc, "p", "No draft: " + ((r.to && r.to.name) || "the person") + " writes the reply", "thread__meta"));
    } else {
      var none = el(doc, "div", null, "thread__msg thread__msg--internal");
      none.appendChild(el(doc, "div", "No reply was produced for this message.", "thread__body"));
      root.appendChild(none);
    }

    if (st.sent) {
      var s = j.sent;
      var sb = el(doc, "div", null, "thread__msg thread__msg--sent");
      sb.appendChild(el(doc, "div", ["Sent", s.by ? "by " + s.by : null, s.at].filter(Boolean).join(" "), "thread__meta"));
      sb.appendChild(el(doc, "div", s.body || "", "thread__body"));
      var chip = el(doc, "span", s.status === "handled" ? "HANDLED" : s.status === "follow_up" ? "FOLLOW UP" : "SENT", "thread__status");
      if (s.status) chip.setAttribute("data-status", s.status);
      sb.appendChild(chip);
      root.appendChild(sb);
      var rows = writeRows(j);
      if (rows.length) {
        var w = el(doc, "div", null, "write");
        rows.forEach(function (kv) {
          var row = el(doc, "div", null, "write__row");
          row.appendChild(el(doc, "span", kv[0], "write__k"));
          row.appendChild(el(doc, "span", kv[1], "write__v"));
          w.appendChild(row);
        });
        root.appendChild(w);
      }
    }

    if (typeof h.onOpenDrawer === "function") {
      var under = el(doc, "button", "Under the hood", "btn-line thread__under");
      under.setAttribute("type", "button");
      under.addEventListener("click", function () { h.onOpenDrawer(); });
      root.appendChild(under);
    }
    return root;
  }

  function kvRow(doc, k, v) {
    var row = el(doc, "div", null, "dr__kv");
    row.appendChild(el(doc, "span", k, "write__k"));
    row.appendChild(el(doc, "span", v, "write__v"));
    return row;
  }

  function drawerRow(doc, node, journey, allNodes) {
    var t = techOf(node);
    var row = el(doc, "li", null, "dr__row");
    row.setAttribute("data-tech", t.tech);
    row.appendChild(el(doc, "span", node.n, "dr__n"));
    row.appendChild(el(doc, "span", t.label, "dr__tech"));
    if (t.model) row.appendChild(el(doc, "span", t.model, "dr__model"));
    var ms = fmtMs(durationOf(node)) + (typeof node.query_ms === "number" ? " · query " + fmtMs(node.query_ms) : "");
    row.appendChild(el(doc, "span", ms, "dr__ms"));
    var stat = el(doc, "span", statusText(node) + (statusSub(node) ? " · " + statusSub(node) : ""), "dr__status");
    stat.setAttribute("data-status", str(node.status));
    row.appendChild(stat);
    row.appendChild(el(doc, "span", node.label, "dr__label"));

    if (node.status === "skipped") {
      row.appendChild(el(doc, "div", "not called", "dr__route"));
      return row;
    }
    if (node.step === "executor.act") {
      var f = factsOf(node);
      var kv = el(doc, "div", null, "dr__chips");
      arr(f.cited).forEach(function (id) {
        var d = detailFor(id, allNodes);
        kv.appendChild(kvRow(doc, id, d || "—"));
      });
      row.appendChild(kv);
      if (f.amount !== undefined) row.appendChild(kvRow(doc, "amount vs limit", f.amount + " vs " + f.limit));
      if (f.owner) row.appendChild(kvRow(doc, "owner / backup", f.owner + " / " + f.backup));
      if (f.duplicate) row.appendChild(kvRow(doc, "duplicate check", f.duplicate));
      arr(f.other).forEach(function (o) { row.appendChild(kvRow(doc, "note", o)); });
      return row;
    }
    if (node.label === "Zetaris: the FAQ") {
      var hit = faqHit(node, journey);
      var chips = el(doc, "div", null, "dr__chips");
      hit.hits.forEach(function (x) { chips.appendChild(el(doc, "span", x.text, "dr__detail")); });
      row.appendChild(chips);
      row.appendChild(el(doc, "div", (hit.meaning || "") + (hit.scanned !== null && hit.found ? " (" + hit.scanned + " rows scanned)" : ""), "dr__route"));
      return row;
    }
    if (node.step === "synthesis") {
      var o = outcomeOf(node);
      row.appendChild(kvRow(doc, "decision", o.decision || "—"));
      row.appendChild(kvRow(doc, "rows cited", o.cited === null ? "—" : o.cited));
      var link = el(doc, "a", "Open the trace", "dr__route");
      link.setAttribute("href", "/runs/" + encodeURIComponent(str(journey && journey.run_id)) + "/trace");
      row.appendChild(link);
      return row;
    }
    row.appendChild(el(doc, "div", node.route || "—", "dr__route"));
    var det = str(node.detail) || (arr(node.retained).length ? arr(node.retained).join(", ") : "");
    if (det) row.appendChild(el(doc, "div", det, "dr__detail"));
    return row;
  }

  function renderDrawer(doc, journey) {
    var list = doc.querySelector("#drawer .dr__list");
    var gloss = doc.querySelector("#drawer .dr__glossary");
    var j = isObj(journey) ? journey : {};
    if (list) {
      clear(list);
      var nodes = arr(j.nodes);
      foldRows(nodes).forEach(function (n) { list.appendChild(drawerRow(doc, n, j, nodes)); });
      var rows = writeRows(j);
      if (rows.length) {
        var last = el(doc, "li", null, "dr__row");
        last.setAttribute("data-tech", "file");
        last.appendChild(el(doc, "span", "Ticket file", "dr__label"));
        rows.forEach(function (kv) { last.appendChild(kvRow(doc, kv[0], kv[1])); });
        list.appendChild(last);
      }
    }
    if (gloss) {
      clear(gloss);
      glossary().forEach(function (s) { gloss.appendChild(el(doc, "p", s, null)); });
    }
  }

  function renderFlow(doc, journey, handlers) {
    var st = stateOf(journey);
    setBadge(doc, st.kind, st.text);
    var thread = doc.getElementById("thread");
    if (thread) {
      clear(thread);
      thread.appendChild(renderThread(doc, journey, handlers));
    }
    renderDrawer(doc, journey);
  }

  var JP_FLOW = {
    faqIndex: {},
    techOf: techOf, statusText: statusText, statusSub: statusSub, foldRows: foldRows, durationOf: durationOf, fmtMs: fmtMs,
    factsOf: factsOf, detailFor: detailFor, faqHit: faqHit, outcomeOf: outcomeOf, routeOf: routeOf, stateOf: stateOf,
    writeRows: writeRows, compareExpected: compareExpected, glossary: glossary,
    setBadge: setBadge, renderFlow: renderFlow, renderThread: renderThread, renderDrawer: renderDrawer,
  };
  globalThis.JP_FLOW = JP_FLOW;
})();

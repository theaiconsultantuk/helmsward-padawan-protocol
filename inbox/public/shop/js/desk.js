/* Staff desk: counters, who holds what (a board by person), recent runs, and the animated "Under the hood" for any run.
   Same-origin fetches (or the api-base meta). Text only, via textContent: nothing from a response is ever built as html. */
(function () {
  "use strict";
  var meta = document.querySelector('meta[name="api-base"]');
  var base = (meta && meta.getAttribute("content")) || "";
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function when(x) {
    if (!x) return "";
    var d = new Date(x);
    return isNaN(d.getTime()) ? String(x) : d.toLocaleString();
  }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
  // A shared instance may need a token on POST: take ?token=... once, remember it, send it as a bearer header.
  var token = (function () { try { var q = new URLSearchParams(location.search).get("token"); if (q) { localStorage.setItem("jp_token", q); try { var u = new URL(location.href); u.searchParams.delete("token"); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {} } return localStorage.getItem("jp_token") || ""; } catch (e) { return ""; } })();
  function withAuth(opts) { opts = opts || {}; if (token) opts.headers = Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + token }); return opts; }
  // Same words as the contact page (P51): a 401 means the bearer is missing or wrong, not that the server broke.
  var NEED_TOKEN = "This demo needs the judges' access link (the one with ?token=). Ask Team Jedi Pack.";
  function api(path, opts) {
    return fetch(base + path, withAuth(opts)).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (r.status === 401) throw new Error(NEED_TOKEN);
        if (!r.ok) throw new Error(body && body.error && body.error.message ? body.error.message : "HTTP " + r.status);
        return body;
      });
    });
  }
  function setStatus(msg, bad) { var s = $("status"); s.textContent = msg || ""; s.className = "desk__status" + (bad ? " is-bad" : ""); }

  var runRows = {};                                   // run id -> its row from /runs
  var journeys = {};                                  // run id -> journey, fetched once
  function journey(id) {
    if (journeys[id]) return Promise.resolve(journeys[id]);
    return api("/runs/" + encodeURIComponent(id) + "/journey").then(function (j) { journeys[id] = j; return j; });
  }
  function name(p) { return p && p.name ? p.name : ""; }
  // Who wrote in, from the run's journey: "Name · email" (usability test, 26 Oct). Empty when the journey has neither.
  function sender(j) {
    var i = j && j.input && typeof j.input === "object" ? j.input : {}, n = String(i.name || "").trim(), f = String(i.from || "").trim();
    return [n, f && f !== n ? f : ""].filter(Boolean).join(" · ");
  }
  function hood(id, btn) {
    btn.disabled = true;
    journey(id).then(function (j) { if (window.JP_HOOD) window.JP_HOOD.openJourney(j, btn); })
      .catch(function (e) { setStatus("Could not load " + id + ": " + e.message, true); })
      .then(function () { btn.disabled = false; });
  }
  function hoodButton(id) {
    var b = el("button", "Under the hood", "desk__btn desk__btn--hot");
    b.type = "button";
    b.addEventListener("click", function () { hood(id, b); });
    return b;
  }

  function chainChanged(id, label) { document.querySelectorAll('[data-chain="' + id + '"]').forEach(function (e) { e.textContent = label; }); }
  function chainButton(id) {
    var b = el("button", "Sign-off", "desk__btn");
    b.type = "button";
    b.addEventListener("click", function () {
      b.disabled = true;
      journey(id).then(function (j) { return window.JP_CHAIN.open(runRows[id] || { run_id: id }, j, b, chainChanged); })
        .catch(function (e) { setStatus("Could not open the sign-off: " + e.message, true); })
        .then(function () { b.disabled = false; });
    });
    return b;
  }

  // A queue card whose run the server no longer holds (a restart forgets runs) still has its ticket on disk, so Sign-off
  // opens from that: the reason on file stands in for the message, and the hand-off text drives the legal-threat route.
  function standIn(q) {
    var reason = q.decision_reason || "", id = "queue-" + (q.ticket_id || q.file || "x");
    return {
      run: { run_id: id, at: q.mtime, branch_id: q.ticket_id || null },
      j: { run_id: id, scenario: q.category || "other", decision: /escalat/i.test(reason) ? "escalate" : "hold", human: { input: reason, reply: null },
        nodes: [{ step: "branch", route: reason }], reached_human: q.owner ? { who: q.owner } : null },
    };
  }
  function queueChainButton(q) {
    var b = el("button", "Sign-off", "desk__btn"); b.type = "button";
    b.addEventListener("click", function () {
      var s = standIn(q); b.disabled = true;
      Promise.resolve(window.JP_CHAIN.open(s.run, s.j, b, null)).catch(function (e) { setStatus("Could not open the sign-off: " + e.message, true); }).then(function () { b.disabled = false; });
    });
    return b;
  }
  // P57: "★ Full journey" on a run whose Sign-off follows the case to the end. chain.js decides (the same plan() the
  // dialog uses), so the rule lives in one place. Takes a journey or a promise of one; stays hidden until it says yes.
  var STAR_TITLE = { refund: "Sign-off follows it to an approved refund and a 5-star review", repeat: "Sign-off follows it to a declined repeat claim",
    legal: "Sign-off follows it through Legal's risk check to a goodwill refund" };
  function star(j) {
    var s = el("span", null, "dchip desk__star"); s.hidden = true;
    var icon = el("span", "★"); icon.setAttribute("aria-hidden", "true"); s.appendChild(icon); s.appendChild(el("span", " Full journey"));
    Promise.resolve(j).then(function (x) { return x && window.JP_CHAIN && window.JP_CHAIN.fullJourney ? window.JP_CHAIN.fullJourney(x) : ""; })
      .then(function (k) { if (k) { s.hidden = false; s.title = STAR_TITLE[k]; } }, function () { /* no journey: no star */ });
    return s;
  }

  function cardChainButton(rid, q) { return rid ? chainButton(rid) : (q && q.ticket_id ? queueChainButton(q) : null); }

  function renderCounters(c) {
    var box = $("counters"); box.textContent = "";
    Object.keys(c || {}).forEach(function (k) {
      var t = el("div", null, "tile");
      t.appendChild(el("div", c[k], "tile__n")); t.appendChild(el("div", k, "tile__l"));
      box.appendChild(t);
    });
  }

  // The board: one column per person who holds a ticket. The queue lists the policy owner; the journey says who actually
  // holds it (the backup when the owner is out), so each card reads the journey.
  function dcard(q, j, rid) {
    var held = j && j.reached_human && j.reached_human.who;
    var holder = name(held) || name(q.owner) || "unassigned";
    var li = el("li", null, "dcard" + (q.status === "handled" ? " is-done" : ""));
    var top = el("div", null, "dcard__top");
    top.appendChild(el("strong", q.ticket_id || rid || q.run_id));
    top.appendChild(el("span", q.scenario || q.category || "", "dchip"));
    if (j) top.appendChild(star(j));
    if (q.status === "handled") top.appendChild(el("span", "handled", "dchip dchip--ok"));
    else if (q.status === "follow_up") top.appendChild(el("span", "follow up", "dchip dchip--warn"));
    li.appendChild(top);
    var who = sender(j);
    if (who) li.appendChild(el("p", who, "dcard__who"));
    var said = (j && j.human && j.human.input) || q.decision_reason || "";
    if (said) li.appendChild(el("p", clip(said, 120), "dcard__msg"));
    if (held && q.owner && held.employee_id !== q.owner.employee_id) li.appendChild(el("p", "Backup for " + name(q.owner) + ", who is out", "dcard__out"));
    var foot = el("div", null, "dcard__foot");
    foot.appendChild(el("span", q.has_draft ? "draft ready" : "no draft", "muted"));
    foot.appendChild(el("span", when(q.at || q.mtime), "muted"));
    li.appendChild(foot);
    if (rid) {
      var chip = el("span", "", "dchip dchip--warn"); chip.setAttribute("data-chain", rid); foot.appendChild(chip);
      if (j && window.JP_CHAIN) window.JP_CHAIN.summary(runRows[rid] || { run_id: rid }, j).then(function (t) { chip.textContent = t; });
      var acts = el("div", null, "dcard__acts"); acts.appendChild(hoodButton(rid)); acts.appendChild(chainButton(rid)); li.appendChild(acts);
    } else if (q.ticket_id && window.JP_CHAIN) {
      var gone = el("button", "Trace not kept", "desk__btn"); gone.type = "button"; gone.disabled = true;
      gone.title = "The server forgot this run when it restarted, so the animation has nothing to replay. The ticket and Sign-off are still here.";
      var acts2 = el("div", null, "dcard__acts"); acts2.appendChild(gone); acts2.appendChild(queueChainButton(q)); li.appendChild(acts2);
    }
    return { holder: holder, li: li };
  }
  function renderBoard(items, js, rids) {
    var box = $("board"); box.textContent = "";
    if (!items.length) { box.appendChild(el("p", filtering() ? "No ticket matches the filter." : "Nothing is waiting for a person.", "muted")); return; }
    var cols = {}, order = [];
    items.forEach(function (q, i) {
      var c = dcard(q, js[i], rids[i]);
      if (!cols[c.holder]) { cols[c.holder] = el("ul", null, "col__cards"); order.push(c.holder); }
      cols[c.holder].appendChild(c.li);
    });
    order.forEach(function (h) {
      var col = el("section", null, "col");
      var head = el("header", null, "col__head");
      head.appendChild(el("h3", h)); head.appendChild(el("span", cols[h].children.length, "col__n"));
      col.appendChild(head); col.appendChild(cols[h]); box.appendChild(col);
    });
  }

  function renderRuns(items) {
    var ul = $("runs"); ul.textContent = "";
    if (!items.length) { ul.appendChild(el("li", filtering() ? "No run matches the filter." : "No runs yet.", "muted")); return; }
    items.forEach(function (r) {
      var li = el("li", null, "run");
      var top = el("div", null, "run__top");
      top.appendChild(el("strong", r.run_id));
      top.appendChild(el("span", r.scenario || r.kind || "", "dchip"));
      top.appendChild(el("span", r.decision || "", "dchip dchip--" + (r.decision === "send" ? "ok" : "warn")));
      top.appendChild(star(journey(r.run_id)));
      if (r.execution_time_seconds) top.appendChild(el("span", Math.round(r.execution_time_seconds) + " s", "muted"));
      top.appendChild(el("span", when(r.at), "muted"));
      li.appendChild(top);
      var rwho = sender(journeys[r.run_id]);
      if (rwho) li.appendChild(el("p", rwho, "run__who"));
      var acts = el("div", null, "run__acts");
      acts.appendChild(hoodButton(r.run_id));
      acts.appendChild(chainButton(r.run_id));
      var msg = el("span", "", "muted"), buttons = [];
      var kept = window.JP_REASON ? window.JP_REASON.get(r.run_id) : "";
      if (kept) { msg.textContent = "Rejected: " + kept; msg.title = window.JP_REASON.note; }
      // A Reject asks for a reason first (sent as `note`); an Affirm goes straight through.
      function send(verdict, note) {
        buttons.forEach(function (x) { x.disabled = true; });
        msg.className = "muted"; msg.textContent = "sending...";
        var payload = { run_id: r.run_id, verdict: verdict }; if (note) payload.note = note;
        api("/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
          .then(function () {
            if (note && window.JP_REASON) { window.JP_REASON.put(r.run_id, note); msg.title = window.JP_REASON.note; }
            msg.textContent = verdict === "affirm" ? "affirmed" : "Rejected: " + note;
            return api("/counters").then(renderCounters);
          })
          .catch(function (e) { msg.className = "is-bad"; msg.textContent = e.message; })
          .then(function () { buttons.forEach(function (x) { x.disabled = false; }); });
      }
      ["affirm", "reject"].forEach(function (verdict) {
        var b = el("button", verdict === "affirm" ? "Affirm" : "Reject", "desk__btn");
        b.type = "button"; buttons.push(b);
        b.addEventListener("click", function () {
          if (verdict === "affirm" || !window.JP_REASON) { send(verdict, ""); return; }
          buttons.forEach(function (x) { x.disabled = true; });
          window.JP_REASON.ask(acts, function (why) { send("reject", why); }, function () { buttons.forEach(function (x) { x.disabled = false; }); });
        });
        acts.appendChild(b);
      });
      acts.appendChild(msg); li.appendChild(acts); ul.appendChild(li);
    });
  }

  // Find a ticket (usability test, 26 Oct): one kind of ticket and/or a search on name, email, ticket or run id.
  // Client side only: it narrows the Teams view, Who holds what and Recent runs; the counters stay the server's totals.
  var KINDS = [["refund", "Refunds"], ["complaint", "Complaints"], ["legal", "Legal threats"], ["question", "Questions"], ["product", "Product questions"],
    ["rfq", "Quotes"], ["delivery", "Delivery"], ["other", "Other"]];
  var filter = { kind: "", q: "" }, last = null, kindLabels = {};
  function filtering() { return !!(filter.kind || filter.q); }
  // What a ticket or run is matched on: its kind (legal threats are complaints the agent read as legal) and who sent it.
  function facts(row, j, rid) {
    var r = runRows[rid] || row || {}, inp = (j && j.input) || {};
    var kind = (j && j.scenario) || row.scenario || row.category || "other";
    if (j && j.topic_label && !kindLabels[kind]) kindLabels[kind] = j.topic_label;
    return { kind: kind, legal: /legal/.test(r.branch_id || ""),
      text: [inp.name, inp.from, row.ticket_id, row.thread_id, rid, row.run_id].filter(Boolean).join(" ").toLowerCase() };
  }
  function matches(f) {
    if (filter.kind === "legal" ? !f.legal : filter.kind && f.kind !== filter.kind) return false;
    return !filter.q || filter.q.split(/\s+/).every(function (w) { return f.text.indexOf(w) !== -1; });
  }
  function renderCats(seen) {
    var box = $("f-cats"); box.textContent = "";
    var opts = [["", "All"]].concat(KINDS.filter(function (k) { return seen[k[0]] || k[0] === filter.kind; }));
    Object.keys(seen).forEach(function (k) { if (!KINDS.some(function (x) { return x[0] === k; })) opts.push([k, k.charAt(0).toUpperCase() + k.slice(1)]); });
    opts.forEach(function (o) {
      var on = filter.kind === o[0], b = el("button", o[1], "desk__btn" + (on ? " desk__btn--hot" : ""));
      b.type = "button"; b.setAttribute("aria-pressed", on ? "true" : "false");
      if (kindLabels[o[0]]) b.title = kindLabels[o[0]];
      b.addEventListener("click", function () { filter.kind = on && o[0] ? "" : o[0]; renderAll(); });
      box.appendChild(b);
    });
  }
  function renderAll() {
    if (!last) return;
    var seen = {}, q = [], js = [], rids = [];
    var see = function (f) { seen[f.kind] = true; if (f.legal) seen.legal = true; return matches(f); };   // a chip for every kind on the page
    last.q.forEach(function (x, i) { if (see(facts(x, last.js[i], last.rids[i]))) { q.push(x); js.push(last.js[i]); rids.push(last.rids[i]); } });
    var runs = last.runs.filter(function (r) { return see(facts(r, journeys[r.run_id], r.run_id)); });
    renderCats(seen); renderRuns(runs); renderBoard(q, js, rids);
    if (window.JP_TEAMS) window.JP_TEAMS.render(q, js, rids, { hoodButton: hoodButton, chainButton: cardChainButton, star: star, sender: sender,
      empty: filtering() ? "No ticket matches the filter." : null });
    $("f-count").textContent = filtering()
      ? "Showing " + q.length + " of " + last.q.length + " tickets · " + runs.length + " of " + last.runs.length + " runs"
      : last.q.length + " tickets · " + last.runs.length + " runs";
    $("f-clear").disabled = !filtering();
  }
  $("f-q").addEventListener("input", function (e) { filter.q = e.target.value.trim().toLowerCase(); renderAll(); });
  $("f-clear").addEventListener("click", function () { filter = { kind: "", q: "" }; $("f-q").value = ""; renderAll(); $("f-q").focus(); });

  function load() {
    setStatus("Loading...");
    return Promise.all([api("/counters"), api("/queue"), api("/runs?limit=50")]).then(function (v) {
      renderCounters(v[0]); (v[2] || []).forEach(function (r) { runRows[r.run_id] = r; });
      var q = v[1] || [], runs = v[2] || [];
      var byThread = {};
      runs.slice().reverse().forEach(function (r) { if (r.thread_id) byThread[r.thread_id] = r.run_id; });   // newest run per thread wins
      var rids = q.map(function (x) { return x.run_id || byThread[x.ticket_id] || ""; });
      var soft = function (id) { return id ? journey(id).catch(function () { return null; }) : Promise.resolve(null); };
      // Runs need their journey too (the sender's name and email live there); journey() fetches each one once.
      return Promise.all([Promise.all(rids.map(soft)), Promise.all(runs.map(function (r) { return soft(r.run_id); }))])
        .then(function (both) { last = { q: q, js: both[0], rids: rids, runs: runs }; renderAll(); setStatus("Updated " + new Date().toLocaleTimeString()); });
    }).catch(function (e) { setStatus(e.message, true); });
  }
  function start() {
    load();
    setInterval(function () { if (!document.hidden) load(); }, 20000);
  }

  // No access code: the hosted demo runs open since 25 Oct 21:39 CET (no token), so the desk loads straight away.
  start();

  // The desk loads no core.js, so the Menu button in the masthead would do nothing: open and close that one dialog here.
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var m = $("menu");
    if (m && t.closest('[data-open="menu"]') && m.showModal) { try { m.showModal(); } catch (err) { /* already open */ } return; }
    if (m && t.closest("#menu [data-close]")) m.close();
  });
})();

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
  function api(path, opts) {
    return fetch(base + path, withAuth(opts)).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) throw new Error(body && body.error && body.error.message ? body.error.message : "HTTP " + r.status);
        return body;
      });
    });
  }
  function setStatus(msg, bad) { var s = $("status"); s.textContent = msg || ""; s.className = "desk__status" + (bad ? " is-bad" : ""); }

  var journeys = {};                                  // run id -> journey, fetched once
  function journey(id) {
    if (journeys[id]) return Promise.resolve(journeys[id]);
    return api("/runs/" + encodeURIComponent(id) + "/journey").then(function (j) { journeys[id] = j; return j; });
  }
  function name(p) { return p && p.name ? p.name : ""; }
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
    if (q.status === "handled") top.appendChild(el("span", "handled", "dchip dchip--ok"));
    else if (q.status === "follow_up") top.appendChild(el("span", "follow up", "dchip dchip--warn"));
    li.appendChild(top);
    var said = (j && j.human && j.human.input) || q.decision_reason || "";
    if (said) li.appendChild(el("p", clip(said, 120), "dcard__msg"));
    if (held && q.owner && held.employee_id !== q.owner.employee_id) li.appendChild(el("p", "Backup for " + name(q.owner) + ", who is out", "dcard__out"));
    var foot = el("div", null, "dcard__foot");
    foot.appendChild(el("span", q.has_draft ? "draft ready" : "no draft", "muted"));
    foot.appendChild(el("span", when(q.at || q.mtime), "muted"));
    li.appendChild(foot);
    if (rid) li.appendChild(hoodButton(rid));
    return { holder: holder, li: li };
  }
  function renderBoard(items, js, rids) {
    var box = $("board"); box.textContent = "";
    if (!items.length) { box.appendChild(el("p", "Nothing is waiting for a person.", "muted")); return; }
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
    if (!items.length) { ul.appendChild(el("li", "No runs yet.", "muted")); return; }
    items.forEach(function (r) {
      var li = el("li", null, "run");
      var top = el("div", null, "run__top");
      top.appendChild(el("strong", r.run_id));
      top.appendChild(el("span", r.scenario || r.kind || "", "dchip"));
      top.appendChild(el("span", r.decision || "", "dchip dchip--" + (r.decision === "send" ? "ok" : "warn")));
      if (r.execution_time_seconds) top.appendChild(el("span", Math.round(r.execution_time_seconds) + " s", "muted"));
      top.appendChild(el("span", when(r.at), "muted"));
      li.appendChild(top);
      var acts = el("div", null, "run__acts");
      acts.appendChild(hoodButton(r.run_id));
      var msg = el("span", "", "muted"), buttons = [];
      ["affirm", "reject"].forEach(function (verdict) {
        var b = el("button", verdict === "affirm" ? "Affirm" : "Reject", "desk__btn");
        b.type = "button"; buttons.push(b);
        b.addEventListener("click", function () {
          buttons.forEach(function (x) { x.disabled = true; });
          msg.className = "muted"; msg.textContent = "sending...";
          api("/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: r.run_id, verdict: verdict }) })
            .then(function () { msg.textContent = verdict === "affirm" ? "affirmed" : "rejected"; return api("/counters").then(renderCounters); })
            .catch(function (e) { msg.className = "is-bad"; msg.textContent = e.message; })
            .then(function () { buttons.forEach(function (x) { x.disabled = false; }); });
        });
        acts.appendChild(b);
      });
      acts.appendChild(msg); li.appendChild(acts); ul.appendChild(li);
    });
  }

  function load() {
    setStatus("Loading...");
    return Promise.all([api("/counters"), api("/queue"), api("/runs?limit=50")]).then(function (v) {
      renderCounters(v[0]); renderRuns(v[2]);
      var q = v[1] || [];
      var byThread = {};
      (v[2] || []).slice().reverse().forEach(function (r) { if (r.thread_id) byThread[r.thread_id] = r.run_id; });   // newest run per thread wins
      var rids = q.map(function (x) { return x.run_id || byThread[x.ticket_id] || ""; });
      return Promise.all(rids.map(function (id) { return id ? journey(id).catch(function () { return null; }) : Promise.resolve(null); }))
        .then(function (js) { renderBoard(q, js, rids); if (window.JP_TEAMS) window.JP_TEAMS.render(q, js, rids, { hoodButton: hoodButton }); setStatus("Updated " + new Date().toLocaleTimeString()); });
    }).catch(function (e) { setStatus(e.message, true); });
  }
  load();
  setInterval(function () { if (!document.hidden) load(); }, 20000);
})();

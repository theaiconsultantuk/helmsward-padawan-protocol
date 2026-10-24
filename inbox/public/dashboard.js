// Internal dashboard. Same-origin fetches (or the api-base meta), text via textContent only.
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
  function who(p) {
    if (!p || (p.name == null && p.employee_id == null)) return "unassigned";
    return (p.name || "?") + (p.employee_id != null ? " (id " + p.employee_id + ")" : "");
  }
  // A shared instance may need a token on POST: take ?token=... once, remember it, send it as a bearer header.
  var token = (function () { try { var q = new URLSearchParams(location.search).get("token"); if (q) { localStorage.setItem("jp_token", q); try { var u = new URL(location.href); u.searchParams.delete("token"); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {} } return localStorage.getItem("jp_token") || ""; } catch (e) { return ""; } })();
  function withAuth(opts) { opts = opts || {}; if (token) opts.headers = Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + token }); return opts; }
  function api(path, opts) {
    return fetch(base + path, withAuth(opts)).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) {
          var m = body && body.error && body.error.message ? body.error.message : "HTTP " + r.status;
          throw new Error(m);
        }
        return body;
      });
    });
  }
  function setStatus(msg, bad) {
    var s = $("status");
    s.textContent = msg || "";
    s.className = bad ? "error" : "muted";
  }

  function renderCounters(c) {
    var box = $("counters");
    box.textContent = "";
    Object.keys(c || {}).forEach(function (k) {
      var t = el("div", null, "tile");
      t.appendChild(el("div", c[k], "n"));
      t.appendChild(el("div", k, "l"));
      box.appendChild(t);
    });
  }

  function renderQueue(items) {
    var ul = $("queue");
    ul.textContent = "";
    if (!items.length) { ul.appendChild(el("li", "Nothing is waiting.", "muted")); return; }
    items.forEach(function (q) {
      var li = el("li");
      var top = el("div", null, "row-top");
      top.appendChild(el("strong", q.ticket_id || q.run_id || "(no ticket)"));
      top.appendChild(el("span", q.scenario || q.category || "", "chip"));
      top.appendChild(el("span", when(q.mtime || q.at), "muted"));
      li.appendChild(top);
      var line = el("div");
      line.appendChild(el("span", "Waits for: " + who(q.approver || q.owner)));
      line.appendChild(el("span", q.has_draft ? "draft" : "no draft", q.has_draft ? "chip ok" : "chip"));
      if (q.status === "handled") line.appendChild(el("span", "HANDLED", "chip ok"));
      else if (q.status === "follow_up") line.appendChild(el("span", "FOLLOW UP", "chip warn"));
      if (q.status && q.sent_at) line.appendChild(el("span", when(q.sent_at), "muted"));
      li.appendChild(line);
      if (q.recommendation) li.appendChild(el("div", "Recommendation: " + (typeof q.recommendation === "string" ? q.recommendation : JSON.stringify(q.recommendation)), "muted"));
      ul.appendChild(li);
    });
  }

  function renderRuns(items) {
    var ul = $("runs");
    ul.textContent = "";
    if (!items.length) { ul.appendChild(el("li", "No runs yet.", "muted")); return; }
    items.forEach(function (r) {
      var li = el("li");
      li.setAttribute("data-run", r.run_id);
      var top = el("div", null, "row-top");
      top.appendChild(el("strong", r.run_id));
      top.appendChild(el("span", r.scenario || r.kind || "", "chip"));
      top.appendChild(el("span", r.decision || "", "chip"));
      top.appendChild(el("span", when(r.at), "muted"));
      li.appendChild(top);
      if (r.branch_id) li.appendChild(el("div", "branch " + r.branch_id, "muted"));
      var acts = el("div", null, "row-actions");
      var link = el("a", "Journey");
      link.href = "/shop/contact.html?run=" + encodeURIComponent(r.run_id);
      acts.appendChild(link);
      var msg = el("span", "", "muted");
      var buttons = [];
      ["affirm", "reject"].forEach(function (verdict) {
        var b = el("button", verdict === "affirm" ? "Affirm" : "Reject", "secondary");
        b.type = "button";
        buttons.push(b);
        b.addEventListener("click", function () {
          buttons.forEach(function (x) { x.disabled = true; });
          msg.className = "muted"; msg.textContent = "sending...";
          api("/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: r.run_id, verdict: verdict }) })
            .then(function () {
              msg.textContent = verdict === "affirm" ? "affirmed" : "rejected";
              return api("/counters").then(renderCounters);
            })
            .catch(function (e) { msg.className = "error"; msg.textContent = e.message; })
            .then(function () { buttons.forEach(function (x) { x.disabled = false; }); });
        });
        acts.appendChild(b);
      });
      acts.appendChild(msg);
      li.appendChild(acts);
      ul.appendChild(li);
    });
  }

  function load() {
    var btn = $("refresh");
    btn.disabled = true;
    setStatus("Loading...");
    return Promise.all([api("/counters"), api("/queue"), api("/runs?limit=50")])
      .then(function (v) { renderCounters(v[0]); renderQueue(v[1]); renderRuns(v[2]); setStatus("Updated " + new Date().toLocaleTimeString()); })
      .catch(function (e) { setStatus(e.message, true); })
      .then(function () { btn.disabled = false; });
  }

  $("refresh").addEventListener("click", load);
  load();
})();

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
  // Reject needs a reason (usability test, 26 Oct). The same panel as the staff desk (shop/js/reject-reason.js), kept here
  // because this page loads only /static/ scripts. Same storage key, so a reason given on either page shows on both.
  var R = (function () {
    var CHIPS = ["Wrong decision", "Tone", "Wrong facts", "Should have escalated", "Other"];
    var NOTE = "Reason sent with the verdict; the server does not store it yet, so it is kept on this page.";
    function key(id) { return "jp_reject_reason_" + id; }
    function get(id) { try { return localStorage.getItem(key(id)) || ""; } catch (e) { return ""; } }
    function put(id, t) { try { localStorage.setItem(key(id), t); } catch (e) { /* works without storage */ } }
    function ask(anchor, onConfirm, onCancel) {
      var box = el("div", null, "rr"), chosen = "", chips = el("div", null, "rr__chips"), note = el("textarea", null, "rr__note");
      var go = el("button", "Confirm reject", "rr__go"), no = el("button", "Cancel", "rr__no");
      box.setAttribute("role", "group"); box.setAttribute("aria-label", "Why reject?");
      note.rows = 2; note.maxLength = 500; note.placeholder = "What should it have done? (optional, required for Other)"; note.setAttribute("aria-label", "Reason details");
      go.type = "button"; no.type = "button"; go.disabled = true;
      function text() { var t = note.value.trim(); return chosen === "Other" ? t : chosen + (t ? ": " + t : ""); }
      function check() { go.disabled = !chosen || (chosen === "Other" && !note.value.trim()); }
      CHIPS.forEach(function (c) {
        var b = el("button", c, "rr__chip"); b.type = "button"; b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () { chosen = c; chips.querySelectorAll(".rr__chip").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); check(); if (c === "Other") note.focus(); });
        chips.appendChild(b);
      });
      note.addEventListener("input", check);
      go.addEventListener("click", function () { var t = text(); if (!t) return; box.remove(); onConfirm(t); });
      no.addEventListener("click", function () { box.remove(); if (onCancel) onCancel(); });
      var acts = el("div", null, "rr__acts"); acts.appendChild(go); acts.appendChild(no);
      box.appendChild(el("p", "Why reject? Pick a reason (required)", "rr__h"));
      box.appendChild(chips); box.appendChild(note); box.appendChild(acts); box.appendChild(el("p", NOTE, "rr__fine"));
      anchor.parentNode.insertBefore(box, anchor.nextSibling); chips.firstChild.focus();
    }
    return { ask: ask, get: get, put: put, note: NOTE };
  })();
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
      var kept = R.get(r.run_id);
      if (kept) { msg.textContent = "Rejected: " + kept; msg.title = R.note; }
      // A Reject asks for a reason first (sent as `note`, kept on this page); an Affirm goes straight through.
      function send(verdict, note) {
        buttons.forEach(function (x) { x.disabled = true; });
        msg.className = "muted"; msg.textContent = "sending...";
        var payload = { run_id: r.run_id, verdict: verdict };
        if (note) payload.note = note;
        api("/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
          .then(function () {
            if (note) { R.put(r.run_id, note); msg.title = R.note; }
            msg.textContent = verdict === "affirm" ? "affirmed" : "Rejected: " + note;
            return api("/counters").then(renderCounters);
          })
          .catch(function (e) { msg.className = "error"; msg.textContent = e.message; })
          .then(function () { buttons.forEach(function (x) { x.disabled = false; }); });
      }
      ["affirm", "reject"].forEach(function (verdict) {
        var b = el("button", verdict === "affirm" ? "Affirm" : "Reject", "secondary");
        b.type = "button";
        buttons.push(b);
        b.addEventListener("click", function () {
          if (verdict === "affirm") { send(verdict, ""); return; }
          buttons.forEach(function (x) { x.disabled = true; });
          R.ask(acts, function (why) { send("reject", why); }, function () { buttons.forEach(function (x) { x.disabled = false; }); });
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

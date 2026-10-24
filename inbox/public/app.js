// Unified front page. Same-origin fetches (or the api-base meta); all data is rendered with textContent only.
(function () {
  "use strict";
  var meta = document.querySelector('meta[name="api-base"]');
  var base = (meta && meta.getAttribute("content")) || "";
  var $ = function (id) { return document.getElementById(id); };
  var BLANK = /\[\[blank:\s*([^\]]*?)\s*\]\]/g;
  var timer = null;
  var demoAsOf = "";

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function who(p) {
    if (!p || (p.name == null && p.employee_id == null)) return "unassigned";
    return p.name || ("employee " + p.employee_id);
  }
  function setStatus(msg, bad) {
    var s = $("status");
    s.textContent = msg || "";
    s.className = bad ? "error" : "muted";
  }
  function errText(body, code) {
    if (body && body.error) return (body.error.type || "Error") + ": " + (body.error.message || "failed");
    return "HTTP " + code;
  }
  // A shared instance may need a token on POST: take ?token=... once, remember it, send it as a bearer header.
  var token = (function () { try { var q = new URLSearchParams(location.search).get("token"); if (q) { localStorage.setItem("jp_token", q); try { var u = new URL(location.href); u.searchParams.delete("token"); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {} } return localStorage.getItem("jp_token") || ""; } catch (e) { return ""; } })();
  function withAuth(opts) { opts = opts || {}; if (token) opts.headers = Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + token }); return opts; }
  function getJson(path, opts) {
    // No client timeout: a live run can take minutes.
    return fetch(base + path, withAuth(opts)).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) { return { ok: r.ok, code: r.status, body: body }; });
    });
  }

  // ----- demo scenarios -----
  function setRadio(v) {
    var r = document.querySelector('input[name="scenario"][value="' + v + '"]');
    if (r) r.checked = true;
  }
  function loadDemos() {
    fetch(base + "/static/demo-scenarios.json").then(function (r) { return r.json(); }).then(function (list) {
      var box = $("demos");
      list.forEach(function (d) {
        var wrap = el("div", null, "demo");
        var b = el("button", d.label, "secondary");
        b.type = "button";
        b.addEventListener("click", function () {
          $("name").value = d.name || "";
          $("email").value = d.email || "";
          $("message").value = d.message || "";
          setRadio(d.scenario || "free_text");
          demoAsOf = d.as_of || "";
          $("as_of").value = demoAsOf;
        });
        wrap.appendChild(b);
        if (d.expected) wrap.appendChild(el("small", d.expected, "muted hint"));
        box.appendChild(wrap);
      });
    }).catch(function () { $("demos").appendChild(el("span", "Demo scenarios unavailable.", "muted")); });
  }

  // ----- submit -----
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function submit(ev) {
    ev.preventDefault();
    var btn = $("submit");
    if (btn.disabled) return;
    var message = $("message").value.trim();
    if (!message) { setStatus("Please write a message.", true); return; }
    var scen = document.querySelector('input[name="scenario"]:checked');
    var input = { message: message, from: $("email").value.trim() || $("name").value.trim() || "anonymous", channel: "chat" };
    if ($("name").value.trim()) input.name = $("name").value.trim();
    if (scen && scen.value !== "free_text") input.scenario = scen.value;
    if ($("as_of").value) input.as_of = $("as_of").value;
    var runId = "web-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    btn.disabled = true;
    var t0 = Date.now();
    var tick = function () { setStatus("Running… " + runId + " · " + Math.floor((Date.now() - t0) / 1000) + "s"); };
    tick();
    stopTimer();
    timer = setInterval(tick, 1000);
    getJson("/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runId, input: input }) })
      .then(function (r) {
        if (!r.ok || !r.body || r.body.status === "error") throw new Error(errText(r.body, r.code));
        return loadJourney(r.body.run_id || runId);
      })
      .then(function () { stopTimer(); setStatus("Done · run " + runId); })
      .catch(function (e) { stopTimer(); setStatus(e.message || String(e), true); })
      .then(function () { btn.disabled = false; });
  }

  function loadJourney(id) {
    return getJson("/runs/" + encodeURIComponent(id) + "/journey").then(function (r) {
      if (!r.ok || !r.body) throw new Error(errText(r.body, r.code));
      render(r.body);
    });
  }

  // ----- render -----
  function chips(list, cls) {
    var box = el("div", null, "chips");
    (list || []).forEach(function (id) { box.appendChild(el("span", id, "chip " + cls)); });
    return box;
  }
  function withBlanks(parent, text) {
    var s = String(text == null ? "" : text), last = 0, m;
    BLANK.lastIndex = 0;
    while ((m = BLANK.exec(s)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
      parent.appendChild(el("mark", m[1], "blank"));
      last = m.index + m[0].length;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }
  function replyCard(h, journey) {
    var r = (h && h.reply) || { kind: "none" };
    var card = el("div", null, "reply kind-" + r.kind);
    var to = r.to;
    var title = { auto_reply: "Sent automatically", answer: "Answer" }[r.kind];
    if (r.kind === "draft_for_human") title = "Draft for " + (to && to.name ? to.name : "a colleague") + (to && to.role ? " (" + to.role + ")" : "");
    else if (r.kind === "escalation") title = "Escalated to " + (to && to.name ? to.name : "a colleague");
    else if (r.kind === "none") title = "Held for " + (to && to.name ? to.name : "a colleague") + ", no draft";
    card.appendChild(el("h3", title));
    if (r.kind === "escalation" && journey.reached_human && journey.reached_human.what) {
      card.appendChild(el("h4", "What they received"));
      var ul = el("ul");
      journey.reached_human.what.forEach(function (w) { ul.appendChild(el("li", w)); });
      card.appendChild(ul);
    }
    if (r.text) {
      var p = el("div", null, "reply-text");
      withBlanks(p, r.text);
      card.appendChild(p);
    }
    if (r.blanks && r.blanks.length) {
      card.appendChild(el("h4", "To fill before sending"));
      var bl = el("ul");
      r.blanks.forEach(function (b) { bl.appendChild(el("li", typeof b === "string" ? b : (b.what || b.id || JSON.stringify(b)))); });
      card.appendChild(bl);
    }
    if (r.recommendation) {
      card.appendChild(el("h4", "Recommendation"));
      card.appendChild(el("p", r.recommendation));
    }
    if (r.attachments && r.attachments.length) {
      card.appendChild(el("h4", "Attached"));
      card.appendChild(chips(r.attachments, "kept"));
    }
    return card;
  }

  // human.path lists the non-skipped nodes in order (path labels can differ from node labels: "Branch: rfq" vs "Branch", "Reply" vs "Outcome").
  // So path entry i links to the i-th non-skipped node when the counts agree; otherwise it falls back to a forward label match.
  function linkPath(path, nodes) {
    var live = [];
    nodes.forEach(function (n, k) { if (n.status !== "skipped") live.push(k); });
    if (live.length === path.length) return live;
    var cursor = 0;
    return path.map(function (label) {
      for (var k = cursor; k < nodes.length; k++) {
        if (nodes[k].status !== "skipped" && label.indexOf(nodes[k].label) === 0) { cursor = k + 1; return k; }
      }
      return -1;
    });
  }

  function render(j) {
    $("split").hidden = false;
    var human = $("human"), hood = $("hood");
    human.textContent = ""; hood.textContent = "";
    var h = j.human || {}, inp = j.input || {};
    var nodes = j.nodes || [];

    var inbox = el("div", null, "input-block");
    inbox.appendChild(el("div", (inp.name || "Customer") + " <" + (inp.from || "unknown") + "> · " + (inp.channel || "chat"), "muted"));
    inbox.appendChild(el("p", h.input != null ? h.input : inp.text, "input-text"));
    human.appendChild(inbox);

    var path = h.path || [];
    var links = linkPath(path, nodes);
    var ol = el("ol", null, "path");
    var li0 = el("li", "Input", "path-item fixed");
    ol.appendChild(li0);
    var pathEls = [];
    path.forEach(function (label, i) {
      var li = el("li", label, "path-item");
      ol.appendChild(li);
      pathEls[i] = li;
    });
    human.appendChild(ol);
    human.appendChild(replyCard(h, j));

    var cardEls = [];
    nodes.forEach(function (n, k) {
      var c = el("article", null, "node status-" + n.status + (n.status === "skipped" ? " muted" : ""));
      var head = el("div", null, "node-head");
      head.appendChild(el("span", n.n, "node-n"));
      head.appendChild(el("strong", n.label));
      head.appendChild(el("span", n.status, "badge badge-" + n.status));
      if (n.reached_human) head.appendChild(el("span", "→ human", "badge human"));
      c.appendChild(head);
      c.appendChild(el("div", n.agent + " · " + n.step + (n.model ? " · " + n.model : ""), "muted small"));
      c.appendChild(el("p", n.route, "route"));
      if (n.detail) c.appendChild(el("p", n.detail, "detail"));
      if ((n.consulted || []).length) {
        c.appendChild(el("div", "consulted", "list-label"));
        c.appendChild(chips(n.consulted, "seen"));
      }
      if ((n.retained || []).length) {
        c.appendChild(el("div", "retained", "list-label"));
        c.appendChild(chips(n.retained, "kept"));
      }
      hood.appendChild(c);
      cardEls[k] = c;
    });

    function mark(on, a, b) {
      if (a) a.classList.toggle("hl", on);
      if (b) b.classList.toggle("hl", on);
    }
    path.forEach(function (_, i) {
      if (links[i] < 0) return;
      var pe = pathEls[i], ce = cardEls[links[i]];
      pe.addEventListener("mouseenter", function () { mark(true, pe, ce); });
      pe.addEventListener("mouseleave", function () { mark(false, pe, ce); });
      ce.addEventListener("mouseenter", function () { mark(true, pe, ce); });
      ce.addEventListener("mouseleave", function () { mark(false, pe, ce); });
    });
    $("split").scrollIntoView({ block: "start" });
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("form").addEventListener("submit", submit);
    loadDemos();
    var q = new URLSearchParams(window.location.search).get("run");
    if (q) {
      setStatus("Loading run " + q + "…");
      loadJourney(q).then(function () { setStatus("Run " + q); }).catch(function (e) { setStatus(e.message || String(e), true); });
    }
  });
})();

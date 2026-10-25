/* Contact us: the form, the scenario buttons, the flow ("How a person sees it"), SEND and the technical drawer.
   Text only: every value from the API goes in through textContent. Nothing on this page is invented: a model, a row, a duration or a status
   appears only when the run's own journey carries it. The renderers live in js/flow-render.js (window.JP_FLOW); where one is missing this
   file draws a small, truthful fallback from the journey's own fields. */
(function () {
  "use strict";

  // Where focus goes after a scenario fill, as a small state machine with no DOM in it (the test drives it with plain booleans).
  // A pointer pick may hand focus to Submit as soon as the fill lands. A key pick (Enter/Space on the scenario button) waits for that key's
  // release first, because a held key auto-repeats on whatever has focus and must never repeat onto Submit. Either way focus only moves while it
  // is still on the scenario button (or nowhere); if the judge moved on, nothing is stolen, and if the key's release never arrives (the window lost
  // focus) nothing moves. Submit itself is never vetoed: this only decides when focus may be moved.
  function createHandoff() {
    var st = null;
    function tryMove(onButton) {
      if (!st || st.dead || st.moved || !st.filled || !st.released) return false;
      if (!onButton) { st.dead = true; return false; }
      st.moved = true;
      return true;
    }
    return {
      // viaKey: the pick came from the keyboard; keyDown: that key is still held right now
      begin: function (viaKey, keyDown) { st = { filled: false, released: !(viaKey && keyDown), dead: false, moved: false }; },
      cancel: function () { st = null; },
      // the fill landed; true means "move focus to Submit now"
      filled: function (onButton) { if (st) st.filled = true; return tryMove(onButton); },
      // the held key was released; true means "move focus to Submit now"
      keyup: function (onButton) { if (st && !st.released) st.released = true; return tryMove(onButton); },
      // the window lost focus before the release: the keyup may never come, so do not move focus at all
      blur: function () { if (st && !st.released) st.dead = true; },
      pending: function () { return Boolean(st && !st.dead && !st.moved); }
    };
  }

  // Outside a browser (no document) only the token function is exposed, for the test that drives it with throwing stubs.
  if (typeof document === "undefined") { globalThis.JP_CONTACT_TEST = { resolveToken: resolveToken, createHandoff: createHandoff }; return; }

  var meta = document.querySelector('meta[name="api-base"]');
  var base = ((meta && meta.getAttribute("content")) || "").replace(/\/+$/, "");
  var $ = function (id) { return document.getElementById(id); };
  var BLANK = /\[\[blank:\s*([^\]]*?)\s*\]\]/g;
  var REASON_ORDER = ["Refund", "Question", "Quote", "Complaint", "Other", "Review", "Email"];
  var REASON_VALUES = ["refund", "question", "rfq", "complaint", "free_text"];
  var DEFAULT_AS_OF = "2026-10-20";

  var scenarios = [];   // the entries from GET /demo/scenarios
  var active = null;    // the chosen entry, while the form still holds its message
  var cur = { runId: null, journey: null, started: 0, entry: null };
  var busy = false;
  var sending = false;
  var ticker = null;
  var pickSeq = 0;
  var picked = null;
  var drawerOpener = null;

  /* ---------- helpers ---------- */
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function enc(s) { return encodeURIComponent(s); }
  function flow(name) { var f = window.JP_FLOW; return f && typeof f[name] === "function" ? f[name] : null; }
  function callFlow(name, args) { var fn = flow(name); return fn ? fn.apply(window.JP_FLOW, args) : undefined; }

  function fmtMs(n) {
    if (typeof n !== "number" || !isFinite(n)) return "";
    var f = flow("fmtMs");
    if (f) { try { var t = f(n); if (typeof t === "string") return t; } catch (e) { /* fall through */ } }
    return n < 1000 ? Math.round(n) + " ms" : (n / 1000).toFixed(1) + " s";
  }

  function setStatus(msg, bad) {
    var s = $("status");
    if (!s) return;
    s.textContent = msg || "";
    if (bad) s.setAttribute("data-state", "error"); else s.removeAttribute("data-state");
  }
  function setNote(msg) { var n = $("send-note"); if (n) n.textContent = msg || ""; }

  function errMsg(body, code) {
    var e = body && body.error;
    if (e && e.message) return String(e.message);
    return "HTTP " + code;
  }

  /* ---------- token and fetch ---------- */
  // Token handling is a small function so a test can drive it with throwing stubs (JP_CONTACT_TEST above).
  // Returns { token, stripFailed }: the token is kept in memory even when storage throws, and the address bar is
  // cleaned in its own try/catch, independent of storage.
  function resolveToken(env) {
    var q = "", stripFailed = false;
    try { q = new URLSearchParams(env.search).get("token") || ""; } catch (e) { q = ""; }
    if (q) {
      try { env.storage.setItem("jp_token", q); } catch (e) { /* kept in memory only */ }
      try {
        var u = new URL(env.href);
        u.searchParams.delete("token");
        env.history.replaceState(null, "", u.pathname + u.search + u.hash);
      } catch (e) { stripFailed = true; }
      return { token: q, stripFailed: stripFailed };
    }
    var stored = "";
    try { stored = env.storage.getItem("jp_token") || ""; } catch (e) { stored = ""; }
    return { token: stored, stripFailed: false };
  }
  var tokenState = resolveToken({
    get search() { return location.search; }, get href() { return location.href; },
    get storage() { return localStorage; }, get history() { return history; }
  });
  var token = tokenState.token;
  if (tokenState.stripFailed) setStatus("The address bar still shows your access token: this browser would not let the page remove it.", true);

  // The bearer goes on POST only; a GET carries no credentials.
  function withAuth(opts) {
    var out = Object.assign({}, opts || {});
    if (token && String(out.method || "GET").toUpperCase() === "POST") {
      out.headers = Object.assign({}, out.headers || {}, { Authorization: "Bearer " + token });
    }
    return out;
  }

  // No client timeout unless the caller asks for one: a live run can take minutes (POST /run never asks).
  function fetchWithTimeout(url, opts) {
    var o = Object.assign({}, opts || {});
    var timeoutMs = o.timeoutMs;
    delete o.timeoutMs;
    var ctrl = timeoutMs && typeof AbortController !== "undefined" ? new AbortController() : null;
    var tid = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) { /* done */ } }, timeoutMs) : null;
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o).then(function (r) { if (tid) clearTimeout(tid); return r; }, function (e) { if (tid) clearTimeout(tid); throw e; });
  }

  function getJson(path, opts) {
    var o = withAuth(opts);
    return fetchWithTimeout(base + path, o)
      .catch(function (e) {
        if (!base) throw e;
        return fetchWithTimeout(path, o);
      })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          return { ok: r.ok, code: r.status, body: body };
        });
      });
  }

  // After a gateway error the run may still be going: ask for the stored run until it is there.
  function pollRunUntilDone(id, triesLeft) {
    if (triesLeft <= 0) return Promise.reject(new Error("Gave up waiting for run " + id + ". Open it later with ?run=" + id + "."));
    return new Promise(function (resolve) { setTimeout(resolve, 3000); }).then(function () {
      return getJson("/runs/" + enc(id), { timeoutMs: 8000 }).then(function (r) {
        var b = r.body;
        if (r.ok && b && (b.status === "success" || b.status === "error" || b.output)) return r;
        return pollRunUntilDone(id, triesLeft - 1);
      }, function () { return pollRunUntilDone(id, triesLeft - 1); });
    });
  }

  /* ---------- text with blanks, path links (kept for the fallback drawer and thread) ---------- */
  function withBlanks(parent, text) {
    var s = String(text == null ? "" : text), last = 0, m;
    BLANK.lastIndex = 0;
    while ((m = BLANK.exec(s)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
      parent.appendChild(el("mark", "[" + m[1] + "]", "thread__blank"));
      last = m.index + m[0].length;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }

  function linkPath(path, nodes) {
    var live = [];
    nodes.forEach(function (n, k) { if (n.status !== "skipped") live.push(k); });
    if (live.length === path.length) return live;
    var cursor = 0;
    return path.map(function (label) {
      for (var k = cursor; k < nodes.length; k++) {
        if (nodes[k].status !== "skipped" && String(label).indexOf(nodes[k].label) === 0) {
          cursor = k + 1;
          return k;
        }
      }
      return -1;
    });
  }

  /* ---------- the form ---------- */
  function setReason(v) {
    var sel = $("reason");
    if (!sel) return;
    sel.value = REASON_VALUES.indexOf(v) >= 0 ? v : "free_text";
  }

  // The form's Reason is filled from the entry's own reason ("Question"); only an entry without one falls back to its scenario.
  var REASON_BY_LABEL = { Refund: "refund", Question: "question", Quote: "rfq", Complaint: "complaint", Other: "free_text" };
  function reasonValueFor(e) {
    var r = REASON_BY_LABEL[str(e.reason)];
    return r || str(e.scenario);
  }

  function readInput() {
    var reason = $("reason").value;
    // A scenario's declared kind still travels as its own: the Reason the form shows can read "Question" for an entry that is declared free text,
    // and the shown label must not change what is declared. Editing the Reason takes over.
    if (active && picked && reason === picked.shown) reason = picked.sent;
    var name = $("name").value.trim();
    var email = $("email").value.trim();
    var input = {
      message: $("message").value.trim(),
      from: email || name || "anonymous",
      channel: ($("channel") && $("channel").value) || "contact-form"
    };
    if (name) input.name = name;
    if (reason && reason !== "free_text") input.scenario = reason;
    var asOf = $("as_of") && $("as_of").value;
    if (asOf) input.as_of = asOf;
    if (active && active.subject) input.subject = String(active.subject);
    return input;
  }

  function setBusy(on) {
    busy = on;
    var res = $("flow");
    if (res) res.setAttribute("aria-busy", on ? "true" : "false");
    var form = $("contact-form");
    if (form) Array.prototype.forEach.call(form.querySelectorAll('button[type="submit"]'), function (b) { b.disabled = on; });
    var sub = $("submit");
    if (sub) sub.textContent = on ? "Running\u2026" : "Submit dispatch";
    Array.prototype.forEach.call(document.querySelectorAll(".sc__btn"), function (b) { b.disabled = on; });
  }

  /* ---------- scenarios ---------- */
  function expectedText(x) {
    var e = obj(x);
    return [e.decision, e.branch, e.team].filter(function (p) { return p; }).join(" · ");
  }

  function showExpected(extra) {
    var p = $("sc-expected");
    if (!p) return;
    if (!active) { p.hidden = true; p.textContent = ""; return; }
    var t = expectedText(active.expected);
    p.textContent = "Expected: " + (t || "not stated") + (extra ? " — " + extra : "");
    p.hidden = false;
  }

  function markActive(id) {
    Array.prototype.forEach.call(document.querySelectorAll(".sc__btn"), function (b) {
      var on = !!id && b.getAttribute("data-id") === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function renderScenarios(list) {
    var box = $("scenarios");
    if (!box) return;
    clear(box);
    var groups = {};
    var order = REASON_ORDER.slice();
    list.forEach(function (e) {
      var g = str(e.reason) || "Other";
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
      if (order.indexOf(g) < 0) order.push(g);
    });
    order.forEach(function (g) {
      if (!groups[g]) return;
      var wrap = el("div", null, "sc__group");
      wrap.appendChild(el("h3", g, "sc__group-label"));
      groups[g].forEach(function (e) {
        var b = el("button", str(e.label) || str(e.id), "sc__btn");
        b.type = "button";
        b.setAttribute("data-id", str(e.id));
        b.setAttribute("aria-pressed", "false");
        wrap.appendChild(b);
      });
      box.appendChild(wrap);
    });
  }

  function loadScenarios() {
    return getJson("/demo/scenarios", { timeoutMs: 10000 })
      .then(function (r) { if (r.ok && Array.isArray(r.body)) return r.body; throw new Error("none"); })
      .catch(function () {
        return getJson("/static/demo-scenarios.json", { timeoutMs: 10000 }).then(function (r) {
          if (r.ok && Array.isArray(r.body)) return r.body;
          throw new Error("none");
        });
      })
      .then(function (list) { scenarios = list; renderScenarios(list); })
      .catch(function () {
        var box = $("scenarios");
        if (box) { clear(box); box.appendChild(el("p", "The sample messages could not be loaded from this server.", "sc__note")); }
      });
  }

  function entryById(id) {
    for (var i = 0; i < scenarios.length; i++) if (scenarios[i].id === id) return scenarios[i];
    return null;
  }

  /* ---------- the source card (review and email) ---------- */
  function hideSourceCard() {
    var card = $("source-card"), fields = $("form-fields"), sub = $("submit");
    if (card) { card.hidden = true; clear(card); }
    if (fields) fields.hidden = false;
    if (sub) sub.hidden = false;
  }

  function showSourceCard(e, client) {
    var card = $("source-card"), fields = $("form-fields"), sub = $("submit");
    if (!card) return;
    clear(card);
    var isMail = e.channel === "email";
    var box = el("div", null, "src " + (isMail ? "src--email" : "src--trustpilot"));
    var head = el("div", null, "src__head");
    head.appendChild(el("p", isMail ? "Email" : "Trustpilot review"));
    var title = !isMail && e.review && e.review.title ? str(e.review.title) : "";
    if (title) head.appendChild(el("h3", title));
    box.appendChild(head);
    var m = el("div", null, "src__meta");
    var name = (client && client.name) || e.name;
    var mail = (client && client.email) || e.email;
    if (isMail) {
      m.appendChild(el("p", "From: " + (mail || "")));
      if (e.to) m.appendChild(el("p", "To: " + e.to));
      if (e.subject) m.appendChild(el("p", "Subject: " + e.subject));
    } else {
      m.appendChild(el("p", name ? name + " · Arrived via Trustpilot" : "Arrived via Trustpilot"));
    }
    box.appendChild(m);
    box.appendChild(el("p", $("message").value, "src__body"));
    var go = el("button", "Simulate arrival", "btn src__submit");
    go.type = "submit";
    box.appendChild(go);
    var own = el("button", "Write your own", "btn-line");
    own.type = "button";
    own.setAttribute("data-act", "write-own");
    box.appendChild(own);
    card.appendChild(box);
    card.hidden = false;
    if (fields) fields.hidden = true;
    if (sub) sub.hidden = true;
  }

  function writeOwn() {
    active = null;
    pickSeq++;
    handoff.cancel();
    markActive(null);
    showExpected();
    hideSourceCard();
    if ($("channel")) $("channel").value = "contact-form";
    $("message").focus();
    setStatus("");
  }

  // A click only fills. The form sits above the scenario list, so bring it into view and park focus on the button that starts the run
  // (when createHandoff says it is safe: see above).
  var handoff = createHandoff();
  var handoffTarget = null, handoffFrom = null, keyDown = null;
  function onFrom() {
    var ae = document.activeElement;
    return !ae || ae === document.body || ae === document.documentElement || ae === handoffFrom;
  }
  function focusTarget() {
    var btn = handoffTarget;
    if (btn && btn.focus) { try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); } }
  }
  function scrollToForm() {
    var form = $("contact-form");
    var reduced = window.T && window.T.reduced;
    if (form && form.scrollIntoView) { try { form.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" }); } catch (e) { /* position only */ } }
  }
  function focusSubmit(btn) {
    handoffTarget = btn;
    scrollToForm();
    if (handoff.filled(onFrom())) focusTarget();
  }

  function pickScenario(id, fromBtn, viaKey) {
    handoffFrom = fromBtn || null;
    handoff.begin(Boolean(viaKey), Boolean(viaKey && keyDown));
    var e = entryById(id);
    if (!e || busy) return;
    var seq = ++pickSeq;
    active = e;
    markActive(id);
    showExpected();
    var f = $("flow");
    if (f) f.hidden = true;
    setReason(reasonValueFor(e));
    picked = { shown: $("reason") ? $("reason").value : "", sent: str(e.scenario) || "free_text" };
    if ($("channel")) $("channel").value = str(e.channel) || "contact-form";
    $("message").value = str(e.message);
    if ($("as_of")) $("as_of").value = str(e.as_of) || DEFAULT_AS_OF;
    setStatus("Filling in a name and email…");
    getJson("/demo/client?scenario=" + enc(id), { timeoutMs: 10000 })
      .then(function (r) {
        if (r.ok && r.body && (r.body.name || r.body.email)) return { client: r.body, note: "" };
        throw new Error("no client");
      })
      .catch(function () {
        return { client: { name: e.name, email: e.email }, note: "A fresh name could not be generated; using the name on the entry. " };
      })
      .then(function (res) {
        if (seq !== pickSeq) return; // a later click or an edit owns the form now
        $("name").value = str(res.client.name);
        $("email").value = str(res.client.email);
        if (e.channel === "trustpilot" || e.channel === "email") {
          showSourceCard(e, res.client);
          setStatus(res.note + "Message filled. Press Simulate arrival to send it.");
          focusSubmit(document.querySelector("#source-card .src__submit"));
        } else {
          hideSourceCard();
          setStatus(res.note + "Ready: check the message, then press Submit dispatch.");
          focusSubmit($("submit"));
        }
      });
  }

  /* ---------- the flow ---------- */
  function stateKind(j) {
    var s = callFlow("stateOf", [j]);
    if (s && typeof s === "object") s = s.kind || s.state;
    if (typeof s === "string" && s) return s;
    var rep = obj(obj(j.human).reply);
    if (rep.kind === "auto_reply" || rep.kind === "answer") return "auto";
    if (rep.kind === "draft_for_human") return "draft";
    if (rep.kind === "escalation") return rep.text ? "escalation" : (rep.to ? "route" : "none");
    return rep.to && !rep.text ? "route" : "none";
  }

  var STATE_WORDS = { running: "Running", auto: "Replied automatically", draft: "Draft for a person", route: "Routed to a person", escalation: "Escalated", none: "No reply", error: "Error" };

  function setFlowState(kind, extra, text) {
    var st = $("flow-state"), badge = $("flow-badge");
    if (st) st.setAttribute("data-kind", kind);
    if (badge) badge.textContent = (text || STATE_WORDS[kind] || kind) + (extra ? " · " + extra : "");
  }

  function sentWord(j) {
    var s = obj(j.sent).status;
    return s === "handled" ? "HANDLED" : (s === "follow_up" ? "FOLLOW UP" : "");
  }

  function showFlow() { var f = $("flow"); if (f) f.hidden = false; }

  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function startTicker(runId) {
    var slot = $("flow-run");
    var t0 = Date.now();
    cur.started = t0;
    var tick = function () {
      if (slot) slot.textContent = "Running · " + runId + " · " + Math.floor((Date.now() - t0) / 1000) + " s";
    };
    stopTicker();
    tick();
    ticker = setInterval(tick, 1000);
  }

  function showError(msg) {
    stopTicker();
    showFlow();
    setFlowState("error");
    var slot = $("flow-run");
    if (slot) slot.textContent = cur.runId || "";
    var t = $("thread");
    clear(t);
    t.appendChild(el("p", msg, "thread__meta"));
    setStatus(msg, true);
    cur.journey = null;
  }

  /* fallback thread: only what the journey itself says */
  function fallbackThread(j) {
    var frag = document.createDocumentFragment();
    var human = obj(j.human);
    var rep = obj(human.reply);
    var inp = obj(j.input);
    var kind = stateKind(j);
    var who = el("div", null, "thread__msg thread__msg--customer");
    who.appendChild(el("p", [str(inp.name) || str(inp.from), str(j.channel_label)].filter(Boolean).join(" · "), "thread__meta"));
    who.appendChild(el("p", str(inp.text) || str(human.input), "thread__body"));
    frag.appendChild(who);
    var to = obj(rep.to);
    if (rep.to) {
      var rc = el("div", null, "route");
      rc.appendChild(el("p", str(to.name), "route__who"));
      var tl = str(j.team_label) || str(j.team);
      if (tl) rc.appendChild(el("p", tl, "route__team"));
      if (to.role) rc.appendChild(el("p", str(to.role), "route__role"));
      var cc = Array.isArray(j.cc) ? j.cc.map(function (c) { return str(obj(c).name); }).filter(Boolean) : [];
      if (cc.length) rc.appendChild(el("p", "CC: " + cc.join(", "), "route__cc"));
      if (j.memory_note) rc.appendChild(el("p", str(j.memory_note), "route__note"));
      frag.appendChild(rc);
    }
    var sent = obj(j.sent);
    if (j.sent) {
      var sm = el("div", null, "thread__msg thread__msg--agent thread__msg--sent");
      sm.appendChild(el("p", "Sent" + (sent.by ? " by " + sent.by : "") + (sent.at ? " · " + sent.at : ""), "thread__meta"));
      sm.appendChild(el("p", str(sent.body), "thread__body"));
      frag.appendChild(sm);
      var chip = el("p", sentWord(j), "thread__status");
      chip.setAttribute("data-status", str(sent.status));
      frag.appendChild(chip);
      var w = el("dl", null, "write");
      [["Ticket", sent.ticket_id], ["Status", sentWord(j)], ["Sent by", sent.by], ["Sent at", sent.at], ["File", sent.queue_file]].forEach(function (kv) {
        if (!kv[1]) return;
        var row = el("div", null, "write__row");
        row.appendChild(el("dt", kv[0], "write__k"));
        row.appendChild(el("dd", kv[1], "write__v"));
        w.appendChild(row);
      });
      frag.appendChild(w);
    } else if (kind === "draft" && rep.text) {
      var dm = el("div", null, "thread__msg thread__msg--internal");
      dm.appendChild(el("p", "Draft" + (to.name ? " for " + to.name : ""), "thread__meta"));
      var ta = el("textarea", null, "thread__draft");
      ta.value = str(rep.text);
      ta.rows = 8;
      ta.maxLength = 4000;
      ta.setAttribute("aria-label", "Draft reply");
      dm.appendChild(ta);
      var sb = el("button", "SEND", "btn thread__send");
      sb.type = "button";
      sb.addEventListener("click", function () { sb.disabled = true; doSend(ta.value, to.name ? String(to.name) : ""); });
      dm.appendChild(sb);
      frag.appendChild(dm);
    } else if (rep.text) {
      var am = el("div", null, "thread__msg thread__msg--agent");
      var body = el("p", null, "thread__body");
      withBlanks(body, rep.text);
      am.appendChild(body);
      frag.appendChild(am);
    } else if (rep.to) {
      frag.appendChild(el("p", "No draft: " + str(to.name) + " writes the reply", "thread__meta"));
    }
    return frag;
  }

  function fallbackDrawer(j) {
    var list = $("dr-list");
    clear(list);
    var nodes = Array.isArray(j.nodes) ? j.nodes : [];
    var onPath = {};
    var path = obj(j.human).path;
    if (Array.isArray(path)) linkPath(path, nodes).forEach(function (k) { if (k >= 0) onPath[k] = true; });
    nodes.forEach(function (n, k) {
      var tech = str(n.tech).toLowerCase();
      var row = el("li", null, "dr__row");
      if (tech) row.setAttribute("data-tech", tech);
      if (onPath[k]) row.setAttribute("data-path", "1");
      row.appendChild(el("span", n.n != null ? n.n : k + 1, "dr__n"));
      if (n.tech) row.appendChild(el("span", n.tech, "dr__tech"));
      if (n.model) row.appendChild(el("span", n.model, "dr__model"));
      row.appendChild(el("span", typeof n.duration_ms === "number" ? fmtMs(n.duration_ms) : "—", "dr__ms"));
      var stt = el("span", str(n.status), "dr__status");
      stt.setAttribute("data-status", str(n.status));
      row.appendChild(stt);
      row.appendChild(el("span", str(n.label), "dr__label"));
      if (n.route) row.appendChild(el("p", n.route, "dr__route"));
      list.appendChild(row);
    });
  }

  function fallbackGlossary() {
    var g = callFlow("glossary", []);
    var box = $("dr-glossary");
    clear(box);
    if (!Array.isArray(g)) return;
    g.forEach(function (x) {
      var t = typeof x === "string" ? x : (x && (x.text || x.body)) || "";
      if (t) box.appendChild(el("p", t));
    });
  }

  // renderFlow fills #thread, the badge and the drawer list; the page only supplies what SEND does.
  function paint(j) {
    var done = false;
    if (flow("renderFlow")) {
      try { callFlow("renderFlow", [document, j, { onSend: function (text, by) { doSend(text, by); } }]); done = true; } catch (e) { done = false; }
    }
    if (!done) {
      var t = $("thread");
      clear(t);
      t.appendChild(fallbackThread(j));
      fallbackDrawer(j);
      fallbackGlossary();
    }
    var kind = stateKind(j);
    var st = callFlow("stateOf", [j]);
    setFlowState(kind, sentWord(j), st && typeof st.text === "string" ? st.text : "");
    var run = $("dr-run"), total = $("dr-total");
    if (run) run.textContent = str(j.run_id);
    if (total) {
      var nodes = Array.isArray(j.nodes) ? j.nodes : [];
      var sum = 0, all = nodes.length > 0;
      nodes.forEach(function (n) { if (typeof n.duration_ms === "number") sum += n.duration_ms; else all = false; });
      total.textContent = all ? "Total " + fmtMs(sum) : "";
    }
  }

  // "Nudge, don't open": a one-time pulse and a hint beside Under the hood once the reply has landed; the drawer stays shut.
  function nudgeDrawer() {
    var b = $("open-drawer"), h = $("drawer-hint"), d = $("drawer");
    if (!b || !h || (d && d.open)) return;
    h.hidden = false;
    b.classList.remove("is-nudge");
    void b.offsetWidth;
    b.classList.add("is-nudge");
  }
  function clearNudge() {
    var b = $("open-drawer"), h = $("drawer-hint");
    if (b) b.classList.remove("is-nudge");
    if (h) h.hidden = true;
  }

  function renderJourney(j) {
    cur.journey = j;
    showFlow();
    var slot = $("flow-run");
    if (slot) {
      // The run's own time: the sum of the nodes' duration_ms, or (no durations) the POST /run wall time.
      // Both are fixed once the run is done, so a send (which re-renders) never changes it.
      var nodes = Array.isArray(j.nodes) ? j.nodes : [], sum = 0, all = nodes.length > 0;
      nodes.forEach(function (n) { if (n && typeof n.duration_ms === "number") sum += n.duration_ms; else all = false; });
      var ms = all ? sum : (cur.runId === j.run_id && typeof cur.postMs === "number" ? cur.postMs : null);
      slot.textContent = str(j.run_id) + (ms !== null ? " · " + fmtMs(ms) : "");
    }
    paint(j);
    nudgeDrawer();
    if (active && cur.entry === active && cur.runId === j.run_id) {
      var cmp = callFlow("compareExpected", [active.expected, j]);
      showExpected(cmp && typeof cmp.text === "string" ? cmp.text : "");
    }
  }

  function loadJourney(id) {
    return getJson("/runs/" + enc(id) + "/journey", { timeoutMs: 20000 }).then(function (r) {
      if (!r.ok || !r.body) throw new Error(errMsg(r.body, r.code));
      return r.body;
    });
  }

  /* ---------- run ---------- */
  function run(input) {
    var runId = "run-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    cur = { runId: runId, journey: null, started: Date.now(), entry: active };
    setBusy(true);
    clearNudge();
    setStatus("");
    setNote("");
    showFlow();
    clear($("thread"));
    setFlowState("running");
    startTicker(runId);
    var f = $("flow");
    if (f && f.scrollIntoView) { try { f.scrollIntoView({ block: "start", behavior: window.T && window.T.reduced ? "auto" : "smooth" }); } catch (e) { /* position only */ } }

    getJson("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, input: input })
    })
      .then(function (r) {
        if (typeof cur.postMs !== "number") cur.postMs = Date.now() - cur.started;
        if (r.code === 502 || r.code === 504 || r.code === 524) {
          setStatus("Still working: long runs can take a few minutes…");
          return pollRunUntilDone(runId, 100);
        }
        return r;
      })
      .then(function (r) {
        var b = r.body;
        if (!r.ok || !b || b.status === "error") throw new Error(errMsg(b, r.code));
        var id = str(b.run_id) || runId;
        cur.runId = id;
        return loadJourney(id);
      })
      .then(function (j) {
        stopTicker();
        setStatus("");
        renderJourney(j);
      })
      .catch(function (e) {
        showError((e && e.message) || "The server could not be reached.");
      })
      .then(function () { setBusy(false); });
  }

  /* ---------- SEND ---------- */
  function sendButton() { return document.querySelector("#thread .thread__send"); }

  function doSend(rawText, rawBy) {
    var j = cur.journey;
    var btn = sendButton();
    if (sending || !j || !j.run_id) return;
    var text = str(rawText).trim();
    if (!text) { if (btn) btn.disabled = false; setNote("Write the reply first."); return; }
    var by = str(rawBy) || str(obj(obj(obj(j.human).reply).to).name);
    var payload = { text: text };
    if (by) payload.by = by;
    sending = true;
    if (btn) btn.disabled = true;
    setNote("Sending…");
    var id = j.run_id;
    var message = "";
    getJson("/runs/" + enc(id) + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        if (!r.ok) {
          message = errMsg(r.body, r.code);
          if (r.code !== 409) { var b1 = sendButton(); if (b1) b1.disabled = false; return null; }
        }
        return loadJourney(id);
      })
      .then(function (nj) {
        if (nj) renderJourney(nj);
        setNote(message);
      })
      .catch(function (e) {
        var b2 = sendButton();
        if (b2) b2.disabled = false;
        setNote((e && e.message) || "The send did not go through.");
      })
      .then(function () { sending = false; });
  }

  /* ---------- the drawer ---------- */
  function openDrawer(opener) {
    var d = $("drawer");
    if (!d || d.open) return;
    if (!cur.journey) { setNote("Nothing to show yet: run a dispatch first."); return; }
    drawerOpener = opener || null;
    clearNudge();
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    if (window.T && window.T.lenis && typeof window.T.lenis.stop === "function") window.T.lenis.stop();
    var c = d.querySelector("[data-close]");
    if (c) c.focus();
  }

  function onDrawerClosed() {
    if (window.T && window.T.lenis && typeof window.T.lenis.start === "function") window.T.lenis.start();
    if (drawerOpener && drawerOpener.focus) { try { drawerOpener.focus({ preventScroll: true }); } catch (e) { /* focus only */ } }
    drawerOpener = null;
  }

  /* ---------- URL contract ---------- */
  function applyUrlPrefill() {
    var params = new URLSearchParams(location.search);
    var scen = params.get("scenario");
    var slug = params.get("product");
    if (scen && REASON_VALUES.indexOf(scen) >= 0) setReason(scen);
    if (slug) {
      fetch("data/catalogue.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (cat) {
        var list = cat && Array.isArray(cat.products) ? cat.products : [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].slug === slug && list[i].name) {
            var m = $("message");
            if (m && !active) m.value = (m.value ? m.value + "\n" : "") + "About the " + list[i].name + ".";
            return;
          }
        }
      }).catch(function () { /* an unknown slug adds nothing */ });
    }
    return params.get("run");
  }

  function loadFaqIndex() {
    getJson("/faq", { timeoutMs: 10000 }).then(function (r) {
      if (!r.ok || !Array.isArray(r.body) || !window.JP_FLOW) return;
      var idx = {};
      r.body.forEach(function (row) {
        var id = str(obj(row).faq_id);
        if (!id) return;
        idx[id] = str(row.question);
        idx["faq:" + id] = str(row.question);
      });
      window.JP_FLOW.faqIndex = idx;
    }).catch(function () { /* the hit text then shows the row's own key */ });
  }

  /* ---------- wiring ---------- */
  function init() {
    var form = $("contact-form");
    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (busy) return;
        var input = readInput();
        if (!input.message) { setStatus("Write a message first.", true); $("message").focus(); return; }
        var em = $("email").value.trim();
        if (em && em.indexOf("@") < 1) { setStatus("That email address does not look right.", true); $("email").focus(); return; }
        run(input);
      });
    }
    var msg = $("message");
    if (msg) msg.addEventListener("input", function () {
      if (active && msg.value.trim() !== str(active.message).trim()) { active = null; pickSeq++; handoff.cancel(); markActive(null); showExpected(); }
    });
    document.addEventListener("keydown", function (ev) {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target && ev.target.closest && ev.target.closest(".sc__btn")) keyDown = ev.target.closest(".sc__btn");
    }, true);
    document.addEventListener("keyup", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var was = keyDown;
      keyDown = null;
      if (was && handoff.keyup(onFrom())) focusTarget();
    }, true);
    window.addEventListener("blur", function () { keyDown = null; handoff.blur(); });
    var box = $("scenarios");
    if (box) box.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".sc__btn") : null;
      if (b) pickScenario(b.getAttribute("data-id"), b, ev.detail === 0 || keyDown === b);
    });
    var card = $("source-card");
    if (card) card.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (b && b.getAttribute("data-act") === "write-own") writeOwn();
    });
    var open = $("open-drawer");
    if (open) open.addEventListener("click", function () { openDrawer(open); });
    var d = $("drawer");
    if (d) {
      d.addEventListener("close", onDrawerClosed);
      d.addEventListener("click", function (ev) {
        if (ev.target === d) d.close();
        else if (ev.target.closest && ev.target.closest("[data-close]")) d.close();
      });
    }

    var runParam = applyUrlPrefill();
    loadScenarios();
    loadFaqIndex();
    if (runParam) {
      cur = { runId: runParam, journey: null, started: 0, entry: null };
      setStatus("Loading run " + runParam + "…");
      loadJourney(runParam)
        .then(function (j) { setStatus(""); renderJourney(j); })
        .catch(function (e) { showError((e && e.message) || "That run could not be loaded."); });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

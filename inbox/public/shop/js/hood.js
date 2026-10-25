/* "Under the hood": a bonnet panel that opens over the contact page and replays a real run, station by station.
 *
 * Drop-in add-on. It reads only the journey the page already loaded (GET /runs/<id>/journey: nodes with step, agent,
 * label, route, detail, consulted, retained, status, model, tech, duration_ms). Nothing is generated: every line on screen
 * is a node of that journey, and the "step time" counters run up to the node's real duration_ms.
 *
 * It needs three lines in contact.html (after js/contact.js):
 *   <link rel="stylesheet" href="css/hood.css">
 *   <script src="js/hood-sounds.js" defer></script>
 *   <script src="js/hood.js" defer></script>
 * and replaces the "Under the hood" buttons' action (the old drawer stays, behind "Full list").
 * Link straight into it: contact.html?run=<run id>&hood=1
 */
(function () {
  "use strict";

  var STATIONS = [
    { id: "intake", no: "01", name: "Intake", tag: "Contact form" },
    { id: "memory", no: "02", name: "H-MEM", tag: "Memory" },
    { id: "zetaris", no: "03", name: "Zetaris", tag: "Live data" },
    { id: "scout", no: "04", name: "Scout", tag: "Meterless" },
    { id: "planner", no: "05", name: "Planner", tag: "Branch" },
    { id: "gates", no: "06", name: "Gates", tag: "OpenJev" },
    { id: "drafter", no: "07", name: "Drafter", tag: "Nightshift" },
    { id: "evaluator", no: "08", name: "Evaluator", tag: "Critique" },
    { id: "risk", no: "09", name: "Risk", tag: "Sign-off" },
    { id: "escalator", no: "10", name: "Escalator", tag: "Hand-off" }
  ];
  var CHAIN = STATIONS.map(function (s) { return s.id; });
  var VERDICT = {
    send: ["Engage", "The agent answered on its own."],
    hold: ["Held in carbon freeze", "A human reads it before anything goes out."],
    escalate: ["Routed up the chain", "They find your lack of approval disturbing."],
    close: ["These are not the tickets you are looking for", "Nothing to do. Closed."]
  };
  var VSND = { send: "v_send", hold: "v_hold", escalate: "v_escalate", close: "v_hold" };
  var NS = "http://www.w3.org/2000/svg";
  var W = 196, H = 124, CX = [118, 359, 600, 841, 1082], CY = [105, 335];

  var $ = function (id) { return document.getElementById(id); };
  var str = function (v) { return typeof v === "string" ? v : ""; };
  var clip = function (s, n) { s = str(s); return s.length > n ? s.slice(0, n - 1).replace(/\s+$/, "") + "…" : s; };
  var fmt = function (ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms"; };

  /* ---------- sound (Web Audio; decoded once, played on demand) ---------- */
  var ac = null, master = null, soundOn = true, bufs = {};
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.6; master.connect(ac.destination);
    var S = window.JP_HOOD_SOUNDS || {};
    Object.keys(S).forEach(function (k) {
      var bin = atob(S[k]), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      ac.decodeAudioData(u.buffer).then(function (b) { bufs[k] = b; }, function () { /* a missing sound is not an error */ });
    });
  } catch (e) { ac = null; }
  window.__sfxLog = [];
  function sfx(name, gain) {
    window.__sfxLog.push({ t: Date.now(), n: name, g: gain == null ? 1 : gain });   // read by the video recorder
    if (!soundOn || !ac || !bufs[name]) return;
    if (ac.state === "suspended") ac.resume();
    var s = ac.createBufferSource(); s.buffer = bufs[name];
    var g = ac.createGain(); g.gain.value = gain == null ? 1 : gain;
    s.connect(g); g.connect(master); s.start();
  }
  function later(fn, ms) { return setTimeout(fn, ms); }

  /* ---------- journey -> visits (a visit = consecutive nodes at one station) ---------- */
  function stationOf(n) {
    var s = n.step, a = n.agent;
    if (s === "memory.read" || s === "memory.write") return "memory";
    if (s === "zetaris.query" || s === "executor.act") return "zetaris";
    if (s === "meterless.engine") return "scout";
    if (s === "nvidia.model") {
      if (a === "Gates" || a === "Severity") return "gates";
      if (a === "Reader" || a === "RefundReader") return "evaluator";
      return "drafter";
    }
    if (s === "critique") return "evaluator";
    if (s === "risk.signoff") return "risk";
    if (s === "escalate_or_fallback") return "escalator";
    if (s === "planner.plan" || s === "delegate" || s === "branch" || s === "retry" || s === "recovery") return "planner";
    return null;   // synthesis is the outcome, not a station
  }
  function notRun(n) { return n.status === "skipped" || /not run/i.test(str(n.tech)); }
  function buildVisits(j) {
    var text = str((j.input && j.input.text) || (j.human && typeof j.human.input === "string" ? j.human.input : ""));
    var visits = [{ st: "intake", nodes: [{ step: "intake", agent: "Intake", label: "Ticket in", route: text, detail: "", tech: "", status: "success", duration_ms: 0, consulted: [], retained: [] }] }];
    (Array.isArray(j.nodes) ? j.nodes : []).forEach(function (n) {
      var st = stationOf(n);
      if (!st) return;
      var last = visits[visits.length - 1];
      if (last.st === st) last.nodes.push(n); else visits.push({ st: st, nodes: [n] });
    });
    visits.forEach(function (v) {
      var d = 0; v.nodes.forEach(function (n) { if (typeof n.duration_ms === "number" && n.duration_ms > d) d = n.duration_ms; });
      v.dur = d;
      v.refused = v.nodes.some(function (n) { return n.status === "refused"; });
      v.skipped = v.nodes.every(notRun);
      v.revise = v.nodes.some(function (n) { return n.status === "needs_revision"; });
    });
    return visits;
  }
  function stationInfo(visits, id) {
    var vs = visits.filter(function (v) { return v.st === id; }), dur = 0;
    vs.forEach(function (v) { dur += v.dur; });
    return { visits: vs, dur: dur, refused: vs.some(function (v) { return v.refused; }), skipped: vs.length > 0 && vs.every(function (v) { return v.skipped; }) };
  }

  /* ---------- state ---------- */
  var journey = null, visits = [], opened = false, opener = null, runId = 0, speed = 1, step = 0;
  var scrim, panel, svg, nodes = {}, wires = [], packet, whoEl, lineEl, verdictEl, detailEl, stepEl, swEl, built = false;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sv(tag, attrs, text) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  var pos = function (i) { return { x: CX[i % 5], y: CY[Math.floor(i / 5)] }; };
  function wirePath(i) {
    var a = pos(i), b = pos(i + 1);
    if (a.y === b.y) return "M" + (a.x + W / 2) + "," + a.y + " H" + (b.x - W / 2);
    return "M" + a.x + "," + (a.y + H / 2) + " V" + ((a.y + b.y) / 2) + " H" + b.x + " V" + (b.y - H / 2);
  }

  function build() {
    if (built) return;
    built = true;
    scrim = el("div", "hood-scrim"); scrim.hidden = true;
    panel = el("section", "hood"); panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-labelledby", "hood-title");

    var head = el("div", "hood__head");
    var pl = el("span", "hood__piston hood__piston--l"); pl.appendChild(el("i"));
    var pr = el("span", "hood__piston hood__piston--r"); pr.appendChild(el("i"));
    head.appendChild(pl); head.appendChild(pr);
    var ttl = el("div");
    ttl.appendChild(el("div", "hood__label", "Helmsward desk · a real run, replayed"));
    var h = el("h2", "hood__title"); h.id = "hood-title"; h.appendChild(document.createTextNode("Under the ")); h.appendChild(el("em", "", "hood"));
    ttl.appendChild(h); head.appendChild(ttl);

    var ctl = el("div", "hood__ctl");
    function btn(id, text) { var b = el("button", "hood__btn", text); b.type = "button"; b.id = id; ctl.appendChild(b); return b; }
    btn("hood-replay", "Replay").onclick = function () { sfx("ignite", 0.9); play(); };
    btn("hood-prev", "◀ Back").onclick = function () { goTo(step - 1); };
    btn("hood-next", "Step ▶").onclick = function () { goTo(step + 1); };
    btn("hood-end", "Skip to end").onclick = function () { goTo(visits.length - 1); };
    var sp = btn("hood-speed", "1×"); sp.onclick = function () { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; sp.textContent = speed + "×"; };
    var snd = btn("hood-snd", "Sound on"); snd.setAttribute("aria-pressed", "true");
    snd.onclick = function () { soundOn = !soundOn; snd.setAttribute("aria-pressed", String(soundOn)); snd.textContent = soundOn ? "Sound on" : "Sound off"; };
    if ($("drawer")) btn("hood-list", "Full list").onclick = function () { var d = $("drawer"); if (d && typeof d.showModal === "function") { d.showModal(); } };
    btn("hood-close", "Close").onclick = function () { toggle(false); };
    head.appendChild(ctl);
    panel.appendChild(head);
    ctl.querySelectorAll(".hood__btn").forEach(function (b) { if (b.id !== "hood-close" && b.id !== "hood-snd") b.addEventListener("click", function () { sfx("click", 0.7); }); });
    ctl.querySelectorAll(".hood__btn").forEach(function (b) { b.addEventListener("pointerenter", function () { sfx("hover", 0.25); }); });

    var body = el("div", "hood__body");
    svg = sv("svg", { viewBox: "0 0 1200 470", role: "group", "aria-label": "The ten stations a ticket passes through" });
    for (var i = 0; i < CHAIN.length - 1; i++) {
      var d = wirePath(i);
      svg.appendChild(sv("path", { "class": "wire", d: d }));
      var en = sv("path", { "class": "energy", d: d }); svg.appendChild(en); wires.push(en);
    }
    STATIONS.forEach(function (s, i) {
      var p = pos(i), l = p.x - W / 2, t = p.y - H / 2, r = l + W, b = t + H, k = 12;
      var g = sv("g", { "class": "node", tabindex: "0", role: "button", "aria-label": "Show what happened at " + s.name });
      g.appendChild(sv("rect", { "class": "box", x: l, y: t, width: W, height: H }));
      g.appendChild(sv("path", { "class": "tick", d: "M" + (l - 4) + "," + (t + k) + " V" + (t - 4) + " H" + (l + k) + " M" + (r - k) + "," + (t - 4) + " H" + (r + 4) + " V" + (t + k) + " M" + (l - 4) + "," + (b - k) + " V" + (b + 4) + " H" + (l + k) + " M" + (r - k) + "," + (b + 4) + " H" + (r + 4) + " V" + (b - k) }));
      g.appendChild(sv("text", { "class": "no", x: l + 14, y: t + 26 }, s.no));
      g.appendChild(sv("text", { "class": "nm", x: l + 14, y: p.y + 6 }, s.name));
      g.appendChild(sv("text", { "class": "tg", x: l + 14, y: p.y + 32 }, s.tag));
      var st = sv("text", { "class": "st", x: l + 14, y: p.y + 54 }, ""); g.appendChild(st);
      g.addEventListener("pointerenter", function () { sfx("hover", 0.25); });
      g.addEventListener("click", function () {
        var first = firstVisit(s.id); sfx("click", 0.8);
        goTo(first < 0 ? step : first, s.id);
      });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); g.dispatchEvent(new Event("click")); } });
      svg.appendChild(g); nodes[s.id] = { g: g, st: st };
    });
    packet = sv("circle", { "class": "packet", r: 7, cx: 0, cy: 0 }); svg.appendChild(packet);
    body.appendChild(svg);

    var subs = el("div", "hood__subs"); subs.setAttribute("aria-live", "polite");
    whoEl = el("span", "hood__label hood__who", " "); lineEl = el("span", "hood__line");
    subs.appendChild(whoEl); subs.appendChild(lineEl); body.appendChild(subs);
    stepEl = el("div", "hood__label", ""); stepEl.style.textAlign = "center"; body.appendChild(stepEl);

    verdictEl = el("div", "hood__verdict");
    body.appendChild(verdictEl);
    detailEl = el("div", "hood__detail"); detailEl.hidden = true; body.appendChild(detailEl);
    panel.appendChild(body);

    scrim.addEventListener("click", function () { toggle(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && opened) { var d = $("drawer"); if (d && d.open) return; toggle(false); } });
    document.body.appendChild(scrim); document.body.appendChild(panel);
  }

  /* ---------- engine ---------- */
  function Cancel() {}
  var sleep = function (ms, my) { return new Promise(function (res, rej) { setTimeout(function () { if (my === runId) res(); else rej(new Cancel()); }, ms / speed); }); };
  var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
  var setClass = function (id, c) { nodes[id].g.setAttribute("class", "node " + c); };
  function stationText(id) {
    var si = stationInfo(visits, id);
    if (!si.visits.length) return ["", "Not on this path"];
    if (si.refused) return ["refused", "Refused" + (si.visits.length > 1 ? " · " + si.visits.length + " passes" : "")];
    if (si.skipped) return ["skip", "Not needed"];
    var t = "OK" + (si.visits.length > 1 ? " · " + si.visits.length + " passes" : "") + (si.dur >= 50 ? " · " + fmt(si.dur) : "");
    return ["done", t];
  }
  function resetVisual() {
    packet.style.opacity = 0;
    wires.forEach(function (w) { var len = w.getTotalLength(); w.style.strokeDasharray = len; w.style.strokeDashoffset = len; w.dataset.len = len; });
    STATIONS.forEach(function (s) { setClass(s.id, ""); nodes[s.id].st.textContent = ""; });
    verdictEl.className = "hood__verdict"; verdictEl.textContent = ""; detailEl.hidden = true;
    whoEl.textContent = " "; lineEl.textContent = ""; lineEl.className = "hood__line";
  }
  async function travel(k, forward, my, ms) {
    var en = wires[k], len = +en.dataset.len, t0 = performance.now();
    sfx(forward ? "travel" : "back", 0.7); packet.style.opacity = 1;
    for (;;) {
      if (my !== runId) throw new Cancel();
      var p = Math.min(1, ((performance.now() - t0) * speed) / ms), q = forward ? p : 1 - p;
      var pt = en.getPointAtLength(q * len);
      packet.setAttribute("cx", pt.x); packet.setAttribute("cy", pt.y);
      if (forward) en.style.strokeDashoffset = len * (1 - p);
      if (p >= 1) break;
      await raf();
    }
    packet.style.opacity = 0;
  }
  async function moveTo(a, b, my) {
    var n = Math.abs(b - a), ms = n > 1 ? 380 : 720, k;
    if (b > a) for (k = a; k < b; k++) await travel(k, true, my, ms);
    else for (k = a - 1; k >= b; k--) await travel(k, false, my, ms);
  }
  async function type(text, my, cps) {
    lineEl.textContent = ""; lineEl.className = "hood__line typing";
    for (var i = 1; i <= text.length; i++) { lineEl.textContent = text.slice(0, i); if (i % 2 === 0) await sleep(1000 / cps, my); }
    lineEl.className = "hood__line";
  }
  function nodeText(n) {
    var t = str(n.label); var r = clip(n.route, 190);
    return r ? t + ": " + r : t;
  }
  function nodeMeta(n) { return [str(n.agent), str(n.tech), typeof n.duration_ms === "number" && n.duration_ms >= 50 ? fmt(n.duration_ms) : ""].filter(Boolean).join(" · "); }
  async function dwell(v, my) {
    var id = v.st, many = v.nodes.length > 6;
    var was = nodes[id].g.getAttribute("class") || "", worked = /(^| )(done|refused)( |$)/.test(was);
    if (!(v.skipped && worked)) { setClass(id, v.skipped ? "skip" : "on"); nodes[id].st.textContent = v.skipped ? "Not needed" : "Working"; }
    sfx(v.skipped ? "skip" : "station", v.skipped ? 0.5 : 0.8);
    for (var i = 0; i < v.nodes.length; i++) {
      var n = v.nodes[i];
      whoEl.textContent = nodeMeta(n);
      if (many) { lineEl.textContent = nodeText(n); sfx("line", 0.3); await sleep(150, my); }
      else { await type(nodeText(n), my, 110); await sleep(520, my); }
    }
    var extra = v.dur > 1500 ? Math.min(2600, v.dur / 18) : 0;   // real time, compressed: the counter runs up to the node's own duration_ms
    if (extra) {
      var t0 = performance.now();
      for (;;) {
        if (my !== runId) throw new Cancel();
        var p = Math.min(1, ((performance.now() - t0) * speed) / extra);
        nodes[id].st.textContent = "Step time " + fmt(v.dur * p);
        if (p >= 1) break;
        await raf();
      }
    }
    var cls = v.refused ? "refused" : v.skipped ? "skip" : "done";
    var txt = v.refused ? "Refused" : v.skipped ? "Not needed" : v.revise ? "Rewrite asked" : "OK" + (v.dur >= 50 ? " · " + fmt(v.dur) : "");
    if (cls === "skip" && /(^| )(done|refused)( |$)/.test(nodes[id].g.getAttribute("class") || "")) { cls = ""; }   // 'not reached' after real work: keep the station as it was
    if (cls) { setClass(id, cls); nodes[id].st.textContent = txt; }
    if (v.refused) sfx("refuse", 0.9);
    await sleep(240, my);
  }
  function showVerdict() {
    var j = journey, vd = VERDICT[j.decision] || [str(j.decision), ""];
    verdictEl.textContent = "";
    var a = el("div"); a.appendChild(el("div", "hood__label", "Decision")); a.appendChild(el("p", "hood__v", vd[0])); a.appendChild(el("p", "hood__q", vd[1]));
    var b = el("div"); b.appendChild(el("div", "hood__label", "Where it went"));
    var who = j.reached_human && j.reached_human.who ? "Waiting on " + str(j.reached_human.who.name) + (j.team_label ? " (" + str(j.team_label) + ")" : "") + "." : (j.team_label ? "Team: " + str(j.team_label) + "." : "");
    var total = 0, all = Array.isArray(j.nodes) && j.nodes.length > 0;
    (j.nodes || []).forEach(function (n) { if (typeof n.duration_ms === "number") total += n.duration_ms; else all = false; });
    b.appendChild(el("p", "hood__why", [who, all ? "The run took " + fmt(total) + " in all." : ""].filter(Boolean).join(" ")));
    verdictEl.appendChild(a); verdictEl.appendChild(b);
    verdictEl.className = "hood__verdict is-on";
    try { verdictEl.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { /* position only */ }
    sfx(VSND[j.decision] || "v_hold", 0.9);
  }
  function stepLabel() {
    if (!visits.length) { stepEl.textContent = ""; return; }
    var v = visits[step] || visits[0], s = STATIONS.filter(function (x) { return x.id === v.st; })[0];
    stepEl.textContent = "Step " + (step + 1) + " of " + visits.length + " · " + s.name;
  }
  async function play() {
    var my = ++runId; resetVisual(); step = 0; stepLabel();
    try {
      await sleep(350, my);
      var prev = -1;
      for (var i = 0; i < visits.length; i++) {
        step = i; stepLabel();
        var idx = CHAIN.indexOf(visits[i].st);
        if (prev >= 0 && idx !== prev) await moveTo(prev, idx, my);
        prev = idx;
        await dwell(visits[i], my);
      }
      whoEl.textContent = "Run complete"; lineEl.textContent = "";
      showVerdict();
    } catch (e) { if (!(e instanceof Cancel)) throw e; }
  }
  function firstVisit(id) { for (var i = 0; i < visits.length; i++) if (visits[i].st === id) return i; return -1; }

  /* time travel: show the run exactly as it stood at visit k, and what happened at the chosen station */
  function goTo(k, stationId) {
    if (!visits.length) return;
    var last = visits.length - 1, prev = step;
    runId++; k = Math.max(0, Math.min(last, k)); step = k;
    resetVisual();
    var reach = -1;
    for (var i = 0; i <= k; i++) {
      var v = visits[i], idx = CHAIN.indexOf(v.st); if (idx > reach) reach = idx;
      var cls = v.refused ? "refused" : v.skipped ? "skip" : "done", prevCls = nodes[v.st].g.getAttribute("class") || "";
      if (cls === "skip" && /(^| )(done|refused)( |$)/.test(prevCls)) { setClass(v.st, prevCls.replace(/^node /, "").replace(/ ?sel/, "") + (i === k ? " sel" : "")); continue; }
      setClass(v.st, cls + (i === k ? " sel" : ""));
      nodes[v.st].st.textContent = v.refused ? "Refused" : v.skipped ? "Not needed" : "OK" + (v.dur >= 50 ? " · " + fmt(v.dur) : "");
    }
    for (var w = 0; w < reach; w++) wires[w].style.strokeDashoffset = 0;
    var cur = visits[k], ln = cur.nodes[cur.nodes.length - 1];
    whoEl.textContent = nodeMeta(ln); lineEl.textContent = nodeText(ln);
    showDetail(stationId || cur.st);
    stepLabel();
    if (k === last) showVerdict();
    sfx(k < prev ? "back" : "step", 0.8);
  }
  function showDetail(id) {
    var st = STATIONS.filter(function (s) { return s.id === id; })[0], si = stationInfo(visits, id);
    detailEl.textContent = "";
    detailEl.appendChild(el("div", "hood__label", st.no + " · " + st.tag + (si.visits.length > 1 ? " · " + si.visits.length + " passes (the agent went round again)" : "")));
    detailEl.appendChild(el("h3", "", st.name));
    var ol = el("ol");
    if (!si.visits.length) ol.appendChild(el("li", "", "Not on this path: this ticket did not need this station."));
    si.visits.forEach(function (v, vi) {
      v.nodes.forEach(function (n) {
        var li = el("li");
        li.appendChild(el("span", "hood__label", [si.visits.length > 1 ? "Pass " + (vi + 1) : "", str(n.agent), str(n.tech), str(n.model), n.status && n.status !== "success" ? str(n.status) : "", typeof n.duration_ms === "number" && n.duration_ms >= 50 ? fmt(n.duration_ms) : ""].filter(Boolean).join(" · ")));
        li.appendChild(el("p", "", str(n.label) + (n.route ? ": " + clip(n.route, 400) : "")));
        if (n.detail && n.detail !== n.route) li.appendChild(el("p", "more", clip(n.detail, 400)));
        var c = Array.isArray(n.consulted) ? n.consulted.length : 0, r = Array.isArray(n.retained) ? n.retained.length : 0;
        if (c || r) li.appendChild(el("p", "more", "Looked at " + c + (c === 1 ? " item" : " items") + ", kept " + r + "."));
        ol.appendChild(li);
      });
    });
    detailEl.appendChild(ol); detailEl.hidden = false;
  }

  /* ---------- open / close: the bonnet ---------- */
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function toggle(on, trigger) {
    if (on === opened) return;
    if (on && !journey) return;
    build();
    opened = on; swEl && swEl.setAttribute("aria-checked", String(on));
    var lenis = window.T && window.T.lenis;
    if (on) {
      opener = trigger || null; visits = buildVisits(journey);
      scrim.hidden = false; panel.hidden = false; resetVisual(); stepLabel();
      sfx("tog_on", 0.9); later(function () { sfx("hood_open", 0.85); }, 70);
      requestAnimationFrame(function () { scrim.classList.add("is-on"); });
      if (lenis && lenis.stop) lenis.stop();
      var anim = panel.animate(
        [{ transform: "translateY(105%)" }, { transform: "translateY(-1.4%)", offset: 0.72 }, { transform: "translateY(0)" }],
        { duration: reduced ? 1 : 1050, easing: "cubic-bezier(.3,.6,.2,1)", fill: "forwards" });
      later(function () { panel.classList.add("is-open", "is-flare"); sfx("hood_clunk", 0.85); }, reduced ? 0 : 760);
      later(function () { panel.classList.remove("is-flare"); }, reduced ? 0 : 1250);
      anim.onfinish = function () { if (opened) { $("hood-close").focus({ preventScroll: true }); play(); } };
    } else {
      runId++; sfx("tog_off", 0.9); later(function () { sfx("hood_close", 0.8); }, 40);
      later(function () { sfx("hood_thunk", 0.7); }, reduced ? 0 : 560);
      panel.classList.remove("is-open", "is-flare"); scrim.classList.remove("is-on");
      var out = panel.animate([{ transform: "translateY(0)" }, { transform: "translateY(105%)" }], { duration: reduced ? 1 : 700, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" });
      out.onfinish = function () {
        if (opened) return;
        panel.hidden = true; scrim.hidden = true;
        if (lenis && lenis.start) lenis.start();
        var o = opener || swEl; if (o && o.focus) { try { o.focus({ preventScroll: true }); } catch (e) { /* focus only */ } }
      };
    }
  }

  /* ---------- hook into the page ---------- */
  function addSwitch() {
    var head = document.querySelector(".flow__head"), old = $("open-drawer");
    if (!head || swEl) return;
    swEl = el("button", "hood-switch"); swEl.type = "button"; swEl.id = "hood-switch";
    swEl.setAttribute("role", "switch"); swEl.setAttribute("aria-checked", "false");
    var tr = el("span", "hood-switch__track"); tr.appendChild(el("span", "hood-switch__knob"));
    swEl.appendChild(tr); swEl.appendChild(el("span", "", "Under the hood"));
    swEl.addEventListener("click", function () { toggle(!opened, swEl); });
    swEl.addEventListener("pointerenter", function () { sfx("hover", 0.25); });
    if (old && old.parentNode) old.parentNode.insertBefore(swEl, old); else head.appendChild(swEl);
  }
  function init() {
    var F = window.JP_FLOW;
    if (F && typeof F.renderFlow === "function") {
      var orig = F.renderFlow;
      F.renderFlow = function (doc, j) {          // contact.js looks the renderer up at call time, so this wrapper is used
        var was = opened; if (was) toggle(false);
        journey = j; addSwitch();
        return orig.apply(this, arguments);
      };
    }
    // the thread's own "Under the hood" button and the old header button both open the bonnet now
    document.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("#open-drawer, .thread__under");
      if (!b) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      toggle(!opened, b);
    }, true);
    addSwitch();
    if (/[?&]hood=1/.test(location.search)) {
      var tries = 0, t = setInterval(function () { if (journey || ++tries > 120) { clearInterval(t); if (journey) later(function () { toggle(true); }, 600); } }, 250);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  function openJourney(j, trigger) {          // the desk page hands over a journey it fetched itself
    if (opened) toggle(false);
    journey = j; toggle(true, trigger);
  }
  window.JP_HOOD = { toggle: toggle, goTo: goTo, play: play, openJourney: openJourney };
})();

/* Staff desk, Teams view: a column group per team, people inside it, a card per ticket with a traffic light.
   Deadlines come from data/deadlines.json (PROPOSED, in real hours). A card past its deadline is shown moved to the team head.
   SIMULATED: the API does not move tickets yet, so escalation exists only on this page. The demo clock changes only how fast
   age advances (1 min = 1 day by default); tickets keep their real arrival time. Text only: nothing from data is built as html. */
(function () {
  "use strict";
  var SPEEDS = [
    { key: "day", label: "1 min = 1 day", f: 1440 },
    { key: "hour", label: "1 min = 1 hour", f: 60 },
    { key: "real", label: "Real time", f: 1 }
  ];
  var HOUR = 3600000;
  var cfg = null, model = [], host = null, ui = {};
  var speed = SPEEDS[0], paused = false, pausedAt = 0, pausedTotal = 0;

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function realNow() { return (paused ? pausedAt : Date.now()) - pausedTotal; }
  function hoursFor(topic) {
    var h = cfg && cfg.hours ? cfg.hours : {};
    return h[topic] || h["default"] || 8;
  }
  // Virtual age in ms: real age since arrival, scaled by the demo clock.
  function ageOf(m) { return Math.max(0, (realNow() - m.at) * speed.f); }
  function light(m) {
    if (m.done) return "done";
    var r = ageOf(m) / (m.hours * HOUR);
    return r >= 1 ? "red" : r >= 0.5 ? "amber" : "green";
  }
  function fmt(ms) {
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 30) return "over 30 d";   // an old ticket against the fast demo clock: a number like 507 d means nothing
    if (d >= 1) return d + " d " + (h % 24) + " h";
    if (h >= 1) return h + " h " + (m % 60) + " m";
    return m + " m " + (Math.floor(ms / 1000) % 60) + " s";
  }
  function headFor(m) {
    var heads = (cfg && cfg.heads) || {}, h = heads[m.team];
    if (h && h.employee_id !== m.holderId) return h;
    return cfg && cfg.ceo ? cfg.ceo : null;           // the head already holds it, or the team has none: it goes to the CEO
  }

  function build(items, js, rids) {
    return items.map(function (q, i) {
      var j = js[i], held = j && j.reached_human && j.reached_human.who;
      var topic = (j && j.scenario) || q.scenario || q.category || "default";
      var at = new Date(q.at || q.mtime || Date.now()).getTime();
      return {
        q: q, j: j, rid: rids[i], topic: topic, at: isNaN(at) ? Date.now() : at,
        team: (j && j.team) || "Unassigned", teamLabel: (j && (j.team_label || j.team)) || "Unassigned",
        topicLabel: (j && j.topic_label) || topic,
        holder: (held && held.name) || (q.owner && q.owner.name) || "unassigned",
        holderId: (held && held.employee_id) || (q.owner && q.owner.employee_id) || 0,
        hours: hoursFor(topic), done: q.status === "handled", escalated: false, holderNow: null
      };
    });
  }

  function cardFor(m, deps) {
    var li = el("li", null, "tcard");
    var top = el("div", null, "tcard__top");
    var lamp = el("span", null, "lamp"); lamp.setAttribute("role", "img");
    top.appendChild(lamp);
    top.appendChild(el("strong", m.q.ticket_id || m.rid || m.q.run_id));
    top.appendChild(el("span", m.topicLabel, "dchip"));
    if (m.j && deps.star) top.appendChild(deps.star(m.j));   // P57: the desk's "★ Full journey" chip
    li.appendChild(top);
    var line = el("p", null, "tcard__who"), esc = el("p", null, "tcard__esc"), age = el("p", null, "tcard__age muted");
    li.appendChild(line); li.appendChild(esc); li.appendChild(age);
    if (m.rid && deps.hoodButton) li.appendChild(deps.hoodButton(m.rid));
    var sg = deps.chainButton && deps.chainButton(m.rid, m.q); if (sg) li.appendChild(sg);
    m.ui = { li: li, lamp: lamp, line: line, esc: esc, age: age };
    refreshCard(m);
    return li;
  }
  function refreshCard(m) {
    var l = light(m), u = m.ui;
    if (!u) return;
    u.li.className = "tcard tcard--" + l;
    u.lamp.className = "lamp lamp--" + l;
    u.lamp.setAttribute("aria-label", l === "done" ? "handled" : l);
    u.line.textContent = m.escalated ? "Now with " + m.holderNow.name + " (" + m.holder + " had it)" : "Held by " + m.holder;
    u.esc.textContent = m.escalated ? "Auto-escalated to " + m.holderNow.name + ", " + m.holderNow.role + " (simulated)" : "";
    u.esc.hidden = !m.escalated;
    u.age.textContent = m.done ? "Handled" : fmt(ageOf(m)) + " of " + m.hours + " h deadline";
  }
  function applyState() {
    var changed = false;
    model.forEach(function (m) {
      var esc = !m.done && light(m) === "red";
      if (esc !== m.escalated) changed = true;
      if (esc) {
        var h = headFor(m);
        m.holderNow = h ? { name: h.name, role: h.role } : { name: m.holder, role: "" };
      }
      m.escalated = esc;
    });
    return changed;
  }

  function draw(deps) {
    var box = ui.board; box.textContent = "";
    if (!model.length) { box.appendChild(el("p", "No tickets yet. Log one on the contact page and it will appear here.", "muted")); return; }
    var teams = {}, order = [];
    model.forEach(function (m) {
      if (!teams[m.team]) { teams[m.team] = { label: m.teamLabel, people: {}, porder: [] }; order.push(m.team); }
      var t = teams[m.team], who = m.escalated ? m.holderNow.name : m.holder;
      if (!t.people[who]) { t.people[who] = el("ul", null, "col__cards"); t.porder.push(who); }
      t.people[who].appendChild(cardFor(m, deps));
    });
    order.forEach(function (k) {
      var t = teams[k], g = el("section", null, "tgroup");
      g.appendChild(el("h3", t.label, "tgroup__h"));
      var cols = el("div", null, "tgroup__cols");
      t.porder.forEach(function (p) {
        var col = el("section", null, "col"), head = el("header", null, "col__head");
        head.appendChild(el("h4", p)); head.appendChild(el("span", t.people[p].children.length, "col__n"));
        col.appendChild(head); col.appendChild(t.people[p]); cols.appendChild(col);
      });
      g.appendChild(cols); box.appendChild(g);
    });
  }

  function tick() {
    if (applyState()) draw(ui.deps); else model.forEach(refreshCard);
    ui.clock.textContent = "Demo clock: " + speed.label + (paused ? " (paused)" : "") + ". Escalation is simulated.";
  }
  function controls() {
    var bar = ui.bar; bar.textContent = "";
    SPEEDS.forEach(function (s) {
      var b = el("button", s.label, "desk__btn" + (s === speed ? " desk__btn--hot" : ""));
      b.type = "button"; b.setAttribute("aria-pressed", s === speed ? "true" : "false");
      b.addEventListener("click", function () { speed = s; controls(); tick(); });
      bar.appendChild(b);
    });
    var p = el("button", paused ? "Resume" : "Pause", "desk__btn");
    p.type = "button"; p.setAttribute("aria-pressed", paused ? "true" : "false");
    p.addEventListener("click", function () {
      if (paused) { pausedTotal += Date.now() - pausedAt; paused = false; } else { pausedAt = Date.now(); paused = true; }
      controls(); tick();
    });
    bar.appendChild(p);
  }

  function init() {
    host = document.getElementById("teams");
    if (!host) return;
    ui.deps = {};
    ui.bar = el("div", null, "tclock__bar"); ui.clock = el("p", null, "tclock__txt"); ui.board = el("div", null, "tgroups");
    ui.bar.setAttribute("role", "group"); ui.bar.setAttribute("aria-label", "Demo clock speed");
    var note = el("p", "Proposed deadlines, not agreed. Escalation is simulated: the API does not move tickets yet, so a red card moves to the team head on this page only. Lights: green under half the deadline, amber up to the deadline, red overdue.", "tclock__note muted");
    host.appendChild(ui.clock); host.appendChild(ui.bar); host.appendChild(note); host.appendChild(ui.board);
    controls();
    ui.clock.textContent = "Demo clock: " + speed.label + ". Escalation is simulated.";
    fetch("data/deadlines.json").then(function (r) { return r.json(); }).then(function (d) { cfg = d; })
      .catch(function () { cfg = { hours: { "default": 8 }, heads: {} }; });
    setInterval(function () { if (cfg && !document.hidden) tick(); }, 1000);
  }

  window.JP_TEAMS = {
    render: function (items, js, rids, deps) {
      if (!host) return;
      ui.deps = deps || {};
      if (!cfg) { setTimeout(function () { window.JP_TEAMS.render(items, js, rids, deps); }, 150); return; }
      model = build(items, js, rids); applyState(); draw(ui.deps); tick();
    }
  };
  init();
})();

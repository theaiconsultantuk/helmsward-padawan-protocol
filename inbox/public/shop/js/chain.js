/* Approval chain for a run: who has to sign, who stands in when someone is out, and what goes out when they have.
   The first two steps are real (the run's own record). The emails and signatures are a SIMULATION and the page says so:
   nothing is sent, and signing changes nothing on the server. State lives in this browser only (localStorage).
   Who signs comes from data/approval-chain.json, built from policy.csv, responsibility.csv and the hierarchy. Text only: no html from data. */
(function () {
  "use strict";
  var DATA = null;
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = String(text); if (cls) e.className = cls; return e; }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
  function load() {
    if (DATA) return Promise.resolve(DATA);
    return fetch("data/approval-chain.json").then(function (r) { return r.json(); }).then(function (d) { DATA = d; return d; });
  }
  function key(id) { return "jp_chain_" + id; }
  function getState(id) { try { return JSON.parse(localStorage.getItem(key(id))) || {}; } catch (e) { return {}; } }
  function putState(id, s) { try { localStorage.setItem(key(id), JSON.stringify(s)); } catch (e) { /* the page still works without storage */ } }

  // The signers for a run, in order. Each: { id, backup, role-note }.
  function plan(j, d) {
    var topic = j.scenario, t = d.topics[topic], said = (j.human && j.human.input) || (typeof j.input === "string" ? j.input : "") || "";
    var m = /(\d[\d,]*(?:\.\d+)?)\s*GC/i.exec(said), amount = m ? Number(m[1].replace(/,/g, "")) : null;
    var held = j.reached_human && j.reached_human.who;
    if (t && amount != null && amount > t.limit) {
      return { amount: amount, limit: t.limit, dual: true, why: amount + " GC is over the " + t.limit + " GC limit for " + topic + ": two signatures",
        signers: [{ id: t.over_owner, backup: t.over_backup }, { id: d.second_signer.id, backup: "201" }] };
    }
    var desk = d.desks[topic] || d.desks.other || {};
    var legal = (j.nodes || []).some(function (n) { return n.step === "branch" && /legal threat/i.test(n.route || ""); });
    if (legal && d.desks.legal) {
      var owner = held && held.employee_id != null ? String(held.employee_id) : String(desk.owner || "");
      return { amount: amount, limit: null, dual: true, cc: d.copy_on_legal || [], why: "Legal threat: Support owns the reply and Legal reviews, two signatures",
        signers: [{ id: owner, backup: owner === String(desk.owner) ? String(desk.backup || "") : String(desk.owner || "") }, { id: d.desks.legal.owner, backup: d.desks.legal.backup }] };
    }
    var first = held && held.employee_id != null ? String(held.employee_id) : String(desk.owner || "");
    var back = first === String(desk.owner) ? String(desk.backup || "") : String(desk.owner || "");
    return { amount: amount, limit: t ? t.limit : null, dual: false, why: t && amount != null ? amount + " GC is within the " + t.limit + " GC limit: one signature" : "One signature from the person who holds the ticket",
      signers: [{ id: first, backup: back }], handoff: held && desk.owner && String(held.employee_id) !== String(desk.owner) ? desk.owner : null };
  }
  function person(d, id) { return d.people[String(id)] || { name: "Employee " + id, email: "", role: "" }; }

  var dlg = null;
  function ensure() {
    if (dlg) return dlg;
    dlg = el("dialog", null, "chain"); dlg.setAttribute("aria-label", "Sign-off");
    document.body.appendChild(dlg);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    return dlg;
  }

  function render(run, j, d, onChange) {
    var id = run.run_id, st = getState(id), p = plan(j, d), box = ensure();
    box.textContent = "";
    var head = el("div", null, "chain__head");
    head.appendChild(el("h2", "Sign-off"));
    var x = el("button", "Close", "desk__btn"); x.type = "button"; x.addEventListener("click", function () { box.close(); }); head.appendChild(x);
    box.appendChild(head);
    box.appendChild(el("p", "SIMULATION: no email leaves the system and nothing is signed on the server. The first two steps are the run's own record.", "chain__sim"));
    box.appendChild(el("p", id + " · " + p.why, "chain__why"));

    var list = el("ol", null, "chain__steps"); box.appendChild(list);
    function step(title, state, cls) { var li = el("li", null, "chain__step " + (cls || "")); var h = el("div", null, "chain__t"); h.appendChild(el("strong", title)); if (state) h.appendChild(el("span", state, "chain__tag")); li.appendChild(h); list.appendChild(li); return li; }
    var who = j.input && typeof j.input === "object" ? j.input.name || j.input.from : "";
    step("Message received", "real", "is-real").appendChild(el("p", clip((j.human && j.human.input) || "", 160) + (run.at ? " · " + new Date(run.at).toLocaleString() : ""), "chain__p"));
    var dec = step("Agent decision: " + (j.decision || "?"), "real", "is-real");
    dec.appendChild(el("p", [run.branch_id ? "branch " + run.branch_id : "", run.execution_time_seconds ? Math.round(run.execution_time_seconds) + " s" : "", j.decision === "hold" || j.decision === "escalate" ? "needs a person" : ""].filter(Boolean).join(" · "), "chain__p"));

    var allSigned = !st.rejected, active = -1;
    p.signers.forEach(function (sg, i) {
      var out = !!(st.out && st.out[i]);
      var cur = person(d, out ? sg.backup : sg.id), orig = person(d, sg.id);
      var signed = !!(st.signed && st.signed[i]);
      var prevOk = i === 0 || (st.signed && st.signed[i - 1]);
      if (!signed) allSigned = false;
      if (st.rejected || !prevOk) { if (!st.rejected) { step("Then: " + cur.name + " (" + cur.role + ")", "waiting", "is-wait"); } return; }
      var li = step((signed ? "Signed by " : "Sign-off request emailed to ") + cur.name + " (" + cur.role + ")", signed ? "simulated · signed" : "simulated · waiting", signed ? "is-done" : "is-live");
      if (out) li.appendChild(el("p", orig.name + " is out of office, so the request goes to the backup, " + cur.name + ".", "chain__out"));
      var replyText = j.human && j.human.reply && j.human.reply.text ? String(j.human.reply.text) : "";
      var more = el("details", null, "chain__mail"); more.appendChild(el("summary", "The email (simulated)"));
      var body = ["To: " + cur.name + " <" + cur.email + ">"].concat((p.cc || []).map(function (c) { return "Cc: " + person(d, c).name + " <" + person(d, c).email + ">"; }), ["Subject: Sign-off needed: " + (p.amount != null ? p.amount + " GC " : "") + (j.scenario || "request") + " (" + id + ")", "",
        "Hello " + cur.name.split(" ")[0] + ",", "The agent held this for you" + (p.dual ? " (signature " + (i + 1) + " of 2)" : "") + ".", (replyText ? "Customer message: \"" + clip((j.human && j.human.input) || "", 200) + "\"" : "Note on file (the original message is not kept): \"" + clip((j.human && j.human.input) || "", 200) + "\""), (replyText ? "Draft reply: \"" + clip(replyText, 260) + "\"" : "Draft reply: in the queue file"), "", "[Sign]  [Reject]   (simulated)"]).join("\n");
      more.appendChild(el("pre", body, "chain__pre")); li.appendChild(more);
      if (!signed) {
        active = i;
        var row = el("div", null, "chain__acts");
        var sgn = el("button", "Sign as " + cur.name, "desk__btn desk__btn--hot"); sgn.type = "button";
        sgn.addEventListener("click", function () { var s = getState(id); s.signed = s.signed || {}; s.signed[i] = true; putState(id, s); render(run, j, d, onChange); onChange && onChange(id, summary(j, d, run)); });
        var rej = el("button", "Reject", "desk__btn"); rej.type = "button";
        rej.addEventListener("click", function () { var s = getState(id); s.rejected = true; putState(id, s); render(run, j, d, onChange); onChange && onChange(id, summary(j, d, run)); });
        row.appendChild(sgn); row.appendChild(rej);
        if (sg.backup) {
          var lab = el("label", null, "chain__out-toggle"), cb = el("input"); cb.type = "checkbox"; cb.checked = out;
          cb.addEventListener("change", function () { var s = getState(id); s.out = s.out || {}; s.out[i] = cb.checked; putState(id, s); render(run, j, d, onChange); });
          lab.appendChild(cb); lab.appendChild(el("span", " " + orig.name + " is out of office")); row.appendChild(lab);
        }
        li.appendChild(row);
      }
    });
    if (st.rejected) step("Rejected", "simulated", "is-bad").appendChild(el("p", "Back to the agent with a reason. Nothing is sent to the customer.", "chain__p"));
    else if (allSigned) {
      var fin = step("Reply released to the customer", "simulated · done", "is-done");
      fin.appendChild(el("p", clip(j.human && j.human.reply && j.human.reply.text, 400), "chain__reply"));
    }
    var rs = el("button", "Reset this demo", "desk__btn chain__reset"); rs.type = "button";
    rs.addEventListener("click", function () { putState(id, {}); render(run, j, d, onChange); onChange && onChange(id, summary(j, d, run)); });
    box.appendChild(rs);
  }

  // A short label for a card: "0 of 2 signed", "signed", "rejected".
  function summary(j, d, run) {
    var st = getState(run.run_id), p = plan(j, d), n = 0;
    p.signers.forEach(function (s, i) { if (st.signed && st.signed[i]) n++; });
    if (st.rejected) return "rejected";
    return n === p.signers.length ? "signed" : n + " of " + p.signers.length + " signed";
  }

  window.JP_CHAIN = {
    open: function (run, j, trigger, onChange) {
      return load().then(function (d) { render(run, j, d, onChange); var b = ensure(); if (!b.open) b.showModal(); });
    },
    summary: function (run, j) { return load().then(function (d) { return summary(j, d, run); }); },
  };
})();

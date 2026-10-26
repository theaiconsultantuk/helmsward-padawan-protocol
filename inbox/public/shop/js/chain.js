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
      return { kind: topic === "refund" ? "refund" : "", amount: amount, limit: t.limit, dual: true, why: amount + " GC is over the " + t.limit + " GC limit for " + topic + ": two signatures",
        signers: [{ id: t.over_owner, backup: t.over_backup }, { id: d.second_signer.id, backup: "201" }] };
    }
    var desk = d.desks[topic] || d.desks.other || {};
    var legal = (j.nodes || []).some(function (n) { return n.step === "branch" && /legal threat/i.test(n.route || ""); });
    if (legal && d.desks.legal) {
      var owner = held && held.employee_id != null ? String(held.employee_id) : String(desk.owner || "");
      return { kind: "legal", amount: amount, limit: null, dual: true, cc: d.copy_on_legal || [], why: "Legal threat: Support owns the reply and Legal reviews, two signatures",
        signers: [{ id: owner, backup: owner === String(desk.owner) ? String(desk.backup || "") : String(desk.owner || "") }, { id: d.desks.legal.owner, backup: d.desks.legal.backup }] };
    }
    var first = held && held.employee_id != null ? String(held.employee_id) : String(desk.owner || "");
    var back = first === String(desk.owner) ? String(desk.backup || "") : String(desk.owner || "");
    return { kind: topic === "refund" ? (j.memory_note ? "repeat" : "refund") : "", amount: amount, limit: t ? t.limit : null, dual: false, why: t && amount != null ? amount + " GC is within the " + t.limit + " GC limit: one signature" : "One signature from the person who holds the ticket",
      signers: [{ id: first, backup: back }], handoff: held && desk.owner && String(held.employee_id) !== String(desk.owner) ? desk.owner : null };
  }
  function person(d, id) { return d.people[String(id)] || { name: "Employee " + id, email: "", role: "" }; }

  /* ---------- the case through to the end (SIMULATED) ----------
     For three kinds of case (refund, repeat refund, legal threat) the dialog follows the ticket past sign-off: the SOP that
     applies, Legal's risk read, the emails to the customer, the customer's answer and the ticket closing. Everything after
     the agent's decision is simulated and labelled so; the inputs (history, severity, memory) are read from the run. */
  var SOP = {
    refund: { title: "SOP: refund", rules: ["Within the limit: the refund owner approves, one signature.", "Over the limit: the Sales head approves, then a second signature.", "Approved: tell the customer the amount and that it reaches them in 5 to 10 working days.", "A refund is not a replacement: never both for the same item."] },
    repeat: { title: "SOP: repeat refund claim", rules: ["A second refund claim from the same customer is held for a person, with the earlier refunds shown.", "Same item or the same pattern again: decline politely and give the reason.", "Declined claims go on the watch list: the next claim from that customer always goes to a person.", "A genuinely new fault: approve as a normal refund."] },
    legal: { title: "SOP: legal threat", rules: ["Support owns the reply; Legal (Fine Print Chambers) reviews before anything is sent. Heads of Support and Legal in Cc.", "Legal weighs the risk, not the tone: is a lawyer or firm named, is there an injury, is there evidence, the customer's history and tier.", "Low risk: goodwill refund, apology, no admission of liability; ask for photos for Quality; log on the legal register.", "High risk (injury, a named firm or a formal letter): Legal takes over the reply, no offer in writing, evidence kept."] },
  };
  function nodeLine(j, re) {
    var n = (j.nodes || []).filter(function (x) { return x && x.status !== "skipped" && re.test([x.label, x.route, x.detail].join(" ")); })[0];
    return n ? clip([n.route, n.detail && n.detail !== "None" ? n.detail : ""].filter(Boolean).join(" · "), 200) : "";
  }
  function customer(j) {
    var i = j.input && typeof j.input === "object" ? j.input : {}, raw = String(i.name || i.from || "");
    var name = raw.replace(/<[^>]*>/, "").trim() || "there", m = /<([^>]+)>/.exec(String(i.from || "")) || [];
    return { name: name, first: name.split(/\s+/)[0], email: m[1] || (String(i.from || "").indexOf("@") > 0 ? String(i.from) : "") };
  }
  // Legal's read of the threat: signals from the message itself, history and severity from the run's own trace.
  function legalRisk(j) {
    var text = String((j.human && j.human.input) || (j.input && j.input.text) || "");
    var sig = [
      { k: "Lawyer or firm named", hit: /\b(llp|solicitors?\s+\w+|law firm|esq|attorneys? at)\b/i.test(text), serious: true },
      { k: "Lawyer mentioned, but not named", hit: /\b(lawyer|solicitor|attorney)\b/i.test(text) && !/\b(llp|law firm|esq|attorneys? at)\b/i.test(text), serious: false },
      { k: "Formal letter or court date", hit: /\b(letter before action|court|claim form|summons|tribunal)\b/i.test(text), serious: true },
      { k: "Injury described", hit: /\b(injur\w*|hurt|burn\w*|cut my|bleed\w*|hospital|wound\w*)\b/i.test(text), serious: true },
      { k: "Evidence offered (photos, receipt)", hit: /\b(photo\w*|picture\w*|video|attached|receipt)\b/i.test(text), serious: false },
      { k: "Conditional threat (\"if I do not hear…\")", hit: /\bif (i|we) (do not|don't|dont) (hear|get)\b/i.test(text), serious: false },
    ];
    var hist = nodeLine(j, /world model/i), sev = nodeLine(j, /severity/i), mem = nodeLine(j, /^memory read/i);
    var high = sig.some(function (s) { return s.hit && s.serious; });
    return { signals: sig, history: hist, severity: sev, memory: mem, high: high,
      verdict: high ? "HIGH risk: treat as a real claim. Legal takes over; no offer in writing yet."
                    : "LOW risk: a threat used as leverage (no firm named, no injury, no evidence). Goodwill refund, no admission of liability." };
  }
  function riskPanel(r) {
    var box = el("div", null, "chain__risk");
    box.appendChild(el("p", "Legal's risk read (simulated, from the SOP)", "chain__risk-h"));
    var ul = el("ul", null, "chain__risk-l");
    r.signals.forEach(function (s) { ul.appendChild(el("li", (s.hit ? "Yes · " : "No · ") + s.k, s.hit ? (s.serious ? "is-bad" : "is-mid") : "")); });
    ul.appendChild(el("li", "Customer tier · standard (no VIP flag on file)"));
    if (r.history) ul.appendChild(el("li", "History (World Model, real) · " + r.history));
    if (r.severity) ul.appendChild(el("li", "Severity (OpenJev, real) · " + r.severity));
    box.appendChild(ul);
    box.appendChild(el("p", r.verdict, "chain__risk-v " + (r.high ? "is-bad" : "")));
    return box;
  }
  function mail(lines) { var m = el("details", null, "chain__mail"); m.open = true; m.appendChild(el("summary", "The email (simulated)")); m.appendChild(el("pre", lines.join("\n"), "chain__pre")); return m; }

  /* ---------- what an internal email carries (usability test, 26 Oct) ----------
     The ticket, who wrote it, what the agent decided and why, and the risk profile, each read from the run's own journey.
     A line with no data in the journey is left out, never guessed. */
  function ticketOf(j) { return j && j.input && typeof j.input === "object" && j.input.thread_id ? String(j.input.thread_id) : ""; }
  function branchRoute(j) { var n = (j.nodes || []).filter(function (x) { return x && x.step === "branch" && x.status !== "skipped"; })[0]; return n ? String(n.route || "") : ""; }
  function branchId(j, run) {
    if (run && run.branch_id && !/^F\d+$/.test(run.branch_id)) return String(run.branch_id);
    var hit = "";
    (j.nodes || []).forEach(function (n) { var m = n && n.step === "planner.plan" ? /→\s*([\w-]+)/.exec(String(n.route || "")) : null; if (m) hit = m[1]; });
    return hit;
  }
  function riskLines(j, p) {
    var out = [], route = branchRoute(j);
    var sev = /severity (\d+) \(([^)]*)\)/i.exec(route);
    if (sev) out.push("Severity: " + sev[1] + " of 10" + (sev[2] && sev[2] !== sev[1] ? " (" + sev[2].replace(/^\d+\s*/, "") + ")" : ""));
    if (sev || /legal threat/i.test(route)) out.push("Legal threat: " + (/legal threat/i.test(route) ? "yes" : "no"));
    if (p && p.amount != null && p.limit != null) out.push("Refund: " + p.amount + " GC against a " + p.limit + " GC limit (" + (p.amount > p.limit ? "over the limit" : "within the limit") + ")");
    var led = (j.nodes || []).filter(function (n) { return n && /trust ledger/i.test(String(n.label || "")); })[0];
    var tw = led ? /(\w[\w ]*): trust weight ([\d.]+), floor ([\d.]+)/.exec(String(led.detail || "")) : null;
    if (tw) out.push("Trust: " + tw[1] + " weight " + tw[2] + " against the floor " + tw[3] + (Number(tw[2]) >= Number(tw[3]) ? " (trusted to send)" : " (still learning: a person decides)"));
    var hist = nodeLine(j, /world model/i), cust = /customer [^;]*/.exec(hist);
    if (cust) out.push("History (World Model): " + clip(cust[0], 140));
    return out;
  }
  // The block every internal email carries: ticket, customer, decision and reason, then the risk profile.
  function caseLines(j, run, p) {
    var c = customer(j), t = ticketOf(j), b = branchId(j, run), why = branchRoute(j), risk = riskLines(j, p);
    var out = [];
    if (t) out.push("Ticket: " + t);
    if (c.name !== "there" || c.email) out.push("Customer: " + (c.name !== "there" ? c.name : "") + (c.email ? " <" + c.email + ">" : ""));
    if (j.channel_label) out.push("Channel: " + j.channel_label);
    var said = (j.input && j.input.text) || (j.human && j.human.input) || "";
    if (said) out.push("Message: \"" + clip(said, 220) + "\"");
    if (j.decision) out.push("Agent decision: " + j.decision + (b ? " (branch " + b + ")" : ""));
    if (why) out.push("Why: " + clip(why, 240));
    if (risk.length) { out.push("", "Risk profile:"); risk.forEach(function (r) { out.push("  - " + r); }); }
    return out;
  }
  function subjectRef(j) { var t = ticketOf(j); return t ? " [ticket " + t + "]" : ""; }

  // A repeat of an earlier thread (same sender, subject and body) closes as a duplicate. The close is the run's own record;
  // the acknowledgement to the customer is simulated. Same words as the contact page (flow-render.js duplicateAck).
  function duplicateOf(j) {
    var r = branchRoute(j), m = /duplicate/i.test(r) ? /earlier thread\s+(F\d+)/i.exec(r) : null;
    return m ? m[1] : (/duplicate/i.test(r) ? "your earlier message" : "");
  }
  function duplicateMail(j, orig) {
    var c = customer(j), ref = /^F\d+$/.test(orig) ? "ref " + orig : orig;
    return ["To: " + c.name + (c.email ? " <" + c.email + ">" : ""), "Subject: We've already got your message" + (/^F\d+$/.test(orig) ? " (" + ref + ")" : ""), "",
      "Hello " + c.first + ",", "", "Thanks, we've already got your message (" + ref + "), so you may have sent it twice.",
      "No need to resend; a colleague is already on it.", "", "Best regards,", "Farstrand Support team"];
  }
  // What happens after the last signature (or a rejection): every kind of case, accepted or rejected, ends solved.
  function happyEnd(j, step, said, stars, review) {
    var c = customer(j);
    step("Customer replied", "simulated", "is-done").appendChild(el("p", "\"" + said + "\"", "chain__reply"));
    if (review) step("Review left", "simulated", "is-done").appendChild(el("p", stars + "  \"" + review + "\" · " + c.name + ", Trustpilot", "chain__reply"));
    step("Ticket solved", "simulated · closed", "is-done").appendChild(el("p", "Status: solved. Affirm on the desk (real) writes this verdict to the trust ledger, so the next case like this is judged with it.", "chain__p"));
  }
  function closeOut(step, said, status) {
    if (said) step("Customer replied", "simulated", "is-done").appendChild(el("p", "\"" + said + "\"", "chain__reply"));
    step("Ticket solved", "simulated · closed", "is-done").appendChild(el("p", "Status: " + status, "chain__p"));
  }
  function named(x) { return x.name + (x.role ? ", " + x.role : "") + (x.email ? " <" + x.email + ">" : ""); }
  // An email to the customer: To, Subject with the ticket, greeting, body, signature.
  function custMail(j, subject, body, sig, cc) {
    var c = customer(j);
    return ["To: " + c.name + (c.email ? " <" + c.email + ">" : "")].concat(cc ? ["Cc: " + cc] : [], ["Subject: " + subject + subjectRef(j), "", "Hello " + c.first + ","], body, ["", "Best regards,", sig || "Farstrand Support team"]);
  }
  // The person at signature i: the backup when the first choice was marked out of office.
  function signerAt(p, st, d, i) { var sg = p.signers[i] || {}; return person(d, st.out && st.out[i] ? sg.backup : sg.id); }
  // A reply a person wrote after Legal or Support turned the agent's draft down: careful, no admission of liability, no money.
  function revisedLegalReply(j, by) {
    return custMail(j, "Your complaint", ["", "Further to our earlier reply, a member of our team has now reviewed your message in full.",
      "We are sorry to hear the product failed, and we take reports like this seriously.",
      "Please reply with your order number and photos of the item, and we will arrange a repair or a replacement at no cost to you.",
      "This does not affect your rights."], by.name + ", Farstrand Support team");
  }
  // rj (a rejection): { at: signature index, by: the person who rejected, reason: their reason, first: the first signer }.
  function resolution(p, j, d, step, rejected, rj) {
    var c = customer(j), to = "To: " + c.name + (c.email ? " <" + c.email + ">" : ""), amt = p.amount != null ? p.amount + " GC" : "the full order price";
    var happy = function (said, stars, review) { happyEnd(j, step, said, stars, review); };
    var why = rj && rj.reason ? rj.reason : "no reason given";
    if (p.kind === "repeat" && rejected) {
      var dec = step("Declined, per the repeat-claim SOP", "simulated", "is-bad");
      dec.appendChild(el("p", "Internal reason, from " + rj.by.name + " (not sent to the customer): " + why, "chain__p"));
      dec.appendChild(mail([to, "Subject: Your refund request" + subjectRef(j), "", "Hello " + c.first + ",",
        "Thank you for writing. We have looked at this request together with your earlier refunds on the same item, and we cannot approve another refund.",
        "If the item has a fault we can repair or replace it under our replacement policy: reply to this email and we will arrange it.", "", "Best regards,", "Farstrand Support team"]));
      step("Added to the watch list", "simulated", "is-bad").appendChild(el("p", (c.email || c.name) + ": the next claim from this customer always goes to a person, whatever the amount. Memory note: " + (j.memory_note ? clip(j.memory_note, 160) : "earlier refunds on file") + ".", "chain__p"));
      step("Ticket solved", "simulated · closed", "is-done").appendChild(el("p", "Status: solved (declined). Nothing was refunded.", "chain__p"));
      return true;
    }
    if (p.kind === "refund" && rejected) {
      var over = p.amount != null && p.limit != null && p.amount > p.limit;
      var no = step("Refund declined by " + rj.by.name + (rj.by.role ? " (" + rj.by.role + ")" : ""), "simulated", "is-bad");
      no.appendChild(el("p", "Internal reason (not sent to the customer): " + why, "chain__p"));
      no.appendChild(mail(custMail(j, "Your refund request", ["", "Thank you for writing. We have looked at your request" + (p.amount != null ? " for a refund of " + amt : "") + " and we cannot approve a refund as it stands.",
        "If the item is faulty, we can repair or replace it under our replacement policy: reply to this email with your order number and a photo of the fault and we will arrange it.",
        "If you think we have missed something, reply and a colleague will look at it again."])));
      closeOut(step, "OK, photo attached. A replacement would be fine.", "solved (declined" + (over ? ", over the limit" : "") + "). Nothing was refunded; a repair or replacement is offered.");
      return true;
    }
    if (p.kind === "legal" && rejected) {
      var support = rj.first, legalP = signerAt(p, rj.st, d, p.signers.length - 1), heads = (p.cc || []).map(function (x) { return named(person(d, x)); });
      var r0 = legalRisk(j);
      if (rj.at >= p.signers.length - 1) {
        // Legal turned the reply down: it goes back to Support with Legal's reason, then Support's revised reply goes out.
        step("Returned to Support: " + support.name, "simulated", "is-bad").appendChild(mail(["From: " + named(rj.by), "To: " + named(support)].concat(heads.map(function (h) { return "Cc: " + h; }), [
          "Subject: Returned" + (ticketOf(j) ? ": ticket " + ticketOf(j) : "") + ", legal threat: reply not approved", "", "Hello " + support.name.split(" ")[0] + ",",
          "I can't sign the reply as drafted.", "Reason: " + why, "",
          "Please revise it: thank them, say we take it seriously, ask for photos and the order number, offer a repair or replacement.",
          "No admission of liability and no money in writing. Send it back to me before it goes out.", "", "Ticket: " + (ticketOf(j) || "this run"), "Customer: " + c.name + (c.email ? " <" + c.email + ">" : ""), "",
          rj.by.name.split(" ")[0]])));
        step("Revised reply cleared by " + rj.by.name + " and sent", "simulated", "is-done").appendChild(mail(revisedLegalReply(j, support)));
        step("Logged on the legal register", "simulated", "is-done").appendChild(el("p", "Threat, " + (r0.high ? "high" : "low") + " risk. Draft returned by Legal (" + why + "); revised reply sent by Support, no offer of money in writing.", "chain__p"));
      } else {
        // Support turned the agent's draft down at the first signature: Support rewrites it, and Legal still reviews it before it goes out.
        step("Support rewrote the reply: " + rj.by.name, "simulated", "is-bad").appendChild(mail(["From: " + named(rj.by), "To: " + named(legalP)].concat(heads.map(function (h) { return "Cc: " + h; }), [
          "Subject: Rewritten reply for your review" + (ticketOf(j) ? ": ticket " + ticketOf(j) : "") + ", legal threat", "", "Hello " + legalP.name.split(" ")[0] + ",",
          "I did not send the agent's draft.", "Reason: " + why, "", "My rewritten reply is below for your review before it goes out.", "",
          "Ticket: " + (ticketOf(j) || "this run"), "Customer: " + c.name + (c.email ? " <" + c.email + ">" : ""), "", rj.by.name.split(" ")[0]])));
        var ok = step("Legal cleared the rewritten reply: " + legalP.name, "simulated", "is-done");
        ok.appendChild(el("p", "Read against the SOP: acknowledgement, no admission of liability, no money in writing.", "chain__p"));
        ok.appendChild(riskPanel(r0));
        step("Reply sent to the customer", "simulated", "is-done").appendChild(mail(revisedLegalReply(j, rj.by)));
        step("Logged on the legal register", "simulated", "is-done").appendChild(el("p", "Threat, " + (r0.high ? "high" : "low") + " risk. Agent's draft rewritten by Support (" + why + "), cleared by Legal; no offer of money in writing.", "chain__p"));
      }
      closeOut(step, "Thank you for taking it seriously. Order number and photos attached.", "solved. A repair or replacement follows the photos; the legal register keeps the case.");
      return true;
    }
    if (rejected) {
      // Any other case: the person who rejected the agent's draft writes to the customer themselves.
      var rw = step("Agent's draft set aside", "simulated", "is-bad");
      rw.appendChild(el("p", "The agent's draft was not sent. Internal reason: " + why, "chain__p"));
      step("Personal reply sent by " + rj.by.name, "simulated", "is-done").appendChild(mail(custMail(j, "Your message", ["",
        "Thank you for your message. I have read it myself rather than send our standard reply, because I want to be sure you get the right answer.",
        "I will come back to you with a full answer within two working days. If anything is urgent, reply to this email and it comes straight to me."], rj.by.name + ", Farstrand Support team")));
      step("Full answer sent", "simulated", "is-done").appendChild(el("p", rj.by.name + " followed up with the full answer.", "chain__p"));
      closeOut(step, "Thank you, that's sorted it.", "solved after a personal reply.");
      return true;
    }
    if (p.kind === "refund" || p.kind === "repeat") {
      step("Refund approved and issued", "simulated", "is-done").appendChild(mail([to, "Subject: Your refund of " + amt + " is on its way" + subjectRef(j), "", "Hello " + c.first + ",",
        "Good news: your refund of " + amt + " has been approved and issued to your original payment method.", "It reaches you in 5 to 10 working days. You do not need to send the item back.", "", "Best regards,", "Farstrand Support team"]));
      happy("Brilliant, thank you. That was quick and painless.", "★★★★★", "Refund sorted in a day, clear email, no hoops to jump through. Will shop again.");
      return true;
    }
    if (p.kind === "legal") {
      var r = legalRisk(j);
      if (r.high) {
        var lt = step("Legal takes over the reply", "simulated", "is-live");
        lt.appendChild(el("p", "Per the SOP: acknowledgement only, no offer in writing, evidence kept, Head of Legal in Cc.", "chain__p"));
        lt.appendChild(mail(custMail(j, "Your complaint", ["", "Thank you for your message. Our Legal team, Fine Print Chambers, is now handling it and will write to you directly.",
          "Please keep the item and any packaging, and send us photos of it if you can."], "Fine Print Chambers, for Farstrand Supply Co.", "Head of Legal")));
        closeOut(step, "", "solved on the support desk; the case continues with Fine Print Chambers on the legal register.");
        return true;
      }
      step("Legal's decision: goodwill refund", "simulated", "is-done").appendChild(mail([to, "Cc: Head of Support, Head of Legal", "Subject: Your complaint" + subjectRef(j), "", "Hello " + c.first + ",",
        "We are sorry the product failed you. Our Legal team has reviewed your message.", "As a gesture of goodwill, and without admission of liability, we are refunding " + amt + " in full. It reaches you in 5 to 10 working days.",
        "If you can send photos of the fault, our Quality team will check the batch so it does not happen to anyone else.", "", "Best regards,", "Farstrand Support team, on behalf of Fine Print Chambers"]));
      step("Logged on the legal register", "simulated", "is-done").appendChild(el("p", "Threat, low risk, settled by goodwill refund. Batch flagged for Quality.", "chain__p"));
      happy("Thank you, that's fair and more than I expected. Photos attached. No need for lawyers.", "★★★★★", "Product failed, but they listened, refunded fast and asked for photos to fix it. Fair company.");
      return true;
    }
    // Any other case: the signed reply was the answer.
    closeOut(step, "Thanks, that answers it.", "solved. Affirm on the desk (real) writes this verdict to the trust ledger, so the next case like this is judged with it.");
    return true;
  }

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
    if (SOP[p.kind]) {
      var sop = el("details", null, "chain__sop"); sop.appendChild(el("summary", SOP[p.kind].title + " (demo)"));
      var ol = el("ol"); SOP[p.kind].rules.forEach(function (r) { ol.appendChild(el("li", r)); }); sop.appendChild(ol); box.appendChild(sop);
    }

    var list = el("ol", null, "chain__steps"); box.appendChild(list);
    function step(title, state, cls) { var li = el("li", null, "chain__step " + (cls || "")); var h = el("div", null, "chain__t"); h.appendChild(el("strong", title)); if (state) h.appendChild(el("span", state, "chain__tag")); li.appendChild(h); list.appendChild(li); return li; }
    var who = j.input && typeof j.input === "object" ? j.input.name || j.input.from : "";
    step("Message received", "real", "is-real").appendChild(el("p", clip((j.human && j.human.input) || "", 160) + (run.at ? " · " + new Date(run.at).toLocaleString() : ""), "chain__p"));
    var dec = step("Agent decision: " + (j.decision || "?"), "real", "is-real");
    dec.appendChild(el("p", [run.branch_id ? "branch " + run.branch_id : "", run.execution_time_seconds ? Math.round(run.execution_time_seconds) + " s" : "", j.decision === "hold" || j.decision === "escalate" ? "needs a person" : ""].filter(Boolean).join(" · "), "chain__p"));

    // A duplicate closes with no reply on the server; the customer still hears back (simulated acknowledgement).
    var dup = duplicateOf(j);
    if (dup && j.decision === "close") {
      step("Acknowledgement emailed to the customer", "simulated", "is-done").appendChild(mail(duplicateMail(j, dup)));
      step("Ticket closed as a duplicate of " + (/^F\d+$/.test(dup) ? dup : "the earlier request"), "real", "is-real")
        .appendChild(el("p", "No new draft and no sign-off: the original ticket carries the case.", "chain__p"));
      return;
    }

    // Already sent for real (a person sent it from the desk, or the agent sent it on its own): show that, not a simulation.
    var real = j.sent && typeof j.sent === "object" && j.sent.body ? j.sent : null;
    if (real || j.decision === "send") {
      var sentStep = step(real ? "Reply sent by " + (real.by || "a person") : "Sent by the agent on its own (the trust floor allowed it)", "real", "is-real");
      sentStep.appendChild(el("p", clip(real ? real.body : (j.human && j.human.reply && j.human.reply.text) || "", 400), "chain__reply"));
      if (real && real.at) sentStep.appendChild(el("p", new Date(real.at).toLocaleString() + " · from the desk, so no sign-off is needed", "chain__p"));
      if (p.kind === "refund" || p.kind === "repeat") happyEnd(j, step, "Brilliant, thank you. That was quick and painless.", "★★★★★", "Refund sorted in a day, clear email, no hoops to jump through. Will shop again.");
      else if (p.kind === "legal") happyEnd(j, step, "Thank you for getting back to me so quickly.", "", "");
      var rs0 = el("button", "Reset this demo", "desk__btn chain__reset"); rs0.type = "button";
      rs0.addEventListener("click", function () { putState(id, {}); render(run, j, d, onChange); onChange && onChange(id, summary(j, d, run)); });
      box.appendChild(rs0);
      return;
    }
    var allSigned = !st.rejected, active = -1;
    // The signature that was rejected: the stored index, or (for a rejection saved before reasons existed) the first unsigned one.
    var rejAt = -1;
    if (st.rejected) { rejAt = st.rejectedAt != null ? st.rejectedAt : 0; while (rejAt < p.signers.length - 1 && st.rejectedAt == null && st.signed && st.signed[rejAt]) rejAt++; }
    p.signers.forEach(function (sg, i) {
      var out = !!(st.out && st.out[i]);
      var cur = person(d, out ? sg.backup : sg.id), orig = person(d, sg.id);
      var signed = !!(st.signed && st.signed[i]);
      var prevOk = i === 0 || (st.signed && st.signed[i - 1]);
      if (!signed) allSigned = false;
      if (st.rejected && i > rejAt) return;
      if (!st.rejected && !prevOk) { step("Then: " + cur.name + " (" + cur.role + ")", "waiting", "is-wait"); return; }
      var isRej = st.rejected && i === rejAt;
      var li = isRej ? step("Rejected by " + cur.name + " (" + cur.role + ")", "simulated · rejected", "is-bad")
        : step((signed ? "Signed by " : "Sign-off request emailed to ") + cur.name + " (" + cur.role + ")", signed ? "simulated · signed" : "simulated · waiting", signed ? "is-done" : "is-live");
      if (isRej) li.appendChild(el("p", "Reason: " + (st.reason || "no reason given"), "chain__p"));
      if (out) li.appendChild(el("p", orig.name + " is out of office, so the request goes to the backup, " + cur.name + ".", "chain__out"));
      if (p.kind === "legal" && i === p.signers.length - 1) li.appendChild(riskPanel(legalRisk(j)));
      var replyText = j.human && j.human.reply && j.human.reply.text ? String(j.human.reply.text) : "";
      var more = el("details", null, "chain__mail"); more.appendChild(el("summary", "The email (simulated)"));
      var what = p.kind === "legal" ? "legal threat" : (p.amount != null ? p.amount + " GC " : "") + (j.scenario || "request");
      var body = ["To: " + named(cur)].concat((p.cc || []).map(function (c) { return "Cc: " + named(person(d, c)); }), ["Subject: Sign-off needed" + (ticketOf(j) ? ": ticket " + ticketOf(j) : "") + ", " + what + " (" + id + ")", "",
        "Hello " + cur.name.split(" ")[0] + ",", "The agent held this for you" + (p.dual ? " (signature " + (i + 1) + " of 2)" : "") + ".", ""],
        replyText ? caseLines(j, run, p) : ["Note on file (the original message is not kept): \"" + clip((j.human && j.human.input) || "", 200) + "\""],
        ["", (replyText ? "Draft reply: \"" + clip(replyText, 260) + "\"" : "Draft reply: in the queue file"), "", "[Sign]  [Reject]   (simulated)"]).join("\n");
      more.appendChild(el("pre", body, "chain__pre")); li.appendChild(more);
      if (!signed && !isRej) {
        active = i;
        var row = el("div", null, "chain__acts");
        var sgn = el("button", "Sign as " + cur.name, "desk__btn desk__btn--hot"); sgn.type = "button";
        sgn.addEventListener("click", function () { var s = getState(id); s.signed = s.signed || {}; s.signed[i] = true; putState(id, s); render(run, j, d, onChange); onChange && onChange(id, summary(j, d, run)); });
        var rej = el("button", "Reject", "desk__btn"); rej.type = "button";
        // Reject asks why first; the reason goes into the emails that follow. Kept in this browser only, like the rest of the simulation.
        var doReject = function (why) { var s = getState(id); s.rejected = true; s.rejectedAt = i; s.reason = why || ""; putState(id, s); render(run, j, d, onChange); onChange && onChange(id, summary(j, d, run)); };
        rej.addEventListener("click", function () {
          if (!window.JP_REASON) { doReject(""); return; }
          sgn.disabled = true; rej.disabled = true;
          window.JP_REASON.ask(row, doReject, function () { sgn.disabled = false; rej.disabled = false; }, "Simulated: the reason goes into the emails below and stays in this browser; nothing reaches the server.");
        });
        row.appendChild(sgn); row.appendChild(rej);
        if (sg.backup) {
          var lab = el("label", null, "chain__out-toggle"), cb = el("input"); cb.type = "checkbox"; cb.checked = out;
          cb.addEventListener("change", function () { var s = getState(id); s.out = s.out || {}; s.out[i] = cb.checked; putState(id, s); render(run, j, d, onChange); });
          lab.appendChild(cb); lab.appendChild(el("span", " " + orig.name + " is out of office")); row.appendChild(lab);
        }
        li.appendChild(row);
      }
    });
    if (st.rejected) {
      resolution(p, j, d, step, true, { at: rejAt, by: signerAt(p, st, d, rejAt), reason: st.reason || "", first: signerAt(p, st, d, 0), st: st });
    } else if (allSigned) {
      var fin = step("Reply released to the customer", "simulated · done", "is-done");
      var draft = String((j.human && j.human.reply && j.human.reply.text) || "").trim();
      if (draft) {
        var c0 = customer(j), lines = draft.split("\n");
        fin.appendChild(mail(["To: " + c0.name + (c0.email ? " <" + c0.email + ">" : ""), "Subject: Re: your message" + subjectRef(j), ""].concat(lines)));
      }
      resolution(p, j, d, step, false);
    }
    var rs = el("button", "Reset this demo", "desk__btn chain__reset"); rs.type = "button";
    rs.addEventListener("click", function () { putState(id, {}); render(run, j, d, onChange); onChange && onChange(id, summary(j, d, run)); });
    box.appendChild(rs);
  }

  // A short label for a card: "0 of 2 signed", "signed, solved", or what a rejection led to ("declined, solved", "returned to Support, solved").
  function summary(j, d, run) {
    if ((j.sent && typeof j.sent === "object" && j.sent.body) || j.decision === "send") return "sent";
    if (j.decision === "close" && duplicateOf(j)) return "duplicate";
    var st = getState(run.run_id), p = plan(j, d), n = 0;
    p.signers.forEach(function (s, i) { if (st.signed && st.signed[i]) n++; });
    if (st.rejected) {
      if (p.kind === "legal") return (st.rejectedAt != null && st.rejectedAt >= p.signers.length - 1) || (st.rejectedAt == null && n > 0) ? "returned to Support, solved" : "rewritten by Support, solved";
      return p.kind === "refund" || p.kind === "repeat" ? "declined, solved" : "rewritten, solved";
    }
    return n === p.signers.length ? "signed, solved" : n + " of " + p.signers.length + " signed";
  }

  window.JP_CHAIN = {
    open: function (run, j, trigger, onChange) {
      return load().then(function (d) { render(run, j, d, onChange); var b = ensure(); if (!b.open) b.showModal(); });
    },
    summary: function (run, j) { return load().then(function (d) { return summary(j, d, run); }); },
    // P57: the kind ("refund", "repeat", "legal") when this run's Sign-off follows the case through to the end, else "".
    // Same rule as the dialog (plan), so the desk's ★ and the full case flow can never disagree.
    fullJourney: function (j) {
      return load().then(function (d) { var k = j ? plan(j, d).kind : ""; return k === "refund" || k === "repeat" || k === "legal" ? k : ""; }).catch(function () { return ""; });
    },
  };
})();

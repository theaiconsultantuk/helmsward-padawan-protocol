/* Reject needs a reason (usability test, 26 Oct): a small inline panel with reason chips and a note, required before the
   Reject is sent. Used by the staff desk; /dashboard keeps its own copy in dashboard.js (that page loads only /static/). The reason travels as `note` on POST /feedback, which the server
   accepts and echoes but does not store yet, so the page also keeps it (localStorage, this browser only) and says so.
   Text only, via textContent. */
(function () {
  "use strict";
  var CHIPS = ["Wrong decision", "Tone", "Wrong facts", "Should have escalated", "Other"];
  var NOTE = "Reason sent with the verdict; the server does not store it yet, so it is kept on this page.";
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = String(text); if (cls) e.className = cls; return e; }
  function key(id) { return "jp_reject_reason_" + id; }
  function get(id) { try { return localStorage.getItem(key(id)) || ""; } catch (e) { return ""; } }
  function put(id, text) { try { localStorage.setItem(key(id), text); } catch (e) { /* the page still works without storage */ } }

  // Opens the panel after `anchor`. onConfirm(reasonText) sends the Reject; onCancel() puts the buttons back.
  // `fine` replaces the line under the panel (the Sign-off dialog keeps the reason on the page only).
  function ask(anchor, onConfirm, onCancel, fine) {
    var open = anchor.parentNode && anchor.parentNode.querySelector(".rr");
    if (open) open.remove();
    var box = el("div", null, "rr"), chosen = "";
    box.setAttribute("role", "group"); box.setAttribute("aria-label", "Why reject?");
    box.appendChild(el("p", "Why reject? Pick a reason (required)", "rr__h"));
    var chips = el("div", null, "rr__chips"), note = el("textarea", null, "rr__note"), go = el("button", "Confirm reject", "rr__go"), no = el("button", "Cancel", "rr__no");
    note.rows = 2; note.maxLength = 500; note.placeholder = "What should it have done? (optional, required for Other)"; note.setAttribute("aria-label", "Reason details");
    go.type = "button"; no.type = "button"; go.disabled = true;
    function text() { var t = note.value.trim(); return chosen === "Other" ? t : chosen + (t ? ": " + t : ""); }
    function check() { go.disabled = !chosen || (chosen === "Other" && !note.value.trim()); }
    CHIPS.forEach(function (c) {
      var b = el("button", c, "rr__chip"); b.type = "button"; b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        chosen = c; chips.querySelectorAll(".rr__chip").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        check(); if (c === "Other") note.focus();
      });
      chips.appendChild(b);
    });
    note.addEventListener("input", check);
    go.addEventListener("click", function () { var t = text(); if (!t) return; box.remove(); onConfirm(t); });
    no.addEventListener("click", function () { box.remove(); if (onCancel) onCancel(); });
    var acts = el("div", null, "rr__acts"); acts.appendChild(go); acts.appendChild(no);
    box.appendChild(chips); box.appendChild(note); box.appendChild(acts); box.appendChild(el("p", fine || NOTE, "rr__fine"));
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    chips.firstChild.focus();
    return box;
  }
  window.JP_REASON = { ask: ask, get: get, put: put, note: NOTE };
})();

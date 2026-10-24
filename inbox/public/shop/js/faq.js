(function () {
  "use strict";
  var meta = document.querySelector('meta[name="api-base"]');
  var base = meta ? (meta.getAttribute("content") || "") : "";
  var input = document.getElementById("faq-search");
  var list = document.getElementById("faq-list");
  var empty = document.getElementById("faq-empty");
  var note = document.getElementById("faq-note");
  if (!input || !list) return;
  var items = [];

  function getJson(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    }).then(function (d) {
      if (!Array.isArray(d)) throw new Error("not an array");
      return d;
    });
  }

  function render(rows) {
    list.textContent = "";
    items = rows.map(function (row) {
      var d = document.createElement("details");
      d.className = "faq__item";
      var s = document.createElement("summary");
      s.className = "faq__q";
      s.textContent = String(row.question || "");
      var p = document.createElement("p");
      p.className = "faq__a";
      p.textContent = String(row.answer || "");
      d.appendChild(s);
      d.appendChild(p);
      list.appendChild(d);
      return {
        el: d,
        hay: [row.question, row.answer, row.keywords].join(" ").toLowerCase()
      };
    });
    filter();
  }

  function filter() {
    var words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    var shown = 0;
    items.forEach(function (it) {
      var ok = words.every(function (w) { return it.hay.indexOf(w) !== -1; });
      it.el.hidden = !ok;
      if (ok) shown++;
    });
    if (empty) empty.hidden = !(items.length && shown === 0);
    var live = document.querySelector("[data-live]");
    if (live && words.length) live.textContent = shown + (shown === 1 ? " question matches" : " questions match");
  }

  try {
    var q = new URLSearchParams(window.location.search).get("q");
    if (q) input.value = q;
  } catch (e) { /* no query */ }
  input.addEventListener("input", filter);

  getJson(base + "/faq").then(render).catch(function () {
    return getJson("data/faq.json").then(function (rows) {
      if (note) note.hidden = false;
      render(rows);
    }).catch(function () {
      if (empty) { empty.textContent = "The FAQ could not load; ask us on the contact page."; empty.hidden = false; }
    });
  });
})();

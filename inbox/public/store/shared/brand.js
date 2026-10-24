(async () => {
  try {
    const root = location.pathname.includes("/concepts/") ? "../.." : ".";
    const r = await fetch(root + "/brand.json"); if (!r.ok) return;
    const b = await r.json();
    document.querySelectorAll("[data-brand]").forEach(el => { const k = el.getAttribute("data-brand"); if (b[k]) el.textContent = b[k]; });
    document.title = document.title.replace(/\{\{(\w+)\}\}/g, (m, k) => b[k] ?? m);
    window.BRAND = b;
  } catch (e) {}
})();

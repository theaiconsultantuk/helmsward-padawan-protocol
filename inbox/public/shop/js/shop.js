/* TOTALITY · shop catalogue: live search, category pills, sort, 3D Interactive badges */
(() => {
  if (!window.T) return;
  const { $, $$, usd } = T;
  const STOCK_LABEL = {
    in_stock: "In stock",
    low_stock: "Low stock",
    out_of_stock: "Out of stock",
  };
  const STOCK_CLS = {
    in_stock: "badge-stock--in",
    low_stock: "badge-stock--low",
    out_of_stock: "badge-stock--out",
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const grid = $("#shop-grid");
  const searchInput = $("#shop-search");
  const sortSelect = $("#shop-sort");
  const countEl = $("#shop-count");
  const emptyEl = $("#shop-empty");
  const resetBtn = $("#shop-reset");
  const catBtns = $$("[data-cat]");

  let activeCat = "all";
  let searchQuery = "";
  let sortBy = "featured";
  let catalogue = null;
  let modelSlugs = new Set();

  const params = new URLSearchParams(location.search);
  if (params.get("cat")) activeCat = params.get("cat");
  if (params.get("q") && searchInput) {
    searchQuery = params.get("q");
    searchInput.value = searchQuery;
  }

  Promise.all([T.data, T.models]).then(([cat, mList]) => {
    catalogue = cat;
    modelSlugs = new Set(mList || []);
    syncPills();
    renderGrid();
  });

  function syncPills() {
    catBtns.forEach(b => {
      const on = b.dataset.cat === activeCat;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function cardHTML(p, catMap) {
    const catName = catMap.get(p.category) || p.category;
    const has3D = modelSlugs.has(p.slug);
    const oos = p.stock_status === "out_of_stock";
    const stockTxt = STOCK_LABEL[p.stock_status] || "In stock";
    const stockCls = STOCK_CLS[p.stock_status] || "badge-stock--in";
    const specLine = (p.materials_specs && p.materials_specs[0]) || "";

    return `<article class="shop-card" data-slug="${esc(p.slug)}" data-category="${esc(p.category)}">
      <a class="shop-card__media" href="product.html?slug=${esc(p.slug)}" data-video="${T.ROOT || "."}/images/${esc(p.slug)}.mp4" aria-label="Inspect ${esc(p.name)}">
        <figure class="plate shop-card__plate" style="--ar:3/2">
          <span class="plate__inner">
            <img src="${T.ROOT || "."}/images/${esc(p.slug)}.webp" alt="${esc(p.name)}" width="1536" height="1024" loading="lazy" decoding="async">
            <span class="slate" aria-hidden="true"><span class="slate__name">${esc(p.name)}</span><span class="slate__note">render pending</span></span>
          </span>
          <span class="sweep shop-card__sweep" aria-hidden="true"></span>
        </figure>
        <div class="shop-card__badges">
          <span class="shop-badge shop-badge--cat">${esc(catName)}</span>
          ${has3D ? '<span class="shop-badge shop-badge--3d"><span class="shop-badge__dot" aria-hidden="true"></span>3D Interactive</span>' : ""}
          <span class="shop-badge ${stockCls}">${esc(stockTxt)}</span>
        </div>
      </a>
      <div class="shop-card__body">
        <div class="shop-card__top">
          <h2 class="shop-card__title"><a href="product.html?slug=${esc(p.slug)}">${esc(p.name)}</a></h2>
          <p class="shop-card__price">${usd(p.price_usd)}</p>
        </div>
        <p class="shop-card__tag">${esc(p.tagline)}</p>
        ${specLine ? `<p class="shop-card__spec">${esc(specLine)}</p>` : ""}
        <div class="shop-card__acts">
          <button class="btn shop-card__add" type="button" data-add="${esc(p.slug)}" ${oos ? "disabled" : ""}>
            ${oos ? `Out of stock<span class="sr-only">: ${esc(p.name)}</span>` : `Add to cart<span class="sr-only"> · ${esc(p.name)}</span>`}
          </button>
          <a class="btn-line shop-card__inspect" href="product.html?slug=${esc(p.slug)}">Inspect →</a>
        </div>
      </div>
    </article>`;
  }

  function renderGrid() {
    if (!catalogue || !grid) return;
    const catMap = new Map((catalogue.categories || []).map(c => [c.slug, c.name]));
    const q = searchQuery.trim().toLowerCase();

    let list = catalogue.products.filter(p => {
      if (activeCat !== "all" && p.category !== activeCat) return false;
      if (!q) return true;
      const hay = `${p.name} ${p.tagline} ${p.description} ${(p.materials_specs || []).join(" ")} ${catMap.get(p.category) || ""}`.toLowerCase();
      return hay.includes(q);
    });

    if (sortBy === "price-asc") {
      list = [...list].sort((a, b) => a.price_usd - b.price_usd);
    } else if (sortBy === "price-desc") {
      list = [...list].sort((a, b) => b.price_usd - a.price_usd);
    }

    grid.innerHTML = list.map(p => cardHTML(p, catMap)).join("");
    T.watchPlates(grid);

    if (countEl) {
      countEl.textContent = `Showing ${list.length} of ${catalogue.products.length} pieces`;
    }
    if (emptyEl) {
      emptyEl.hidden = list.length > 0;
    }
  }

  catBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      activeCat = btn.dataset.cat || "all";
      syncPills();
      renderGrid();
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      renderGrid();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      sortBy = sortSelect.value;
      renderGrid();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      activeCat = "all";
      searchQuery = "";
      sortBy = "featured";
      if (searchInput) searchInput.value = "";
      if (sortSelect) sortSelect.value = "featured";
      syncPills();
      renderGrid();
    });
  }

  if (typeof gsap !== "undefined") {
    const title = $(".shop-hero__title");
    const letters = T.split(title);
    if (!T.reduced && letters.length) {
      gsap.fromTo(letters, { opacity: 0, scale: 1.35, filter: "blur(10px)" }, {
        opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.9, stagger: 0.025, ease: "expo.out", delay: 0.1,
      });
    }
  }
})();

/* TOTALITY · product page: render ?slug=…, then the film */
(() => {
  if (!window.T) return;
  const { $, $$, MQ, usd } = T;
  const STOCK = { in_stock: "In stock", low_stock: "Low stock this cycle", out_of_stock: "Out of stock" };
  const ALIAS = { "vanta-arc-trainer": "arc-blade-trainer" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  T.data.then(cat => {
    const want = new URLSearchParams(location.search).get("slug") || "";
    const p = cat.products.find(x => x.slug === (ALIAS[want] || want)) || cat.products[0];
    render(p, cat);
    T.watchPlates();
    motion(p);
  });

  function frame(x) {
    const oos = x.stock_status === "out_of_stock" ? ' <span class="frame__oos">· out of stock</span>' : "";
    return `<li class="frame"><a class="frame__link" href="product.html?slug=${x.slug}" data-video="${T.ROOT || "."}/images/${x.slug}.mp4">
      <figure class="plate frame__plate" style="--ar:3/2"><span class="plate__inner"><img src="${T.ROOT || "."}/images/${x.slug}.webp" alt="${esc(x.name)}" width="1536" height="1024" loading="lazy" decoding="async">
      <span class="slate" aria-hidden="true"><span class="slate__name">${esc(x.name)}</span><span class="slate__note">render pending</span></span></span></figure>
      <span class="frame__cap"><span class="frame__name" aria-hidden="true">${esc(x.name)}</span><span class="frame__price">${usd(x.price_usd)}${oos}</span></span></a></li>`;
  }

  function render(p, cat) {
    const catName = cat.categories.find(c => c.slug === p.category)?.name || "";
    const brand = window.BRAND?.shop_name;
    document.title = `${p.name} · ${brand || document.title.split(" · ").pop()}`;
    const set = (key, val) => $$(`[data-p="${key}"]`).forEach(el => (el.textContent = val));
    set("name", p.name); set("tagline", p.tagline); set("price", usd(p.price_usd)); set("price-num", p.price_usd);
    set("stock", STOCK[p.stock_status] || ""); set("description", p.description);
    set("policy", "Ships in 3–5 orbital cycles · 30-day returns");
    const sup = $('[data-p="support-link"]');
    if (sup) sup.href = `contact.html?scenario=refund&product=${encodeURIComponent(p.slug)}`;
    const cl = $('[data-p="catlink"]');
    if (cl) { cl.textContent = catName; cl.href = `index.html#ch-${p.category}`; }
    $$("[data-p-img]").forEach(img => {
      const plate = img.closest(".plate");
      plate.classList.remove("is-missing");
      img.src = `${T.ROOT || "."}/images/${p.slug}.webp`;
      if (img.alt) img.alt = p.name;
      plate.querySelector(".slate__name").textContent = p.name;
    });
    $$("[data-add]").forEach(b => {
      b.dataset.add = p.slug;
      const oos = p.stock_status === "out_of_stock";
      b.disabled = oos;
      b.innerHTML = oos ? `Out of stock<span class="sr-only">: ${esc(p.name)}</span>` : `Add <span class="sr-only">${esc(p.name)} </span>to cart`;
    });
    $('[data-p="specs"]').innerHTML = p.materials_specs.map(s => {
      const i = s.indexOf(":");
      return i > 0 ? `<div class="spec"><dt>${esc(s.slice(0, i).trim())}</dt><dd>${esc(s.slice(i + 1).trim())}</dd></div>`
                   : `<div class="spec spec--solo"><dt class="sr-only">Detail</dt><dd>${esc(s)}</dd></div>`;
    }).join("");
    $('[data-p="lore"]').innerHTML = p.lore.map(l => `<p class="sub">${esc(l)}</p>`).join("");
    const same = cat.products.filter(x => x.category === p.category && x.slug !== p.slug);
    const rest = cat.products.filter(x => x.category !== p.category);
    $('[data-p="related"]').innerHTML = [...same, ...rest].slice(0, 3).map(frame).join("");
  }

  function motion(p) {
    const title = $(".p-hero__title");
    const letters = T.split(title);
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") return;
    const mm = gsap.matchMedia();
    mm.add({ full: MQ.full, lite: MQ.lite, reduced: MQ.reduced }, ctx => {
      const { full, reduced } = ctx.conditions;
      if (reduced) return;

      /* letterboxed hero: a scrubbed light sweep reveals the plate */
      gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: ".p-hero", start: "top top", end: () => "+=" + innerHeight * (full ? 1 : .5), pin: true, scrub: .8, anticipatePin: 1, invalidateOnRefresh: true },
      })
        .fromTo(".p-hero__veil", { xPercent: -48 }, { xPercent: 0, duration: 1 }, 0)
        .fromTo(".p-hero__sweep", { xPercent: -70 }, { xPercent: 60, duration: 1 }, 0)
        .fromTo(".p-hero__plate .plate__inner", { scale: 1.04 }, { scale: 1, duration: 1 }, 0)
        .fromTo(".p-hero .bar", { scaleY: 1.35 }, { scaleY: 1, duration: .6, ease: "power2.out" }, 0);
      gsap.fromTo(letters, { opacity: 0, scale: 1.4, filter: "blur(12px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.1, stagger: .035, ease: "expo.out", delay: .15 });

      /* In the round: scroll-driven 3D with a studio fallback */
      const stage = $(".tt__stage"), card = $(".tt__card"), deg = $("[data-deg]"), hint = $(".tt__hint"), canvas = $(".tt__seq");
      const plateInner = card?.querySelector(".tt__face--front .plate__inner");
      const turn = { p: 0 };
      let seq = null;
      T.sequence(p.slug, canvas).then(s => { seq = s; });

      const stageCtrl = T.mount3DStage({
        stage,
        card,
        plateInner,
        slug: p.slug,
        name: p.name,
        onUpdateMeta(meta) {
          if (deg) deg.textContent = String(meta.deg).padStart(3, "0");
          if (hint && meta.hint) hint.textContent = meta.hint;
        },
      });

      const apply = () => {
        const d = Math.round(turn.p * 360);
        if (deg) deg.textContent = String(d).padStart(3, "0");
        stageCtrl.update(turn.p);
        if (seq && !stageCtrl.is3D()) {
          seq.draw(turn.p);
        }
      };

      gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: ".tt", start: "top top", end: () => "+=" + innerHeight * (full ? 2 : 1), pin: true, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true },
      })
        .fromTo(turn, { p: 0 }, { p: 1, duration: 1, onUpdate: apply }, 0)
        .fromTo(".tt__sweep", { xPercent: -90 }, { xPercent: 90, duration: .5 }, 0)
        .fromTo(".tt__sweep", { xPercent: -90 }, { xPercent: 90, duration: .5, immediateRender: false }, .5);

      /* price title card: the number slams once */
      gsap.fromTo(".pc__price > span", { opacity: 0, scale: 1.4, filter: "blur(14px)" }, {
        opacity: 1, scale: 1, filter: "blur(0px)", duration: .9, stagger: .12, ease: "expo.out",
        scrollTrigger: { trigger: ".pc", start: "top 65%", toggleActions: "play none none reverse" },
      });

      /* lore: three subtitles type in, one at a time, while the frame holds */
      const subs = $(".subs"), lines = $$(".sub", subs);
      subs.classList.add("subs--live");
      const chars = lines.map(l => {
        const text = l.textContent; l.textContent = "";
        l.setAttribute("aria-label", text);
        const spans = [...text].map(ch => { const s = document.createElement("span"); s.className = "c"; s.textContent = ch; s.setAttribute("aria-hidden", "true"); l.append(s); return s; });
        return spans;
      });
      let cur = -1, typing = null;
      const show = (i, instant) => {
        if (i === cur) return; cur = i;
        lines.forEach((l, j) => l.classList.toggle("is-current", j === i));
        typing && typing.kill();
        chars.forEach((c, j) => { if (j !== i) c.forEach(s => s.classList.remove("on")); });
        if (instant) return chars[i].forEach(s => s.classList.add("on"));
        typing = gsap.to(chars[i], { duration: .001, stagger: { each: .022, onStart() { this.targets()[0].classList.add("on"); } } });
      };
      show(0, true);
      ScrollTrigger.create({
        trigger: ".lore__frame", start: () => (full ? "center center" : "top 15%"), end: () => "+=" + innerHeight * (full ? 1.5 : .9),
        pin: true, anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: self => show(Math.min(lines.length - 1, Math.floor(self.progress * lines.length * .999))),
        onLeaveBack: () => show(0, true),
      });

      return () => {
        subs.classList.remove("subs--live");
        lines.forEach(l => { l.textContent = l.getAttribute("aria-label"); l.removeAttribute("aria-label"); l.classList.remove("is-current"); });
        stageCtrl.destroy();
      };
    });
  }
})();

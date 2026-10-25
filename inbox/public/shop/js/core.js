/* TOTALITY · shared runtime: data, cart, dialogs, plates, 3D stage, Lenis, comet-moth */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const MQ = {
    full: "(min-width:1024px) and (prefers-reduced-motion:no-preference)",
    lite: "(max-width:1023px) and (prefers-reduced-motion:no-preference)",
    reduced: "(prefers-reduced-motion:reduce)",
  };
  const reduced = matchMedia(MQ.reduced).matches;
  const hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  const usd = n => `${n} GC`;
  const ROOT = (!location.pathname.includes("/shop/") && !location.pathname.includes("/store/") && location.pathname.includes("/concepts/")) ? "../.." : ".";

  /* ---------- intergalactic languages: reversible text, stable word ciphers ---------- */
  const languages = [
    { id: "en", code: "EARTH", name: "Planet Earth", subtitle: "Basic", flag: "earth-basic" },
    { id: "vth", code: "VTH", name: "Vorthak", subtitle: "Outer Rim", flag: "vorthak" },
    { id: "xly", code: "XLY", name: "Xylosian", subtitle: "Nebula Choir", flag: "xylos" },
    { id: "kzk", code: "KZK", name: "Krazz'ik", subtitle: "Insectoid Hive", flag: "krazzik" },
    { id: "zog", code: "ZOG", name: "Zogwortian", subtitle: "Swamp Moon", flag: "zogwort" },
  ];
  const syllables = {
    vth: ["krr'vak", "zhth", "ul-khor", "vrax'n", "q'thun", "drak-vor"],
    xly: ["aeloria", "shii'luna", "vaen", "oou'ri", "lyss'ea", "nae'vyn"],
    kzk: ["bzz't", "krak-xik", "t'chzz", "xik'krr", "zzz'tik", "ch'kax"],
    zog: ["gloop", "blarg-wub", "zog'plop", "blorp", "quag-mub", "slurp'zog"],
  };
  const LANG_KEY = "totality.lang.v1";
  const originals = new WeakMap();
  const letterGroups = new WeakMap();
  const skipTranslation = "script,style,code,pre,noscript,textarea,.sql,[data-no-translate]";
  let language = "en";
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (languages.some(l => l.id === saved)) language = saved;
  } catch (e) {}

  function cipher(text, lang) {
    if (lang === "en") return text;
    return text.replace(/[A-Za-z]+/g, word => {
      // Credits and other currency codes stay readable, including inside sentences.
      if (/^(GC|USD|EUR|GBP)$/.test(word)) return word;
      let hash = 2166136261;
      for (const ch of `${lang}:${word.toLowerCase()}`) {
        hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
      }
      const translated = syllables[lang][hash % syllables[lang].length];
      if (word === word.toUpperCase()) return translated.toUpperCase();
      if (/^[A-Z]/.test(word)) return translated[0].toUpperCase() + translated.slice(1);
      return translated;
    });
  }

  function translateNode(node, lang) {
    const current = node.data;
    let saved = originals.get(node);
    // Renderers can update an existing node as well as replace its parent.
    if (!saved || current !== saved.rendered) saved = { english: current, rendered: current };
    const translated = cipher(saved.english, lang);
    saved.rendered = translated;
    originals.set(node, saved);
    if (current !== translated) node.data = translated;
  }

  function translateLetters(group, lang) {
    const letters = [...group.children].filter(el => el.matches(".ch,.c"));
    const current = letters.map(el => el.textContent).join("");
    let saved = letterGroups.get(group);
    if (!saved || current !== saved.rendered) saved = { english: current, rendered: current };
    const translated = cipher(saved.english, lang);
    saved.rendered = translated;
    letterGroups.set(group, saved);
    // Keep the spans that GSAP already targets; only their text changes.
    letters.forEach((el, i) => {
      const text = i === letters.length - 1 ? translated.slice(i) : translated.slice(i, i + 1);
      if (el.textContent !== text) el.textContent = text;
    });
  }

  function translateRoot(root, lang) {
    if (!root?.isConnected) return;
    const element = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    if (!element || element.closest(skipTranslation)) return;
    const animated = element.closest(".word,.sub");
    if (animated?.querySelector(":scope > .ch,:scope > .c")) {
      translateLetters(animated, lang);
      return;
    }
    if (root.nodeType === Node.TEXT_NODE) return translateNode(root, lang);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches(skipTranslation)) return NodeFilter.FILTER_REJECT;
          if (node.matches(".word,.sub") && node.querySelector(":scope > .ch,:scope > .c")) {
            translateLetters(node, lang);
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) translateNode(walker.currentNode, lang);
  }

  const languageObserver = new MutationObserver(records => {
    const roots = new Set();
    for (const record of records) {
      if (record.type === "characterData") roots.add(record.target);
      else record.addedNodes.forEach(node => roots.add(node));
    }
    languageObserver.disconnect();
    roots.forEach(root => translateRoot(root, language));
    observeLanguage();
  });
  const observeLanguage = () => languageObserver.observe(document.body, { childList: true, characterData: true, subtree: true });

  function applyLanguage(next = language) {
    if (!languages.some(l => l.id === next)) return;
    language = next;
    try { localStorage.setItem(LANG_KEY, language); } catch (e) {}
    languageObserver.disconnect();
    // Hidden dialogs are prepared too, so opening one never flashes English.
    translateRoot(document.body, language);
    syncLanguageButton();
    observeLanguage();
    if (hasGsap) requestAnimationFrame(() => ScrollTrigger.refresh());
  }

  function syncLanguageButton() {
    const active = languages.find(l => l.id === language);
    const button = $(".lang-switch__btn");
    if (!button) return;
    $("img", button).src = `images/flags/${active.flag}.svg`;
    $(".lang-switch__code", button).textContent = active.code;
    button.setAttribute("aria-label", `Language: ${active.name} · ${active.subtitle}`);
    $$(".lang-switch__option").forEach(option => {
      option.setAttribute("aria-checked", String(option.dataset.lang === language));
    });
  }

  function mountLanguageSwitch() {
    const mast = $(".mast"), cartButton = $(".mast__cart", mast || document);
    if (!mast || !cartButton || $(".lang-switch", mast)) return;
    const control = document.createElement("div");
    control.className = "lang-switch";
    control.dataset.noTranslate = "";
    control.innerHTML = `<button class="lang-switch__btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="totality-languages">
      <img src="images/flags/earth-basic.svg" width="24" height="16" alt=""><span class="lang-switch__code">EARTH</span>
      <svg class="lang-switch__chevron" viewBox="0 0 12 8" width="10" height="7" aria-hidden="true"><path d="m1 1 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
    </button><div class="lang-switch__menu" id="totality-languages" role="menu" aria-label="Intergalactic language" hidden>
      ${languages.map(l => `<button class="lang-switch__option" type="button" role="menuitemradio" aria-checked="false" tabindex="-1" data-lang="${l.id}">
        <img src="images/flags/${l.flag}.svg" width="24" height="16" alt=""><span><span class="lang-switch__name">${l.name}</span><span class="lang-switch__subtitle">${l.subtitle}</span></span>
        <svg class="lang-switch__check" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="m1 6 3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
      </button>`).join("")}</div>`;
    mast.insertBefore(control, cartButton);
    const button = $(".lang-switch__btn", control), menu = $(".lang-switch__menu", control);
    const options = $$(".lang-switch__option", control);
    const close = (restoreFocus = false) => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (restoreFocus) button.focus({ preventScroll: true });
    };
    const open = (index = languages.findIndex(l => l.id === language)) => {
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      options[index].focus({ preventScroll: true });
    };
    button.addEventListener("click", () => menu.hidden ? open() : close());
    options.forEach(option => option.addEventListener("click", () => {
      applyLanguage(option.dataset.lang);
      close(true);
    }));
    control.addEventListener("keydown", e => {
      const index = options.indexOf(document.activeElement);
      if (e.key === "Escape" && !menu.hidden) { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        open(index < 0 ? (e.key === "ArrowDown" ? 0 : options.length - 1) : (index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      } else if (!menu.hidden && (e.key === "Home" || e.key === "End")) {
        e.preventDefault(); open(e.key === "Home" ? 0 : options.length - 1);
      } else if (index >= 0 && /^[a-z]$/i.test(e.key)) {
        const match = languages.findIndex((l, i) => i > index && l.name.toLowerCase().startsWith(e.key.toLowerCase()));
        const first = languages.findIndex(l => l.name.toLowerCase().startsWith(e.key.toLowerCase()));
        if (match >= 0 || first >= 0) { e.preventDefault(); open(match >= 0 ? match : first); }
      }
    });
    document.addEventListener("pointerdown", e => { if (!control.contains(e.target)) close(); });
    control.addEventListener("focusout", e => { if (!control.contains(e.relatedTarget)) close(); });
    syncLanguageButton();
  }

  /* ---------- data ---------- */
  const data = (async () => {
    try {
      const r = await fetch(ROOT + "/data/catalogue.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (err) {
      const el = $("#catalogue-data");
      return el ? JSON.parse(el.textContent) : { categories: [], products: [] };
    }
  })();

  /* ---------- 3D models manifest ---------- */
  const models = (async () => {
    try {
      const r = await fetch(ROOT + "/models/manifest.json", { cache: "no-cache" });
      if (!r.ok) return [];
      const j = await r.json();
      if (Array.isArray(j)) return j;
      if (Array.isArray(j.models)) return j.models;
      return Object.keys(j).filter(k => !k.startsWith("_") && typeof j[k] === "string" && j[k].endsWith(".glb"));
    } catch (e) {
      return [];
    }
  })();

  /* ---------- plates: missing image -> slate ---------- */
  function watchPlates(root = document) {
    $$(".plate img", root).forEach(img => {
      const plate = img.closest(".plate");
      if (!plate) return;
      const miss = () => plate.classList.add("is-missing");
      if (img.complete && img.getAttribute("src") && img.naturalWidth === 0) miss();
      img.addEventListener("error", miss);
      img.addEventListener("load", () => plate.classList.remove("is-missing"));
    });
  }
  watchPlates();

  /* ---------- logo slot ---------- */
  const logo = new Image();
  logo.onload = () => $$("[data-logo-slot]").forEach(slot => {
    const im = logo.cloneNode();
    im.alt = "";
    slot.append(im);
    slot.closest(".endcard")?.classList.add("has-logo");
  });
  logo.src = ROOT + "/images/logo-shop.svg";

  /* ---------- live region ---------- */
  const live = $("[data-live]");
  const say = msg => { if (!live) return; live.textContent = ""; setTimeout(() => (live.textContent = msg), 40); };

  /* ---------- cart ---------- */
  const KEY = "totality.cart.v1";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
  const write = items => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {} paintCart(); };
  const cart = {
    items: read,
    count: () => read().reduce((n, i) => n + i.qty, 0),
    add(slug) {
      const items = read(); const hit = items.find(i => i.slug === slug);
      hit ? hit.qty++ : items.push({ slug, qty: 1 });
      write(items);
    },
    set(slug, qty) { write(read().map(i => i.slug === slug ? { ...i, qty } : i).filter(i => i.qty > 0)); },
  };
  let catalogue = null;
  data.then(c => { catalogue = c; paintCart(); });
  const bySlug = slug => catalogue?.products.find(p => p.slug === slug);

  function paintCart() {
    const n = cart.count();
    $$("[data-cart-count]").forEach(el => (el.textContent = n));
    const list = $("[data-cart-list]"); if (!list || !catalogue) return;
    const items = read().filter(i => bySlug(i.slug));
    list.innerHTML = "";
    let total = 0;
    items.forEach(i => {
      const p = bySlug(i.slug); total += p.price_usd * i.qty;
      const li = document.createElement("li");
      li.className = "cart__item";
      li.innerHTML = `<a href="product.html?slug=${p.slug}">${p.name}</a><span class="cart__line">${usd(p.price_usd * i.qty)}</span>
        <div class="cart__qty"><button type="button" data-q="-1" aria-label="One fewer ${p.name}">−</button><output aria-label="Quantity">${i.qty}</output><button type="button" data-q="1" aria-label="One more ${p.name}">+</button><button type="button" class="cart__rm" data-q="0">Remove<span class="sr-only"> ${p.name}</span></button></div>`;
      li.querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => {
        const d = +b.dataset.q;
        cart.set(p.slug, d === 0 ? 0 : i.qty + d);
        say(d === 0 ? `${p.name} removed.` : `${p.name}: ${Math.max(0, i.qty + d)}.`);
        requestAnimationFrame(() => ($("[data-cart-list] button") || $("#cart [data-close]"))?.focus());
      }));
      list.append(li);
    });
    const emptyEl = $("[data-cart-empty]");
    if (emptyEl) emptyEl.hidden = items.length > 0;
    const totalEl = $("[data-cart-total]");
    if (totalEl) totalEl.textContent = usd(total);
  }
  paintCart();

  document.addEventListener("click", e => {
    const b = e.target.closest("[data-add]");
    if (!b || b.disabled) return;
    const slug = b.dataset.add;
    cart.add(slug);
    const p = bySlug(slug);
    say(`${p ? p.name : "Item"} added. Cart holds ${cart.count()}.`);
    b.classList.add("is-added");
    clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove("is-added"), 1400);
    moth.cheer();
  });

  /* ---------- dialogs (menu + cart): native modal = inert page + focus trap ---------- */
  let lastOpener = null;
  const openDialog = (dlg, opener) => {
    if (!dlg || dlg.open) return;
    lastOpener = opener; paintCart();
    dlg.showModal(); T.lenis?.stop();
    (dlg.querySelector("[data-close]"))?.focus();
  };
  document.addEventListener("click", e => {
    const o = e.target.closest("[data-open-cart]"); if (o) return openDialog($("#cart"), o);
    const m = e.target.closest('[data-open="menu"]'); if (m) return openDialog($("#menu"), m);
    const c = e.target.closest("dialog [data-close]"); if (c) c.closest("dialog").close();
  });
  $$("dialog").forEach(d => {
    d.addEventListener("close", () => { T.lenis?.start(); lastOpener?.focus({ preventScroll: true }); });
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
  });
  $$("#menu a").forEach(a => a.addEventListener("click", () => { lastOpener = null; }));

  /* ---------- hover/focus loops: play <slug>.mp4 if it exists ---------- */
  const assetMan = fetch(ROOT + "/images/seq/manifest.json").then(r => r.ok ? r.json() : {}).catch(() => ({}));
  let videoList = []; assetMan.then(m => { videoList = m.video || []; });
  if (!reduced) {
    const play = link => {
      if (link.dataset.videoState === "missing") return;
      const vs = (link.dataset.video.match(/([^/]+)\.mp4$/) || [])[1]; if (!videoList.includes(vs)) return;
      const plate = link.querySelector(".plate"); if (!plate) return;
      let v = plate.querySelector("video");
      if (!v) {
        v = document.createElement("video");
        Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "auto" });
        v.setAttribute("aria-hidden", "true");
        v.addEventListener("error", () => { link.dataset.videoState = "missing"; v.remove(); }, { once: true });
        v.src = link.dataset.video;
        plate.querySelector(".plate__inner").append(v);
      }
      v.play().catch(() => {});
    };
    const stop = link => link.querySelector("video")?.pause();
    document.addEventListener("pointerover", e => { const l = e.target.closest("[data-video]"); if (l && !l.contains(e.relatedTarget)) play(l); });
    document.addEventListener("pointerout", e => { const l = e.target.closest("[data-video]"); if (l && !l.contains(e.relatedTarget)) stop(l); });
    document.addEventListener("focusin", e => { const l = e.target.closest("[data-video]"); if (l) play(l); });
    document.addEventListener("focusout", e => { const l = e.target.closest("[data-video]"); if (l) stop(l); });
  }

  /* ---------- image sequence probe: images/seq/<slug>/0001.webp … 0036.webp ---------- */
  function sequence(slug, canvas, frames = 36) {
    return assetMan.then(m => (m.seq || []).includes(slug) ? new Promise(resolve => {
      const pad = i => String(i).padStart(4, "0");
      const first = new Image();
      first.onerror = () => resolve(null);
      first.onload = () => {
        const imgs = [first];
        for (let i = 2; i <= frames; i++) { const im = new Image(); im.decoding = "async"; im.src = `${ROOT}/images/seq/${slug}/${pad(i)}.webp`; imgs.push(im); }
        const ctx = canvas.getContext("2d");
        let last = -1;
        const fit = () => {
          const r = canvas.getBoundingClientRect(), dpr = Math.min(1.5, devicePixelRatio || 1);
          canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); last = -1;
        };
        const draw = p => {
          const i = Math.min(frames - 1, Math.max(0, Math.round(p * (frames - 1))));
          let im = imgs[i]; if (!im.complete || !im.naturalWidth) im = first;
          if (i === last && im !== first) return; last = i;
          const cw = canvas.width, ch = canvas.height, s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
          const w = im.naturalWidth * s, h = im.naturalHeight * s;
          ctx.clearRect(0, 0, cw, ch); ctx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h);
        };
        canvas.hidden = false; fit(); draw(0);
        let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(fit, 150); });
        resolve({ draw });
      };
      first.src = `${ROOT}/images/seq/${slug}/0001.webp`;
    }) : null);
  }

  /* ---------- scroll-driven interactive 3D <model-viewer> ---------- */
  function mount3DStage({ stage, card, plateInner, slug, name, onUpdateMeta }) {
    if (!stage) return { update() {}, is3D: () => false, destroy() {} };
    stage.querySelectorAll(".stage-3d, .stage-hud").forEach(el => el.remove());
    stage.classList.remove("has-3d-active", "has-3d-available");

    let ready = false;
    let destroyed = false;
    let mv = null;
    let userInteracting = false;
    let interactTimer = null;
    let currentP = 0;

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    hud.innerHTML = `
      <span class="stage-3d-badge" data-3d-badge hidden>
        <span class="stage-3d-badge__dot" aria-hidden="true"></span>
        <span>3D · DRAG TO ORBIT · SCROLL TO TURN</span>
      </span>
    `;
    stage.append(hud);

    const badgeEl = $("[data-3d-badge]", hud);

    const syncHud = () => {
      const in3D = ready && mv;
      stage.classList.toggle("has-3d-active", Boolean(in3D));
      if (badgeEl) badgeEl.hidden = !in3D;
      applyProgress(currentP);
    };

    const pauseScrub = () => {
      userInteracting = true;
      clearTimeout(interactTimer);
    };
    const resumeScrub = () => {
      if (!userInteracting) return;
      clearTimeout(interactTimer);
      interactTimer = setTimeout(() => {
        userInteracting = false;
        applyProgress(currentP);
      }, 800);
    };

    models.then(list => {
      if (destroyed || !list.includes(slug)) return;
      const wrap = document.createElement("div");
      wrap.className = "stage-3d";
      mv = document.createElement("model-viewer");
      mv.className = "stage-3d__mv";
      mv.setAttribute("loading", "eager");
      mv.setAttribute("src", `${ROOT}/models/${slug}.glb`);
      mv.setAttribute("poster", `${ROOT}/images/${slug}.webp`);
      mv.setAttribute("alt", `${name || slug} interactive 3D model`);
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("disable-zoom", "");
      mv.setAttribute("interpolation-decay", "50");
      mv.setAttribute("touch-action", "pan-y");
      mv.setAttribute("interaction-prompt", "none");
      mv.setAttribute("shadow-intensity", "1.2");
      mv.setAttribute("shadow-softness", "0.85");
      mv.setAttribute("exposure", "1.08");
      mv.setAttribute("camera-orbit", "0deg 75deg 105%");

      mv.addEventListener("pointerdown", pauseScrub);
      window.addEventListener("pointerup", resumeScrub);
      window.addEventListener("pointercancel", resumeScrub);
      mv.addEventListener("load", () => {
        if (destroyed) return;
        ready = true;
        if (card && hasGsap) gsap.set(card, { clearProps: "transform" });
        if (plateInner && hasGsap) gsap.set(plateInner, { clearProps: "transform" });
        syncHud();
      }, { once: true });
      mv.addEventListener("error", () => {
        ready = false;
        clearTimeout(interactTimer);
        userInteracting = false;
        window.removeEventListener("pointerup", resumeScrub);
        window.removeEventListener("pointercancel", resumeScrub);
        stage.classList.remove("has-3d-available", "has-3d-active");
        wrap.remove();
        mv = null;
        syncHud();
      }, { once: true });

      wrap.append(mv);
      stage.prepend(wrap);
      stage.classList.add("has-3d-available");
      syncHud();
    });

    function applyProgress(p) {
      currentP = p;
      const deg = Math.round(p * 360);
      if (ready && mv) {
        if (!userInteracting) {
          mv.cameraOrbit = `${deg}deg 75deg 105%`;
        }
        if (onUpdateMeta) {
          onUpdateMeta({
            mode: "3d",
            deg,
            hint: "3D Interactive · Drag to orbit 360° or scroll to turn.",
          });
        }
        return;
      }
      if (onUpdateMeta) {
        onUpdateMeta({
          mode: "2d",
          deg,
          hint: "Studio view.",
        });
      }
    }

    syncHud();

    return {
      update: applyProgress,
      is3D: () => ready && Boolean(mv),
      destroy() {
        destroyed = true;
        ready = false;
        clearTimeout(interactTimer);
        window.removeEventListener("pointerup", resumeScrub);
        window.removeEventListener("pointercancel", resumeScrub);
        stage.querySelectorAll(".stage-3d, .stage-hud").forEach(el => el.remove());
        stage.classList.remove("has-3d-active", "has-3d-available");
        if (card && hasGsap) gsap.set(card, { clearProps: "transform" });
        if (plateInner && hasGsap) gsap.set(plateInner, { clearProps: "transform" });
      },
    };
  }

  /* ---------- letter split for kinetic titles ---------- */
  function split(el) {
    if (!el) return [];
    translateRoot(el, "en");
    const text = el.textContent.trim();
    el.textContent = "";
    const sr = document.createElement("span"); sr.className = "sr-only"; sr.textContent = text;
    const vis = document.createElement("span"); vis.setAttribute("aria-hidden", "true");
    text.split(/\s+/).forEach((word, i) => {
      if (i) { const sp = document.createElement("span"); sp.className = "sp"; sp.textContent = " "; vis.append(sp); }
      const w = document.createElement("span"); w.className = "word";
      [...word].forEach(ch => { const s = document.createElement("span"); s.className = "ch"; s.textContent = ch; w.append(s); });
      vis.append(w);
    });
    el.append(sr, vis);
    return $$(".ch", vis);
  }

  /* ---------- 3D Kuat/Eclipse-class Capital Dreadnought Battleship cursor ---------- */
  const moth = (() => {
    const el = $(".moth");
    if (el) { el.setAttribute("viewBox", "0 0 120 64"); el.setAttribute("width", "84"); el.setAttribute("height", "45"); el.innerHTML = `<defs><linearGradient id="dn-hull" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#384152"/><stop offset="0.5" stop-color="#1E2430"/><stop offset="1" stop-color="#0D1017"/></linearGradient></defs><g fill="none" stroke-linejoin="round"><polygon points="114,32 22,8 8,16 14,32 8,48 22,56" fill="url(#dn-hull)" stroke="#64748B" stroke-width="1"/><polygon points="102,32 28,15 18,32 28,49" fill="#151922" stroke="#475569" stroke-width="0.75"/><polygon points="68,32 32,21 24,32 32,43" fill="#1E2532" stroke="#64748B" stroke-width="0.75"/><rect x="24" y="25" width="12" height="14" fill="#283142" stroke="#94A3B8" stroke-width="0.8"/><line x1="18" y1="32" x2="112" y2="32" stroke="#FF5A1F" stroke-width="0.9" stroke-opacity="0.75"/><circle cx="11" cy="24" r="2" fill="#38BDF8"/><circle cx="9" cy="32" r="2.6" fill="#FF5A1F"/><circle cx="11" cy="40" r="2" fill="#38BDF8"/></g>`; }
    const api = { shadow() {}, cheer() {}, strike() {}, mode: "rest" };
    if (reduced) return api;
    const follow = matchMedia("(hover:hover) and (pointer:fine)").matches;
    const perch = $("[data-perch]");
    if (!follow) {
      if (!el || !perch || innerWidth >= 1024 || !hasGsap) return api;
      perch.append(el); el.classList.add("is-perched"); api.mode = "perch";
      const flutter = () => {
        gsap.fromTo(el, { y: 0 }, { y: -10, duration: .22, yoyo: true, repeat: 3, ease: "sine.out", overwrite: true });
      };
      perch.parentElement.addEventListener("pointerdown", flutter);
      api.cheer = flutter;
      return api;
    }

    api.mode = "follow";
    document.documentElement.classList.add("has-dreadnought");

    const cvs = document.createElement("canvas");
    cvs.className = "dreadnought-canvas";
    cvs.setAttribute("aria-hidden", "true");
    document.body.append(cvs);
    const ctx = cvs.getContext("2d");

    let vw = innerWidth, vh = innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      vw = innerWidth; vh = innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
      cvs.width = Math.round(vw * dpr);
      cvs.height = Math.round(vh * dpr);
    };
    resize();
    addEventListener("resize", resize, { passive: true });

    /* ============================================================================
       Z-BUFFERED PER-PIXEL 3D RAY-SHADED & AZTEC-PLATED CAPITAL DREADNOUGHT ENGINE
       Precomputes a high-resolution 3D heightfield, surface normals, ray-cast
       self-shadows, ambient occlusion, Aztec durasteel micro-plating, and recessed
       casemate viewport strips on a 236x148 supersampled grid, then dynamically
       relit & Z-buffer parallax-warped in 3D (roll/pitch/yaw + muzzle lights) at 60fps.
       ============================================================================ */
    const SW = 236, SH = 148;
    const CX = 132, CY = 74; // Ship origin in sprite space; Prow tip at x = +80, Stern at x = -108
    const shipCvs = document.createElement("canvas");
    shipCvs.width = SW;
    shipCvs.height = SH;
    const shipCtx = shipCvs.getContext("2d");
    const shipImg = shipCtx.createImageData(SW, SH);
    const shipBuf32 = new Uint32Array(shipImg.data.buffer);
    const zBuf = new Float32Array(SW * SH);

    const hash2 = (x, y) => {
      let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    };

    function aztecPlate(x, y) {
      const gx1 = Math.floor((x + 130) / 6), gy1 = Math.floor((y + 90) / 4);
      const h1 = hash2(gx1, gy1);
      const subX = (h1 > 0.48) ? 3 : 6;
      const subY = (h1 > 0.32 && h1 < 0.78) ? 2 : 4;
      const gx2 = Math.floor((x + 130) / subX), gy2 = Math.floor((y + 90) / subY);
      const h2 = hash2(gx2 + 19, gy2 + 37);
      const fx = ((x + 130) % subX + subX) % subX;
      const fy = ((y + 90) % subY + subY) % subY;
      const isSeam = (fx < 0.58 || fy < 0.58) ? 1 : 0;
      return { tone: 0.80 + h2 * 0.40, isSeam, h1, h2 };
    }

    const H_MAP = new Float32Array(SW * SH);
    const MASK = new Uint8Array(SW * SH);
    const TIER = new Uint8Array(SW * SH);

    function evalShipHeight(x, y) {
      const ay = Math.abs(y);
      if (x > 80 || x < -108) return -1;
      // Split forward sensor mandible notch at the razor prow tip
      if (x > 71 && ay < (x - 71) * 0.20) return -1;

      const tFore = (80 - x) / 164; // 0 at prow (x=80), 1 at stern wingtips (x=-84)
      let maxW;
      if (x >= -84) {
        maxW = 0.75 + Math.pow(tFore, 0.93) * 52.0;
        // Kuat-class broadside sponson hangar notch (x in [-20 .. +14])
        if (x > -20 && x < 14) {
          maxW -= Math.sin(((x + 20) / 34) * Math.PI) * 3.6;
        }
        // Aft armored casemate flare (x in [-60 .. -36])
        if (x > -60 && x < -36) {
          maxW += Math.sin(((x + 60) / 24) * Math.PI) * 1.8;
        }
      } else {
        const tAft = (-84 - x) / 24;
        maxW = 52.5 - tAft * 28.0;
        if (x < -101 && ay < 21) maxW = 24.5;
      }

      if (ay > maxW) return -1;

      const edgeDist = maxW - ay;
      let tier = 1;

      const normY = maxW > 0.1 ? (ay / maxW) : 0;
      const spinePeak = 3.6 + (1 - Math.abs((x + 10) / 98)) * 7.2;
      let z = 1.8 + (1 - Math.pow(normY, 0.86)) * Math.max(1.5, spinePeak);

      // Chiseled outer hull armor bevel & recessed equatorial trench
      if (edgeDist < 4.0) {
        tier = 2;
        if (edgeDist < 1.7) {
          z = 0.8 + edgeDist * 0.95;
        } else {
          z -= 1.15;
        }
      }

      // Recessed Axial Dorsal Reactor Trench & Armored Spine Ribs
      if (ay < 3.8 && x > -80 && x < 66) {
        if (ay < 1.35) {
          const isRib = (Math.abs(((x + 108) % 9) - 4.5) < 1.15);
          z += isRib ? 1.1 : -1.55;
          tier = 2;
        } else if (ay < 3.1) {
          z += 1.75;
        }
      }

      if (x < -86) {
        z *= (1 - ((-86 - x) / 22) * 0.44);
      }

      // TIER 1 CITADEL SUPERSTRUCTURE (x in [-84 .. +30])
      if (x >= -84 && x <= 30) {
        const citT = (30 - x) / 114;
        let citW = 6.0 + citT * 22.8;
        if (x > -48 && x < -10) citW -= 1.6;
        if (x < -72) citW -= (-72 - x) * 0.68;
        if (ay <= citW) {
          const cEdge = citW - ay;
          const stepH = cEdge < 1.8 ? (cEdge / 1.8) * 5.2 : 5.2;
          z += stepH - normY * 1.1;
          tier = 3;
          if (cEdge > 3.4 && cEdge < 7.2 && ((Math.floor((x + 96) / 14) % 2) === 0)) {
            z -= 0.95;
          }
        }
      }

      // TIER 2 UPPER CITADEL SUPERSTRUCTURE (x in [-78 .. +6])
      if (x >= -78 && x <= 6) {
        const cit2T = (6 - x) / 84;
        let cit2W = 4.2 + cit2T * 14.5;
        if (x < -68) cit2W -= (-68 - x) * 0.58;
        if (ay <= cit2W) {
          const cEdge2 = cit2W - ay;
          const stepH2 = cEdge2 < 1.6 ? (cEdge2 / 1.6) * 4.8 : 4.8;
          z += stepH2;
          tier = 4;
        }
      }

      // TIER 3 COMMAND TERRACE & REACTOR DECK (x in [-74 .. -18])
      if (x >= -74 && x <= -18) {
        const cit3T = (-18 - x) / 56;
        const cit3W = 3.6 + cit3T * 8.4;
        if (ay <= cit3W) {
          const cEdge3 = cit3W - ay;
          z += (cEdge3 < 1.4 ? (cEdge3 / 1.4) : 1.0) * 4.0;
          tier = 5;
        }
      }

      // TIER 4 AFT COMMAND BRIDGE STALK & HAMMERHEAD T-BRIDGE TOWER (x in [-74 .. -54])
      if (x >= -73 && x <= -57 && ay <= 6.8) {
        const stalkEdge = Math.min(6.8 - ay, Math.min(x + 73, -57 - x));
        z += Math.min(1, stalkEdge / 1.5) * 6.8;
        tier = 6;
      }
      if (x >= -72 && x <= -56) {
        const wingSweep = Math.abs(x + 64) + ay * 0.17;
        if (ay <= 20.5 && wingSweep <= 9.6) {
          const bEdge = Math.min(20.5 - ay, 9.6 - wingSweep);
          const bridgeBase = 21.0;
          const bridgeTop = bridgeBase + Math.min(1, bEdge / 1.6) * 5.2;
          if (bridgeTop > z) {
            z = bridgeTop;
            tier = 6;
          }
          // Twin Geodesic Deflector Shield Domes at (x = -64, y = +-15.2)
          const dxD = x + 64, dyD = ay - 15.2;
          const rD2 = dxD * dxD + dyD * dyD;
          if (rD2 < 12.5) {
            z += Math.sqrt(12.5 - rD2) * 1.55;
            tier = 7;
          }
        }
      }

      // TIER 5: 8 HEAVY CASEMATE TURBO-LASER BARBETTES
      const turretCoords = [
        [30, 6.4], [10, 10.8], [-16, 15.2], [-42, 18.8]
      ];
      for (let i = 0; i < turretCoords.length; i++) {
        const tx0 = turretCoords[i][0], ty0 = turretCoords[i][1];
        const d2 = (x - tx0) * (x - tx0) + (ay - ty0) * (ay - ty0);
        if (d2 < 9.5) {
          z += Math.sqrt(9.5 - d2) * 1.15;
          tier = 8;
        }
      }

      return { z, tier, edgeDist, maxW };
    }

    for (let py = 0; py < SH; py++) {
      for (let px = 0; px < SW; px++) {
        const x = px - CX, y = py - CY;
        const res = evalShipHeight(x, y);
        const idx = py * SW + px;
        if (res === -1) {
          H_MAP[idx] = 0;
          MASK[idx] = 0;
        } else {
          const az = aztecPlate(x, y);
          const microZ = (az.tone - 1.0) * 0.95 - (az.isSeam ? 0.45 : 0);
          H_MAP[idx] = res.z + microZ;
          MASK[idx] = 1;
          TIER[idx] = res.tier;
        }
      }
    }

    const activePixels = [];
    for (let py = 1; py < SH - 1; py++) {
      for (let px = 1; px < SW - 1; px++) {
        const idx = py * SW + px;
        if (!MASK[idx]) continue;

        const x = px - CX, y = py - CY;
        const z = H_MAP[idx];
        const tier = TIER[idx];

        const dzdx = (H_MAP[idx + 1] - H_MAP[idx - 1]) * 0.5;
        const dzdy = (H_MAP[idx + SW] - H_MAP[idx - SW]) * 0.5;
        let nx = -dzdx * 0.85;
        let ny = -dzdy * 0.85;
        let nz = 1.0;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nx /= nLen; ny /= nLen; nz /= nLen;

        const slope = Math.hypot(dzdx, dzdy);

        // Ray-march crisp directional cast shadow from upper-left key light
        let shadow = 1.0;
        for (let step = 2; step <= 28; step += 2) {
          const sx = Math.round(px - step * 0.62);
          const sy = Math.round(py - step * 0.78);
          if (sx >= 0 && sx < SW && sy >= 0 && sy < SH) {
            const shZ = H_MAP[sy * SW + sx];
            const rayZ = z + step * 0.48;
            if (shZ > rayZ) {
              shadow = Math.max(0.18, shadow - 0.22 * (shZ - rayZ));
            }
          }
        }

        // Deep Ambient Occlusion at superstructure steps & trenches
        let aoSum = 0;
        const aoR = [[-2,0],[2,0],[0,-2],[0,2],[-3,-3],[3,3],[-3,3],[3,-3]];
        for (let k = 0; k < 8; k++) {
          const nIdx = (py + aoR[k][1]) * SW + (px + aoR[k][0]);
          const diff = H_MAP[nIdx] - z;
          if (diff > 0.55) aoSum += Math.min(2.8, diff * 0.42);
        }
        const ao = Math.max(0.24, 1.0 - aoSum * 0.095);

        const az = aztecPlate(x, y);
        let albedo = 0.25 * az.tone;
        let specMask = 1.0;

        if (tier === 2) { albedo *= 0.52; specMask = 0.45; }
        else if (tier === 3) { albedo *= 1.08; specMask = 1.15; }
        else if (tier === 4) { albedo *= 1.16; specMask = 1.28; }
        else if (tier === 5) { albedo *= 1.22; specMask = 1.35; }
        else if (tier === 6) { albedo *= 1.28; specMask = 1.48; }
        else if (tier === 7) { albedo *= 1.42; specMask = 1.75; }
        else if (tier === 8) { albedo *= 0.88; specMask = 1.35; }

        // Highlight razor hull & terrace step rims
        if (slope > 0.9 && dzdx + dzdy < 0) {
          albedo *= 1.24;
          specMask *= 1.35;
        }

        if (az.isSeam) {
          albedo *= 0.62;
          specMask *= 0.42;
        }
        if (x < -84) {
          albedo *= (0.68 + 0.32 * ((x + 108) / 24));
        }

        let emitType = 0;
        if (slope > 1.05 && x > -92 && x < 62) {
          const deckBand = Math.abs((z % 2.2) - 1.1) < 0.46;
          const winHash = hash2(Math.floor(x * 0.75), Math.floor(y * 0.75) + Math.floor(z));
          if (deckBand && winHash > 0.65) {
            emitType = (winHash > 0.84) ? 1 : 2;
          }
        }
        if (tier === 6 && x >= -58 && x <= -55.5 && Math.abs(y) < 18 && z > 21.5 && z < 24.8) {
          if ((Math.abs(y) % 2.2) < 1.35) emitType = 2;
        }
        if (tier === 2 && Math.abs(y) < 0.95 && x > -74 && x < 58 && (((x + 108) % 9) > 1.9)) {
          emitType = 3;
        }

        let edgeNeighbors = 0;
        if (MASK[idx - 1]) edgeNeighbors++;
        if (MASK[idx + 1]) edgeNeighbors++;
        if (MASK[idx - SW]) edgeNeighbors++;
        if (MASK[idx + SW]) edgeNeighbors++;
        const alpha = edgeNeighbors === 4 ? 255 : (edgeNeighbors === 3 ? 225 : 155);

        activePixels.push({
          x, y, z,
          nx, ny, nz,
          albedo: albedo * shadow * ao,
          specMask: specMask * shadow,
          ao: shadow * ao,
          emitType,
          alpha
        });
      }
    }

    const TURRETS = [
      { x:  15.0, y: -3.2, z:  5.0 }, { x:  15.0, y:  3.2, z:  5.0 },
      { x:   5.0, y: -5.4, z:  6.8 }, { x:   5.0, y:  5.4, z:  6.8 },
      { x:  -8.0, y: -7.6, z:  7.4 }, { x:  -8.0, y:  7.6, z:  7.4 },
      { x: -21.0, y: -9.4, z:  7.2 }, { x: -21.0, y:  9.4, z:  7.2 }
    ];

    const ENGINES = [
      { x: -52.5, y:   0.0, r: 3.4, main: true },
      { x: -51.5, y:  -7.2, r: 2.8, main: true },
      { x: -51.5, y:   7.2, r: 2.8, main: true },
      { x: -51.8, y:  -3.7, r: 1.5, main: false },
      { x: -51.8, y:   3.7, r: 1.5, main: false },
      { x: -49.8, y: -12.2, r: 1.7, main: false },
      { x: -49.8, y:  12.2, r: 1.7, main: false }
    ];

    /* --- Z-Buffered Per-Frame PBR Sprite Relighting & 3D Parallax Kernel --- */
    function shadeDreadnoughtSprite(heading, roll, pitch, lockProg, muzzle, now) {
      shipBuf32.fill(0);
      zBuf.fill(-999);

      const cH = Math.cos(-heading), sH = Math.sin(-heading);
      const wLx = -0.50, wLy = -0.58, wLz = 0.64;
      const l1x = wLx * cH - wLy * sH;
      const l1y = (wLx * sH + wLy * cH) * Math.cos(roll) + wLz * Math.sin(roll);
      const l1z = -(wLx * sH + wLy * cH) * Math.sin(roll) + wLz * Math.cos(roll);

      let hx = l1x - Math.sin(pitch) * 0.25;
      let hy = l1y - Math.sin(roll) * 0.45;
      let hz = l1z + Math.cos(roll) * 0.92;
      const hLen = Math.hypot(hx, hy, hz) || 1;
      hx /= hLen; hy /= hLen; hz /= hLen;

      const wRx = 0.58, wRy = 0.54, wRz = 0.61;
      const l2x = wRx * cH - wRy * sH;
      const l2y = (wRx * sH + wRy * cH) * Math.cos(roll) + wRz * Math.sin(roll);
      const l2z = -(wRx * sH + wRy * cH) * Math.sin(roll) + wRz * Math.cos(roll);

      const parX = -Math.sin(pitch) * 0.60;
      const parY = Math.sin(roll) * 0.85 - 0.32;
      const yScale = Math.cos(roll * 0.68);

      const reactorPulse = 0.42 + lockProg * 0.48 + muzzle * 0.65 + 0.12 * Math.sin(now * 0.008);

      for (let i = 0, len = activePixels.length; i < len; i++) {
        const p = activePixels[i];
        const fx = CX + p.x + p.z * parX;
        const fy = CY + p.y * yScale + p.z * parY;
        const px = Math.round(fx);
        const py = Math.round(fy);
        if (px < 0 || px >= SW - 1 || py < 0 || py >= SH - 1) continue;

        const outIdx = py * SW + px;
        if (p.z < zBuf[outIdx] - 0.2) continue;

        let r, g, b;
        if (p.emitType === 1) {
          r = 255; g = 216; b = 162;
        } else if (p.emitType === 2) {
          r = 175; g = 235; b = 255;
        } else if (p.emitType === 3) {
          r = Math.min(255, Math.round(48 + 207 * reactorPulse));
          g = Math.min(255, Math.round(36 + 92 * reactorPulse));
          b = Math.min(255, Math.round(48 + 38 * reactorPulse));
        } else {
          const d1 = Math.max(0, p.nx * l1x + p.ny * l1y + p.nz * l1z);
          const d2 = Math.max(0, p.nx * l2x + p.ny * l2y + p.nz * l2z);
          const ndoth = Math.max(0, p.nx * hx + p.ny * hy + p.nz * hz);
          const specSharp = Math.pow(ndoth, 32) * p.specMask;
          const specBroad = Math.pow(ndoth, 6) * p.specMask * 0.30;

          let mLight = 0;
          if (muzzle > 0.02 && p.x > -32) {
            const distM = Math.hypot(p.x - 32, p.y);
            mLight = muzzle * Math.max(0, 1 - distM / 88) * p.ao;
          }

          let aftBounce = 0;
          if (p.x < -74 && p.nx < -0.15) {
            aftBounce = (-p.nx) * 0.42;
          }

          const diff = (0.30 + d1 * 1.24 + d2 * 0.38) * p.albedo;
          r = Math.min(255, Math.round(diff * 212 + (specSharp + specBroad) * 152 + d2 * 14 + mLight * 195 + aftBounce * 30));
          g = Math.min(255, Math.round(diff * 226 + (specSharp + specBroad) * 164 + d2 * 34 + mLight * 115 + aftBounce * 98));
          b = Math.min(255, Math.round(diff * 250 + (specSharp + specBroad) * 182 + d2 * 58 + mLight * 60  + aftBounce * 155));
        }

        const packed = (p.alpha << 24) | (b << 16) | (g << 8) | r;
        zBuf[outIdx] = p.z;
        shipBuf32[outIdx] = packed;
        // Fill sub-pixel vertical compression gap when banking steeply
        if (yScale < 0.96 && p.z > zBuf[outIdx + SW]) {
          zBuf[outIdx + SW] = p.z;
          shipBuf32[outIdx + SW] = packed;
        }
      }

      shipCtx.putImageData(shipImg, 0, 0);
    }

    /* --- Flight & Combat State --- */
    const SHIP_SCALE = 1.12;
    let mx = vw * 0.76, my = vh * 0.64;
    let sx = mx - 54, sy = my + 36;
    let vx = 0, vy = 0;
    let heading = -0.58;
    let roll = 0, rollVel = 0;
    let pitch = 0.08, pitchVel = 0;
    let recoil = 0;
    let muzzleFlash = 0;
    let lockProgress = 0;
    let hovered = null, landed = null, shadowEl = null, hasMoved = false;
    let pointerDown = false, holdTimer = 0;

    const trails = [];
    const bolts = [];
    const beams = [];
    const shockwaves = [];
    const sparks = [];
    let lastTurretScreen = [];
    let lastProwScreen = [mx, my];

    const INTERACTIVE_SEL = 'a,button,[role="button"],[role="tab"],input,select,textarea,summary,label,[data-add],.card__item,.frame__link,.shop-card,model-viewer';

    addEventListener("pointermove", e => {
      hasMoved = true;
      mx = e.clientX;
      my = e.clientY;
      const t = e.target && e.target.closest ? e.target.closest(INTERACTIVE_SEL) : null;
      hovered = t;
    }, { passive: true });

    document.addEventListener("pointerover", e => {
      const t = e.target.closest && e.target.closest(INTERACTIVE_SEL);
      if (t) hovered = t;
      const b = e.target.closest && e.target.closest("[data-add]:not(:disabled)");
      if (b) landed = b;
    });
    document.addEventListener("pointerout", e => {
      const b = e.target.closest && e.target.closest("[data-add]");
      if (b && !b.contains(e.relatedTarget) && landed === b) landed = null;
      const t = e.target.closest && e.target.closest(INTERACTIVE_SEL);
      if (t && !t.contains(e.relatedTarget) && hovered === t) hovered = null;
    });

    function shipToScreen(lx, ly, lz, cx, cy, cH, sH, roll, pitch) {
      const parX = -Math.sin(pitch) * 0.60;
      const parY = Math.sin(roll) * 0.85 - 0.32;
      const yScale = Math.cos(roll * 0.68);
      const sxLocal = (lx + lz * parX) * SHIP_SCALE;
      const syLocal = (ly * yScale + lz * parY) * SHIP_SCALE;
      return [
        cx + sxLocal * cH - syLocal * sH,
        cy + sxLocal * sH + syLocal * cH
      ];
    }

    function spawnDetonation(tx, ty) {
      shockwaves.push({ x: tx, y: ty, r: 2, maxR: 52, alpha: 1.0, col: "ember", w: 2.5, speed: 155 });
      shockwaves.push({ x: tx, y: ty, r: 1, maxR: 32, alpha: 0.95, col: "cyan",  w: 1.7, speed: 112 });
      for (let i = 0; i < 32; i++) {
        const ang = (Math.PI * 2 * i) / 32 + (Math.random() - 0.5) * 0.32;
        const spd = 75 + Math.random() * 240;
        sparks.push({
          x: tx, y: ty,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 1.0,
          decay: 1.7 + Math.random() * 1.5,
          len: 6 + Math.random() * 11,
          sz: 1.0 + Math.random() * 1.5,
          tier: i % 3
        });
      }
    }

    const triggerStrike = (cx, cy) => {
      const tx = typeof cx === "number" ? cx : mx;
      const ty = typeof cy === "number" ? cy : my;
      if (typeof cx === "number" && typeof cy === "number") {
        mx = cx; my = cy; hasMoved = true;
      }

      recoil = Math.min(9.5, recoil + 6.4);
      pitchVel += 0.24;
      rollVel += (Math.random() - 0.5) * 0.22;
      muzzleFlash = 1.0;

      // High-intensity converging spinal railgun lance + 8 staggered casemate turbo-laser bolts
      beams.push({
        tx, ty,
        life: 1.0,
        decay: 4.2
      });

      const origins = lastTurretScreen.length ? lastTurretScreen : [[sx, sy]];
      origins.forEach((orig, i) => {
        bolts.push({
          turretIdx: i,
          x0: orig[0], y0: orig[1],
          x1: tx + (Math.random() - 0.5) * 4,
          y1: ty + (Math.random() - 0.5) * 4,
          prog: -i * 0.055,
          speed: 5.4,
          cyan: (i % 2) === 0,
          heavy: false
        });
      });
      bolts.push({
        turretIdx: -1,
        x0: lastProwScreen[0], y0: lastProwScreen[1],
        x1: tx, y1: ty,
        prog: 0.08, speed: 6.2, cyan: false, heavy: true
      });

      spawnDetonation(tx, ty);
    };

    addEventListener("pointerdown", e => {
      pointerDown = true;
      holdTimer = 0;
      triggerStrike(e.clientX, e.clientY);
    }, { passive: true });
    addEventListener("pointerup", () => { pointerDown = false; }, { passive: true });
    addEventListener("pointercancel", () => { pointerDown = false; }, { passive: true });

    let lastTime = performance.now();

    function renderFrame(now) {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
      lastTime = now;

      if (pointerDown) {
        holdTimer += dt;
        if (holdTimer > 0.19) {
          holdTimer = 0;
          triggerStrike(mx, my);
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);

      let tx = mx, ty = my;
      if (!hasMoved && shadowEl && !hovered) {
        const r = shadowEl.getBoundingClientRect();
        tx = r.left + r.width * 0.5;
        ty = r.top + r.height * 0.5;
      }

      const isLocked = Boolean(hovered || landed);
      lockProgress += ((isLocked ? 1 : 0) - lockProgress) * Math.min(1, dt * 12);

      // Prow tip is at local x = +40 CSS px; keep prow tip 18px behind exact click point (tx, ty)
      // so the cursor point is completely unobstructed and weapon salvos have a clear firing lane!
      const prowOffset = 40 * SHIP_SCALE + 18;
      const dxToCursor = tx - sx;
      const dyToCursor = ty - sy;
      const distToCursor = Math.hypot(dxToCursor, dyToCursor);

      let desiredHeading = heading;
      if (distToCursor > 3.0) {
        desiredHeading = Math.atan2(dyToCursor, dxToCursor);
      }

      let angDiff = desiredHeading - heading;
      while (angDiff > Math.PI) angDiff -= Math.PI * 2;
      while (angDiff < -Math.PI) angDiff += Math.PI * 2;

      const turnRate = angDiff * 11.5;
      heading += angDiff * Math.min(1, dt * 12.0);

      const desiredSx = tx - Math.cos(heading) * prowOffset;
      const desiredSy = ty - Math.sin(heading) * prowOffset;

      const ax = (desiredSx - sx) * 15.0;
      const ay = (desiredSy - sy) * 15.0;
      vx = (vx + ax * dt) * Math.pow(0.08, dt);
      vy = (vy + ay * dt) * Math.pow(0.08, dt);
      sx += (desiredSx - sx) * Math.min(1, dt * 14.0);
      sy += (desiredSy - sy) * Math.min(1, dt * 14.0);

      const speed = Math.hypot(vx, vy);

      const targetRoll = Math.max(-0.62, Math.min(0.62, turnRate * 0.10)) + Math.sin(now * 0.0020) * 0.055;
      rollVel += (targetRoll - roll) * 44 * dt;
      rollVel *= Math.pow(0.06, dt);
      roll += rollVel * dt;

      const targetPitch = 0.08 + Math.min(0.14, speed * 0.00035) + Math.cos(now * 0.0016) * 0.025;
      pitchVel += (targetPitch - pitch) * 38 * dt;
      pitchVel *= Math.pow(0.07, dt);
      pitch += pitchVel * dt;

      recoil *= Math.pow(0.018, dt);
      muzzleFlash *= Math.pow(0.008, dt);

      const renderCx = sx - Math.cos(heading) * recoil;
      const renderCy = sy - Math.sin(heading) * recoil;
      const cH = Math.cos(heading), sH = Math.sin(heading);

      shadeDreadnoughtSprite(heading, roll, pitch, lockProgress, muzzleFlash, now);

      lastProwScreen = shipToScreen(40, 0, 1.0, renderCx, renderCy, cH, sH, roll, pitch);

      /* 1. Emit & Render Silky Sub-Light Ion Contrail Particles */
      const thrustFactor = Math.min(1.85, 0.52 + speed * 0.0042 + muzzleFlash * 0.45);
      ENGINES.forEach(eng => {
        const ep = shipToScreen(eng.x, eng.y, 1.2, renderCx, renderCy, cH, sH, roll, pitch);
        if (eng.main && (speed > 10 || Math.random() < 0.75)) {
          const spread = (Math.random() - 0.5) * 1.4;
          trails.push({
            x: ep[0] - cH * 2 + sH * spread,
            y: ep[1] - sH * 2 - cH * spread,
            vx: -cH * (26 + speed * 0.16 + Math.random() * 18) + (Math.random() - 0.5) * 6,
            vy: -sH * (26 + speed * 0.16 + Math.random() * 18) + (Math.random() - 0.5) * 6,
            r: eng.r * SHIP_SCALE * (0.55 + Math.random() * 0.35),
            life: 1.0,
            decay: 2.5 + Math.random() * 1.4
          });
        }
      });

      for (let i = trails.length - 1; i >= 0; i--) {
        const p = trails[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= p.decay * dt;
        if (p.life <= 0) { trails.splice(i, 1); continue; }
        const rad = p.r * (0.35 + p.life * 0.85);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 2.0);
        g.addColorStop(0, `rgba(225, 248, 255, ${(p.life * 0.58).toFixed(3)})`);
        g.addColorStop(0.45, `rgba(56, 189, 248, ${(p.life * 0.34).toFixed(3)})`);
        g.addColorStop(1, "rgba(56, 189, 248, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad * 2.0, 0, Math.PI * 2);
        ctx.fill();
      }

      /* 2. Render Stern Ion Drive Thruster Plumes */
      ENGINES.forEach(eng => {
        const ep = shipToScreen(eng.x, eng.y, 1.2, renderCx, renderCy, cH, sH, roll, pitch);
        const plumeLen = (eng.main ? 19 : 10) * SHIP_SCALE * thrustFactor * (0.92 + Math.sin(now * 0.045 + eng.y) * 0.08);
        const tailX = ep[0] - cH * plumeLen;
        const tailY = ep[1] - sH * plumeLen;
        const r = eng.r * SHIP_SCALE;

        const pg = ctx.createLinearGradient(ep[0], ep[1], tailX, tailY);
        pg.addColorStop(0, "rgba(255, 255, 255, 0.96)");
        pg.addColorStop(0.32, "rgba(103, 232, 249, 0.82)");
        pg.addColorStop(0.72, "rgba(14, 165, 233, 0.32)");
        pg.addColorStop(1, "rgba(14, 165, 233, 0)");
        ctx.strokeStyle = pg;
        ctx.lineWidth = r * 1.45;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ep[0], ep[1]);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        const ng = ctx.createRadialGradient(ep[0], ep[1], 0, ep[0], ep[1], r * 2.2);
        ng.addColorStop(0, "#FFFFFF");
        ng.addColorStop(0.38, "rgba(125, 211, 252, 0.85)");
        ng.addColorStop(0.75, "rgba(255, 90, 31, 0.28)");
        ng.addColorStop(1, "rgba(255, 90, 31, 0)");
        ctx.fillStyle = ng;
        ctx.beginPath();
        ctx.arc(ep[0], ep[1], r * 2.2, 0, Math.PI * 2);
        ctx.fill();
      });

      /* 3. Composite the Z-Buffered Per-Pixel PBR Dreadnought Hull Sprite */
      ctx.save();
      ctx.translate(renderCx, renderCy);
      ctx.rotate(heading);
      ctx.scale(SHIP_SCALE * 0.5, SHIP_SCALE * 0.5);
      ctx.drawImage(shipCvs, -CX, -CY);
      ctx.restore();

      /* 4. Render 8 Swiveling Dual-Barrel Heavy Turbo-Laser Barrels on the Citadel Casemates */
      lastTurretScreen = [];
      TURRETS.forEach(t => {
        const tp = shipToScreen(t.x, t.y, t.z, renderCx, renderCy, cH, sH, roll, pitch);
        const aimAngle = Math.atan2(ty - tp[1], tx - tp[0]);
        const ca = Math.cos(aimAngle), sa = Math.sin(aimAngle);
        const perpX = -sa * 0.85, perpY = ca * 0.85;
        const bLen = (4.0 + lockProgress * 0.7) * SHIP_SCALE;

        ctx.strokeStyle = "rgba(195, 208, 228, 0.82)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(tp[0] + perpX, tp[1] + perpY);
        ctx.lineTo(tp[0] + perpX + ca * bLen, tp[1] + perpY + sa * bLen);
        ctx.moveTo(tp[0] - perpX, tp[1] - perpY);
        ctx.lineTo(tp[0] - perpX + ca * bLen, tp[1] - perpY + sa * bLen);
        ctx.stroke();

        const mx0 = tp[0] + ca * bLen, my0 = tp[1] + sa * bLen;
        lastTurretScreen.push([mx0, my0]);

        if (muzzleFlash > 0.06) {
          const mg = ctx.createRadialGradient(mx0, my0, 0, mx0, my0, 5.2 * muzzleFlash);
          mg.addColorStop(0, `rgba(255, 255, 255, ${muzzleFlash.toFixed(2)})`);
          mg.addColorStop(0.45, `rgba(255, 150, 70, ${(muzzleFlash * 0.82).toFixed(2)})`);
          mg.addColorStop(1, "rgba(255, 90, 31, 0)");
          ctx.fillStyle = mg;
          ctx.beginPath();
          ctx.arc(mx0, my0, 5.2 * muzzleFlash, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      /* 5. Render Converging Spinal Railgun Lance & Casemate Turbo-Laser Salvo Bolts */
      for (let i = beams.length - 1; i >= 0; i--) {
        const bm = beams[i];
        bm.life -= bm.decay * dt;
        if (bm.life <= 0) { beams.splice(i, 1); continue; }

        // Forward spinal lance from prow notch to target (bm.tx, bm.ty)
        const px0 = lastProwScreen[0], py0 = lastProwScreen[1];
        ctx.strokeStyle = `rgba(255, 95, 35, ${(bm.life * 0.78).toFixed(3)})`;
        ctx.lineWidth = 4.2 * bm.life;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(px0, py0);
        ctx.lineTo(bm.tx, bm.ty);
        ctx.stroke();

        ctx.strokeStyle = `rgba(255, 255, 255, ${(bm.life * 0.96).toFixed(3)})`;
        ctx.lineWidth = 1.6 * bm.life;
        ctx.beginPath();
        ctx.moveTo(px0, py0);
        ctx.lineTo(bm.tx, bm.ty);
        ctx.stroke();
      }

      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        b.prog += b.speed * dt;
        if (b.prog >= 1.0) { bolts.splice(i, 1); continue; }
        if (b.prog < 0) continue;

        // Track moving turret origin dynamically while bolt launches
        const orig = (b.turretIdx >= 0 && lastTurretScreen[b.turretIdx]) ? lastTurretScreen[b.turretIdx] : [b.x0, b.y0];
        const headT = Math.min(1, b.prog);
        const tailT = Math.max(0, b.prog - (b.heavy ? 0.58 : 0.44));
        const hx = orig[0] + (b.x1 - orig[0]) * headT;
        const hy = orig[1] + (b.y1 - orig[1]) * headT;
        const tx0 = orig[0] + (b.x1 - orig[0]) * tailT;
        const ty0 = orig[1] + (b.y1 - orig[1]) * tailT;

        ctx.strokeStyle = b.cyan ? "rgba(56, 189, 248, 0.88)" : "rgba(255, 105, 42, 0.92)";
        ctx.lineWidth = b.heavy ? 3.8 : 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tx0, ty0);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = b.heavy ? 1.7 : 1.1;
        ctx.beginPath();
        ctx.moveTo(tx0, ty0);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }

      /* 6. Render Cinema-Grade Impact Detonation, Anamorphic Flare & Ballistic Sparks */
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.r += sw.speed * dt;
        sw.alpha = Math.max(0, 1 - sw.r / sw.maxR);
        if (sw.alpha <= 0.01) { shockwaves.splice(i, 1); continue; }

        if (sw.r < 26 && sw.col === "ember") {
          const fg = ctx.createRadialGradient(sw.x, sw.y, 0, sw.x, sw.y, 26);
          fg.addColorStop(0, `rgba(255, 255, 255, ${(sw.alpha * 0.98).toFixed(3)})`);
          fg.addColorStop(0.3, `rgba(255, 215, 145, ${(sw.alpha * 0.85).toFixed(3)})`);
          fg.addColorStop(0.65, `rgba(255, 90, 31, ${(sw.alpha * 0.45).toFixed(3)})`);
          fg.addColorStop(1, "rgba(255, 90, 31, 0)");
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.arc(sw.x, sw.y, 26, 0, Math.PI * 2);
          ctx.fill();

          const streakW = 42 * sw.alpha;
          const sg = ctx.createLinearGradient(sw.x - streakW, sw.y, sw.x + streakW, sw.y);
          sg.addColorStop(0, "rgba(56, 189, 248, 0)");
          sg.addColorStop(0.5, `rgba(255, 250, 240, ${(sw.alpha * 0.92).toFixed(3)})`);
          sg.addColorStop(1, "rgba(56, 189, 248, 0)");
          ctx.strokeStyle = sg;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(sw.x - streakW, sw.y);
          ctx.lineTo(sw.x + streakW, sw.y);
          ctx.stroke();
        }

        ctx.save();
        ctx.translate(sw.x, sw.y);
        ctx.rotate(heading);
        ctx.scale(1.0, 0.72);
        ctx.strokeStyle = sw.col === "ember"
          ? `rgba(255, 115, 50, ${(sw.alpha * 0.90).toFixed(3)})`
          : `rgba(125, 211, 252, ${(sw.alpha * 0.85).toFixed(3)})`;
        ctx.lineWidth = sw.w * sw.alpha;
        ctx.beginPath();
        ctx.arc(0, 0, sw.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vx *= Math.pow(0.16, dt);
        sp.vy *= Math.pow(0.16, dt);
        sp.life -= sp.decay * dt;
        if (sp.life <= 0) { sparks.splice(i, 1); continue; }

        const spd = Math.hypot(sp.vx, sp.vy) || 1;
        const tailX = sp.x - (sp.vx / spd) * sp.len * sp.life;
        const tailY = sp.y - (sp.vy / spd) * sp.len * sp.life;

        ctx.strokeStyle = sp.tier === 0
          ? `rgba(255, 245, 215, ${sp.life.toFixed(3)})`
          : sp.tier === 1
            ? `rgba(255, 100, 38, ${sp.life.toFixed(3)})`
            : `rgba(125, 211, 252, ${sp.life.toFixed(3)})`;
        ctx.lineWidth = sp.sz * sp.life;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
      }

      /* 7. Render Subtle Military Rangefinder Lock-On Bracket at Exact Click Point (tx, ty) */
      if (lockProgress > 0.02 || muzzleFlash > 0.05) {
        const a = Math.min(0.85, lockProgress * 0.72 + muzzleFlash * 0.45);
        const rad = 10.5 - lockProgress * 3.0;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(now * 0.001);
        ctx.strokeStyle = muzzleFlash > 0.2
          ? `rgba(255, 90, 31, ${a.toFixed(3)})`
          : `rgba(125, 211, 252, ${a.toFixed(3)})`;
        ctx.lineWidth = 1.0;
        const c = 2.8;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx0, sy0]) => {
          ctx.beginPath();
          ctx.moveTo(sx0 * (rad - c), sy0 * rad);
          ctx.lineTo(sx0 * rad, sy0 * rad);
          ctx.lineTo(sx0 * rad, sy0 * (rad - c));
          ctx.stroke();
        });
        ctx.restore();
      }

      requestAnimationFrame(renderFrame);
    }

    requestAnimationFrame(renderFrame);

    api.shadow = target => { shadowEl = target; };
    api.strike = triggerStrike;
    api.cheer = () => { triggerStrike(mx, my); };
    return api;
  })();

  /* ---------- Lenis + ScrollTrigger ---------- */
  const T = (window.TOTALITY = window.T = {
    $, $$, MQ, ROOT, data, models, cart, split, sequence,
    mount3DStage, watchPlates, moth, say, usd, applyLanguage,
    lenis: null, reduced,
  });
  mountLanguageSwitch();
  if (document.readyState === "complete") applyLanguage();
  else document.addEventListener("DOMContentLoaded", () => applyLanguage(), { once: true });
  if (hasGsap) {
    gsap.registerPlugin(ScrollTrigger);
    if (!reduced && typeof window.Lenis !== "undefined") {
      const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, anchors: true });
      gsap.ticker.add(t => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
      lenis.on("scroll", ScrollTrigger.update);
      T.lenis = lenis;
    }
    const settle = () => {
      const imgs = $$("img").filter(i => i.loading !== "lazy");
      Promise.all([document.fonts.ready, ...imgs.map(i => i.decode().catch(() => {}))]).then(() => ScrollTrigger.refresh());
    };
    if (document.readyState === "complete") settle(); else addEventListener("load", settle, { once: true });
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
})();

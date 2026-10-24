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

  /* ---------- comet-moth ---------- */
  const moth = (() => {
    const el = $(".moth");
    const api = { shadow() {}, cheer() {}, mode: "rest" };
    if (!el || !hasGsap || reduced) return api;
    const follow = matchMedia("(min-width:1024px) and (hover:hover) and (pointer:fine)").matches;
    const perch = $("[data-perch]");
    if (!follow) {
      if (!perch || innerWidth >= 1024) return api;
      perch.append(el); el.classList.add("is-perched"); api.mode = "perch";
      const flutter = () => {
        el.classList.add("is-flutter");
        gsap.fromTo(el, { y: 0 }, { y: -14, duration: .22, yoyo: true, repeat: 3, ease: "sine.out", overwrite: true, onComplete: () => el.classList.remove("is-flutter") });
      };
      perch.parentElement.addEventListener("pointerdown", flutter);
      api.cheer = flutter;
      return api;
    }
    api.mode = "follow";
    document.body.append(el);
    el.classList.add("is-free");
    gsap.set(el, { x: innerWidth * .82, y: innerHeight * .7 });
    const xTo = gsap.quickTo(el, "x", { duration: .75, ease: "power3.out" });
    const yTo = gsap.quickTo(el, "y", { duration: .75, ease: "power3.out" });
    const rTo = gsap.quickTo(el, "rotation", { duration: .5, ease: "power2.out" });
    let lastS = 1;
    const sTo = v => { if (v !== lastS) { lastS = v; gsap.to(el, { scaleX: v, scaleY: v, duration: .5, ease: "power2.out", overwrite: "auto" }); } };
    let px = innerWidth * .82, py = innerHeight * .7, landed = null, shadowEl = null, lastX = px;
    addEventListener("pointermove", e => { px = e.clientX + 22; py = e.clientY + 18; }, { passive: true });
    const landOn = b => { landed = b; el.classList.add("is-landed"); };
    const takeOff = b => { if (landed === b) { landed = null; el.classList.remove("is-landed"); } };
    document.addEventListener("pointerover", e => { const b = e.target.closest("[data-add]:not(:disabled)"); if (b) landOn(b); });
    document.addEventListener("pointerout", e => { const b = e.target.closest("[data-add]"); if (b && !b.contains(e.relatedTarget)) takeOff(b); });
    document.addEventListener("focusin", e => { const b = e.target.closest("[data-add]:not(:disabled)"); if (b && b.matches(":focus-visible")) landOn(b); });
    document.addEventListener("focusout", e => { const b = e.target.closest("[data-add]"); if (b) takeOff(b); });
    gsap.ticker.add(() => {
      let tx = px, ty = py, sc = 1;
      if (landed && landed.isConnected) {
        const r = landed.getBoundingClientRect(); tx = r.right - 8; ty = r.top - 4; sc = .8;
      } else if (shadowEl) {
        const r = shadowEl.getBoundingClientRect(); tx = r.left + r.width / 2; ty = r.top + r.height / 2; sc = .62;
      }
      el.classList.toggle("is-shadow", !!shadowEl && !landed);
      xTo(tx); yTo(ty); sTo(sc);
      const vx = tx - lastX; lastX = tx;
      rTo(Math.max(-24, Math.min(24, vx * .8)));
    });
    api.shadow = target => { shadowEl = target; };
    api.cheer = () => { el.classList.add("is-flutter"); setTimeout(() => el.classList.remove("is-flutter"), 700); };
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

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
  const usd = n => `${n} USD`;
  const ROOT = location.pathname.includes("/concepts/") ? "../.." : ".";

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
  const T = (window.T = {
    $, $, MQ, ROOT, data, models, cart, split, sequence,
    mount3DStage, watchPlates, moth, say, usd,
    lenis: null, reduced,
  });
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

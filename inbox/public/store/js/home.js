/* TOTALITY · home choreography (see NOTES.md for the motion map) */
(() => {
  const { $, $$, MQ } = window.T || {};
  if (!window.T) return;

  /* ---------- keyboard route through the reel (all tiers) ---------- */
  const track = $(".reel__track");
  const links = track ? $$(".frame__link", track) : [];
  let reelSeek = null; // set while the reel is pinned
  if (track) {
    track.addEventListener("keydown", e => {
      const i = links.indexOf(document.activeElement); if (i < 0) return;
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: links.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const next = links[Math.max(0, Math.min(links.length - 1, to))];
      next.focus({ preventScroll: !!reelSeek });
      if (reelSeek) reelSeek(next);
      else next.scrollIntoView({ block: "nearest", inline: "center", behavior: T.reduced ? "auto" : "smooth" });
    });
    track.addEventListener("focusin", e => { const l = e.target.closest(".frame__link"); if (l && reelSeek) reelSeek(l); });
  }

  // titles split once; screen readers get the whole word
  const cardLetters = new Map($$(".card__title[data-split]").map(h => [h, T.split(h)]));

  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") return;
  const mm = gsap.matchMedia();

  mm.add({ full: MQ.full, lite: MQ.lite, reduced: MQ.reduced }, ctx => {
    const { full, reduced } = ctx.conditions;
    if (reduced) return; // CSS already shows every final state
    const cleanups = [hero(full), chapters(full), flood(full), reel(full), credits(full)];
    return () => cleanups.forEach(fn => fn && fn());
  });

  /* ---------- 1 · TOTALITY hero ---------- */
  function hero(full) {
    const sec = $(".hero"), moon = $(".moon"), words = $$(".hero__title .w");
    if (!sec || !moon) return;
    const k = { v: 0 };
    let corona = null;
    if (full) {
      sec.classList.add("has-canvas");
      corona = startCorona($(".corona"), k);
    }
    const poster = $(".corona-poster");
    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: sec, start: "top top", end: () => "+=" + innerHeight * (full ? 2 : 1),
        pin: true, scrub: 0.8, anticipatePin: 1, invalidateOnRefresh: true,
        onToggle: self => T.moth.shadow(self.isActive ? moon : null),
      },
    });
    tl.fromTo(".hero .bar", { scaleY: 1 }, { scaleY: 0, duration: 1.2, ease: "power2.inOut" }, 0)
      .fromTo(".hero__cue", { opacity: 1 }, { opacity: 0, duration: .6 }, 0)
      .fromTo(moon, { xPercent: -175 }, { xPercent: -4, duration: 4.5 }, 0)
      .fromTo(".hero__shade", { opacity: .3 }, { opacity: .86, duration: 4 }, .4)
      .fromTo(".sun-glare", { opacity: 1 }, { opacity: 0, duration: 3.8, ease: "power1.in" }, .5)
      .fromTo(k, { v: 0 }, { v: 1, duration: 3, ease: "power2.in" }, 1.5)
      .fromTo(poster, { opacity: 0 }, { opacity: 1, duration: 3, ease: "power2.in" }, 1.5)
      .fromTo(".blade__beam", { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.8, ease: "power2.out" }, 4.6)
      .fromTo(".hero__flash", { opacity: 0 }, { opacity: .16, duration: .25 }, 4.6)
      .to(".hero__flash", { opacity: 0, duration: .9 }, 4.85)
      .fromTo(words, { opacity: 0, scale: 1.4, filter: "blur(14px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: .7, stagger: .8, ease: "expo.out" }, 6.1)
      .to(moon, { xPercent: 0, duration: 1 }, 9)
      .fromTo(".bead", { opacity: 0, scale: .3 }, { opacity: 1, scale: 1, duration: .8 }, 9.2)
      .to(k, { v: .78, duration: 1 }, 9.2);
    return () => { corona && corona.destroy(); sec.classList.remove("has-canvas"); T.moth.shadow(null); };
  }

  /* corona: ~800 additive particles streaming off the disc edge; intensity k.v peaks at totality */
  function startCorona(canvas, k) {
    const ctx = canvas.getContext("2d");
    const N = 800, lobes = [0.3, 1.25, 2.1, 2.9, 3.7, 4.6, 5.5];
    const P = Array.from({ length: N }, () => spawn({}, true));
    function spawn(p, fresh) {
      const streamer = Math.random() < .7;
      p.a = streamer ? lobes[(Math.random() * lobes.length) | 0] + gauss() * .2 : Math.random() * Math.PI * 2;
      p.d = fresh ? Math.random() : 0;                 // travelled distance 0..1
      p.sp = .05 + Math.random() * .12;                // speed (per second)
      p.len = (streamer ? .12 : .04) + Math.random() * (streamer ? .4 : .12);
      p.w = .6 + Math.random() * 1.8;
      p.al = .25 + Math.random() * .75;
      p.bone = Math.random() < .22;
      p.spin = (Math.random() - .5) * .02;
      return p;
    }
    function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
    let w = 0, h = 0, dpr = 1, R = 0, raf = 0, visible = true, started = false, last = performance.now();
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(1.5, devicePixelRatio || 1);
      w = r.width; h = r.height; R = w / 3.4 / 2;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    };
    const frame = now => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const kv = k.v;
      if (kv < .01) return;
      const cx = w / 2, cy = h / 2;
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(cx, cy, R * .98, cx, cy, R * 1.55);
      g.addColorStop(0, `rgba(255,240,224,${.85 * kv})`);
      g.addColorStop(.12, `rgba(255,150,96,${.45 * kv})`);
      g.addColorStop(.45, `rgba(255,90,31,${.14 * kv})`);
      g.addColorStop(1, "rgba(255,90,31,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.55, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = "round";
      for (const p of P) {
        p.d += p.sp * dt * (.5 + kv);
        p.a += p.spin * dt;
        if (p.d >= 1) spawn(p, false);
        const r0 = R * (1 + p.d * .7), r1 = r0 + R * p.len * (.35 + kv * .65);
        const fade = Math.pow(1 - p.d, 1.6) * Math.min(1, p.d * 8);
        const al = kv * fade * p.al;
        if (al < .02) continue;
        const c = Math.cos(p.a), s = Math.sin(p.a);
        ctx.strokeStyle = p.bone ? `rgba(242,238,230,${al})` : `rgba(255,90,31,${al})`;
        ctx.lineWidth = p.w;
        ctx.beginPath(); ctx.moveTo(cx + c * r0, cy + s * r0); ctx.lineTo(cx + c * r1, cy + s * r1); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };
    const play = () => { if (!raf && visible && started) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const pause = () => { cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? play() : pause(); });
    io.observe(canvas);
    let rt; const onResize = () => { clearTimeout(rt); rt = setTimeout(fit, 150); };
    addEventListener("resize", onResize);
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 200));
    const id = idle(() => { started = true; fit(); play(); }, { timeout: 1200 });
    return {
      destroy() { pause(); io.disconnect(); removeEventListener("resize", onResize); (window.cancelIdleCallback || clearTimeout)(id); ctx.clearRect(0, 0, canvas.width, canvas.height); },
    };
  }

  /* ---------- 2 · full-viewport stacking title cards ---------- */
  function chapters(full) {
    const cards = $$("#chapters .card");
    if (full) cards.slice(0, -1).forEach(card => {
      ScrollTrigger.create({
        trigger: card, start: "top top", end: "bottom top",
        pin: true, pinSpacing: false, invalidateOnRefresh: true,
      });
    });
    cards.forEach(card => {
      const letters = cardLetters.get(card.querySelector(".card__title")) || [];
      const inner = card.querySelector(".plate__inner"), dark = card.querySelector(".dark"), sweep = card.querySelector(".sweep");
      gsap.timeline({
        scrollTrigger: {
          trigger: card,
          start: "top 92%",
          end: full ? "top 22%" : "top 30%",
          scrub: 0.65,
          invalidateOnRefresh: true,
        },
      })
        .fromTo(inner, { yPercent: 12, scale: 1.08 }, { yPercent: 0, scale: 1, ease: "none" }, 0)
        .fromTo(dark, { opacity: 0.72 }, { opacity: 0, ease: "power1.in" }, 0)
        .fromTo(sweep, { xPercent: -100 }, { xPercent: 100, ease: "none", duration: 0.85 }, 0.15)
        .fromTo(letters, { yPercent: 45, opacity: 0, scale: 0.92 }, { yPercent: 0, opacity: 1, scale: 1, stagger: 0.022, duration: 0.45, ease: "expo.out" }, 0.25);
    });
  }

  /* ---------- 3 · ember flood (scroll-driven 3D with a studio fallback) ---------- */
  function flood(full) {
    const sec = $(".flood"), stage = $(".flood__stage"), turn = $(".flood__turn"), plate = $(".flood__plate");
    if (!sec || !stage || !turn || !plate) return;
    const plateInner = plate.querySelector(".plate__inner");
    const st = ScrollTrigger.create({ trigger: sec, start: "top 40%", end: "bottom 40%", toggleClass: { targets: document.body, className: "on-ember" } });
    const turnP = { p: 0 };
    let seq = null;
    const canvas = document.createElement("canvas");
    canvas.className = "tt__seq"; canvas.hidden = true;
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: 2 });
    plate.append(canvas);
    T.sequence("sovereign-arc-duellist", canvas).then(s => { seq = s; if (s) gsap.set(turn, { rotateY: 0 }); });

    const stageCtrl = T.mount3DStage({
      stage,
      card: turn,
      plateInner,
      slug: "sovereign-arc-duellist",
      name: "Sovereign Arc Duellist",
    });

    const apply = () => {
      stageCtrl.update(turnP.p);
      if (seq && !stageCtrl.is3D()) {
        seq.draw(turnP.p);
      }
    };
    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: { trigger: sec, start: "top top", end: () => "+=" + innerHeight * (full ? 1.5 : .6), pin: true, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true },
    });
    tl.fromTo(turnP, { p: 0 }, { p: 1, onUpdate: apply }, 0)
      .fromTo(".flood .sweep", { xPercent: -100 }, { xPercent: 100 }, 0)
      .fromTo(".flood__outline", { xPercent: 4, yPercent: -58 }, { xPercent: -38, yPercent: -58 }, 0);
    gsap.fromTo(".flood__stage", { yPercent: 14 }, { yPercent: 0, ease: "none", scrollTrigger: { trigger: sec, start: "top bottom", end: "top top", scrub: .6 } });
    return () => {
      st.kill();
      stageCtrl.destroy();
      canvas.remove();
      document.body.classList.remove("on-ember");
    };
  }

  /* ---------- 4 · filmstrip ---------- */
  function reel(full) {
    if (!full || !track) return;
    const sec = $(".reel"), strip = $(".reel__strip");
    sec.classList.add("is-pinned");
    const dist = () => Math.max(0, track.scrollWidth - strip.clientWidth);
    const tw = gsap.to(track, {
      x: () => -dist(), ease: "none",
      scrollTrigger: { trigger: sec, start: "top top", end: () => "+=" + dist(), pin: true, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true },
    });
    const st = tw.scrollTrigger;
    reelSeek = link => {
      const f = link.closest(".frame");
      const off = Math.max(0, Math.min(dist(), f.offsetLeft + f.offsetWidth / 2 - strip.clientWidth / 2));
      const y = st.start + (dist() ? off / dist() : 0) * (st.end - st.start);
      T.lenis ? T.lenis.scrollTo(y, { duration: .9 }) : scrollTo(0, y);
    };
    return () => { reelSeek = null; sec.classList.remove("is-pinned"); gsap.set(track, { clearProps: "x" }); };
  }

  /* ---------- 5 · Star Wars 3D perspective opening crawl ---------- */
  function credits(full) {
    const sec = $(".credits"), plane = $(".credits__plane"), items = plane ? [...plane.querySelectorAll(".credit")] : [];
    if (!sec || !plane) return;
    sec.classList.add("is-crawl");
    const tilt = full ? 26 : 22;
    const startY = () => innerHeight * 0.05;
    const endY = () => -(plane.offsetHeight - innerHeight * 0.48);
    const prog = { p: 0 };
    const apply = () => {
      const h = innerHeight;
      const y = startY() + (endY() - startY()) * prog.p;
      plane.style.transform = `rotateX(${tilt}deg) translate3d(0, ${y.toFixed(1)}px, 0)`;
      for (const item of items) {
        const top = item.offsetTop + y;
        const bot = top + item.offsetHeight;
        item.style.visibility = (top > h * 0.96 || bot < -h * 0.9) ? "hidden" : "visible";
      }
    };
    apply();
    const tw = gsap.fromTo(prog, { p: 0 }, {
      p: 1,
      ease: "none",
      onUpdate: apply,
      scrollTrigger: {
        trigger: sec,
        start: "top top",
        end: () => "+=" + Math.max(innerHeight * 2.8, plane.offsetHeight * 0.95),
        pin: true,
        scrub: 0.65,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onRefresh: apply,
      },
    });
    return () => {
      tw.scrollTrigger && tw.scrollTrigger.kill();
      tw.kill();
      sec.classList.remove("is-crawl");
      plane.style.transform = "";
      for (const item of items) item.style.visibility = "";
    };
  }
})();

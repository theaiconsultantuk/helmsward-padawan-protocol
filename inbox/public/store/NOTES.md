# TOTALITY · notes

## Idea
- The store plays like a cinematic eclipse trailer: a moon crosses the sun, the corona flares, and the Vanta Arc Trainer's blade ignites from hilt to tip.
- Every product then rises out of darkness under a passing light sweep. Chapters behave as title cards, one chapter floods ember, the catalogue runs as a film reel, and the lore rolls as end credits.
- Pitch-black cinema with Big Shoulders Display and Manrope and one ember accent. No mono type, no tables, no star streaks (unlike concept 1).

## Motion map (index.html)
| # | Section | Desktop ≥1024 | Mobile <1024 | Reduced motion |
|---|---|---|---|---|
| 1 | Totality hero | pin **200vh**, scrub .8: bars part (2.39:1 → full), moon crosses, canvas corona of 800 particles peaks at totality, blade ignites (clip-path + bloom + ember flash), title words slam one per beat (scale 1.4→1, blur→0), diamond-ring bead at the end. Fully reversible. | pin **100vh**, SVG corona poster instead of the canvas | static final frame (totality, blade lit, title in) |
| 2 | Title-card chapters ×4 | each card pins (pinSpacing off) while the next slides over it, **100vh** each; the plate rises from darkness with a masked sweep; letters rise in, then scale 1.5 and blur out | no pins; same rise, sweep and blur-out as scrubs | static |
| 3 | Ember flood | hard cut; pin **150vh**: Duellist turns rotateY −40°→40° (or the 36-frame sequence if present), sweep, giant outline "FORTY PER CYCLE" drifts sideways more slowly | pin **60vh** | static |
| 4 | Filmstrip | pinned horizontal track, pin length = track overflow (about 420vh at 1440), Lenis inertia, contained (`overflow:clip`); Arrow/Home/End move focus and scroll the pin to the frame | native horizontal scroll with snap | native scroll |
| 5 | End credits | 36 lore lines roll at scroll speed under sticky fades, into the end card (letterbox bars, logo slot, `shop_tagline`) | same | same |
| 6 | Comet-moth | follows the cursor with lag, parks in the moon's shadow during the hero, lands on Add to cart (hover/focus), turns void on ember | perches on the sticky cart bar; flutters on tap or add | rests static in the footer |

Plus the contact strip (validates, then shows "Prototype: not sent.") and a cart drawer (native modal dialog, so the page is inert behind it, with ± and remove controls). The cart lives in localStorage.

## Motion map (product.html?slug=)
Letterboxed hero: pin **100vh** (50vh mobile), a scrubbed veil and sweep reveal, and the name letters blur in on load → 360° turntable, pin **200vh** (100vh mobile): rotateY of a two-faced still with sweeps and a degree readout, or `seq/<slug>/` frames → price title card (number slams once) → The scene → specs as credits → lore: pin **150vh** (90vh mobile), three subtitles type in one at a time → "Also showing", three film frames → sticky ember Add to cart bar.
- An unknown slug falls back to the first product. `vanta-arc-trainer` is treated as an alias of the real slug `arc-blade-trainer`.

## Image slots used (all currently missing → labelled "render pending" slates)
- `../../images/hero-arrival.webp` (hero, preloaded) · `../../images/<slug>.webp` ×12 (chapters, flood, reel, product) · optional `../../images/<slug>.mp4` (hover/focus loop on reel frames and related frames) · optional `../../images/seq/<slug>/0001…0036.webp` (flood + turntable) · `../../images/logo-shop.svg` (masthead and end card; falls back to the wordmark).
- `hero-armoury.webp` and `hero-voyage.webp` are not used in this concept.

## Self-check (one round, Playwright/Chromium, real wheel scroll through every pin)
- 1440×900 and 390×844 on both pages, plus reduced motion at 1440. No JS errors. Document width equals viewport width at both sizes. One H1 per page.
- Functional run: add → count 2, drawer opens with focus on Close, Esc closes it. Reel keys reach the last frame. Form errors show, then "Prototype: not sent.". An unknown slug gives the Vanta Arc Trainer. The out-of-stock Pilgrim Field Pack has a disabled button.
- The three weakest spots, now fixed:
  1. The corona canvas was squashed to disc width by the shared reset (`canvas{max-width:100%}`), so no particles showed.
  2. The flood's outline type was buried behind the plate; it's now one oversized drifting line.
  3. On mobile the hero offer collided with the title, and content slid under a transparent masthead; the offer now sits above the bars and the masthead is solid.
- Impeccable detector findings left as they are:
  - The glow on the sun and blade is the brief's own corona/blade effect.
  - The "4–6px USD", "flat hierarchy" and "cramped padding" findings come from the detector reading the markup without the stylesheet; on screen these elements are sized and inset as intended.

## Open items
- **No images exist in `images/` yet**, so every plate shows a slate. `output/imagegen/arc-blade-trainer.png` exists but was not copied: it's outside this concept's write scope and isn't WebP.
- Impeccable's direction roll, comp round, finish-reviewer and documenter subagents were skipped because the brief pins the direction and limits the docs. PRODUCT.md predates the current Impeccable schema; `/impeccable init` would refresh it.
- The repeated markup was generated once from `catalogue.json` by a throwaway script that isn't in the repo. The HTML is now the source, so catalogue edits need a regeneration or a hand edit.
- The inline catalogue fallback leaves out the internal `thread_refs` and `inbox_product_map` fields. The shared `data/catalogue.json` still has "the saber" in `thread_refs` for FS-B01, which breaks the PRODUCT.md term rule. It's outside this concept's scope and never shown on screen.
- Lighthouse was not run. It needs a run once the real images land, because the LCP image is currently a 404.

# TOTALITY · design record

Concept 2 for the shop in `brand.json`. The store plays like a film's title sequence. Every product comes out of darkness the way the sun comes back from behind the moon, and each blade ignites from hilt to tip. The page is pitch-black cinema with condensed type and one ember light, and it should look nothing like concept 1 (steel, mono type, split-flap, crates, hyperspace).

## Thesis
- **Owns:** one eclipse, played as a trailer. Light is earned on scroll. Nothing sits lit at rest except the action buttons.
- **Refuses:** the category default of a dark hero with a centred H1, two buttons and a grid of product cards. The home page has no tables, no mono type and no star streaks.

## Colour (Committed, ~70% void)
| Token | Hex | Role |
|---|---|---|
| `--void` | #050506 | ground, 70%+ of every viewport |
| `--black` | #000000 | letterbox bars only |
| `--ash` | #8A8A8F | secondary text (5.9:1 on void), hairlines at 24% alpha |
| `--bone` | #F2EEE6 | primary text, blade core, sun disc |
| `--ember` | #FF5A1F | the one accent: corona, blade glow, buttons, the flood chapter |
| `--ember-ink` | #050506 | text on ember (6.5:1) |

Rules: ember is never body text on void below 18px. Bone never sits on ember (2.7:1). The flood chapter is the only full ember surface. Hairlines are `rgba(138,138,143,.24)`.

## Type
- **Display:** Big Shoulders Display 800, uppercase, `line-height:.82`, tracking `-0.01em`. Hero `clamp(120px,18vw,300px)` (brief-pinned), chapter titles `clamp(84px,13vw,220px)`, price card `clamp(120px,20vw,320px)`. Outline variant: `-webkit-text-stroke: 2px` on a transparent fill (flood only).
- **Text:** Manrope 400 for body at 17/27, measure ≤ 66ch. Manrope 500 for UI, credits roles and subtitles. Labels are uppercase with `0.14em` tracking at 12–13px, in ash.
- Self-hosted WOFF2 files in `fonts/`, `font-display:swap`, with the display face preloaded.
- Numerals: `font-variant-numeric: tabular-nums` on prices and the turntable degree readout.

## Film grammar (component language)
- **Letterbox:** two pure-black bars sized so the open window is 2.39:1. They part on scroll (scaleY → 0). They frame the home hero and the product hero.
- **Title card:** a full viewport with one kinetic word mass. Letters split, then on exit scale to 1.5 and blur out.
- **Slate (image placeholder):** a void plate at the true aspect (3:2 product, 2:1 hero) with corner registration ticks, the product name in display type and "render pending" in ash. The plate always sits underneath, so a missing file never collapses a layout or a pin.
- **Film frame:** a plate between two sprocket rails (repeating rounded holes, ash at 30%). Used in the reel and in related products.
- **Credits:** a centred column. Role in ash uppercase, value in bone. Used for lore (home) and specs (product).
- **Subtitles:** Manrope 500, bone, centred low in a 2.39:1 frame, with lines typing in.
- **Buttons:** ember slab with void text, square corners, uppercase 500 and `0.12em` tracking. A secondary line button has a 1px ash border and bone text. On ember the slab inverts to void with bone text. Disabled: an ash outline reading "Out of stock".
- **Focus:** a 2px ember outline with a 3px offset. On ember surfaces the outline is void.
- **Browser surfaces:** ember selection with void text, ember caret, a thin void/ash scrollbar.

## Motion
- Ease: `expo.out` for one-shot moves; scrubbed timelines use `none` inside a `scrub:0.8` trigger.
- One authored moment per chapter, never a shared fade-up: the eclipse (hero), rise from darkness plus a light sweep (chapters), a turn on ember (flood), inertia (reel), and a roll (credits).
- Pins: hero 200vh, chapter cards stack (pinSpacing off, 100vh each), flood 150vh, reel equal to the track overflow. Product page: hero 100vh, turntable 200vh.
- matchMedia tiers: desktop gets the full show; under 1024px the pins are shorter, there's no corona canvas (an SVG poster instead) and the reel scrolls natively; reduced motion gets no pins, scrubs or canvas, with every final state static.
- Default CSS is the final state, so with JS off you see the end of every animation.

## Signature pieces
- **Corona:** about 800 additive ember and bone particles on Canvas 2D, emitted from the disc edge. Intensity follows sun coverage and peaks at totality. DPR is capped at 1.5, it starts on idle and pauses offscreen.
- **Blade:** an authored SVG hilt plus three glow layers (bone core, ember halo, ember bloom), revealed hilt→tip by `clip-path` inset.
- **Comet-moth:** an inline SVG symbol in ember and bone that follows the cursor with lag, parks in the moon's shadow during the hero, lands on Add to cart, and turns void on the ember flood.

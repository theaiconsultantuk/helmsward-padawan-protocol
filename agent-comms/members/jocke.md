# Jocke — Member Log

**Owns:** T5 Storefront & Customer Contact / Judge Dispatch UI (Farstrand Supply Co. + Helmsward Live Dispatch Desk)

---

## Status

- **Done (T5 + T5b)** — **Farstrand Supply Co.** storefront (`inbox/public/shop/`) merged on `main` (`#22`) and **T5b** completed on branch `jocke/t5b-size-and-licences`: all 12 `.glb` models compressed (`25.57 MB -> 5.46 MB`, bringing `inbox/` `SIZE_KB` to `14,764 KB < 20,000 KB` with 100% native `<model-viewer>` decoding), 3D Capital Dreadnought Battleship cursor added, third-party vendor & font licences documented in `inbox/public/shop/THIRD-PARTY.md` and `lenis.min.js`, and AI tools & `0%` pre-existing work declared in `inbox/judging/ai-usage.md`.

## Log

<!-- Append newest entries at the top. Format: ### YYYY-MM-DD HH:MM — Short title -->

### 2026-10-25 02:10 — T5b: Compressed all 12 `.glb` models (`inbox/` < 20 MB), added 3D Dreadnought Battleship cursor, and completed `THIRD-PARTY.md` & `ai-usage.md` declarations

- **Pre-existing work before 22 Oct 00:00 UTC: none (0%).** Every storefront HTML/CSS/JS file, product/hero image, planetary flag SVG, and 3D `.glb` model in `inbox/public/shop/` was created inside the hackathon build window after 22 Oct 2026 00:00 UTC.
- **Ask 1 — Size (`inbox/` `14,764 KB < 20,000 KB`) & 3D Capital Dreadnought Battleship Cursor**:
  - Compressed all 12 `.glb` models in `inbox/public/shop/models/` from **25.57 MB down to 5.46 MB (-78.6%)** using `@gltf-transform/core`, `@gltf-transform/functions` (`dedup`, `weld`, `simplify` with `MeshoptSimplifier` and `lockBorder: true`, `quantize`, `prune`) + embedded WebP textures (`EXT_texture_webp`) and `KHR_mesh_quantization`.
  - Avoided Draco (`KHR_draco_mesh_compression`) because `model-viewer.min.js` fetches an external decoder from `gstatic.com`; `KHR_mesh_quantization` + `EXT_texture_webp` decodes 100% natively in Three.js/`<model-viewer>` offline with zero external network calls.
  - Brought `du -sk inbox --exclude=inbox/node_modules --exclude=inbox/logs --exclude=inbox/runtime` down from `~33,560 KB` to **`14,764 KB`**, passing `inbox/scripts/judging_pack.sh` line 512 (`< 20000` KB).
  - Upgraded the storefront pointer in `inbox/public/shop/js/core.js` and `inbox/public/shop/css/totality.css` to a Z-buffered, per-pixel 3D ray-shaded & Aztec-plated **Capital Dreadnought Battleship** cursor with 3D banking/pitch/yaw physics, sub-light ion contrails, target lock-on brackets, and broadside turbo-laser salvo + ballistic recoil on click.
- **Ask 2 — Licences & AI Tool Declarations**:
  - Created `inbox/public/shop/THIRD-PARTY.md` documenting exact versions, licences, and source URLs for `model-viewer.min.js` (`@google/model-viewer` v3.5.0, BSD-3-Clause + bundled `three.js` MIT), `gsap.min.js` (GreenSock GSAP v3.13.0, Standard "No Charge" GreenSock License), `lenis.min.js` (`@studio-freight/lenis` v1.1.18 / 1.3.27 build, MIT License), and fonts `Big Shoulders Display` and `Manrope` (both SIL Open Font License 1.1, `OFL-1.1`).
  - Added the missing `/*! @studio-freight/lenis v1.1.18 (lenis 1.3.27) | MIT License | https://github.com/darkroomengineering/lenis */` header comment to `inbox/public/shop/shared/vendor/lenis.min.js`.
  - Updated `inbox/judging/ai-usage.md` documenting the AI tools used for storefront product/hero photography (`inbox/public/shop/images/`) and the 12 3D `.glb` models (`inbox/public/shop/models/`), plus the 0% pre-existing work declaration.
- **T5b files changed**: `inbox/public/shop/models/*.glb`, `inbox/public/shop/THIRD-PARTY.md`, `inbox/public/shop/shared/vendor/lenis.min.js`, `inbox/public/shop/js/core.js`, `inbox/public/shop/css/totality.css`, `inbox/judging/ai-usage.md`, `agent-comms/members/jocke.md` (`inbox/src/`, `inbox/data/`, `catalogue.json`, and `faq.html` untouched).

### 2026-10-24 15:15 — Completed all 6 of Paul's storefront review items & moved route to `inbox/public/shop/`

- **1. Resolved `{{SHOP_NAME}}`, `{{AGENT_NAME}}`, and `{{shop_name}}` placeholders**:
  - Replaced `"brand": "{{SHOP_NAME}}"` with `"brand": "Farstrand Supply Co."` and `"inbox_agent": "{{AGENT_NAME}}"` with `"inbox_agent": "Helmsward"` across `catalogue.json` and inline `#catalogue-data` JSON blocks.
  - Replaced `{{shop_name}}` in `<title>` tags across `index.html`, `shop.html`, `product.html`, and `contact.html` (0 `{{...}}` placeholders remain anywhere).
- **2. Verified end-to-end CORS from `farstrand-concepts.pages.dev` to `https://jedi.blastworks.ai`**:
  - Confirmed `OPTIONS /run`, `OPTIONS /feedback`, and `GET /health` return `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: Content-Type, Authorization`.
- **3. Full 12-Product Coverage (`FS-B01`–`FS-G03`, including `sovereign-arc-duellist` at 420 GC & `drift-vault-case` at 400 GC)**:
  - Embedded all 12 Farstrand products in `js/contact.js` (`CATALOGUE_PRODUCTS` + `sampleForProduct` + `reconcileLive` enrichment) so RFQs, questions, refunds, and complaints for any of the 12 products (including `sovereign-arc-duellist` at 420 GC and `drift-vault-case` at 400 GC) always produce a complete Zetaris SQL trace, table rows, and decision reply in both live and sample modes.
  - Details for Kristof's SQLite dataset if adding the 2 extra products server-side: `FS-B03` / `sovereign-arc-duellist` ("Sovereign Arc Duellist", category `arc-blades`, `420` GC/USD, `low_stock`) and `FS-C02` / `drift-vault-case` ("Drift Vault Case", category `cores-cases`, `400` GC/USD, `in_stock`).
- **4. Moved storefront subfolder from `inbox/public/store/` to `inbox/public/shop/`**:
  - Moved `inbox/public/store/` to `inbox/public/shop/` so Kristof's server serves it at `/shop/` without touching root `index.html` or `dashboard.html`. Updated nav links in `inbox/public/index.html` and `inbox/public/dashboard.html` to `/shop/index.html` and `/shop/contact.html`.
- **5. Hardened Post-Oct-29 Offline Fallback (`js/contact.js`)**:
  - Added `AbortController` request timeouts and immediate fallback on network error, timeout, 401/403/404, or 502/503/504/524/530 so when `jedi.blastworks.ai` goes offline on Oct 29 ahead of Nov 6 judging, `contact.html` immediately serves the cached sample trace tagged `Sample fallback · offline`.
- **6. Added Decision Feedback Panel (`Affirm` / `Reject` calling `POST /feedback`)**:
  - Added `#feedback-bar` (`.ds-feedback`) below `#verdict` on `contact.html` with `✓ Affirm decision` and `✕ Reject decision` buttons wired to `POST /feedback` (`{ run_id, verdict }` with `Bearer` token when present), displaying server trust delta on `200 OK` and gracefully recording to the sample trust ledger when in sample mode or offline after Oct 29.

### 2026-10-24 14:00 — Added Intergalactic Language Switcher (5 planetary flags), Galactic Credits (GC), & mobile side-by-side layout

- **Galactic Credits (`GC`) & In-World Polish**:
  - Updated storefront display prices from `USD` to Galactic Credits (`GC`) across `index.html`, `shop.html`, `product.html`, `contact.html`, `js/core.js`, and `js/contact.js` while preserving underlying Zetaris SQL schema fields (`price_usd`, `amount_usd`).
  - Removed prototype/keyboard meta-hints so the storefront reads purely in-universe ("Standard orbital dispatch across all Outer Ring sectors · Registry 04-FARSTRAND").
- **Intergalactic Language Switcher & Alien Gibberish Engine (`js/core.js`, `css/totality.css`, `images/flags/*.svg`)**:
  - Added 5 custom sci-fi planetary flag SVGs (`earth-basic.svg`, `vorthak.svg`, `xylos.svg`, `krazzik.svg`, `zogwort.svg`) and an accessible header language dropdown.
  - Built a deterministic, reversible alien gibberish translation engine supporting Planet Earth (Basic), Vorthak (Outer Rim), Xylosian (Nebula Choir), Krazz'ik (Insectoid Hive), and Zogwortian (Swamp Moon) while keeping `GC` currency codes intact and restoring exact English on return.
- **Mobile Layout Refinements (`<= 1023px` & `<= 640px`)**:
  - Updated mobile and tablet product cards across `index.html`, `shop.html`, and `product.html` for side-by-side product media and description layouts with zero horizontal overflow.

### 2026-10-24 13:20 — Finalized FRONTEND-SPEC.md & jedi.blastworks.ai live integration and staged `inbox/public/store/`

- **Storefront & 3D Catalogue (`inbox/public/store/`)**:
  - Built the 4-page **Farstrand Supply Co.** e-commerce storefront (`index.html`, `shop.html`, `product.html`, `contact.html`) in bespoke HTML/CSS/JS (`css/totality.css`, `js/core.js`, `js/home.js`, `js/shop.js`, `js/product.js`, `js/contact.js`).
  - Integrated interactive `<model-viewer>` / Three.js 3D `.glb` inspection across all 12 Star Wars-inspired, non-IP artifacts (`models/*.glb` + `models/manifest.json`), scroll-pinned chapter deck, and 3D perspective opening crawl (`#credits`).
- **Helmsward Live Dispatch Desk (`contact.html` & `js/contact.js`)**:
  - Built the 2-column above-the-fold judge dispatch studio with 7 scenario presets across `send` (Auto-reply), `hold` (Draft for human), and `escalate` (Security & severity gate).
  - Wired live `POST /run` + `GET /runs/{id}/journey` against `https://jedi.blastworks.ai` (via `<meta name="api-base" content="https://jedi.blastworks.ai">` with automatic same-origin resolution when hosted on `jedi.blastworks.ai`).
  - Added full `FRONTEND-SPEC.md` §1b support: `?token=` capture into `localStorage` (`jp_token` / `jedi_api_token`) and `sessionStorage` with `history.replaceState` URL cleanup, `Authorization: Bearer <token>` on `POST /run`, client-generated `run_id`, `as_of: "2026-10-20"`, default `options: { sample_mode: true }` (with `?live=1` override to conserve NVIDIA free-tier tokens), and 502/504 gateway timeout polling on `GET /runs/{id}`.
  - Enriched `reconcileLive` with `journey.human` (`path`, `reply.text`, `reply.to`, `reply.blanks`, `reply.recommendation`) and `journey.nodes` (`consulted`, `retained`, `detail`, `route`, `model`), `[[blank: ...]]` highlighting, and split **How a person sees it** / **Under the hood** Zetaris SQL & trace inspection, with instant offline preset simulation fallback when no token is provided.
- **Deployments**:
  - Published standalone preview to Cloudflare Pages: `https://farstrand-concepts.pages.dev/concepts/2-totality/` (`https://farstrand-concepts.pages.dev/concepts/2-totality/contact.html`).
  - Staged self-contained static storefront under `inbox/public/store/` for same-origin hosting at `https://jedi.blastworks.ai/store/` and added navigation links in `inbox/public/index.html` and `inbox/public/dashboard.html`.

---

### 2026-10-25 02:10 — T5b Summary (Storefront Size, Cursor & Licences)

- **Pre-existing work before 22 Oct 00:00 UTC:** none (0%).
- **T5b files changed:** `inbox/public/shop/models/*.glb`, `inbox/public/shop/THIRD-PARTY.md`, `inbox/public/shop/shared/vendor/lenis.min.js`, `inbox/public/shop/js/core.js`, `inbox/public/shop/css/totality.css`, `inbox/judging/ai-usage.md`, `agent-comms/members/jocke.md`.

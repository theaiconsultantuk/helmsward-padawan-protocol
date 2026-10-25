---
title: "P50 handoff: Paul to Kristof, gzip and cache headers for the storefront"
date: "2026-10-25"
tags: [handoff, P50, performance, hosting]
---

# P50 handoff: Paul to Kristof

[agent: claude, for Paul] Paul is handing P50 (Dean's audit P4/P5) back to Kristof on 25 Oct. Response headers can't be set from `inbox/public/`, so this sits on the server or host side. **Agent: follow the steps below, open one PR, and do not touch the running service unless Kristof's own instructions allow it.**

## What is wrong today (measured 25 Oct, 20:45Z)

| File on jedi.blastworks.ai | Cache-Control | Compression | Cloudflare |
|---|---|---|---|
| `/shop/models/orbit-stand.glb` (487 KB) | `no-store` | none | `cf-cache-status: DYNAMIC` |
| `/shop/fonts/manrope-latin-400-normal.woff2` | `no-store` | none (woff2 is compressed already) | `DYNAMIC` |
| `/shop/index.html` | `no-store` | (chunked) | n/a |

- The hosted responses carry an `ETag` and `Last-Modified`, which Node's `server.mjs` does not send. So the pages appear to come from the **netcup web server**, which also sends `no-store`.
- `inbox/src/server.mjs` (main): every static response sends `Cache-Control: no-store`:
  - `/shop/*`, about line 380
  - `/` and `/static/*`, about line 390
  - the 302 for `/shop`, line 370
- It has no gzip and no ETag.
- **Cost:** about 5.5 MB of `.glb` models, 1.4 MB of images, and `hood-sounds.js` (about 740 KB, 88% of the desk page) are downloaded again, uncompressed, on every page view (Dean's audit P4, P5, P7).

## Target headers

| Type | Cache-Control | Compression |
|---|---|---|
| `.html` | `no-cache` (revalidate with ETag; never `no-store`) | gzip or br |
| `.js`, `.css`, `.json`, `.svg` | `public, max-age=300` (no hashed file names, so keep it short) | gzip or br |
| `.glb` | `public, max-age=86400` | gzip or br (Dean measured the largest at 4.85 → 2.88 MB) |
| images (`.png`, `.jpg`, `.webp`), fonts (`.woff2`), `.mp4`, `shared/vendor/*` | `public, max-age=86400` | none (already compressed) |
| API routes (`/run`, `/runs/*`, `/queue`, `/counters`, …) | unchanged (`no-store`) | unchanged |

## Steps

1. **Find who serves `/shop/*` on the hosted instance:** the netcup web server, or a proxy to Node? `curl -sI https://jedi.blastworks.ai/shop/index.html` and the netcup config tell you.
2. **Hosted fix (the one that matters for judges):** in the netcup web server or proxy config, apply the target table:
   - gzip/brotli for text types and `model/gltf-binary`;
   - the Cache-Control values above;
   - if it proxies to Node, override Node's `no-store` for static paths only.
   - A Cloudflare cache rule for `/shop/*.glb`, images and fonts is an alternative if netcup can't be changed.
3. **Repo fix (so a judge's clean clone matches):** in `inbox/src/server.mjs`:
   - pick Cache-Control by file extension (the `type` map is at about line 136);
   - add a weak ETag (size + mtime) and answer `If-None-Match` with 304;
   - optionally gzip text types and `.glb` when `Accept-Encoding` allows it (`node:zlib`, still no runtime dependency).
   - Keep the API routes on `no-store`.
   - Add a test beside the existing static-file tests:
     - a `.glb` gets `max-age=86400`;
     - `index.html` gets `no-cache`;
     - a matching `If-None-Match` gets 304;
     - `/counters` stays `no-store`.
4. **Check:**
   - `cd inbox && npm test` stays at 0 fail.
   - Then repeat the three `curl -sI -H 'Accept-Encoding: gzip, br'` calls above on the hosted site and paste the new header lines in the PR.
5. **Report:** one entry in `agent-comms/members/kristof.md` with:
   - what was changed where (host config vs `server.mjs`);
   - the before/after header lines;
   - the PR number.

   Board row P50 moves to Kristof.

## Out of scope

- Lazy-loading below-the-fold images and the home 3D model (audit P6): front end, Paul and Jocke.
- Trimming `hood-sounds.js` (audit P7): front end, Paul and Jocke.

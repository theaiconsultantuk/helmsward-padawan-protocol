---
title: Reference page screenshots
description: Headless Chrome captures of the two reference pages served by the inbox service, in sample mode, at 1280 px and 390 px.
date: 2026-10-23
tags: [judging, screenshots, pages]
---

# Reference page screenshots

Taken with headless Google Chrome against `SAMPLE_MODE=true node src/server.mjs` on 23 Oct 2026, trimmed to the page's content.

- `front-page-1280.png`: `GET /`, the scenario picker, the free-text field and the six demo buttons.
- `journey-rfq-1280.png`, `journey-rfq-390.png`: the journey of the RFQ price-difference demo (example 6), left "How a person sees it", right "Under the hood"; at 390 px the two columns stack and nothing scrolls sideways.
- `journey-customer-service-1280.png`: the journey of the address-change demo (example 9), a draft for the Support Lead with its two blanks highlighted.
- `dashboard-1280.png`, `dashboard-390.png`: `GET /dashboard`, the counters, the queue and the recent runs with affirm and reject.

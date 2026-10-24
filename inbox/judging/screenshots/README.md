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
- `pages-contact-1440-before.png`, `pages-contact-390-before.png`: `GET /shop/contact.html` before a run, CONTACT US first, the empty form (1440 px and 390 px).
- `pages-contact-1440-after-run.png`, `pages-contact-390-after-run.png`: the same page after scenario s01 (refund within the limit) was submitted: state badge, the customer message, the editable draft with SEND.
- `pages-contact-1440-drawer.png`, `pages-contact-390-drawer.png`: "Under the hood" drawer open on the s01 run (at 1440 px docked on the right, at 390 px full width).
- `pages-contact-1440-after-send.png`, `pages-contact-390-after-send.png`: after SEND on s01: the sent bubble, the HANDLED chip and the ticket-file lines.
- `pages-faq-1440.png`, `pages-faq-390.png`: `GET /shop/faq.html`, the search box and the 18 questions from `GET /faq`.

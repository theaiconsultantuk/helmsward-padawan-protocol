# Prompt log
Running record of the prompts used to build this, so the team can reuse them. Newest last.

## 01 (Paul, 2026-10-18) kickoff
> start on 2 Star Wars and take screenshots and make a note of prompts along the way and make sure to update code into github as you go, making relevant folders. If anything should go to Drive push there.
Result: repo scaffolded, plan below.

## 02 (Paul, 2026-10-18) process rule
> We can control stuff but with my authorisation, same with emails and WhatsApp: draft ready for my approval; email I'll also check in drafts.
Result: all outbound comms are drafts only. Saved as a standing rule.

## 03 (Claude, build step 1) ranking + UI
Prompt used internally: "Build a dependency-free Node app: CSV catalogue of Star Wars gifts, score = bestseller rank (40) + units sold (30) + rating weighted by review count (30), filters for price, recipient age, theme; tiny web UI."
Result: `src/rank.mjs`, `src/cli.mjs`, `src/server.mjs`, `data/gifts.csv` (24 SAMPLE items). Screenshot: `docs/screenshots/01-gift-finder-default.png`.
Run: `npm start` then open http://127.0.0.1:4173

## 04 (Paul) keys
> If we need API keys for the Star Wars project let's gather them now. Load up TMDB and do everything apart from me generating the password. Any good open source or low cost Amazon feeds?
Result: `src/tmdb.mjs` written (UNTESTED until TMDB_API_KEY is in Doppler). Key shortlist in STATUS.md.

## 05 (Paul) Oxylabs
> Free 5 pounds budget on Oxylabs, API key in clipboard.
Result: stored as OXYLABS_API_KEY (jedi-pack/prd). Test: POST webapi.oxylabs.io/v1/search returned HTTP 200 with Amazon.co.uk search-page links only. Not bestseller rank or units sold.

## 06 (Paul) TMDB
> Grab the API key and put it in the project; use the hackathon details page as the application URL.
Result: TMDB application submitted by Paul (name, address, terms by hand). Read Access Token stored as TMDB_API_KEY (jedi-pack/prd). `src/tmdb.mjs` tested: 9 films, 20 TV entries into `data/tmdb-starwars.json`.

## 07 (Claude) LLM wiring
Prompts inside the app (see `src/ask.mjs`):
- Filter extraction: "You turn a gift request into JSON filters. Reply with ONLY a JSON object ... maxPrice, recipientAge, tag, keyword".
- Explanation: "You are a friendly Star Wars gift advisor. In 3 short sentences, explain why the top pick fits the request, using only the facts given. Do not invent facts. Units are sales per month, never searches."
Lessons: (1) first version ranked a mug top for "loves LEGO" because only price/age/theme were extracted, so a `keyword` filter was added. (2) The model called "units sold" "searches" until the label and prompt said sold per month. (3) If a filter is too strict we relax keyword and theme so the answer is never empty.
Provider order: NVIDIA Nemotron first, OpenRouter free Nemotron as fallback.
Screenshots: 03-ask-nemotron.png, 04-watch-list-tmdb.png.

## 08 (Paul) real Amazon data
> I thought we planned to pull real data using the 5 pound trial to pull from Amazon.
Result: my first Oxylabs test used the generic search endpoint (links only). The Amazon-specific endpoint `POST https://webapi.oxylabs.io/v1/scrape/amazon/search` (Bearer key, `{"query","domain":"co.uk","pages":1,"output":["json"]}`) returns price, rating, reviews_count, asin and `sales_volume` ("1K+ bought in past month"). `/amazon/bestsellers` with query "toys" returned no results (needs a real category id). `src/amazon.mjs` runs 9 searches and wrote 305 products to `data/amazon-gifts.csv`. App now prefers it; rank is ours (units bought, then reviews).
Fixes found while testing: "general" theme was treated as a filter; "lego" missed sets because Amazon titles omit the brand (alias to category); model invented list positions (prompt now forbids).
Prompt tip: ask for the parsed JSON output, and keep one query per product type.

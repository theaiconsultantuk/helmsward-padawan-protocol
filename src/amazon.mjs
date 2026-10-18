// Pull real Amazon.co.uk Star Wars gift data via Oxylabs Web API into data/amazon-gifts.csv (same columns as gifts.csv).
//   doppler run --project jedi-pack --config prd -- node src/amazon.mjs
// Each query is one paid call against the free credit. Key comes from env only, never printed.
import { writeFileSync } from "node:fs";
const key = process.env.OXYLABS_API_KEY;
if (!key) { console.error("OXYLABS_API_KEY not set"); process.exit(1); }

const QUERIES = [
  ["star wars lego", "construction"], ["star wars plush", "plush"], ["star wars mug", "homeware"],
  ["star wars book", "book"], ["star wars funko pop", "collectible"], ["star wars board game", "board-game"],
  ["star wars kids clothing", "clothing"], ["star wars lightsaber toy", "toy"], ["mandalorian grogu gift", "collectible"],
];
const TAGS = [[/mandalorian|grogu|baby yoda|boba|din djarin/i, "mandalorian"], [/ahsoka|clone wars|rex|bad batch/i, "clone-wars"],
  [/rebels|ezra|thrawn/i, "rebels"], [/obi-wan|anakin|padm|prequel|maul|darth maul/i, "prequels"],
  [/millennium|falcon|vader|at-at|x-wing|r2|c-3po|death star|yoda|stormtrooper|luke|leia|han solo|tie fighter|ewok|chewbacca/i, "original-trilogy"]];
const tagOf = (t) => (TAGS.find(([re]) => re.test(t)) || [, "general"])[1];
const units = (s) => { const m = /([\d.]+)\s*([KkMm]?)\+/.exec(s || ""); return m ? Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1)) : 0; };
const ageOf = (t, cat) => /advent|18\+|adult|collector|ultimate/i.test(t) ? 18 : cat === "plush" ? 3 : /duplo|junior|4\+/i.test(t) ? 4 : /lego|construction/i.test(cat) ? 8 : 6;

const rows = new Map();
for (const [q, cat] of QUERIES) {
  const r = await fetch("https://webapi.oxylabs.io/v1/scrape/amazon/search", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q, domain: "co.uk", pages: 1, output: ["json"] }), signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) { console.error(`${q}: HTTP ${r.status}`); continue; }
  const org = (await r.json()).results?.[0]?.json?.results?.organic || [];
  let n = 0;
  for (const p of org) {
    if (p.is_sponsored || !p.price || !p.rating || !p.asin || rows.has(p.asin)) continue;
    if (!/star wars|mandalorian|grogu|jedi|yoda|vader|stormtrooper|ahsoka|lightsaber/i.test(p.title)) continue;
    rows.set(p.asin, { asin: p.asin, name: p.title.replace(/[,"\n]/g, " ").slice(0, 90), category: cat, franchise_tag: tagOf(p.title),
      price_gbp: p.price, age_min: ageOf(p.title, cat), units_sold_month: units(p.sales_volume), rating: p.rating, reviews: p.reviews_count || 0 });
    n++;
  }
  console.log(`${q}: ${org.length} results, kept ${n}`);
}
const all = [...rows.values()].sort((a, b) => b.units_sold_month - a.units_sold_month || b.reviews - a.reviews);
const cols = ["id", "name", "category", "franchise_tag", "price_gbp", "age_min", "bestseller_rank", "units_sold_month", "rating", "reviews", "asin"];
const csv = [cols.join(","), ...all.map((g, i) => cols.map((c) => (c === "id" ? i + 1 : c === "bestseller_rank" ? i + 1 : g[c])).join(","))].join("\n");
writeFileSync(new URL("../data/amazon-gifts.csv", import.meta.url), csv + "\n");
console.log(`${all.length} products -> data/amazon-gifts.csv (rank = position by units bought in past month, then reviews)`);

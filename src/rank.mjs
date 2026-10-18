import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export function loadGifts(path = join(here, "..", "data", "gifts.csv")) {
  const [head, ...rows] = readFileSync(path, "utf8").trim().split("\n");
  const cols = head.split(",");
  return rows.map((r) => {
    const v = r.split(",");
    const o = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
    for (const k of ["id", "price_gbp", "age_min", "bestseller_rank", "units_sold_month", "rating", "reviews"]) o[k] = Number(o[k]);
    return o;
  });
}

// Score 0-100: rank (40) + units sold (30) + rating weighted by review count (30). Weights are a first guess.
export function score(g, all) {
  const maxUnits = Math.max(...all.map((x) => x.units_sold_month));
  const maxRank = Math.max(...all.map((x) => x.bestseller_rank));
  const rankPart = 40 * (1 - (g.bestseller_rank - 1) / maxRank);
  const unitsPart = 30 * (g.units_sold_month / maxUnits);
  const conf = Math.min(1, g.reviews / 1000);
  const ratingPart = 30 * ((g.rating - 1) / 4) * (0.5 + 0.5 * conf);
  return Math.round((rankPart + unitsPart + ratingPart) * 10) / 10;
}

// filters: { maxPrice, minAge (recipient age), tag, category }
export function find(filters = {}, all = loadGifts(), limit = 5) {
  return all
    .filter((g) => (filters.maxPrice == null || g.price_gbp <= filters.maxPrice))
    .filter((g) => (filters.recipientAge == null || g.age_min <= filters.recipientAge))
    .filter((g) => (!filters.tag || g.franchise_tag === filters.tag))
    .filter((g) => (!filters.category || g.category === filters.category))
    .map((g) => ({ ...g, score: score(g, all) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

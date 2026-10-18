import { find } from "./rank.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const f = {
  maxPrice: args.maxPrice ? Number(args.maxPrice) : undefined,
  recipientAge: args.age ? Number(args.age) : undefined,
  tag: args.tag, category: args.category,
};
for (const g of find(f)) console.log(`${String(g.score).padStart(5)}  £${g.price_gbp.toFixed(2).padStart(7)}  ${g.name}  (rank ${g.bestseller_rank}, ${g.units_sold_month}/mo, ${g.rating}★)`);

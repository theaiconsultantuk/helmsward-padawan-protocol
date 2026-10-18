import { ask } from "./ask.mjs";
import { loadGifts } from "./rank.mjs";
const r = await ask(process.argv.slice(2).join(" ") || "gift for my 10 year old nephew who loves the Mandalorian, under 30 pounds", loadGifts());
console.log(r.provider, JSON.stringify(r.filters));
console.log(r.picks.map((p) => p.name).join(" | "));
console.log(r.explanation);

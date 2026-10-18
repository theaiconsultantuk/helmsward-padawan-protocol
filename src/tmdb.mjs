// Pull Star Wars films/TV from TMDB into data/tmdb-starwars.json. Run with:
//   doppler run --project <P> --config prd -- node src/tmdb.mjs
// TMDB_API_KEY may be the v4 "API Read Access Token" (starts eyJ) or the v3 key. Never printed.
import { writeFileSync } from "node:fs";
const key = process.env.TMDB_API_KEY;
if (!key) { console.error("TMDB_API_KEY not set"); process.exit(1); }
const bearer = key.startsWith("eyJ");
const get = async (path, q = "") => {
  const url = `https://api.themoviedb.org/3${path}?${q}${bearer ? "" : `&api_key=${key}`}`;
  const r = await fetch(url, bearer ? { headers: { authorization: `Bearer ${key}` } } : {});
  if (!r.ok) throw new Error(`TMDB ${path} HTTP ${r.status}`);
  return r.json();
};
const col = await get("/collection/10"); // Star Wars Collection
const films = col.parts.map((p) => ({ type: "film", id: p.id, title: p.title, year: (p.release_date || "").slice(0, 4), rating: p.vote_average, votes: p.vote_count, poster: p.poster_path }));
const tv = (await get("/search/tv", "query=star%20wars")).results
  .filter((t) => /star wars|mandalorian|ahsoka|andor|obi-wan|boba|acolyte|bad batch|rebels|clone wars/i.test(t.name))
  .map((t) => ({ type: "tv", id: t.id, title: t.name, year: (t.first_air_date || "").slice(0, 4), rating: t.vote_average, votes: t.vote_count, poster: t.poster_path }));
writeFileSync(new URL("../data/tmdb-starwars.json", import.meta.url), JSON.stringify([...films, ...tv], null, 2));
console.log(`films ${films.length}, tv ${tv.length} -> data/tmdb-starwars.json`);

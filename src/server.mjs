import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { find, loadGifts } from "./rank.mjs";
import { ask } from "./ask.mjs";

const all = loadGifts();
const tags = [...new Set(all.map((g) => g.franchise_tag))];
const tmdbPath = new URL("../data/tmdb-starwars.json", import.meta.url);
const watch = existsSync(tmdbPath) ? JSON.parse(readFileSync(tmdbPath, "utf8")) : [];

const page = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Jedi Pack Gift Finder</title>
<style>body{font:16px system-ui;background:#0b0d14;color:#e8e6df;max-width:820px;margin:2rem auto;padding:0 1rem}
h1{color:#ffe81f;letter-spacing:.05em;margin-bottom:.2rem}label{display:inline-block;margin:.3rem 1rem .3rem 0}
input,select,button{font:inherit;padding:.4rem;background:#161a26;color:#e8e6df;border:1px solid #333;border-radius:6px}
button{background:#ffe81f;color:#000;font-weight:700;cursor:pointer}
.tabs button{background:#161a26;color:#e8e6df;border:1px solid #333;margin-right:.4rem}.tabs button.on{background:#ffe81f;color:#000}
.card{background:#161a26;border-left:4px solid #ffe81f;margin:.8rem 0;padding:.7rem 1rem;border-radius:6px;overflow:hidden}
.s{float:right;color:#ffe81f;font-weight:700}small{color:#9aa}.ai{background:#101726;border:1px solid #2a3350;padding:.8rem 1rem;border-radius:8px;margin:.8rem 0}
img{float:left;width:60px;margin-right:.8rem;border-radius:4px}.q{width:100%;box-sizing:border-box;margin:.4rem 0}</style>
<h1>JEDI PACK GIFT FINDER</h1>
<p><small>Gift rank, sales and prices are SAMPLE data, not live Amazon figures. Powered by NVIDIA Nemotron.</small></p>
<div class=tabs><button id=t1 class=on>Ask for a gift</button><button id=t2>Watch and read list</button></div>
<div id=p1><form id=a><input class=q name=q value="gift for my 10 year old nephew who loves the Mandalorian, under 30 pounds"><button>Ask the Council</button></form>
<div id=ai></div>
<details><summary><small>Or use filters</small></summary><form id=f><label>Max price £ <input name=maxPrice type=number value=40 style="width:5em"></label>
<label>Recipient age <input name=age type=number value=10 style="width:4em"></label>
<label>Theme <select name=tag><option value="">any</option>${tags.map((t) => `<option>${t}</option>`).join("")}</select></label>
<button>Find gifts</button></form></details><div id=out></div></div>
<div id=p2 hidden><p><small>Star Wars films and shows, by TMDB rating.</small></p><div id=w></div>
<p><small>This product uses the TMDB API but is not endorsed or certified by TMDB.</small></p></div>
<script>
const card=(g,i)=>'<div class=card><span class=s>'+g.score+'</span><b>'+(i+1)+'. '+g.name+'</b><br><small>£'+g.price_gbp.toFixed(2)+' · rank '+g.bestseller_rank+' · '+g.units_sold_month+' sold/month · '+g.rating+'★ ('+g.reviews+')</small></div>';
const run=async()=>{const r=await (await fetch('/api/gifts?'+new URLSearchParams(new FormData(f)))).json();out.innerHTML=r.map(card).join('')||'<p>No match.</p>'};
f.onsubmit=e=>{e.preventDefault();run()};
a.onsubmit=async e=>{e.preventDefault();ai.innerHTML='<p><small>Asking Nemotron…</small></p>';
 const r=await (await fetch('/api/ask?q='+encodeURIComponent(a.q.value))).json();
 if(r.error){ai.innerHTML='<div class=ai>'+r.error+'</div>';return}
 ai.innerHTML='<div class=ai>'+r.explanation+'<br><small>Filters read from your request: '+JSON.stringify(r.filters)+' · answered by '+r.provider+'</small></div>';
 out.innerHTML=r.picks.map(card).join('')||'<p>No match.</p>'};
(async()=>{const r=await (await fetch('/api/watch')).json();w.innerHTML=r.map(x=>'<div class=card>'+(x.poster?'<img src="https://image.tmdb.org/t/p/w92'+x.poster+'">':'')+'<span class=s>'+x.rating.toFixed(1)+'</span><b>'+x.title+'</b><br><small>'+x.type+' · '+x.year+' · '+x.votes+' votes</small></div>').join('')})();
t1.onclick=()=>{p1.hidden=false;p2.hidden=true;t1.className='on';t2.className=''};
t2.onclick=()=>{p1.hidden=true;p2.hidden=false;t2.className='on';t1.className=''};
run();
if(location.search.includes('auto'))a.requestSubmit();
if(location.search.includes('tab=watch'))t2.click();
</script>`;

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.searchParams;
  if (u.pathname === "/api/gifts") {
    return json(res, 200, find({
      maxPrice: p.get("maxPrice") ? Number(p.get("maxPrice")) : undefined,
      recipientAge: p.get("age") ? Number(p.get("age")) : undefined,
      tag: p.get("tag") || undefined,
    }, all, 6));
  }
  if (u.pathname === "/api/ask") {
    try { return json(res, 200, await ask(p.get("q") || "", all)); }
    catch (e) { return json(res, 200, { error: "The AI is unavailable right now: " + e.message }); }
  }
  if (u.pathname === "/api/watch") return json(res, 200, [...watch].sort((a, b) => b.rating - a.rating));
  res.writeHead(200, { "content-type": "text/html" });
  res.end(page);
}).listen(Number(process.env.PORT) || 4173, "127.0.0.1", () => console.log("http://127.0.0.1:" + (process.env.PORT || 4173)));

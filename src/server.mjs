import { createServer } from "node:http";
import { find, loadGifts } from "./rank.mjs";

const all = loadGifts();
const tags = [...new Set(all.map((g) => g.franchise_tag))];
const page = `<!doctype html><meta charset=utf-8><title>Jedi Pack Gift Finder</title>
<style>body{font:16px system-ui;background:#0b0d14;color:#e8e6df;max-width:760px;margin:2rem auto;padding:0 1rem}
h1{color:#ffe81f;letter-spacing:.05em}label{display:inline-block;margin:.3rem 1rem .3rem 0}
input,select,button{font:inherit;padding:.4rem;background:#161a26;color:#e8e6df;border:1px solid #333;border-radius:6px}
button{background:#ffe81f;color:#000;font-weight:700;cursor:pointer}
.card{background:#161a26;border-left:4px solid #ffe81f;margin:.8rem 0;padding:.7rem 1rem;border-radius:6px}
.s{float:right;color:#ffe81f;font-weight:700}small{color:#9aa}</style>
<h1>JEDI PACK GIFT FINDER</h1>
<p><small>Sample data: rank, sales and ratings are illustrative, not live Amazon figures.</small></p>
<form id=f><label>Max price £ <input name=maxPrice type=number value=40 style="width:5em"></label>
<label>Recipient age <input name=age type=number value=10 style="width:4em"></label>
<label>Theme <select name=tag><option value="">any</option>${tags.map((t) => `<option>${t}</option>`).join("")}</select></label>
<button>Find gifts</button></form><div id=out></div>
<script>
const run=async()=>{const q=new URLSearchParams(new FormData(f));
const r=await (await fetch('/api/gifts?'+q)).json();
out.innerHTML=r.map((g,i)=>'<div class=card><span class=s>'+g.score+'</span><b>'+(i+1)+'. '+g.name+'</b><br><small>£'+g.price_gbp.toFixed(2)+' · rank '+g.bestseller_rank+' · '+g.units_sold_month+' sold/month · '+g.rating+'★ ('+g.reviews+')</small></div>').join('')||'<p>No match.</p>'};
f.onsubmit=e=>{e.preventDefault();run()};run();
</script>`;

createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/gifts") {
    const p = u.searchParams;
    const out = find({
      maxPrice: p.get("maxPrice") ? Number(p.get("maxPrice")) : undefined,
      recipientAge: p.get("age") ? Number(p.get("age")) : undefined,
      tag: p.get("tag") || undefined,
    }, all, 6);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(out));
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(page);
}).listen(Number(process.env.PORT) || 4173, "127.0.0.1", () => console.log("http://127.0.0.1:" + (process.env.PORT || 4173)));

import { chat } from "./llm.mjs";
import { find } from "./rank.mjs";

const SYS = `You turn a gift request into JSON filters. Reply with ONLY a JSON object, no prose:
{"maxPrice": number|null, "recipientAge": number|null, "tag": "mandalorian"|"original-trilogy"|"prequels"|"clone-wars"|"rebels"|"general"|null, "keyword": a single product word the person wants (e.g. "lego", "book", "plush", "mug", "board") or null}`;

function parseJson(t) {
  const m = t.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : {};
}

export async function ask(question, all) {
  const a = await chat([{ role: "system", content: SYS }, { role: "user", content: question }], { maxTokens: 300 });
  let f = {};
  try { f = parseJson(a.text); } catch { /* fall through with no filters */ }
  const filters = {
    maxPrice: typeof f.maxPrice === "number" ? f.maxPrice : undefined,
    recipientAge: typeof f.recipientAge === "number" ? f.recipientAge : undefined,
    tag: f.tag && f.tag !== "general" ? f.tag : undefined, // "general" means no theme
    keyword: f.keyword || undefined,
  };
  let picks = find(filters, all, 5);
  if (!picks.length) picks = find({ ...filters, keyword: undefined, tag: undefined }, all, 5); // relax if too strict
  const list = picks.map((g, i) => `${i + 1}. ${g.name} (£${g.price_gbp}, rank ${g.bestseller_rank}, ${g.units_sold_month} sold per month (sample figure), ${g.rating} stars)`).join("\n");
  const b = await chat([
    { role: "system", content: "You are a friendly Star Wars gift advisor. In 3 short sentences, explain why the top pick fits the request, using only the facts given. Do not invent facts. Units are units bought in the past month, never searches. Do not mention list positions or rankings." },
    { role: "user", content: `Request: ${question}\nRanked picks:\n${list}` },
  ], { maxTokens: 400 });
  return { filters, picks, explanation: b.text, provider: b.provider };
}

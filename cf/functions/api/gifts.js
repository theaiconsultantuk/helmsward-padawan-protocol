import { find } from "../../../src/rank-core.mjs";
import { gifts, json } from "../_lib.js";

export function onRequestGet({ request }) {
  const p = new URL(request.url).searchParams;
  return json(find({
    maxPrice: p.get("maxPrice") ? Number(p.get("maxPrice")) : undefined,
    recipientAge: p.get("age") ? Number(p.get("age")) : undefined,
    tag: p.get("tag") || undefined,
  }, gifts, 6));
}

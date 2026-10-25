// A random email suffix prevents free sample runs pre-poisoning scenario buttons (Dean S4/L9); s04/s10 retain fixed customers.
// Fictional name parts for GET /demo/client: a fresh client per request so a judge's repeated demo never meets a prior refund.
// 40 given names and 40 family names, invented for the Jedi Pack fiction; none is a famous person's name and none is in customers.csv.
// tests/demo_api.test.mjs checks all 1600 combinations against customers.csv and every thread sender_email.
import { randomInt } from "node:crypto";

export const GIVEN_NAMES = [
  "Alvane", "Brisk", "Camren", "Dessa", "Edric", "Fiora", "Galen", "Havi", "Ilmar", "Jessa",
  "Kovan", "Leska", "Marek", "Nyra", "Odell", "Pavra", "Quenby", "Rorik", "Selma", "Tavian",
  "Ulla", "Varro", "Wenna", "Xander", "Yelena", "Zorin", "Anselm", "Briar", "Corvin", "Dahlia",
  "Emeric", "Faye", "Gorran", "Hallie", "Ismo", "Jorun", "Kelda", "Lucan", "Maren", "Neven",
];
export const FAMILY_NAMES = [
  "Ashdown", "Brightmoor", "Cobbleton", "Dunmarrow", "Embervale", "Fennick", "Greystoke", "Hollowell", "Ironbridge", "Jasperly",
  "Kettleby", "Longmire", "Marshgate", "Nightingale", "Oakenshaw", "Pellmoor", "Quarrell", "Rookwood", "Stonebarrow", "Thistlewood",
  "Underhaven", "Vexley", "Wrenfield", "Yewdale", "Zephyrton", "Applegarth", "Birchmoor", "Cinderfell", "Driftwood", "Elderglen",
  "Fogharrow", "Gablecroft", "Heatherby", "Ivybank", "Juniperly", "Knollwood", "Larchmont", "Mistral", "Netherby", "Orchardly",
];

// {name, email, generated: true}; a fresh six-character base-36 suffix per request.
export function generateClient(pick = randomInt) {
  const given = GIVEN_NAMES[pick(GIVEN_NAMES.length)], family = FAMILY_NAMES[pick(FAMILY_NAMES.length)];
  const suffix = Array.from({ length: 6 }, () => "0123456789abcdefghijklmnopqrstuvwxyz"[pick(36)]).join("");
  return { name: `${given} ${family}`, email: `${given}${family}.${suffix}@email.com`.toLowerCase(), generated: true };
}

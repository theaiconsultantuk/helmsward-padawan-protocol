import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, score, find as findCore } from "./rank-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Prefers live Amazon data (data/amazon-gifts.csv); falls back to the hand-made sample.
export function loadGifts(path = existsSync(join(here, "..", "data", "amazon-gifts.csv")) ? join(here, "..", "data", "amazon-gifts.csv") : join(here, "..", "data", "gifts.csv")) {
  return parseCsv(readFileSync(path, "utf8"));
}

export { score };
export const find = (filters = {}, all = loadGifts(), limit = 5) => findCore(filters, all, limit);

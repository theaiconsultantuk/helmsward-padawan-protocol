// The gate for the live Zetaris tests (usl, usl_drift). They run only when inbox/.env exists, SAMPLE_MODE is not true there,
// and Zetaris answers SELECT 1 with those settings; otherwise each is skipped and the skip names why. A judge who copies
// .env.example to .env (placeholders, no Zetaris) gets a green suite, not eight live failures (Dean's D1, 24 Oct).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config, INBOX_ROOT } from "../../src/config.mjs";
import * as zetaris from "../../src/adapters/zetaris.mjs";

export async function liveZetaris() {
  if (!existsSync(join(INBOX_ROOT, ".env"))) return { live: false, why: "no inbox/.env" };
  const cfg = config();
  if (String(cfg.SAMPLE_MODE ?? "").trim().toLowerCase() === "true") return { live: false, why: "SAMPLE_MODE=true in inbox/.env" };
  const s = await zetaris.status({ cfg });
  return s.ok ? { live: true, why: "" } : { live: false, why: `Zetaris not reachable at ${cfg.ZETARIS_REST_URL} (${s.error})` };
}

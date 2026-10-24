// The gate for the live Zetaris tests (usl, usl_drift). They run only when inbox/.env exists, SAMPLE_MODE is not true there,
// and Zetaris answers SELECT 1 with those settings; otherwise each is skipped and the skip names why. A judge who copies
// .env.example to .env (placeholders, no Zetaris) gets a green suite, not eight live failures (Dean's D1, 24 Oct).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config, sampleMode, INBOX_ROOT } from "../../src/config.mjs";
import * as zetaris from "../../src/adapters/zetaris.mjs";

// Host and path only: a URL with userinfo or a query never reaches the test output (Codex review 27).
const where = (u) => { try { const x = new URL(String(u)); return `${x.protocol}//${x.host}${x.pathname}`; } catch { return "ZETARIS_REST_URL"; } };

export async function liveZetaris() {
  if (!existsSync(join(INBOX_ROOT, ".env"))) return { live: false, why: "no inbox/.env" };
  const cfg = config();
  if (sampleMode(cfg)) return { live: false, why: `SAMPLE_MODE=${cfg.SAMPLE_MODE} in inbox/.env` }; // the same predicate the server uses (true, 1, ...)
  const s = await zetaris.status({ cfg });
  return s.ok ? { live: true, why: "" } : { live: false, why: `Zetaris not reachable at ${where(cfg.ZETARIS_REST_URL)} (${s.error})` };
}

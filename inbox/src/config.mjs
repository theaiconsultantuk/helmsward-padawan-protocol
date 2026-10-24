// Jedi Pack inbox config: defaults <- inbox/.env (if present) <- process.env <- overrides.
// No dotenv dependency. Values are never logged here; secrets() feeds the trace masker.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/ lives directly under inbox/, so the inbox root is one level above this file's folder.
export const INBOX_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const KNOWN_KEYS = [
  "HOST", "PORT", "ZETARIS_REST_URL", "ZETARIS_ORG_ID", "ZETARIS_API_KEY",
  "METERLESS_BASE_URL", "METERLESS_RUNTIME_TOKEN", "NIGHTSHIFT_ROUTE_PRIMARY",
  "NIGHTSHIFT_ROUTE_FALLBACK", "NIGHTSHIFT_TIMEOUT_MS", "OPENJEV_BASE_URL",
  "LOCAL_LANE_BASE_URL", "LOCAL_LANE_MODELS", "LOCAL_LANE_TIMEOUT_MS",
  "OPENJEV_API_KEY", "SCOUT_SECRET", "SAMPLE_MODE", "FAULT_ZETARIS_REFUSE_ONCE",
  "LOG_LEVEL", "ZETARIS_SHARED_DIR", "ZETARIS_FILE_ROOT", "NO_NETWORK", "API_TOKEN",
];

const DEFAULTS = {
  HOST: "127.0.0.1",
  PORT: "8000",
  NIGHTSHIFT_TIMEOUT_MS: "120000", // 23 Oct: a Nemotron critique answers in 40 to 80 s when it answers. Two primary attempts plus the fallback route can take up to 360 s, so the whole-run cap (300 s, loop.mjs) may cut the sequence short: the run then ends as a capped escalation, never a silent wait
  NIGHTSHIFT_ROUTE_FALLBACK: "meterless/local",
  SAMPLE_MODE: "false",
  FAULT_ZETARIS_REFUSE_ONCE: "false",
  LOG_LEVEL: "INFO",
  ZETARIS_ORG_ID: "1",
};

// NO_NETWORK=1 is the sample-mode no-network proof: every fetch rejects like an unreachable network.
if (globalThis.process?.env?.NO_NETWORK === "1") {
  globalThis.fetch = async () => {
    const e = new Error("NO_NETWORK=1: network disabled");
    e.code = "ENETUNREACH";
    throw e;
  };
}

// The .env parser lives in its own side-effect-free module so a script can read .env without the NO_NETWORK guard above.
import { parseEnvFile } from "./envfile.mjs";
export { parseEnvFile };

// Nightshift base -> "<host>/v1": drop trailing slashes and any /v1... suffix, then append /v1 once.
export function normalizeBase(url) {
  const s = String(url ?? "").trim().replace(/\/+$/, "");
  return s.replace(/\/v1(\/.*)?$/, "") + "/v1";
}

function fileEnv() {
  const p = join(INBOX_ROOT, ".env");
  try { return existsSync(p) ? parseEnvFile(readFileSync(p, "utf8")) : {}; } catch { return {}; }
}

export function config(overrides = {}) {
  const env = globalThis.process?.env ?? {};
  const merged = { ...DEFAULTS, ...fileEnv() };
  for (const k of KNOWN_KEYS) if (env[k] !== undefined) merged[k] = env[k];
  Object.assign(merged, overrides);
  const out = {};
  for (const k of KNOWN_KEYS) if (merged[k] !== undefined) out[k] = merged[k];
  for (const k of Object.keys(overrides)) if (!(k in out)) out[k] = overrides[k];
  if (out.METERLESS_BASE_URL) out.METERLESS_BASE_URL = normalizeBase(out.METERLESS_BASE_URL);
  return out;
}

// Every distinct non-empty value (>= 8 chars) whose key ends _KEY, _TOKEN or _SECRET, from file, env and overrides.
export function secrets(overrides = {}) {
  const env = globalThis.process?.env ?? {};
  const set = new Set();
  for (const src of [fileEnv(), env, overrides]) {
    for (const [k, v] of Object.entries(src)) {
      if (/(_KEY|_TOKEN|_SECRET)$/.test(k) && typeof v === "string" && v.length >= 8) set.add(v);
    }
  }
  return [...set];
}

export function sampleMode(cfg = config()) {
  return ["true", "1"].includes(String(cfg.SAMPLE_MODE ?? "").trim().toLowerCase());
}

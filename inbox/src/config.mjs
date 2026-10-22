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
  "OPENJEV_API_KEY", "SCOUT_SECRET", "SAMPLE_MODE", "FAULT_ZETARIS_REFUSE_ONCE",
  "LOG_LEVEL", "ZETARIS_SHARED_DIR", "ZETARIS_FILE_ROOT", "NO_NETWORK",
];

const DEFAULTS = {
  HOST: "127.0.0.1",
  PORT: "8000",
  NIGHTSHIFT_TIMEOUT_MS: "90000",
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

// Simple KEY=VALUE parser: skips blank and # lines, strips one pair of quotes, no expansion.
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.at(-1) === val[0]) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

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

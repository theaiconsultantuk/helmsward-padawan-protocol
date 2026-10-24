// Jedi Pack .env parser: pure, no imports, no side effects. src/config.mjs and scripts/scenario_proofs.mjs both read .env through it.
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

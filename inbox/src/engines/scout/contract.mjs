// Scout signed execution contract. Follows Meterless engines/scout-intent/docs/execution-contract.md:
// signature = HMAC_SHA256(secret, canonical_json(contract_without_signature)), signedBy "scout", TTL 5 min.
import crypto from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(clock = Date.now, rng = crypto.randomBytes) {
  let t = BigInt(Math.floor(clock()));
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[Number(t & 31n)] + time;
    t >>= 5n;
  }
  const bytes = rng(10); // 80 bits
  let r = 0n;
  for (const b of bytes) r = (r << 8n) | BigInt(b);
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand = CROCKFORD[Number(r & 31n)] + rand;
    r >>= 5n;
  }
  return time + rand;
}

export function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") {
    const s = JSON.stringify(obj);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(obj)) return "[" + obj.map((v) => canonicalJson(v)).join(",") + "]";
  const parts = [];
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ":" + canonicalJson(obj[k]));
  }
  return "{" + parts.join(",") + "}";
}

const defaultSecret = () => process.env.SCOUT_SECRET ?? "dev-secret";

function hmac(contract, secret) {
  const { signature, ...rest } = contract;
  return crypto.createHmac("sha256", secret).update(canonicalJson(rest)).digest("hex");
}

export function sign(contractWithoutSignature, secret = defaultSecret()) {
  return hmac(contractWithoutSignature, secret);
}

export function issueContract({
  traceId, intent, risk, toolPlan, modelProfile, scope, registryVersion, policyPackVersion,
  clock = Date.now, ttlMs = 5 * 60 * 1000, secret = defaultSecret(),
}) {
  const now = clock();
  const body = {
    contractId: ulid(clock),
    traceId,
    intent: {
      primary: intent?.primary,
      parameters: intent?.parameters ?? {},
      references: intent?.references ?? {},
      confidence: intent?.confidence,
      alternates: intent?.alternates ?? [],
    },
    risk: {
      level: risk?.level,
      flags: risk?.flags ?? [],
      redactions: risk?.redactions ?? [],
      approvals: risk?.approvals ?? [],
    },
    toolPlan: toolPlan ?? [],
    modelProfile,
    scope,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    registryVersion,
    policyPackVersion,
    signedBy: "scout",
  };
  return { ...body, signature: sign(body, secret) };
}

export function verifyContract(contract, { secret = defaultSecret(), clock = Date.now } = {}) {
  const bad = (reason) => ({ ok: false, reason });
  if (!contract || typeof contract !== "object" || typeof contract.signature !== "string"
      || typeof contract.expiresAt !== "string" || !contract.intent || !contract.toolPlan) {
    return bad("missing");
  }
  if (contract.signedBy !== "scout") return bad("signedBy");
  const expected = Buffer.from(hmac(contract, secret), "hex");
  const given = Buffer.from(contract.signature, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return bad("signature");
  const exp = Date.parse(contract.expiresAt);
  if (!(exp > clock())) return bad("expired");
  return { ok: true, reason: null };
}

// Scout policy guard: injection check, RBAC policy gate, PII redaction, policy packs.
// Behaviour per Meterless risk-and-policy.md: any `block` blocks; any `warn` lifts the level one band.
// Pure rules, zero deps, never throws.

const ZW = /[​-‏⁠-⁤﻿]/g; // zero-width chars, stripped before matching
const BIDI = /[‪-‮⁦-⁩]/g;      // bidi overrides (RTL override U+202E etc.)

export const INJECTION_RULES = [
  { id: "override-instructions", severity: "block",
    re: /\b(?:ignore|disregard|forget|override|bypass)\b[\s\W]{0,12}(?:(?:all|any|the|your|my|every)\b[\s\W]{0,8})*(?:previous|prior|above|earlier|preceding|former)\b/i },
  { id: "override-rules", severity: "block",
    re: /\b(?:ignore|disregard|forget)\b[\s\W]{0,12}(?:(?:all|any|the|your|every)\b[\s\W]{0,8})*(?:instructions?|rules?|prompts?|guidelines?)\b/i },
  { id: "disregard-the-user", severity: "block", re: /\bdisregard\s+the\s+user\b/i },
  { id: "system-tag", severity: "block", re: /<\/?\s*system\s*>/i },
  { id: "inst-marker", severity: "block", re: /\[\/?INST\]|<<\/?SYS>>/i },
  { id: "role-reassign", severity: "block", re: /\byou\s+are\s+now\b/i },
  { id: "role-pretend-system", severity: "block", re: /\bpretend\s+(?:to\s+be|you\s+are|you're)\s+(?:the\s+)?(?:system|admin|root|developer)\b/i },
  { id: "unrestricted-mode", severity: "block", re: /\b(?:unrestricted|jailbreak)\s+mode\b/i },
  { id: "exfiltrate-secrets", severity: "block",
    re: /\b(?:reveal|print|show|dump|expose|leak|output|display)\b[^.\n]{0,40}?\b(?:credentials?|api[\s_-]?keys?|secrets?|passwords?|system\s+prompt|hidden\s+instructions?)\b/i },
  { id: "privilege-escalation", severity: "block",
    re: /\b(?:grant|give)\s+(?:me\s+)?(?:admin|root|superuser|sudo)\b|\b(?:elevate|escalate)\s+(?:my\s+)?(?:privileges?|permissions?|access)\b|\bmake\s+me\s+(?:an?\s+)?(?:admin|root)\b/i },
  { id: "control-bytes", severity: "block", re: /[‪-‮⁦-⁩]|\\u202e|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i },
  { id: "decode-execute", severity: "block",
    re: /\b(?:decode|decrypt)\b[^.\n]{0,60}\b(?:and\s+)?(?:execute|run|eval)\b|[A-Za-z0-9+/]{40,}={0,2}[\s\S]{0,40}\b(?:decode|execute|eval)\b|\b(?:decode|execute|eval)\b[\s\S]{0,40}[A-Za-z0-9+/]{40,}={0,2}/i },
];

export const PII_REDACTIONS = [
  { id: "email", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { id: "phone", re: /(?<![\w.])\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}(?![\w])/g },
  { id: "card", re: /\b(?:\d[ -]?){13,19}\b/g },
];

// default: pattern blocks + out-of-band tool refs + RBAC warn. tight: same blocks, plus stricter extras.
export const PACKS = {
  default: { version: 1, outOfBandTool: "block", rbac: "warn", pii: "redact", rules: INJECTION_RULES.map((r) => r.id) },
  "adversarial-tight": { version: 1, outOfBandTool: "block", rbac: "warn", pii: "redact", rules: INJECTION_RULES.map((r) => r.id), strictRbac: true },
};

const TOOL_REF = /\b(?:use|call|invoke|run|execute|trigger)\s+(?:the\s+)?([a-z][a-z0-9]*(?:[_-][a-z0-9]+)+)(?:\s+(?:tool|function|api|capability))?/gi;

export function rbac(user, intent) {
  const roles = intent?.roles;
  if (!Array.isArray(roles) || roles.length === 0 || roles.includes("*")) return { allowed: true, reason: "open" };
  const role = user?.role;
  if (!role) return { allowed: true, reason: "no-role" };
  if (role === "exec") return { allowed: true, reason: "exec" };
  if (roles.includes(role)) return { allowed: true, reason: "role-match" };
  return { allowed: false, reason: `role ${role} not in [${roles.join(",")}]` };
}

const lift = (l) => (l === "low" ? "medium" : l === "medium" ? "high" : l);

export function guard(prompt, { user, surface, intent, packs = ["default"] } = {}) {
  const out = { level: "low", flags: [], redactions: [], approvals: [] };
  try {
    const raw = String(prompt ?? "").replace(ZW, "");
    const clean = raw.replace(BIDI, " ");
    const active = (Array.isArray(packs) ? packs : [packs]).map((p) => PACKS[p]).filter(Boolean);
    const ids = new Set(active.flatMap((p) => p.rules));
    if (!active.length) INJECTION_RULES.forEach((r) => ids.add(r.id));
    let blocked = false, warned = false;

    for (const r of INJECTION_RULES) {
      if (!ids.has(r.id)) continue;
      if (r.re.test(r.id === "control-bytes" ? raw : clean)) {
        out.flags.push(`injection:${r.id}`);
        if (r.severity === "block") blocked = true; else warned = true;
      }
    }
    const caps = new Set(intent?.capabilities ?? []);
    for (const m of clean.matchAll(TOOL_REF)) {
      const name = m[1].toLowerCase();
      if (!caps.has(name)) { out.flags.push(`tool-ref:${name}`); blocked = true; }
    }
    for (const p of PII_REDACTIONS) {
      const hits = clean.match(p.re);
      if (hits) out.redactions.push(...hits.map((h) => `${p.id}:${h.length > 4 ? h.slice(0, 2) + "..." + h.slice(-2) : "***"}`));
    }
    const r = rbac(user, intent);
    if (!r.allowed) { out.flags.push("rbac:" + r.reason); warned = true; out.approvals.push("rbac-review"); }

    if (blocked) out.level = "block";
    else if (warned) out.level = lift(out.level);
  } catch {
    out.flags.push("guard-error");
  }
  return out;
}

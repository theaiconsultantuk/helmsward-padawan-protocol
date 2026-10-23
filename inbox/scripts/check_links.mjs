#!/usr/bin/env node
// Dependency-free relative-link checker for markdown files.
// Usage: node inbox/scripts/check_links.mjs <file.md> [more.md ...]
// Exits 1 if a relative link target does not exist, or an #anchor has no matching heading.
// http(s), mailto and other schemes are not fetched. Links inside code fences and code spans are ignored.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node check_links.mjs <file.md> [more.md ...]");
  process.exit(64);
}

function stripCode(text) {
  const out = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      out.push("");
      continue;
    }
    out.push(fence ? "" : line.replace(/`[^`\n]*`/g, ""));
  }
  return out;
}

const slug = (h) => h.trim().toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const set = new Set();
  const seen = new Map();
  for (const line of stripCode(readFileSync(file, "utf8"))) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    let s = slug(m[1]);
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    set.add(n ? `${s}-${n}` : s);
  }
  anchorCache.set(file, set);
  return set;
}

let bad = 0;
let total = 0;
for (const file of files) {
  if (!existsSync(file)) { console.error(`FAIL ${file}: file not found`); bad++; continue; }
  const lines = stripCode(readFileSync(file, "utf8"));
  lines.forEach((line, i) => {
    const re = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
    for (let m; (m = re.exec(line));) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http(s), mailto, ...
      total++;
      const [pathPart, anchor] = target.split("#");
      const abs = pathPart ? resolve(dirname(file), decodeURI(pathPart)) : resolve(file);
      if (!existsSync(abs)) { console.error(`FAIL ${file}:${i + 1}: missing target ${target}`); bad++; continue; }
      if (anchor) {
        if (statSync(abs).isDirectory() || !/\.md$/i.test(abs)) continue;
        if (!anchorsOf(abs).has(decodeURI(anchor).toLowerCase())) { console.error(`FAIL ${file}:${i + 1}: no heading for #${anchor} in ${pathPart || file}`); bad++; }
      }
    }
  });
}
console.log(bad ? `check_links: ${bad} broken of ${total} relative links` : `check_links: ok, ${total} relative links`);
process.exit(bad ? 1 : 0);

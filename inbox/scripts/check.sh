#!/usr/bin/env bash
# Level-1 syntax check: node --check on every src/**/*.mjs (src/scenarios.mjs, src/intake.mjs, src/journey.mjs, src/engines/world-model/world.mjs included) and scripts/*.mjs,
# on public/app.js, public/dashboard.js and the storefront scripts public/shop/js/{contact,flow-render,faq}.js, check_links over the scenario markdown, py_compile on gen_company.py.
# One line per file; exits non-zero if any file fails.
set -uo pipefail
INBOX="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
while IFS= read -r f; do
  if out=$(node --check "$f" 2>&1); then echo "ok    ${f#"$INBOX"/}"
  else echo "FAIL  ${f#"$INBOX"/}: $(printf '%s' "$out" | head -n 3 | tr '\n' ' ')"; fail=1; fi
done < <(find "$INBOX/src" -type f -name '*.mjs' -not -path '*/node_modules/*' | sort; find "$INBOX/scripts" -maxdepth 1 -type f -name '*.mjs' | sort)
# the browser scripts are plain .js files (not .mjs), so they are named here; node --check parses them as scripts
for f in "$INBOX/public/app.js" "$INBOX/public/dashboard.js" "$INBOX/public/shop/js/contact.js" "$INBOX/public/shop/js/flow-render.js" "$INBOX/public/shop/js/faq.js"; do
  if out=$(node --check "$f" 2>&1); then echo "ok    ${f#"$INBOX"/}"
  else echo "FAIL  ${f#"$INBOX"/}: $(printf '%s' "$out" | head -n 3 | tr '\n' ' ')"; fail=1; fi
done
# relative links in the markdown the scenario slice added (the README and the older judging files are checked by their own runs)
if out=$(node "$INBOX/scripts/check_links.mjs" "$INBOX/docs/FRONTEND-SPEC.md" "$INBOX/judging/scenarios.md" "$INBOX/judging/engine-world-model.md" "$INBOX/judging/screenshots/README.md" 2>&1); then echo "ok    check_links (FRONTEND-SPEC, scenarios, engine-world-model, screenshots/README)"
else echo "FAIL  check_links: $(printf '%s' "$out" | head -n 5 | tr '\n' ' ')"; fail=1; fi
py="$INBOX/scripts/gen_company.py"
pyc="$(mktemp -d)/gen_company.pyc"
if out=$(python3 -I -c 'import sys,py_compile; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)' "$py" "$pyc" 2>&1); then echo "ok    scripts/gen_company.py"
else echo "FAIL  scripts/gen_company.py: $(printf '%s' "$out" | head -n 3 | tr '\n' ' ')"; fail=1; fi
rm -rf "$(dirname "$pyc")"
[ "$fail" -eq 0 ] && echo "check: all files pass" || echo "check: FAILURES"
exit "$fail"

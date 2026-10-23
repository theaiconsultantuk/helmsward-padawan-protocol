#!/usr/bin/env bash
# Level-1 syntax check: node --check on every src/**/*.mjs and scripts/*.mjs, py_compile on gen_company.py.
# One line per file; exits non-zero if any file fails.
set -uo pipefail
INBOX="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
while IFS= read -r f; do
  if out=$(node --check "$f" 2>&1); then echo "ok    ${f#"$INBOX"/}"
  else echo "FAIL  ${f#"$INBOX"/}: $(printf '%s' "$out" | head -n 3 | tr '\n' ' ')"; fail=1; fi
done < <(find "$INBOX/src" -type f -name '*.mjs' -not -path '*/node_modules/*' | sort; find "$INBOX/scripts" -maxdepth 1 -type f -name '*.mjs' | sort)
py="$INBOX/scripts/gen_company.py"
pyc="$(mktemp -d)/gen_company.pyc"
if out=$(python3 -I -c 'import sys,py_compile; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)' "$py" "$pyc" 2>&1); then echo "ok    scripts/gen_company.py"
else echo "FAIL  scripts/gen_company.py: $(printf '%s' "$out" | head -n 3 | tr '\n' ' ')"; fail=1; fi
rm -rf "$(dirname "$pyc")"
[ "$fail" -eq 0 ] && echo "check: all files pass" || echo "check: FAILURES"
exit "$fail"

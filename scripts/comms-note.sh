#!/usr/bin/env bash
# Append a timestamped entry to your own comms log. Usage: scripts/comms-note.sh "T3" "what you did" "files: a,b" "next: ..."
# Who you are comes from git config user.name, lowercased. Agents: set AGENT=claude (or codex, cursor) to tag entries.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
who=$(git config user.name | tr 'A-Z ' 'a-z-')
f="agent-comms/members/${who}.md"
tag=${AGENT:+ [agent: $AGENT]}
[ -f "$f" ] || printf '# %s log (append only, newest last)\n' "$who" > "$f"
printf '\n- %s%s | %s | %s | %s | %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$tag" "${1:?task id}" "${2:?what}" "${3:-files: -}" "${4:-next: -}" >> "$f"
echo "logged to $f"

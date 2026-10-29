#!/usr/bin/env bash
# Render one diagram with the renderer scripts/setup.sh installed, run the way
# hooks/register.tsx runs it. CI runs this on Linux, macOS, and Windows.
set -eu

cache="$HOME/.cache/mermaid-render"
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf 'flowchart LR\n  A[Reply] --> B[Mod]\n' > "$work/in.mmd"

art="$("$cache/bin/mermaid-ascii$exe" -p 0 -x 3 -y 2 --max-width 76 < "$work/in.mmd")"
printf '%s\n' "$art"
case "$art" in
  *Reply*Mod*) ;;
  *) echo "smoke: mermaid-ascii drew no boxes" >&2; exit 1 ;;
esac

echo "smoke: mermaid-ascii works"

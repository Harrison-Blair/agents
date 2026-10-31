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

# Two stacked subgraphs, with the wider gaps register.tsx uses for them. With
# smaller gaps, the second title merges into a border line.
printf 'flowchart LR\n  subgraph A[First]\n    A1[Reply] --> A2[Mod]\n  end\n  subgraph B[Second]\n    B1[Reply] --> B2[Mod]\n  end\n' > "$work/sub.mmd"
art="$("$cache/bin/mermaid-ascii$exe" -p 0 -x 5 -y 5 --max-width 76 < "$work/sub.mmd")"
printf '%s\n' "$art"
if ! printf '%s\n' "$art" | grep -Eq '^│ +Second +│[[:space:]]*$'; then
  echo "smoke: mermaid-ascii drew the second subgraph title outside its border" >&2
  exit 1
fi

echo "smoke: mermaid-ascii works"

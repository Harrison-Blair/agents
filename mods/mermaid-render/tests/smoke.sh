#!/usr/bin/env bash
# Render one diagram with each renderer scripts/setup.sh installed, run the way
# hooks/register.tsx runs them. CI runs this on Linux, macOS, and Windows.
set -eu

cache="$HOME/.cache/mermaid-render"
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf 'flowchart LR\n  A[Reply] --> B[Mod]\n' > "$work/in.mmd"

art="$("$cache/bin/mermaid-ascii$exe" < "$work/in.mmd")"
printf '%s\n' "$art"
case "$art" in
  *Reply*Mod*) ;;
  *) echo "smoke: mermaid-ascii drew no boxes" >&2; exit 1 ;;
esac

mmdc() {
  PUPPETEER_CACHE_DIR="$cache/puppeteer" node "$cache/node_modules/@mermaid-js/mermaid-cli/src/cli.js" \
    -q -i "$work/in.mmd" -o "$work/out.png" -t dark -b transparent -s 2 "$@"
}
# Like the mod: where Chromium's sandbox is blocked (Ubuntu 23.10+), retry once
# without it.
if ! mmdc 2> "$work/err"; then
  cat "$work/err" >&2
  grep -q "No usable sandbox" "$work/err" || exit 1
  echo "smoke: sandbox blocked; retrying without it"
  printf '{"args":["--no-sandbox"]}' > "$work/no-sandbox.json"
  mmdc -p "$work/no-sandbox.json"
fi
signature="$(head -c 8 "$work/out.png" | od -An -tx1 | tr -d ' \n')"
if [ "$signature" != 89504e470d0a1a0a ]; then
  echo "smoke: mermaid-cli wrote no PNG" >&2
  exit 1
fi
echo "smoke: both renderers work"

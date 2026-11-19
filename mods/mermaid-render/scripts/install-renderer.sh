#!/bin/sh
# Install the pinned mermaid-ascii release into the cache that
# hooks/register.tsx draws from. The mod runs this script at the first diagram
# of a session. It is also the manual install command.
#
# Exit status 0: the pinned release is installed, by this run or an earlier
# one. In each other case the exit status is 1, and one line on stderr gives
# the reason.
set -u

VERSION="1.6.1"
URL="https://github.com/AlexanderGrooff/mermaid-ascii/releases/download/$VERSION"
CACHE="$HOME/.cache/mermaid-render"
# A cache directory without this marker is not ours and is not changed.
# scripts/setup.sh --uninstall removes a cache that has it.
MARK="$CACHE/.agents-managed"
TMP="$CACHE/download"

fail() {
  echo "mermaid-ascii $VERSION not installed: $1" >&2
  exit 1
}

# A failure after the download directory was made.
abandon() {
  rm -rf "$TMP"
  fail "$1"
}

# The release archive of mermaid-ascii for this OS and CPU.
asset_name() {
  case "$(uname -s)" in
    Linux) os=Linux ;;
    Darwin) os=Darwin ;;
    MINGW*|MSYS*|CYGWIN*) os=Windows ;;
    *) return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x86_64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) return 1 ;;
  esac
  if [ "$os" = Windows ]; then
    echo "mermaid-ascii_${os}_${arch}.zip"
  else
    echo "mermaid-ascii_${os}_${arch}.tar.gz"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# The Windows archive is a zip, and Git Bash has no unzip.
unpack() {
  case "$asset" in
    *.zip)
      powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '$(cygpath -w "$TMP/$asset")' -DestinationPath '$(cygpath -w "$TMP")'" >/dev/null &&
        mv -f "$TMP/mermaid-ascii.exe" "$CACHE/bin/mermaid-ascii.exe"
      ;;
    *)
      tar -xzf "$TMP/$asset" -C "$TMP" mermaid-ascii && mv -f "$TMP/mermaid-ascii" "$CACHE/bin/mermaid-ascii"
      ;;
  esac
}

[ "$(cat "$CACHE/.mermaid-ascii-version" 2>/dev/null)" = "$VERSION" ] && exit 0
if [ -d "$CACHE" ] && [ ! -e "$MARK" ]; then
  fail "$CACHE exists and is not managed by mermaid-render"
fi
asset="$(asset_name)" || fail "no release build for this OS and CPU"
checksums="mermaid-ascii_${VERSION}_checksums.txt"
if ! { rm -rf "$TMP" && mkdir -p "$TMP" "$CACHE/bin" && : > "$MARK"; } 2>/dev/null; then
  fail "could not write to $CACHE"
fi
for name in "$asset" "$checksums"; do
  # curl adds lines of help text to some errors. The reason is its first line.
  error="$(curl -fsSL --connect-timeout 10 -o "$TMP/$name" "$URL/$name" 2>&1)" ||
    abandon "could not download $name: $(printf '%s\n' "$error" | head -n 1)"
done
expected="$(grep -F " $asset" "$TMP/$checksums" | cut -d' ' -f1)"
if [ -z "$expected" ] || [ "$(sha256 "$TMP/$asset")" != "$expected" ]; then
  abandon "checksum mismatch for $asset"
fi
unpack 2>/dev/null || abandon "could not unpack $asset"
rm -rf "$TMP"
printf '%s\n' "$VERSION" > "$CACHE/.mermaid-ascii-version"
echo "installed: mermaid-ascii $VERSION"

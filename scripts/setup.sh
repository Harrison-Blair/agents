#!/usr/bin/env bash
# Wire this clone into the local machine, or (--sync) pull and reconcile.
#
#   scripts/setup.sh              one-time setup after clone
#   scripts/setup.sh --force      setup, also replacing a custom Claude or Cursor
#                                 statusLine
#   scripts/setup.sh --sync       what the session-start hooks run: pull,
#                                 re-link, and re-merge the hook entries
#   scripts/setup.sh --uninstall  remove the links and hook entries this clone
#                                 installed, leaving the clone itself alone
#
# With no clone around it -- piped from curl, or a lone downloaded copy -- the
# script first clones the repo to ${AGENTS_HOME:-~/source/agents} and hands the
# run over to that copy, so the hook it installs names a path that keeps working.
#
# Skills are linked one by one into ~/.agents/skills so machine-local skills can
# live beside them, and global/AGENTS.md supplies each harness's instructions.
# Hooks are merged into existing config files, never replaced.
# Every statement lives in a function and the file ends with one `main "$@"`, so
# the shell parses the whole script before a pull can replace it on disk.
set -u

REPO_URL="https://github.com/Harrison-Blair/agents.git"
AGENTS_SKILLS="$HOME/.agents/skills"
# Wrappers for commands skills ship in skills/<name>/bin/, so every harness can
# run them by the same bare name.
BIN_DIR="$HOME/.local/bin"
WRAPPER_MARK="# agents repo command:"
# The marker wrappers carried before the repo was renamed; still ours.
OLD_WRAPPER_MARK="# skills repo command:"
# The shared instructions every harness file links to, and the fixed start of
# the first line of a copy written where no link can be made (see link_file).
AGENTS_MD="$HOME/.agents/AGENTS.md"
MANAGED_MARK="<!-- Managed by the agents repository: "
# Directory holding this script's clone, empty when the script has no file to
# sit next to: piped into a shell, $0 is the shell's own name and `dirname` of
# it would silently point at whatever happens to be above the current directory.
REPO=""
[ -f "$0" ] && REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
LOCK=""
STAMP=""
MODE=setup
FORCE=0
LOCK_HELD=0

is_windows() {
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac
}

# Physical path of a link target (or of a plain path).
resolve() { (cd "$1" 2>/dev/null && pwd -P); }

# True for a symlink, or on Windows a junction (listed by `dir /AL`).
is_link() {
  [ -L "$1" ] && return 0
  is_windows && [ -d "$1" ] &&
    MSYS_NO_PATHCONV=1 cmd /c dir /AL /B "$(cygpath -w "$(dirname "$1")")" 2>/dev/null |
    tr -d '\r' | grep -Fxq -- "$(basename "$1")"
}

# A path spelled the way a junction target comes back, so the two can be
# compared: `cygpath -u` maps both C:\x and C:/x onto /c/x and leaves /c/x be.
unix_path() {
  if is_windows; then
    cygpath -u "$1" 2>/dev/null || printf '%s\n' "$1"
  else
    printf '%s\n' "$1"
  fi
}

# junction_list DIR: print "name|target" for every junction in DIR. `dir /AL`
# prints "<JUNCTION>  name [target]"; the /B form is_link uses omits the target,
# which is the only thing that says whether a junction is one of ours.
junction_list() {
  MSYS_NO_PATHCONV=1 cmd /c dir /AL "$(cygpath -w "$1")" 2>/dev/null | tr -d '\r' |
    sed -n 's/^.*<JUNCTION>[[:space:]]*\(.*\) \[\(.*\)\]$/\1|\2/p'
}

# Target a directory link records, empty when the path is not a link. Symlink
# targets come back as written (setup writes absolute ones); junction targets
# are converted to the same spelling as unix_path.
link_target() {
  local entry
  if [ -L "$1" ]; then
    readlink "$1"
    return 0
  fi
  is_windows || return 0
  junction_list "$(dirname "$1")" | while IFS= read -r entry; do
    [ "${entry%%|*}" = "$(basename "$1")" ] || continue
    unix_path "${entry#*|}"
  done
}

# Remove a directory link and nothing else. A junction needs `rmdir` -- never
# /S, which would recurse into the real directory on the other side -- while a
# symlink only needs unlinking.
unlink_dir() {
  if [ -L "$1" ]; then
    # Git Bash reports a junction as a symlink too; when rm cannot take it,
    # fall through to the rmdir a junction always accepts.
    rm "$1" 2>/dev/null && return 0
    is_windows || return 1
  fi
  MSYS_NO_PATHCONV=1 cmd /c rmdir "$(cygpath -w "$1")" >/dev/null
}

# prune_junctions DIR PREFIX: the Windows counterpart of the broken-symlink
# sweep. A junction in DIR goes only when it points under PREFIX -- that is, at
# a skill this setup linked -- and that target is gone. Junctions pointing
# anywhere else, and every real directory, are left as they are.
prune_junctions() {
  local dir="$1" prefix entry name target
  prefix="$(unix_path "$2")"
  [ -d "$dir" ] || return 0
  junction_list "$dir" | while IFS= read -r entry; do
    name="${entry%%|*}"
    target="$(unix_path "${entry#*|}")"
    [ -n "$name" ] || continue
    case "$target" in "$prefix"/*) ;; *) continue ;; esac
    [ -e "$target" ] && continue
    if unlink_dir "$dir/$name"; then
      echo "pruned: $name"
    else
      echo "warn: could not remove junction $dir/$name" >&2
    fi
  done
  return 0
}

# link_dir LINK TARGET: create a directory link; never delete anything real.
# A dangling link in the way -- one left by a clone that moved or was deleted
# -- holds nothing of its own and is replaced; a live link elsewhere and any
# real directory are left alone.
link_dir() {
  local link="$1" target="$2"
  [ -d "$target" ] || { echo "skip: missing target $target" >&2; return 1; }
  if [ -e "$link" ] || [ -L "$link" ]; then
    if is_link "$link" && [ "$(resolve "$link")" = "$(resolve "$target")" ]; then
      return 0
    fi
    if is_link "$link" && [ ! -e "$link" ]; then
      unlink_dir "$link" || { echo "warn: could not remove dangling link $link" >&2; return 1; }
      echo "relinked: $(basename "$link")"
    else
      echo "warn: $link exists and is not a link to $target; left untouched" >&2
      return 1
    fi
  fi
  mkdir -p "$(dirname "$link")"
  if is_windows; then
    # Junction: no admin rights needed, absolute Windows paths required.
    # Pass as separate argv entries -- wrapping this in one quoted string for
    # `cmd /c` trips a cmd.exe re-quoting bug ("filename... is incorrect")
    # once more than one quoted path is embedded in it.
    MSYS_NO_PATHCONV=1 cmd /c mklink /J "$(cygpath -w "$link")" "$(cygpath -w "$target")" >/dev/null
  else
    ln -s "$target" "$link"
  fi
}

# Link every repo skill into ~/.agents/skills; prune links to removed skills.
link_skills() {
  mkdir -p "$AGENTS_SKILLS"
  local d name
  for d in "$REPO"/skills/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    link_dir "$AGENTS_SKILLS/$name" "${d%/}"
  done
  if is_windows; then
    prune_junctions "$AGENTS_SKILLS" "$REPO/skills"
    return 0
  fi
  for d in "$AGENTS_SKILLS"/*; do
    [ -L "$d" ] || continue
    case "$(readlink "$d")" in
      "$REPO"/skills/*) [ -e "$d" ] || { rm "$d"; echo "pruned: $(basename "$d")"; } ;;
    esac
  done
}

link_claude_skills() {
  [ -d "$HOME/.claude" ] || { echo "skip: ~/.claude not found (Claude Code)"; return 0; }
  local root="$HOME/.claude/skills" target d name
  target="$(resolve "$AGENTS_SKILLS")" || return 1
  if is_link "$root"; then
    if [ "$(resolve "$root")" != "$target" ]; then
      echo "warn: $root is not a link to $AGENTS_SKILLS; left untouched" >&2
      return 1
    fi
    # Migrate the old whole-directory link without touching its contents.
    # A Windows junction needs rmdir (never /S); a symlink only needs unlinking.
    if [ -L "$root" ]; then
      rm "$root" || return 1
    else
      MSYS_NO_PATHCONV=1 cmd /c rmdir "$(cygpath -w "$root")" || return 1
    fi
  elif [ -e "$root" ] && [ ! -d "$root" ]; then
    echo "warn: $root is not a directory; left untouched" >&2
    return 1
  fi
  mkdir -p "$root" || return 1
  for d in "$AGENTS_SKILLS"/*; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    link_dir "$root/$name" "$d"
  done
  if is_windows; then
    prune_junctions "$root" "$AGENTS_SKILLS"
    return 0
  fi
  for d in "$root"/*; do
    [ -L "$d" ] || continue
    name="$(basename "$d")"
    if [ "$(readlink "$d")" = "$AGENTS_SKILLS/$name" ] && [ ! -e "$d" ]; then
      rm "$d" && echo "pruned: claude/$name"
    fi
  done
}

# Every folder under pi/ is a Pi extension, linked under its own name. A link
# into this clone's pi/ whose target is gone -- an extension removed or renamed
# -- is pruned.
link_pi() {
  local dir="$HOME/.pi/agent/extensions" ext
  [ -d "$HOME/.pi/agent" ] || { echo "skip: ~/.pi/agent not found (Pi)"; return 0; }
  mkdir -p "$dir"
  for ext in "$REPO"/pi/*/; do
    [ -d "$ext" ] || continue
    link_dir "$dir/$(basename "$ext")" "${ext%/}"
  done
  if is_windows; then
    prune_junctions "$dir" "$REPO/pi"
    return 0
  fi
  for ext in "$dir"/*; do
    [ -L "$ext" ] || continue
    case "$(readlink "$ext")" in
      "$REPO"/pi/*) [ -e "$ext" ] || { rm "$ext"; echo "pruned: $(basename "$ext")"; } ;;
    esac
  done
}

# Every folder under mods/ is a Claude Code mod. Claude Code loads a plugin
# from ~/.claude/skills/<name>, so each mod is linked there under its own name,
# and a link into this clone's mods/ whose target is gone is pruned.
link_mods() {
  local root="$HOME/.claude/skills" mod
  [ -d "$HOME/.claude" ] || return 0
  [ -d "$REPO/mods" ] || return 0
  mkdir -p "$root"
  for mod in "$REPO"/mods/*/; do
    [ -d "$mod" ] || continue
    link_dir "$root/$(basename "$mod")" "${mod%/}"
  done
  if is_windows; then
    prune_junctions "$root" "$REPO/mods"
    return 0
  fi
  for mod in "$root"/*; do
    [ -L "$mod" ] || continue
    case "$(readlink "$mod")" in
      "$REPO"/mods/*) [ -e "$mod" ] || { rm "$mod"; echo "pruned: mods/$(basename "$mod")"; } ;;
    esac
  done
}

# The renderers the mermaid-render mod runs, in a cache this script owns. Only
# a setup run installs them: --sync runs inside a 30-second session hook, too
# short for a Chromium download.
MERMAID_CACHE="$HOME/.cache/mermaid-render"
MERMAID_MARK="$HOME/.cache/mermaid-render/.agents-managed"
MERMAID_ASCII_VERSION="1.6.1"
MERMAID_CLI_VERSION="12.0.0"

# The release archive of mermaid-ascii for this OS and CPU.
mermaid_ascii_asset() {
  local os arch
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

install_mermaid_ascii() {
  local asset url tmp expected
  [ "$(cat "$MERMAID_CACHE/.mermaid-ascii-version" 2>/dev/null)" = "$MERMAID_ASCII_VERSION" ] && return 0
  asset="$(mermaid_ascii_asset)" || { echo "warn: mermaid-render: no mermaid-ascii build for this OS" >&2; return 1; }
  url="https://github.com/AlexanderGrooff/mermaid-ascii/releases/download/$MERMAID_ASCII_VERSION"
  tmp="$MERMAID_CACHE/download"
  rm -rf "$tmp" && mkdir -p "$tmp" "$MERMAID_CACHE/bin" || return 1
  if ! curl -fsSL -o "$tmp/$asset" "$url/$asset" ||
    ! curl -fsSL -o "$tmp/checksums.txt" "$url/mermaid-ascii_${MERMAID_ASCII_VERSION}_checksums.txt"; then
    echo "warn: mermaid-render: could not download mermaid-ascii" >&2
    rm -rf "$tmp"
    return 1
  fi
  expected="$(grep -F " $asset" "$tmp/checksums.txt" | cut -d' ' -f1)"
  if [ -z "$expected" ] || [ "$(sha256 "$tmp/$asset")" != "$expected" ]; then
    echo "warn: mermaid-render: mermaid-ascii checksum mismatch; not installed" >&2
    rm -rf "$tmp"
    return 1
  fi
  if is_windows; then
    powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '$(cygpath -w "$tmp/$asset")' -DestinationPath '$(cygpath -w "$tmp")'" >/dev/null &&
      mv -f "$tmp/mermaid-ascii.exe" "$MERMAID_CACHE/bin/mermaid-ascii.exe"
  else
    tar -xzf "$tmp/$asset" -C "$tmp" mermaid-ascii && mv -f "$tmp/mermaid-ascii" "$MERMAID_CACHE/bin/mermaid-ascii"
  fi || { echo "warn: mermaid-render: could not unpack mermaid-ascii" >&2; rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  printf '%s\n' "$MERMAID_ASCII_VERSION" > "$MERMAID_CACHE/.mermaid-ascii-version"
  echo "installed: mermaid-ascii $MERMAID_ASCII_VERSION"
}

# mermaid-cli brings its own headless Chromium through Puppeteer, kept inside
# the cache rather than Puppeteer's default ~/.cache/puppeteer.
install_mermaid_cli() {
  [ "$(cat "$MERMAID_CACHE/.mermaid-cli-version" 2>/dev/null)" = "$MERMAID_CLI_VERSION" ] && return 0
  if ! command -v npm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
    echo "warn: mermaid-render: npm not found; images skipped, diagrams render as text" >&2
    return 0
  fi
  echo "installing: mermaid-cli $MERMAID_CLI_VERSION with Chromium (about 1 GB)"
  if ! PUPPETEER_CACHE_DIR="$MERMAID_CACHE/puppeteer" npm install --prefix "$MERMAID_CACHE" \
    --no-fund --no-audit --loglevel=error "@mermaid-js/mermaid-cli@$MERMAID_CLI_VERSION" >/dev/null; then
    echo "warn: mermaid-render: npm install failed; images skipped" >&2
    return 0
  fi
  printf '%s\n' "$MERMAID_CLI_VERSION" > "$MERMAID_CACHE/.mermaid-cli-version"
  echo "installed: mermaid-cli $MERMAID_CLI_VERSION"
}

install_mermaid_renderers() {
  [ -d "$HOME/.claude" ] || return 0
  [ -d "$REPO/mods/mermaid-render" ] || return 0
  if [ -d "$MERMAID_CACHE" ] && [ ! -e "$MERMAID_MARK" ]; then
    echo "warn: $MERMAID_CACHE exists and is not managed by this repo; renderers skipped" >&2
    return 0
  fi
  mkdir -p "$MERMAID_CACHE" && : > "$MERMAID_MARK" || return 0
  install_mermaid_ascii
  install_mermaid_cli
  return 0
}

remove_mermaid_renderers() {
  [ -e "$MERMAID_MARK" ] || return 0
  rm -rf "$MERMAID_CACHE" && echo "removed: $MERMAID_CACHE"
}

# Physical path of a file, following every link in a chain; fails on a loop or
# a missing directory along the way.
resolve_file() {
  local path="$1" hops=0 target dir
  while [ -L "$path" ]; do
    hops=$((hops + 1))
    [ "$hops" -le 40 ] || return 1
    target="$(readlink "$path")"
    case "$target" in
      /*) path="$target" ;;
      *) path="$(dirname "$path")/$target" ;;
    esac
  done
  dir="$(resolve "$(dirname "$path")")" || return 1
  printf '%s/%s\n' "$dir" "$(basename "$path")"
}

# copy_owner FILE: the clone a managed AGENTS.md copy names, else nothing. Only
# a regular file is read, and only its start, so a FIFO or a huge file in the
# way cannot stall a session.
copy_owner() {
  local line
  [ -f "$1" ] && [ ! -L "$1" ] || return 0
  line="$(head -c 4096 "$1" 2>/dev/null | head -n 1)"
  case "$line" in
    "$MANAGED_MARK"*"/AGENTS.md. Edit it there"*) ;;
    *) return 0 ;;
  esac
  line="${line#"$MANAGED_MARK"}"
  # A legacy clone can itself be named global; check its exact path first.
  case "$line" in
    "$REPO/AGENTS.md. Edit it there"*) printf '%s\n' "$REPO" ;;
    *"/global/AGENTS.md. Edit it there"*) printf '%s\n' "${line%%/global/AGENTS.md. Edit it there*}" ;;
    *) printf '%s\n' "${line%%/AGENTS.md. Edit it there*}" ;;
  esac
}

# The copy written where a link cannot be: global/AGENTS.md with its
# placeholder marker line naming this clone.
managed_copy() {
  printf '%s%s/global/AGENTS.md. Edit it there; this copy is rewritten at sync. -->\n' \
    "$MANAGED_MARK" "$REPO"
  tail -n +2 "$REPO/global/AGENTS.md"
}

# make_file_link LINK TARGET: put a symlink at LINK, replacing whatever is
# there in one rename. On Windows a real symlink needs nativestrict -- Git
# Bash's default `ln -s` silently copies -- and the result is checked.
make_file_link() {
  local link="$1" target="$2" temp
  temp="$(dirname "$link")/.$(basename "$link").$$"
  if is_windows; then
    MSYS=winsymlinks:nativestrict ln -s "$target" "$temp" 2>/dev/null
  else
    ln -s "$target" "$temp"
  fi
  if [ -L "$temp" ]; then
    mv -f "$temp" "$link" && return 0
  fi
  rm -f "$temp"
  return 1
}

# write_copy LINK: write this clone's managed copy at LINK when it differs.
write_copy() {
  local link="$1" temp
  managed_copy | cmp -s - "$link" && return 0
  temp="$(dirname "$link")/.$(basename "$link").$$"
  if ! { managed_copy > "$temp" && mv -f "$temp" "$link"; }; then
    rm -f "$temp"
    return 1
  fi
  echo "warn: could not create a symlink at $link; wrote a managed copy instead" \
    "(Developer Mode or admin rights allow a link)" >&2
}

# link_file LINK TARGET: the one place that decides an AGENTS.md path. A link
# to TARGET stays; a legacy link into this clone's root AGENTS.md migrates;
# a dangling link is replaced; a copy this clone (or a clone
# that no longer exists) wrote becomes a link, or on Windows, where a link may
# be impossible, is refreshed. Anything else -- a live link elsewhere, a file
# without the marker, another live clone's copy, a directory -- is left with a
# warning and a non-zero status.
link_file() {
  local link="$1" target="$2" owner resolved
  if [ -L "$link" ]; then
    if [ -e "$link" ]; then
      resolved="$(resolve_file "$link")"
      [ "$resolved" = "$(resolve_file "$target")" ] && return 0
      if [ "$resolved" != "$(resolve_file "$REPO/AGENTS.md")" ]; then
        echo "warn: $link links elsewhere; left untouched" >&2
        return 1
      fi
    else
      rm "$link" || { echo "warn: could not remove dangling link $link" >&2; return 1; }
      echo "relinked: $link"
    fi
  elif [ -e "$link" ]; then
    owner="$(copy_owner "$link")"
    if [ -z "$owner" ]; then
      echo "warn: $link exists and is not managed by this repo; left untouched" >&2
      return 1
    fi
    if [ "$owner" != "$REPO" ] && [ -d "$owner" ]; then
      echo "warn: $link is managed by another clone, $owner; left untouched" >&2
      return 1
    fi
  fi
  mkdir -p "$(dirname "$link")" || return 1
  make_file_link "$link" "$target" && return 0
  if is_windows; then
    write_copy "$link"
    return
  fi
  echo "warn: could not link $link" >&2
  return 1
}

# True when the shared AGENTS.md is this clone's: a link into it, or a copy
# naming it. Nothing is installed or removed downstream of one that is not.
owns_agents_md() {
  local target
  if [ -L "$AGENTS_MD" ]; then
    [ -e "$AGENTS_MD" ] || return 1
    target="$(resolve_file "$AGENTS_MD")"
    [ "$target" = "$(resolve_file "$REPO/global/AGENTS.md")" ] ||
      [ "$target" = "$(resolve_file "$REPO/AGENTS.md")" ]
  else
    [ "$(copy_owner "$AGENTS_MD")" = "$REPO" ]
  fi
}

# The harness files that read the shared AGENTS.md, one "harness-dir|file" per
# line; a harness is skipped when its directory is absent.
agents_md_users() {
  printf '%s\n' "$HOME/.claude|$HOME/.claude/CLAUDE.md" \
    "$HOME/.codex|$HOME/.codex/AGENTS.md" \
    "$HOME/.pi/agent|$HOME/.pi/agent/AGENTS.md"
}

# Link ~/.agents/AGENTS.md into this clone, then each harness's file to it --
# but only when the shared entry is this clone's, so content it does not own
# is never spread further.
link_agents_md() {
  local dir file
  link_file "$AGENTS_MD" "$REPO/global/AGENTS.md" || return 0
  agents_md_users | while IFS='|' read -r dir file; do
    [ -d "$dir" ] || continue
    link_file "$file" "$AGENTS_MD"
  done
  return 0
}

# Remove the harness files pointing at this clone's shared AGENTS.md, then the
# shared entry itself; nothing at all when the shared entry is not this clone's.
unlink_agents_md() {
  local dir file
  owns_agents_md || return 0
  agents_md_users | while IFS='|' read -r dir file; do
    if [ -L "$file" ]; then
      [ -e "$file" ] || continue
      [ "$(resolve_file "$file")" = "$(resolve_file "$AGENTS_MD")" ] || continue
    elif [ "$(copy_owner "$file")" != "$REPO" ]; then
      continue
    fi
    rm "$file" && echo "removed: $file"
  done
  rm "$AGENTS_MD" && echo "removed: $AGENTS_MD"
}

# wrapper_for TARGET: the shim written to $BIN_DIR for one skill command.
wrapper_for() {
  printf '#!/bin/sh\n%s %s\nexec "%s" "$@"\n' "$WRAPPER_MARK" "$1" "$1"
}

# wrapper_target FILE: the command a wrapper this repo wrote runs, else nothing.
wrapper_target() {
  [ -f "$1" ] && sed -n -e "2s|^$WRAPPER_MARK ||p" -e "2s|^$OLD_WRAPPER_MARK ||p" "$1"
}

# Put a wrapper on PATH for every skills/<name>/bin/<command>. A wrapper that
# belongs to a clone that still exists, and any file that is not a wrapper, is
# left alone with a warning. Wrappers whose command is gone from this clone go.
link_commands() {
  local target name dest current found=0
  for target in "$REPO"/skills/*/bin/*; do
    [ -f "$target" ] || continue
    found=1
    name="$(basename "$target")"
    dest="$BIN_DIR/$name"
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      current="$(wrapper_target "$dest")"
      if [ -z "$current" ]; then
        echo "warn: $dest exists and is not an agents command wrapper; left untouched" >&2
        continue
      fi
      if [ "$current" != "$target" ] && [ -e "$current" ]; then
        echo "warn: $dest runs $current from another clone; left untouched" >&2
        continue
      fi
      wrapper_for "$target" | cmp -s - "$dest" && continue
    fi
    mkdir -p "$BIN_DIR"
    wrapper_for "$target" > "$dest.$$" && chmod 755 "$dest.$$" && mv -f "$dest.$$" "$dest"
  done
  remove_commands prune
  if [ "$found" = 1 ]; then
    case ":$PATH:" in
      *":$BIN_DIR:"*) ;;
      *) echo "warn: $BIN_DIR is not on PATH; add it so agents can run skill commands" >&2 ;;
    esac
  fi
}

# remove_commands prune|all: delete this clone's wrappers -- with prune, only
# those whose command no longer exists.
remove_commands() {
  local f target
  for f in "$BIN_DIR"/*; do
    target="$(wrapper_target "$f")"
    case "$target" in
      "$REPO"/skills/*/bin/*) ;;
      *) continue ;;
    esac
    [ "$1" = prune ] && [ -e "$target" ] && continue
    rm -f "$f" && echo "removed: $f"
  done
}

# The command hooks run at session start, with this machine's paths baked in.
# Its shape is also what marks a hook entry as managed by this repo, so it must
# stay stable: Codex re-prompts for trust whenever the command string changes.
sync_cmd() {
  if is_windows; then
    local bash_exe
    bash_exe="$(cygpath -m "$(command -v bash)")"
    echo "\"$bash_exe\" \"$(cygpath -m "$REPO")/scripts/setup.sh\" --sync"
  else
    echo "sh \"$REPO/scripts/setup.sh\" --sync"
  fi
}

# merge_hooks FILE TEMPLATE [ACTION]: reconcile FILE's hook entries with the
# template's. Entries whose command is a `scripts/setup.sh --sync` call are
# managed by this repo: one for this clone is updated in place, one for a clone
# that is gone is removed, one for another clone that still exists is kept with
# a warning. With ACTION "remove" (uninstall) the entries for this clone are
# deleted instead and no other managed entry is touched, not even a dead one.
# Anything else in the file is left exactly as it is. An event holds groups
# with a nested "hooks" list (Claude, Codex) or flat entries with a "command"
# (Cursor); the retired statuslines entries in the flat form are dropped here.
# A file that is not usable JSON of that shape is left byte for byte, and the
# entry printed for manual paste. Uses python3, python, or powershell; prints
# the snippet for manual paste when none is available.
merge_hooks() {
  local file="$1" template="$2" action="${3:-merge}" cmd
  cmd="$(sync_cmd)"
  # JSON-escape the command (backslashes, quotes), then sed-escape it.
  local cmd_json snippet
  cmd_json="$(printf '%s' "$cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  snippet="$(sed "s|__SYNC_CMD__|$(printf '%s' "$cmd_json" | sed 's/[\\&|]/\\&/g')|" "$template")"

  local py=""
  if command -v python3 >/dev/null 2>&1; then py=python3
  elif command -v python >/dev/null 2>&1; then py=python
  fi

  if [ -n "$py" ]; then
    SNIPPET="$snippet" SYNC_CMD="$cmd" HOOK_ACTION="$action" "$py" - "$file" <<'PY'
import json, os, re, sys, tempfile

path = sys.argv[1]
template = json.loads(os.environ["SNIPPET"])
removing = os.environ.get("HOOK_ACTION") == "remove"
# Managed entries end in a quoted (or bare) setup.sh path plus --sync; the
# Windows form only adds a quoted bash executable in front.
SYNC_RE = re.compile(r'([^"]*)/scripts/setup\.sh"?\s+--sync\s*$')
OLD_HOOK_RE = re.compile(r'/scripts/setup\.sh" --sync --hook=statuslines$')


def clone_of(command):
    """Clone path of a hook command this repo manages, else None."""
    if not isinstance(command, str):
        return None
    match = SYNC_RE.search(command)
    if not match:
        return None
    return match.group(1).strip() or None


def normalize(text):
    return text.replace("\\", "/").rstrip("/").lower()


def clone_exists(text):
    """False only when the clone is confidently gone (Git Bash spells vary)."""
    candidates = [text]
    drive = re.match(r"^([A-Za-z]):[/\\](.*)$", text)
    if drive:
        letter, rest = drive.group(1).lower(), drive.group(2)
        candidates.append("/%s/%s" % (letter, rest))
        candidates.append("/cygdrive/%s/%s" % (letter, rest))
    return any(os.path.isdir(candidate) for candidate in candidates)


def group_clone(group):
    """Clone a whole hook group belongs to, or None to leave the group alone."""
    if not isinstance(group, dict):
        return None
    if "hooks" not in group:
        return clone_of(group.get("command"))  # Cursor's flat entry
    entries = group.get("hooks")
    if not isinstance(entries, list) or not entries:
        return None
    clones = [
        clone_of(entry.get("command")) if isinstance(entry, dict) else None
        for entry in entries
    ]
    if not all(clones):
        return None
    return clones[0]


def give_up(reason, headline=None):
    """Leave the file as it is and say what to change in it by hand."""
    print(headline or "warn: %s %s; left alone" % (path, reason), file=sys.stderr)
    if removing:
        print("      delete the entry running %s from it by hand"
              % os.environ["SYNC_CMD"], file=sys.stderr)
    else:
        print("      add this to it by hand:\n%s" % os.environ["SNIPPET"], file=sys.stderr)
    sys.exit(0)


def retired(group):
    return (isinstance(group, dict) and "hooks" not in group
            and isinstance(group.get("command"), str)
            and OLD_HOOK_RE.search(group["command"]) is not None)


self_clone = clone_of(os.environ["SYNC_CMD"])
if self_clone is None:
    print("warn: unrecognized sync command; %s left alone" % path, file=sys.stderr)
    sys.exit(0)

data = {}
if os.path.islink(path) and not os.path.exists(path):
    give_up("is a dangling link")  # not a missing file: writing would replace the link
try:
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
except OSError as exc:
    give_up("", "warn: cannot read %s: %s" % (path, exc.strerror or exc))
except ValueError as exc:
    give_up("is not readable JSON (%s)" % exc)
if not isinstance(data, dict) or not isinstance(data.get("hooks", {}), dict):
    give_up("has no hooks object")
for event in template.get("hooks", {}):
    if not isinstance(data.get("hooks", {}).get(event, []), list):
        give_up("hooks.%s is not a list" % event)

before = json.dumps(data, sort_keys=True)
if removing and "hooks" not in data:
    # An uninstall has nothing to take out of a file that holds no hooks, and
    # inventing one -- or an empty event list -- would leave more behind than
    # it removed. This is also the file-does-not-exist case.
    print("ok: %s already up to date" % path)
    sys.exit(0)
hooks = data.setdefault("hooks", {})
if not removing:
    for key, value in template.items():
        if key != "hooks":
            data.setdefault(key, value)  # Cursor's "version": 1 in a new file
warnings = []
for event, groups in template.get("hooks", {}).items():
    if removing:
        groups = []  # every entry for this clone becomes surplus, and goes
        if event not in hooks:
            continue  # nothing of this clone's can be in an absent event
    existing = hooks.setdefault(event, [])
    mine, drop = [], []
    for index, group in enumerate(existing):
        if not removing and retired(group):
            drop.append(index)
            continue
        clone = group_clone(group)
        if clone is None:
            continue  # not ours: never touched
        if normalize(clone) == normalize(self_clone):
            mine.append(index)
        elif removing:
            continue  # another clone's entry is not this clone's to clean up
        elif not clone_exists(clone):
            drop.append(index)
        else:
            warnings.append(
                "warn: %s keeps a %s hook for another clone: %s" % (path, event, clone)
            )
    for index, group in zip(mine, groups):
        existing[index] = group  # in place, so ordering around it survives
    drop.extend(mine[len(groups):])  # duplicates for this clone
    for index in sorted(drop, reverse=True):
        del existing[index]
    for group in groups[len(mine):]:
        existing.append(group)

for warning in warnings:
    print(warning, file=sys.stderr)
if json.dumps(data, sort_keys=True) == before:
    print("ok: %s already up to date" % path)
    sys.exit(0)
directory = os.path.dirname(path) or "."
temp = None
try:
    os.makedirs(directory, exist_ok=True)
    handle_fd, temp = tempfile.mkstemp(dir=directory, prefix=".hooks-", suffix=".json")
    with os.fdopen(handle_fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    try:
        # mkstemp makes the temp file 0600; carry the real file's mode over so
        # replacing it does not quietly tighten or loosen its permissions.
        os.chmod(temp, os.stat(path).st_mode & 0o7777)
    except OSError:
        pass  # no file there yet: 0600 is the right default for a new config
    os.replace(temp, path)  # atomic: readers never see a half-written file
except OSError as exc:
    # An unwritable directory or file: say so in one line and carry on.
    if temp is not None and os.path.exists(temp):
        os.unlink(temp)
    print("warn: cannot write %s: %s" % (path, exc.strerror or exc), file=sys.stderr)
    sys.exit(0)
except BaseException:
    if temp is not None and os.path.exists(temp):
        os.unlink(temp)
    raise
print("updated: %s" % path)
PY
    return
  fi

  if command -v powershell >/dev/null 2>&1; then
    # The whole script runs as one block: -Command - reads stdin like a console,
    # where a multi-line statement waits for a blank line that never comes.
    SNIPPET="$snippet" SYNC_CMD="$cmd" HOOK_ACTION="$action" \
      HOOK_FILE="$(cygpath -w "$file" 2>/dev/null || echo "$file")" \
      powershell -NoProfile -Command '& ([scriptblock]::Create([Console]::In.ReadToEnd()))' <<'PS'
$Path = $env:HOOK_FILE
$tpl = $env:SNIPPET | ConvertFrom-Json
$removing = $env:HOOK_ACTION -eq 'remove'
$rx = [regex]'([^"]*)/scripts/setup\.sh"?\s+--sync\s*$'
function Get-Clone($command) {
  if (-not $command) { return $null }
  $m = $rx.Match([string]$command)
  if (-not $m.Success) { return $null }
  $p = $m.Groups[1].Value.Trim()
  if ($p -eq '') { return $null }
  return $p
}
function Get-Normalized($p) {
  if (-not $p) { return $null }
  return ($p -replace '\\', '/').TrimEnd('/').ToLowerInvariant()
}
function Get-GroupClone($g) {
  if ($g -isnot [pscustomobject]) { return $null }
  if (-not $g.PSObject.Properties['hooks']) { return Get-Clone $g.command }
  $entries = @($g.hooks)
  if ($entries.Count -eq 0) { return $null }
  $first = $null
  foreach ($h in $entries) {
    $c = Get-Clone $h.command
    if (-not $c) { return $null }
    if (-not $first) { $first = $c }
  }
  return $first
}
$selfClone = Get-Normalized (Get-Clone $env:SYNC_CMD)
if (-not $selfClone) {
  [Console]::Error.WriteLine("warn: unrecognized sync command; $Path left alone")
  exit 0
}
function Stop-Unusable($reason, $Headline) {
  if (-not $Headline) { $Headline = "warn: $Path $reason; left alone" }
  [Console]::Error.WriteLine($Headline)
  if ($removing) {
    [Console]::Error.WriteLine("      delete the entry running $($env:SYNC_CMD) from it by hand")
  } else {
    [Console]::Error.WriteLine("      add this to it by hand:`n$($env:SNIPPET)")
  }
  exit 0
}
$data = [pscustomobject]@{}
$item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
if ($item -and $item.LinkType -and -not (Test-Path -LiteralPath $Path)) { Stop-Unusable 'is a dangling link' }
try {
  if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -gt 0) {
    $data = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  }
} catch [System.IO.IOException], [System.UnauthorizedAccessException] {
  Stop-Unusable 'is not readable JSON' -Headline "warn: cannot read ${Path}: $($_.Exception.Message)"
} catch {
  Stop-Unusable 'is not readable JSON'
}
if ($data -isnot [pscustomobject]) { Stop-Unusable 'has no hooks object' }
if ($data.PSObject.Properties['hooks']) {
  if ($data.hooks -isnot [pscustomobject]) { Stop-Unusable 'has no hooks object' }
  foreach ($ev in $tpl.hooks.PSObject.Properties) {
    $p = $data.hooks.PSObject.Properties[$ev.Name]
    if ($p -and $p.Value -isnot [array]) { Stop-Unusable "hooks.$($ev.Name) is not a list" }
  }
}
if ($removing -and -not $data.PSObject.Properties['hooks']) {
  # Nothing of this clone's can be in a file with no hooks, and writing one
  # would leave more behind than the uninstall removed.
  Write-Output "ok: $Path already up to date"
  exit 0
}
if (-not $data.PSObject.Properties['hooks']) { $data | Add-Member hooks ([pscustomobject]@{}) }
$before = $data | ConvertTo-Json -Depth 20 -Compress
if (-not $removing) {
  foreach ($p in $tpl.PSObject.Properties) {
    if ($p.Name -ne 'hooks' -and -not $data.PSObject.Properties[$p.Name]) { $data | Add-Member $p.Name $p.Value }
  }
}
foreach ($ev in $tpl.hooks.PSObject.Properties) {
  if (-not $data.hooks.PSObject.Properties[$ev.Name]) {
    if ($removing) { continue }
    $data.hooks | Add-Member $ev.Name @()
  }
  # @() around the whole if: assigning an if's output unrolls a one-entry
  # array to a bare object, whose .Count Windows PowerShell leaves empty.
  $groups = @(if (-not $removing) { $ev.Value })
  $existing = [System.Collections.ArrayList]@($data.hooks.($ev.Name))
  $mine = @()
  $drop = @()
  for ($i = 0; $i -lt $existing.Count; $i++) {
    $g = $existing[$i]
    if (-not $removing -and $g -is [pscustomobject] -and -not $g.PSObject.Properties['hooks'] -and
        $g.command -is [string] -and $g.command -match '/scripts/setup\.sh" --sync --hook=statuslines$') {
      $drop += $i
      continue
    }
    $clone = Get-GroupClone $g
    if (-not $clone) { continue }
    if ((Get-Normalized $clone) -eq $selfClone) { $mine += $i }
    elseif ($removing) { continue }
    elseif (-not (Test-Path -LiteralPath $clone -PathType Container)) { $drop += $i }
    else { [Console]::Error.WriteLine("warn: ${Path} keeps a $($ev.Name) hook for another clone: $clone") }
  }
  for ($k = 0; $k -lt $mine.Count; $k++) {
    if ($k -lt $groups.Count) { $existing[$mine[$k]] = $groups[$k] } else { $drop += $mine[$k] }
  }
  foreach ($i in @($drop | Sort-Object -Descending)) { $existing.RemoveAt($i) }
  for ($k = $mine.Count; $k -lt $groups.Count; $k++) { $existing.Add($groups[$k]) | Out-Null }
  $data.hooks.($ev.Name) = @($existing)
}
if (($data | ConvertTo-Json -Depth 20 -Compress) -eq $before) {
  Write-Output "ok: $Path already up to date"
  exit 0
}
$temp = "$Path.new"
try {
  New-Item -ItemType Directory -Force -ErrorAction Stop (Split-Path $Path) | Out-Null
  # WriteAllText with an explicit BOM-less UTF-8, because Set-Content -Encoding
  # UTF8 on Windows PowerShell prepends a byte-order mark that strict JSON
  # readers (Node's JSON.parse among them) refuse.
  $json = ($data | ConvertTo-Json -Depth 20) + "`n"
  [System.IO.File]::WriteAllText($temp, $json, (New-Object System.Text.UTF8Encoding $false))
  Move-Item -Force -ErrorAction Stop -LiteralPath $temp -Destination $Path
} catch {
  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $temp
  [Console]::Error.WriteLine("warn: cannot write ${Path}: $($_.Exception.Message)")
  exit 0
}
Write-Output "updated: $Path"
PS
    return
  fi

  if [ "$action" = remove ]; then
    echo "warn: no python3, python, or powershell found; delete the entry running" >&2
    echo "        $cmd" >&2
    echo "      from $file by hand" >&2
    return
  fi
  echo "warn: no python3, python, or powershell found; add this to $file by hand:" >&2
  echo "$snippet" >&2
  echo >&2
}

# apply_hooks [ACTION]: merge (or, with "remove", strip) this repo's hook
# entries in every harness whose config directory exists.
apply_hooks() {
  local action="${1:-merge}"
  if [ -d "$HOME/.claude" ]; then
    merge_hooks "$HOME/.claude/settings.json" "$REPO/hooks/claude.json" "$action"
  fi
  if [ -d "$HOME/.codex" ]; then
    merge_hooks "$HOME/.codex/hooks.json" "$REPO/hooks/codex.json" "$action"
  elif [ "$action" = merge ]; then
    echo "skip: ~/.codex not found (Codex)"
  fi
  if [ -d "$HOME/.cursor" ]; then
    merge_hooks "$HOME/.cursor/hooks.json" "$REPO/hooks/cursor.json" "$action"
  elif [ "$action" = merge ]; then
    echo "skip: ~/.cursor not found (Cursor)"
  fi
}

# json_statusline FILE HARNESS [ACTION]: point the statusLine in FILE (Claude's
# settings.json or Cursor's cli-config.json) at this clone's
# statusline/statusline.py rendering for HARNESS, or with "remove" take it out
# if it is this clone's. The statusLine is replaced only when it is missing, a
# statusline.py render from any clone, or the legacy
# ~/.claude/statusline-command.sh wrapper; any other is custom and needs
# --force. Every other key is kept. Also drops the SessionStart entries the
# retired statuslines repo installed (`setup.sh" --sync --hook=statuslines`),
# which would otherwise point the statusLine back at that old clone. FILE is
# replaced atomically, and only when its content changes; one that is not
# usable JSON is left alone and the entry printed for manual paste.
json_statusline() {
  local repo="$REPO"
  is_windows && repo="$(cygpath -m "$REPO")"
  STATUS_CMD="python3 \"$repo/statusline/statusline.py\" render $2" \
    SET_STATUSLINE="$([ "${3:-merge}" = merge ] && echo 1)" FORCE="$FORCE" \
    python3 - "$1" <<'PY'
import json, os, re, sys, tempfile

path, status_cmd = sys.argv[1], os.environ["STATUS_CMD"]
setting = os.environ["SET_STATUSLINE"] == "1"
OLD_HOOK_RE = re.compile(r'/scripts/setup\.sh" --sync --hook=statuslines$')
OURS_RE = re.compile(r'^python3 "(.+)/statusline\.py" render (?:claude|cursor)$')
LEGACY_RE = re.compile(
    r"""^(?:(?:ba)?sh\s+)?(["']?)(?:~|\$HOME|\$\{HOME\}|/[^"']*)?"""
    r"""/\.claude/statusline-command\.sh\1\s*$"""
)

def give_up(reason, headline=None):
    """Leave the file as it is; when setting, print the entry to paste."""
    print(headline or "warn: %s %s; statusLine left alone" % (path, reason), file=sys.stderr)
    if setting:
        print("      add this to it by hand: %s" % json.dumps(
            {"statusLine": {"type": "command", "command": status_cmd}}), file=sys.stderr)
    sys.exit(1)


if os.path.islink(path) and not os.path.exists(path):
    give_up("is a dangling link")  # not a missing file: writing would replace the link
try:
    with open(path, encoding="utf-8") as handle:
        original = handle.read()
except FileNotFoundError:
    original = None
except OSError as exc:
    give_up("", "warn: cannot read %s: %s" % (path, exc.strerror or exc))
if original is None and not setting:
    sys.exit(0)


try:
    data = json.loads(original) if original else {}  # an empty file counts as missing
except ValueError as exc:
    give_up("is not valid JSON (%s)" % exc)
hooks = data.get("hooks", {}) if isinstance(data, dict) else None
if not isinstance(hooks, dict) or not all(isinstance(g, list) for g in hooks.values()):
    # The hook merge leaves such a file alone too; so does this.
    give_up("has no usable hooks object" if isinstance(data, dict) else "is not a JSON object")
before = json.dumps(data, sort_keys=True)

for event, groups in hooks.items():
    kept = []
    for group in groups:
        entries = group.get("hooks") if isinstance(group, dict) else None
        if isinstance(entries, list):
            left = [e for e in entries if not (
                isinstance(e, dict) and isinstance(e.get("command"), str)
                and OLD_HOOK_RE.search(e["command"]))]
            if not left and entries:
                continue
            group["hooks"] = left
        kept.append(group)
    hooks[event] = kept

current = data.get("statusLine")
command = current.get("command") if isinstance(current, dict) else None
if not setting:
    if command == status_cmd:
        del data["statusLine"]
elif (current is None or os.environ["FORCE"] == "1"
      or (isinstance(command, str) and (OURS_RE.match(command) or LEGACY_RE.match(command)))):
    line = dict(current) if isinstance(current, dict) else {}
    line.update(type="command", command=status_cmd)
    data["statusLine"] = line
else:
    print("warn: %s has a custom statusLine; left alone (setup.sh --force replaces it)"
          % path, file=sys.stderr)

if original is not None and json.dumps(data, sort_keys=True) == before:
    sys.exit(0)
temp = None
try:
    fd, temp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".statusline-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    if original is not None:
        os.chmod(temp, os.stat(path).st_mode & 0o7777)
    os.replace(temp, path)
except OSError as exc:
    if temp is not None and os.path.exists(temp):
        os.unlink(temp)
    print("warn: cannot write %s: %s" % (path, exc.strerror or exc), file=sys.stderr)
    sys.exit(1)
except BaseException:
    if temp is not None and os.path.exists(temp):
        os.unlink(temp)
    raise
print("updated: %s" % path)
PY
}

# apply_statusline [ACTION]: set up (or, with "remove", take out) the shared
# statusline in Claude, Cursor and Codex. It needs python3 >= 3.11 for tomllib; without
# it the statusline is skipped with a warning and the rest of the run goes on.
apply_statusline() {
  local action="${1:-merge}"
  if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' >/dev/null 2>&1; then
    [ "$action" = merge ] && echo "warn: python3 >= 3.11 not found; statusline skipped" >&2
    return 0
  fi
  if [ -d "$HOME/.claude" ]; then
    json_statusline "$HOME/.claude/settings.json" claude "$action"
  fi
  if [ -d "$HOME/.cursor" ]; then
    json_statusline "$HOME/.cursor/cli-config.json" cursor "$action"
  fi
  if [ -d "$HOME/.codex" ]; then
    # The retired statuslines repo's hook lives here too; Codex keeps its
    # status line in config.toml, so setting one is skipped for this file.
    json_statusline "$HOME/.codex/hooks.json" claude remove
    if [ "$action" = merge ]; then
      python3 "$REPO/statusline/statusline.py" --config "$REPO/statusline/config.json" \
        sync codex --target "$HOME/.codex/config.toml" ||
        echo "warn: Codex status line not synced" >&2
    else
      echo "kept: [tui].status_line in $HOME/.codex/config.toml"
    fi
  fi
}

release_lock() {
  [ "$LOCK_HELD" = 1 ] || return 0
  LOCK_HELD=0
  rmdir "$LOCK" 2>/dev/null || true
  return 0
}

hold_lock() {
  LOCK_HELD=1
  trap 'release_lock; exit 1' HUP INT TERM
  # Quoted so ShellCheck reads the handler as code and sees release_lock used
  # (an unquoted function name reads as a dead store: SC2317, an error in CI).
  trap 'release_lock' EXIT
}

# One run at a time: Claude, Codex, Cursor and Pi can all start a session at once.
acquire_lock() {
  if [ "${AGENTS_SYNC_REEXEC:-}" = 1 ] && [ -d "$LOCK" ]; then
    hold_lock  # inherited across exec from the run that pulled; still ours
    return 0
  fi
  local waited=0 reclaimed=0
  while :; do
    if mkdir "$LOCK" 2>/dev/null; then
      hold_lock
      return 0
    fi
    # A lock left behind by an interrupted run goes stale after ~10 minutes.
    if [ "$reclaimed" = 0 ] &&
      [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
      reclaimed=1
      echo "warn: reclaiming stale lock $LOCK" >&2
      rmdir "$LOCK" 2>/dev/null || true
      continue
    fi
    if [ "$MODE" != --sync ] && [ "$waited" -lt 5 ]; then
      waited=$((waited + 1))
      sleep 1
      continue
    fi
    [ "$MODE" != --sync ] && echo "warn: another run holds $LOCK; nothing done" >&2
    return 1
  done
}

# The shell the hooks invoke this script with, and the one every hand-off here
# uses, so a re-exec or a bootstrap lands on the same interpreter as a session.
interpreter() {
  if is_windows; then
    command -v bash || echo bash
  else
    command -v sh || echo sh
  fi
}

# Re-run this script once from the freshly pulled copy, on the interpreter the
# hook uses. AGENTS_SYNC_REEXEC stops the new copy from pulling again, so this
# cannot loop. The lock stays held across exec; the new run adopts it.
reexec() {
  export AGENTS_SYNC_REEXEC=1
  exec "$(interpreter)" "$REPO/scripts/setup.sh" "$@"
}

# True unless DIR is confidently not a clone of this repo. The repo layout has
# to be there, and git must not report a different work-tree root -- a copied
# setup.sh sitting inside some other project. When git cannot answer at all
# (absent, or the directory has no history) the layout decides on its own:
# cloning over a working install because git broke would be the worse mistake.
looks_like_clone() {
  local top
  [ -n "$1" ] || return 1
  [ -d "$1" ] || return 1
  [ -f "$1/scripts/setup.sh" ] || return 1
  [ -d "$1/hooks" ] || return 1
  top="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || return 0
  [ -n "$top" ] || return 0
  [ "$(resolve "$top")" = "$(resolve "$1")" ]
}

# Nothing to wire up yet: the script arrived on its own, piped from curl or
# copied somewhere by hand. Get a real clone and hand the whole run to its copy
# of this script, so the hook it installs names a path that stays valid.
bootstrap() {
  local clone
  if [ "${AGENTS_BOOTSTRAPPED:-}" = 1 ]; then
    echo "error: bootstrap did not produce a usable clone" >&2
    return 1
  fi
  clone="${AGENTS_HOME:-$HOME/source/agents}"
  if looks_like_clone "$clone"; then
    echo "using clone: $clone"
  elif [ -e "$clone" ] || [ -L "$clone" ]; then
    echo "error: $clone exists and is not a clone of $REPO_URL; move it or set" >&2
    echo "       AGENTS_HOME to another path" >&2
    return 1
  elif [ "$MODE" = --uninstall ]; then
    echo "error: no clone at $clone to uninstall" >&2
    return 1
  else
    echo "cloning $REPO_URL into $clone"
    mkdir -p "$(dirname "$clone")" || return 1
    git clone "$REPO_URL" "$clone" || { echo "error: git clone failed" >&2; return 1; }
    looks_like_clone "$clone" || { echo "error: $clone is not usable" >&2; return 1; }
  fi
  export AGENTS_BOOTSTRAPPED=1
  exec "$(interpreter)" "$clone/scripts/setup.sh" "$@"
}

# Fast-forward the clone, then hand off to the new script if HEAD moved: bash
# reads a script as it runs it, so continuing in this process could execute a
# mix of the old and new file.
pull() {
  [ "${AGENTS_SYNC_REEXEC:-}" = 1 ] && return 0
  # Throttle: a burst of session starts should hit the network once. Spelled as
  # "not older than a minute" rather than -mmin -1 because BSD find (macOS)
  # rounds the age up to the next whole minute, which makes -mmin -1 false for
  # everything but a stamp written this very second.
  if [ -n "$(find "$STAMP" -maxdepth 0 ! -mmin +1 2>/dev/null)" ]; then
    return 0
  fi
  local before after
  before="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  GIT_TERMINAL_PROMPT=0 git -C "$REPO" pull --ff-only --quiet >/dev/null 2>&1 || true
  touch "$STAMP" 2>/dev/null || true
  after="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  [ "$before" != unknown ] || return 0
  [ "$after" != unknown ] || return 0
  [ "$before" != "$after" ] || return 0
  reexec "$@"
}

# Everything setup and --sync both do; --sync just runs it without the chatter.
reconcile() {
  echo "repo: $REPO"
  link_skills
  link_claude_skills
  link_pi
  link_mods
  link_agents_md
  link_commands
  apply_hooks merge
  apply_statusline merge
  return 0
}

# Undo what this clone installed, and only that: a link goes when the target it
# records is inside this clone -- or, in Claude's directory, is an
# ~/.agents/skills entry that is itself one of those links. Real directories,
# links pointing anywhere else, and hooks this repo did not write all stay.
uninstall() {
  local root="$HOME/.claude/skills" repo_skills agents pi d name
  repo_skills="$(unix_path "$REPO/skills")"
  agents="$(unix_path "$AGENTS_SKILLS")"
  echo "repo: $REPO"
  if [ "$(link_target "$root")" = "$agents" ]; then
    # The pre-split whole-directory link; unlinking leaves the shared dir whole.
    unlink_dir "$root" && echo "removed: $root"
  elif [ -d "$root" ]; then
    # Claude's links go first: each names an ~/.agents/skills entry that the
    # next loop deletes, and a vanished entry can no longer vouch for them.
    for d in "$root"/*; do
      name="$(basename "$d")"
      [ "$(link_target "$d")" = "$agents/$name" ] || continue
      case "$(link_target "$AGENTS_SKILLS/$name")" in
        "$repo_skills"/*) ;;
        *) continue ;;
      esac
      unlink_dir "$d" && echo "removed: $d"
    done
  fi
  for d in "$AGENTS_SKILLS"/*; do
    case "$(link_target "$d")" in
      "$repo_skills"/*) unlink_dir "$d" && echo "removed: $d" ;;
    esac
  done
  # Every link into this clone's mods/. The renderer cache is shared by every
  # clone, so it goes only when no other clone's mermaid-render link is left.
  for d in "$root"/*; do
    case "$(link_target "$d")" in
      "$(unix_path "$REPO/mods")"/*) unlink_dir "$d" && echo "removed: $d" ;;
    esac
  done
  [ -e "$root/mermaid-render" ] || remove_mermaid_renderers
  # Every link into this clone's pi/, including one left by a renamed extension.
  for pi in "$HOME/.pi/agent/extensions"/*; do
    case "$(link_target "$pi")" in
      "$(unix_path "$REPO/pi")"/*) unlink_dir "$pi" && echo "removed: $pi" ;;
    esac
  done
  unlink_agents_md
  remove_commands all
  apply_hooks remove
  apply_statusline remove
  echo "kept: the clone at $REPO, and every local skill and hook"
  return 0
}

next_steps() {
  cat <<MSG

Next steps:
  - Codex: open Codex and run /hooks to review and trust the new SessionStart hook.
  - Machine-local shared skills: plain directories in $AGENTS_SKILLS.
  - Harness-local skills: plain directories in each harness's own skills directory.
MSG
}

main() {
  MODE="${1:-setup}"
  case "$MODE" in
    setup | --sync | --uninstall) ;;
    --force) MODE=setup; FORCE=1 ;;
    *) echo "usage: $0 [--force | --sync | --uninstall]" >&2; exit 2 ;;
  esac

  # A script from before the rename execs this one with its own flag set and
  # the lock held; that hand-off is the same as ours.
  if [ "${SKILLS_SYNC_REEXEC:-}" = 1 ]; then export AGENTS_SYNC_REEXEC=1; fi
  looks_like_clone "$REPO" || bootstrap "$@" || exit 1
  LOCK="$REPO/.sync.lock"
  STAMP="$REPO/.sync-stamp"
  if ! acquire_lock; then
    # --sync runs at session start and must never fail one.
    [ "$MODE" = --sync ] && exit 0
    exit 1
  fi

  case "$MODE" in
    --uninstall) uninstall ;;
    --sync) pull "$MODE"; reconcile >/dev/null ;;
    setup) pull "$@"; reconcile; install_mermaid_renderers; next_steps ;;
  esac
  # Returning rather than exiting: `main "$@"` is the last line, so the status
  # is the same, and an `exit` here would make ShellCheck read everything the
  # EXIT trap runs as dead code (SC2317, an error in CI).
  return 0
}

main "$@"

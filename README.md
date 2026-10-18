# agents

The one synced source for what coding agents read from the home directory:
portable skills, the shared `global/AGENTS.md` instructions, the session-start hooks
that keep both updated, and a shared [statusline](statusline/README.md). Setup
installs them for Claude Code, Codex, Cursor, and Pi on Linux, macOS, and
Windows (Git Bash). One clone per machine is the source of truth. Machine-local
skills can live alongside its links.

## Layout

```
AGENTS.md                contributor instructions for this repository only
global/AGENTS.md         shared instructions, linked into ~/.agents and each harness
skills/<name>/SKILL.md   one skill per directory (see skills/agnostic-skill for conventions)
hooks/claude.json        SessionStart entry merged into ~/.claude/settings.json
hooks/codex.json         SessionStart entry merged into ~/.codex/hooks.json
hooks/cursor.json        sessionStart entry merged into ~/.cursor/hooks.json
pi/<name>/               Pi extensions (agents-autopull, ask-user-question, statusline), linked into ~/.pi/agent/extensions
statusline/              statusline renderer and its shared config.json
scripts/setup.sh         one-time setup, and the --sync command the hooks run
```

## Setup and updating

One line, on Linux, macOS, or Windows in Git Bash:

```sh
curl -fsSL https://raw.githubusercontent.com/Harrison-Blair/agents/main/scripts/setup.sh | sh
```

Run with no clone around it, the script clones the repo to `~/source/agents`
(set `AGENTS_HOME` for another path) and hands the rest of the run to that
copy, so the hook it installs names a path that keeps working. It refuses to
touch a directory that is already there and is not this repo.

To choose the location yourself, clone anywhere and run setup from it:

```sh
git clone https://github.com/Harrison-Blair/agents.git ~/source/agents
~/source/agents/scripts/setup.sh
```

On Windows the directory links are created as junctions, so no admin rights are
needed.

That run installs one session-start hook per harness (Pi gets an extension
instead), and the hook runs `scripts/setup.sh --sync` from this clone at each
session start. Sync does everything setup does, so later changes -- new skills,
an edited `global/AGENTS.md` or hook template -- arrive on their own; setup is only
needed again after moving or re-cloning the repo. To sync by hand:

```sh
~/source/agents/scripts/setup.sh --sync
```

Both modes do the following, skipping any harness whose config directory is
absent:

- Fast-forwards the clone. If the pull moved `HEAD`, the script re-executes
  itself once so the rest of the run comes from the new copy rather than a
  half-read old one. A failed pull still links the current checkout and never
  fails a session.
- Links each `skills/<name>` into `~/.agents/skills/<name>`. Codex, Cursor, and
  Pi read that directory directly.
- Keeps `~/.claude/skills` as a real directory and links each shared skill into
  it from `~/.agents/skills`, including machine-local shared skills. Existing
  local folders are preserved. An older whole-directory link to
  `~/.agents/skills` is automatically replaced with individual links without
  changing the shared contents. Unrelated directory links are left untouched
  with a warning, except a dangling one in a skill's place, which a clone that
  moved or was deleted left behind: that is replaced and reported as `relinked`.
- Links each Pi extension in `pi/` into `~/.pi/agent/extensions/<name>`, and
  prunes a link there that points into this clone's `pi/` at something gone,
  such as an extension that was renamed.
- Links `global/AGENTS.md` into `~/.agents` and each harness; see
  [AGENTS.md](#agentsmd).
- Writes a small wrapper into `~/.local/bin` for every command a skill ships in
  `skills/<name>/bin/`, so agents in any harness run it by its bare name.
  A file there that is not one of these wrappers, or a
  wrapper for another clone that still exists, is left alone with a warning;
  wrappers for commands removed from this clone are deleted. Setup warns when
  `~/.local/bin` is not on `PATH`.
- Merges one session-start hook into `~/.claude/settings.json`,
  `~/.codex/hooks.json`, and `~/.cursor/hooks.json`, next to whatever hooks are
  already there. Cursor's file uses its own flat shape (`version: 1`, a
  `sessionStart` list of entries with `command` and `timeout`) and is created
  when missing. The entries this repo manages are the ones running
  `scripts/setup.sh --sync`: the entry for this clone is rewritten in place when
  the template changes, an entry for a clone that no longer exists on disk is
  dropped, and an entry for a second clone that does exist is kept with a
  warning. Every other hook and key is left alone, and the file is replaced
  atomically with its mode kept. A file that is not usable JSON of the expected
  shape is left exactly as it is and the entry is printed for you to add by
  hand. The merge uses `python3`, `python`, or `powershell`; if none is found,
  the entry is printed for you to paste.
- Prunes the links it made for skills that are gone: broken symlinks on
  Linux/macOS, and on Windows junctions that point into this clone's `skills/`
  (or, in Claude's directory, into `~/.agents/skills`) at something no longer
  there. A junction pointing anywhere else is left alone, and removal is
  `rmdir` without `/S`, which unlinks the junction and never its target.
- Sets up the [statusline](#statusline).

Setup reports each step; sync is quiet on stdout and prints only warnings. One
run happens at a time: each holds `.sync.lock` in the clone, a directory
reclaimed only once it is older than ten minutes. A sync that finds the lock
held exits straight away without doing anything, so it never delays a session;
a setup run waits a few seconds and then says so. Pulls are throttled with
`.sync-stamp` to about one a minute, so a burst of session starts fetches once.

One manual step remains: **Codex** does not run new hooks until you trust
them. Open Codex and run `/hooks` to review the entry.

## AGENTS.md

`global/AGENTS.md` holds the global instructions distributed to each harness.
The root `AGENTS.md` is the contributor guide for this repository and is never
installed as global instructions.
Setup and sync link it in two steps, so one shared entry decides what all
harnesses see:

| Path | Links to | When |
| --- | --- | --- |
| `~/.agents/AGENTS.md` | `<clone>/global/AGENTS.md` | always |
| `~/.claude/CLAUDE.md` | `~/.agents/AGENTS.md` | `~/.claude` exists |
| `~/.codex/AGENTS.md` | `~/.agents/AGENTS.md` | `~/.codex` exists |
| `~/.pi/agent/AGENTS.md` | `~/.agents/AGENTS.md` | `~/.pi/agent` exists |

Cursor has no file for global rules; its User Rules live in its own settings,
so it gets no link here.

The harness files are linked only while `~/.agents/AGENTS.md` belongs to this
clone: a link into it, or a managed copy naming it. When it is anything else --
a real file, a link elsewhere, a directory, another clone's copy -- setup warns
once and links none of the harness files, so it never spreads content it does
not own. For each path, a link that already resolves to its target stays, and a
dangling one is replaced and reported as `relinked`. A link to anything else and
a real file without the managed marker are left alone with a warning; user
content is never overwritten, and `--force` does not change that.

On Windows setup asks for a real symlink. Without Developer Mode or admin rights
it cannot make one, so it writes a copy instead and warns. The copy's first line
is the managed marker, naming the clone it came from:

```
<!-- Managed by the agents repository: <clone>/global/AGENTS.md. Edit it there; this copy is rewritten at sync. -->
```

Sync rewrites a copy naming this clone when the content changes (warning only
when it writes), and replaces it with a link once a link can be made. A copy
naming a clone that no longer exists is treated the same way; one naming
another clone that still exists is left with a warning. Edit `global/AGENTS.md`
in the clone, never an installed copy.

Existing installations migrate automatically during setup or sync: links to
this clone's former root `AGENTS.md` change to the new source, and managed
copies with the old marker are recognized and refreshed. Unrelated files and
other live clones' installations remain untouched. Uninstall recognizes both
old and new installations. After an update, run `scripts/setup.sh --sync`
before starting agents, then restart existing sessions. Until migration runs,
a legacy link still reads the root file, which now contains project guidance.

## Statusline

Setup and sync also point Claude Code, Cursor, Codex, and Pi at `statusline/`, run straight from
the clone, so a pushed change to its `config.json` or `statusline.py` arrives
on its own. This part needs Python 3.11 or newer (`python3`); without it the
statusline is skipped with a warning and everything else still runs.

- Sets Claude's `statusLine` in `~/.claude/settings.json` to
  `python3 "<clone>/statusline/statusline.py" render claude`.
- Sets Cursor's `statusLine` in `~/.cursor/cli-config.json` to
  `python3 "<clone>/statusline/statusline.py" render cursor`, keeping every
  other key, or creates the file with only that entry. `render cursor` takes
  the project label from the current directory (`workspace.current_dir`, else
  `cwd`), because Cursor's `workspace.project_dir` names its transcripts
  directory. Restart Cursor to pick up a changed `cli-config.json`.
- Runs `statusline.py sync codex`, which writes `[tui].status_line` in
  `~/.codex/config.toml` and leaves the rest of that file alone.
- Links the `pi/statusline` extension, which replaces Pi's footer and reads
  `config.json` from the clone it links to. It needs no Python.
- Drops the `SessionStart` entries installed by the retired `statuslines` repo
  (`setup.sh" --sync --hook=statuslines`) from both hook files, so a machine
  that used it moves over at its next session start.

Claude's and Cursor's `statusLine` is replaced only when it is missing, already
a `statusline.py ... render` from any clone (so a moved clone is picked up), or
the legacy `~/.claude/statusline-command.sh` wrapper. Any other statusLine is
custom: it is left alone with a warning. A file that is not valid JSON is left
alone too, and the entry is printed for you to add; an empty file counts as
missing. A dangling link or an unreadable file is left alone too, with the entry
printed. To replace a custom one
anyway:

```sh
~/source/agents/scripts/setup.sh --force
```

`--force` is for setup only; a sync never overwrites a custom statusLine.
Codex's `[tui].status_line` is always managed.

## Uninstalling

```sh
~/source/agents/scripts/setup.sh --uninstall
```

This reverses what setup installed for that clone and prints each removal: the
skill links in `~/.agents/skills` that point into it, the links in
`~/.claude/skills` that point at those, every Pi extension link into its `pi/`,
the `AGENTS.md` links and managed copies (the harness files only while
`~/.agents/AGENTS.md` is this clone's), the command wrappers in `~/.local/bin`
that run its skills' commands, the hook entries running that clone's `--sync`,
and Claude's and Cursor's `statusLine` when it runs that clone's statusline.
Codex's `[tui].status_line` is kept. It never removes a real directory, a
link pointing anywhere else, a hook this repo did not write, or an entry for a
different clone -- including a dead one, which belongs to whoever owns it. The
clone itself stays; delete it afterwards if you want it gone.

## Machine-local skills

Choose the location based on what you want to share. Each skill is a directory
containing `SKILL.md`.

| Purpose | Location | Synced by this repo? |
| --- | --- | --- |
| Shared collection across machines | `skills/<name>/` in this clone | Yes, after commit and push |
| Shared across harnesses on this machine | `~/.agents/skills/<name>/` as a plain directory | No |
| Local extras for Claude Code | `~/.claude/skills/<name>/` as a plain directory | No |
| Local extras for Codex | `~/.codex/skills/<name>/` | No |
| Local extras for Cursor | `~/.cursor/skills/<name>/` | No |
| Local extras for Pi | `~/.pi/agent/skills/<name>/` | No |

Setup and sync preserve ordinary local folders and unrelated links. If a shared
skill's name conflicts with an existing local entry, they warn and skip that
link; they do not overwrite the local entry. Use distinct names to keep both.
Shared machine-local skills added to `~/.agents/skills` become linked into
Claude's directory on the next setup or sync.

These locations separate storage, not visibility: [Cursor reads
`~/.agents/skills` and also discovers Claude and Codex
skills](https://cursor.com/docs/skills). This setup leaves that compatibility
behavior unchanged.

Sync only pulls repo changes; it never imports installed skills, commits, or
pushes local edits. Editing a linked repo skill changes the file in this clone,
so commit and push it to distribute the edit. To share a standalone local skill
between machines, move its contents into `skills/<name>/` in the clone, remove
the old local entry so setup can create its link, then commit and push.

## Adding hooks later

Add entries to `hooks/claude.json`, `hooks/codex.json`, or `hooks/cursor.json` and push. Every machine
picks them up at its next session start, because sync re-merges the templates
and rewrites the entry it manages for that clone.

## Moving from the skills repo

This repository used to be `Harrison-Blair/skills`, cloned to
`~/source/skills`. To move a machine over:

1. Move the clone: `mv ~/source/skills ~/source/agents`, and point its remote
   at `https://github.com/Harrison-Blair/agents.git` (the old URL redirects).
2. Rerun setup from the new path: `~/source/agents/scripts/setup.sh`.

The hook entries follow on their own: the old path no longer exists, so its
entries are dropped and the new clone's are added. Command wrappers written
with the old `# skills repo command:` marker are recognised and rewritten. The
dangling skill and Pi links left by the old path are replaced. If
`~/.agents/AGENTS.md` is a link you made by hand, remove it first so setup can
link it into the clone. Restart Cursor to pick up its new `cli-config.json`.

## Publishing edits

Commit and push from the clone. Other machines pick the change up at their next
session start.

## Testing setup changes

Install the CI-only parsers and reference validator, then run the checks locally:

```sh
python3 -m pip install -r requirements-ci.txt
python3 -B -m unittest discover -s tests -v
python3 scripts/validate_repo.py
shellcheck scripts/setup.sh
```

Tests use temporary fixtures and do not change your installed skills or hooks.
They cover setup, sync, hook merging for all three hook files, `AGENTS.md`
linking and its ownership rules, the post-pull re-exec, the sync lock,
bootstrap, uninstall, migration, conflicts, pruning, the statusline install,
its renderer and Codex adapter, metadata, and Markdown links. The Windows job
runs the junction, `AGENTS.md` symlink and copy, and PowerShell merge tests
with Git for Windows Bash; native Windows testing is required before a junction
or symlink change -- pruning included -- is considered verified.

# agents

The one synced source for what coding agents read from the home directory:
portable skills, the shared `global/AGENTS.md` instructions, the session-start hooks
that keep both updated, and a shared [statusline](statusline/README.md). Setup
installs them for Claude Code, Codex, Cursor, and Pi on Linux, macOS, and
Windows (Git Bash). One clone per machine is the source of truth. Machine-local
skills can live alongside its links.

The folder `plugins/hb` is a plugin named `hb`, in a catalog named
`harrison-blair`. Claude Code gets the skills, the `mermaid-render` mod, and
the Urple color theme from it, and a machine with no clone can install it on
its own; see [The hb plugin](#the-hb-plugin).

## Layout

```
AGENTS.md                contributor instructions for this repository only
global/AGENTS.md         shared instructions, linked into ~/.agents and each harness
.claude-plugin/          the Claude Code catalog (marketplace.json)
.agents/plugins/         the Codex catalog (marketplace.json)
plugins/hb/              the plugin hb; no other plugin is in this folder
  plugin.json            manifest of the plugin hb
  .claude-plugin/        the same manifest for Claude Code (plugin.json)
  skills/<name>/SKILL.md one skill per directory (see plugins/hb/skills/agnostic-skill for conventions)
  themes/urple.json      the Claude Code color theme Urple, part of the plugin
hooks/claude.json        SessionStart entry merged into ~/.claude/settings.json
hooks/codex.json         SessionStart entry merged into ~/.codex/hooks.json
hooks/cursor.json        sessionStart entry merged into ~/.cursor/hooks.json
pi/<name>/               Pi extensions (agents-autopull, ask-user-question, statusline), linked into ~/.pi/agent/extensions
mods/<name>/             Claude Code mods (mermaid-render), each one a plugin in the Claude Code catalog
statusline/              statusline renderer and its shared config.json
scripts/setup.sh         one-time setup, and the --sync command the hooks run
```

## The hb plugin

The plugin `hb` is the folder `plugins/hb`. The catalog `harrison-blair` lists
it for Claude Code and for Codex.

| Harness | What the plugin gives |
| --- | --- |
| Claude Code | The 8 skills in `plugins/hb/skills/`, the color theme [Urple](#theme), and its dependency `mermaid-render`, the mod that draws [Mermaid diagrams](#mermaid-diagrams). |
| Codex | The skills. Codex shows 7 of them to the model; `hb:orchestrate` is not one of them. |

A skill from the plugin has the prefix `hb:`, for example `hb:interrogate`.
Codex gives the same prefix to a skill that it reads from a link in
`~/.agents/skills` into the clone, because the folder `plugins/hb` of the
clone has the manifest `.claude-plugin/plugin.json`: codex-cli 0.170.0 lists
`hb:interrogate` there. Before the clone had that manifest, it listed
`interrogate`. A machine-local skill in `~/.agents/skills` keeps its bare
name. The skill names in Cursor and Pi are not measured.

On a machine with a clone, `scripts/setup.sh` installs the plugin for Claude
Code from the clone; see [Setup and updating](#setup-and-updating). Codex,
Cursor, and Pi read the skill links in `~/.agents/skills` there, and setup does
not install the Codex plugin. Codex shows the same 7 skills from the links. If
the Codex plugin is also installed on such a machine, codex-cli 0.170.0 lists
each of the 7 skills two times, with the same name.

On a machine with no clone, install the plugin from GitHub. That gives the
skills and, in Claude Code, the mod and the theme. The global instructions, the
hooks, the statusline, and the Pi extensions need a clone and setup.

Claude Code 2.1.275 or later, from a shell:

```sh
claude plugin install hb --marketplace Harrison-Blair/agents
```

Or in a session:

```
/plugin install hb --marketplace Harrison-Blair/agents
```

The one command adds the catalog and installs `hb` and its dependency
`mermaid-render`.

Codex:

```sh
codex plugin marketplace add Harrison-Blair/agents && codex plugin add hb@harrison-blair
```

Limits:

- The install from GitHub is tested on Linux: Claude Code 2.1.328 installed
  `hb` and `mermaid-render`, and codex-cli 0.170.0 added the catalog and
  installed `hb`. Not tested: a session with those installs, macOS and
  Windows, and whether a Codex install gets a later commit.
  The install from a local path is tested, with Claude Code 2.1.311 and 2.1.328
  and with codex-cli 0.170.0.
- Codex shows 7 skills to the model, and `hb:orchestrate` is not one of them.
- Claude Code loads a plugin in place when its catalog is a local path, so a
  pull of the clone updates the plugin. Codex copies the plugin to its cache.
- The manifests and the catalog entries have no `version`, so each pushed
  commit is a release.

### Mermaid diagrams

The `mermaid-render` mod draws the fenced `mermaid` blocks of a reply with
`mermaid-ascii`, and it is the only installer of that renderer.
`scripts/setup.sh` downloads nothing.

- While a session has found no renderer, each diagram looks for the renderer
  and starts the installer, `sh <plugin root>/scripts/install-renderer.sh`, with
  a limit of 120 seconds. Diagrams that get there during a run share that run.
- With a renderer present, the diagram draws at once. The installer runs in the
  background, one time in each session, and its result is not shown. When it
  installs a new release, later diagrams draw with the new release, and a
  diagram that is already drawn stays as it is. A failed background run changes
  nothing.
- With no renderer present, the diagram shows a placeholder and waits for the
  installer. If no renderer is there after the run, the diagram shows its source
  and a note with the reason and the manual command. The next diagram, and the
  same diagram in a later message, start a new run.
- The release is pinned in `mods/mermaid-render/scripts/install-renderer.sh`
  (`VERSION`, now 1.6.2). A machine that has an older release moves to a new
  pin in the background of the first diagram of a session; diagrams from the
  next one draw with the new release.
- The cache is `~/.cache/mermaid-render`: `bin/mermaid-ascii` (`.exe` on
  Windows), `.mermaid-ascii-version`, and the marker `.agents-managed`. A cache
  directory without the marker is not changed.
- The download is checked against the checksum file of the release, and a
  mismatch installs nothing. Each download has a connection limit of 10
  seconds.
- To install by hand: `sh mods/mermaid-render/scripts/install-renderer.sh`.
  Exit status 0 means that the pinned release is installed. Each other result
  is exit status 1 with one reason line on stderr; for a `curl` error, the line
  has the first line of the `curl` text.
- The installer needs `sh`, `curl`, `tar`, and `sha256sum` or `shasum`. On
  Windows it needs Git Bash with `cygpath`, and `powershell`.

Limits:

- On Windows, the automatic install needs `sh` on the `PATH` (Git Bash).
  Otherwise the note gives the manual command.
- On Windows, if a diagram is drawn at the moment when the background run
  replaces `mermaid-ascii.exe`, the replacement fails and the next session
  tries again.
- When `sh` is bash and `LC_ALL` names a locale that the machine does not have,
  the note for a failed install can show the locale warning of the shell as its
  reason. The manual command in the note gives the real reason.
- When the cache is removed while the mod stays installed (see
  [Uninstalling](#uninstalling)), the mod installs the renderer again at the
  first diagram of the next session. A session that has already drawn a diagram
  starts no installer run; its new diagrams show their source and a note until
  the session ends.

### Theme

The plugin ships one Claude Code color theme, Urple, in
`plugins/hb/themes/urple.json`.
Select it by hand: `/theme`, then the entry "Urple from hb". The setting value
is `custom:hb:urple`. No script of this repository changes the `theme` setting.

- It is one dark theme: the base `dark-daltonized` with 30 color overrides.
  There is no light variant, and Codex does not use it.
- Its purpose is high contrast for low vision, and status colors that stay
  distinct for protanopia, deuteranopia, and tritanopia.
- The contrast values hold for the terminal background `#201d2a` (WCAG 2
  contrast ratio): `text` and `inactive` at least 7:1; accent, status, and
  border colors at least 4.5:1; `subtle` at least 3:1; `text` on the message
  and selection backgrounds at least 7:1.
- `claude`, `success`, `error`, and `warning` are at least 0.15 apart in OKLab
  for normal vision and for each simulated deficiency (Machado, Oliveira,
  Fernandes 2009, severity 1.0).
- `tests/test_theme.py` keeps these properties: a color change that breaks a
  limit fails the test.
- A plugin theme is read-only for the user. According to the Claude Code
  documentation, an edit in `/theme` saves a copy in the user's own themes
  directory; this is not tested here.
- The logo of the welcome header has the accent color, from the override
  `clawd_body`. Claude Code 2.1.328 showed the logo in RGB 202, 128, 255, also
  after a redraw.
- Claude Code 2.1.328 drew the first frame of a session with its default
  colors. The theme colors came with the next frame, about 0.1 seconds later.

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
session start. Sync does everything setup does, except that it installs the
Claude Code plugin only while a link of an older setup remains (see below). So
later changes -- new skills, an edited `global/AGENTS.md` or hook template --
arrive on their own; setup is needed again after moving or re-cloning the repo,
and when the plugin step of the last setup was skipped or failed. After you
move the clone, run
`scripts/setup.sh` from the new path: it also replaces the Claude Code catalog
that still names the old path. To sync by hand:

```sh
~/source/agents/scripts/setup.sh --sync
```

Both modes do the following, skipping any harness whose config directory is
absent:

- Fast-forwards the clone. If the pull moved `HEAD`, the script re-executes
  itself once so the rest of the run comes from the new copy rather than a
  half-read old one. A failed pull still links the current checkout and never
  fails a session.
- Links each `plugins/hb/skills/<name>` into `~/.agents/skills/<name>`. Codex,
  Cursor, and Pi read that directory directly. A link that an older setup made
  to `skills/<name>` of the clone, the place of the skills before
  `plugins/hb`, is stale. It is replaced and reported as `relinked`, or
  reported as `pruned` when the skill is gone. That is also done when the old
  folder `skills/<name>` stays in the clone, because it has a file that git
  does not track. Setup does not delete that folder.
- Installs the plugin `hb` for Claude Code when the `claude` command is on the
  `PATH`: `claude plugin install hb --marketplace <clone>`, which needs Claude
  Code 2.1.275 or later. The one command adds the catalog `harrison-blair` from
  the clone and installs `hb` and its dependency `mermaid-render`. Claude Code
  loads both in place from the clone, so a pull is enough to update them.
  - Setup runs the command at each run. Sync runs it only while a link that an
    older setup made remains in `~/.claude/skills`; with none left, sync does
    not start `claude`.
  - After a successful install, the links that an older setup made are removed
    and reported as `removed`: each link in `~/.claude/skills` to a skill of
    this clone, and the `mermaid-render` mod link. An older whole-directory
    link from `~/.claude/skills` to `~/.agents/skills` is replaced with a real
    directory that holds only the machine-local links, without changing the
    shared contents.
  - Without `claude` on the `PATH`, the step prints one `skip:` line and the
    old links stay.
  - When the install fails, setup warns with the reason that `claude` gave and
    the old links stay, so Claude Code loses no skill. While old links remain,
    each sync tries the install again and prints the warning again.
  - On a machine that has no old link, sync does not install the plugin. Run
    `scripts/setup.sh` again when `claude` is on the `PATH`, or after you
    correct the cause of a failed install. Until then Claude Code has no skill,
    mod, or theme of this repository.
  - Claude Code refuses a catalog named `harrison-blair` that it already has
    from a different source: a second clone that still exists, or GitHub. Setup
    then warns and changes nothing. To use this clone in its place, run
    `claude plugin marketplace remove harrison-blair`, then run setup. That
    command also uninstalls the two plugins and deletes their saved data.
  - A catalog whose directory is gone, because the clone moved or was deleted,
    is removed and added again from this clone.
- Keeps `~/.claude/skills` as a real directory and links each machine-local
  skill of `~/.agents/skills` into it: a skill there that is not from this
  clone, for example `hf-cli`. The skills of this clone are not linked there,
  because Claude Code gets them from the plugin. A link into the
  `plugins/hb/skills/` of another clone of this repository is not linked there
  either. This step needs
  only the directory `~/.claude`; it does not depend on the plugin step.
  Existing local folders are preserved. Unrelated directory links are left untouched
  with a warning, except a dangling one in a skill's place, which a clone that
  moved or was deleted left behind: that is replaced and reported as `relinked`.
  An older whole-directory link to `~/.agents/skills` already shows each
  machine-local skill, and it stays until the plugin is installed.
- Links each Pi extension in `pi/` into `~/.pi/agent/extensions/<name>`, and
  prunes a link there that points into this clone's `pi/` at something gone,
  such as an extension that was renamed.
- Links no Claude Code mod and downloads no renderer. The `mermaid-render` mod
  comes with the plugin and installs its renderer itself; see
  [Mermaid diagrams](#mermaid-diagrams).
- Links `global/AGENTS.md` into `~/.agents` and each harness; see
  [AGENTS.md](#agentsmd).
- Writes a small wrapper into `~/.local/bin` for every command a skill ships in
  `plugins/hb/skills/<name>/bin/`, so agents in any harness run it by its bare
  name.
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
  Linux/macOS, and on Windows junctions that point into this clone's
  `plugins/hb/skills/` (or, in Claude's directory, into `~/.agents/skills`) at
  something no longer there. A link into this clone's old `skills/` folder is
  pruned also when its target is there. A junction pointing anywhere else is left alone, and removal is
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
Claude Code plugin `hb` and the catalog `harrison-blair` when the catalog
points at that clone, the
skill links in `~/.agents/skills` that point into it, the links in
`~/.claude/skills` that an older setup made to those skills and to the
`mermaid-render` mod, every Pi extension link into its `pi/`,
the `~/.cache/mermaid-render` renderer cache when it has the marker and nothing
uses it any more,
the `AGENTS.md` links and managed copies (the harness files only while
`~/.agents/AGENTS.md` is this clone's), the command wrappers in `~/.local/bin`
that run its skills' commands, the hook entries running that clone's `--sync`,
and Claude's and Cursor's `statusLine` when it runs that clone's statusline.
Codex's `[tui].status_line` is kept. It never removes a real directory, a
link pointing anywhere else, a hook this repo did not write, or an entry for a
different clone -- including a dead one, which belongs to whoever owns it. The
clone itself stays; delete it afterwards if you want it gone.

For the plugin, uninstall runs `claude plugin uninstall hb@harrison-blair
--prune -y`, which also removes the dependency `mermaid-render`, and then
`claude plugin marketplace remove harrison-blair`. A catalog `harrison-blair`
from a different source is not from that clone: it stays with its plugins and
is reported as `kept`. Without `claude` on the `PATH`, uninstall prints one
`skip:` line and the plugin stays; run the two commands later to remove it.
When uninstall cannot read the catalogs of Claude Code, for example because
Python does not start, it warns and keeps the plugin, the catalog, and the
renderer cache.

The renderer cache stays while something can still use it: an entry
`~/.claude/skills/mermaid-render`, which is the link of another clone, or a
catalog `harrison-blair` that Claude Code still lists after the plugin step.
Without `claude` on the `PATH`, only the first of these is checked. If the mod
is still installed after the cache is removed, it installs the renderer again;
see [Mermaid diagrams](#mermaid-diagrams).

## Machine-local skills

Choose the location based on what you want to share. Each skill is a directory
containing `SKILL.md`.

| Purpose | Location | Synced by this repo? |
| --- | --- | --- |
| Shared collection across machines | `plugins/hb/skills/<name>/` in this clone | Yes, after commit and push |
| Shared across harnesses on this machine | `~/.agents/skills/<name>/` as a plain directory | No |
| Local extras for Claude Code | `~/.claude/skills/<name>/` as a plain directory | No |
| Local extras for Codex | `~/.codex/skills/<name>/` | No |
| Local extras for Cursor | `~/.cursor/skills/<name>/` | No |
| Local extras for Pi | `~/.pi/agent/skills/<name>/` | No |

Setup and sync preserve ordinary local folders and unrelated links. If a shared
skill's name conflicts with an existing local entry, they warn and skip that
link; they do not overwrite the local entry. Use distinct names to keep both.
Shared machine-local skills added to `~/.agents/skills` become linked into
Claude's directory on the next setup or sync. The skills of this repository are
not linked there: Claude Code gets them from the plugin, with the prefix `hb:`.

These locations separate storage, not visibility: [Cursor reads
`~/.agents/skills` and also discovers Claude and Codex
skills](https://cursor.com/docs/skills). This setup leaves that compatibility
behavior unchanged.

Sync only pulls repo changes; it never imports installed skills, commits, or
pushes local edits. Editing a linked repo skill changes the file in this clone,
so commit and push it to distribute the edit. To share a standalone local skill
between machines, move its contents into `plugins/hb/skills/<name>/` in the clone, remove
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
shellcheck scripts/setup.sh mods/mermaid-render/scripts/install-renderer.sh
claude plugin validate .
claude plugin validate plugins/hb
```

`claude plugin validate .` checks the catalog. It passes with one warning for
each of the two plugins: a missing `version`. `claude plugin validate
plugins/hb` checks the plugin `hb`. It passes with two warnings: a missing
`version` and a missing icon. These warnings are accepted, so do not add
`--strict`.

Tests use temporary fixtures and do not change your installed skills or hooks.
They cover setup, sync, hook merging for all three hook files, `AGENTS.md`
linking and its ownership rules, the post-pull re-exec, the sync lock,
bootstrap, uninstall, migration, conflicts, pruning, the statusline install,
its renderer and Codex adapter, metadata, and Markdown links. They also cover
the Claude Code plugin step with a stub `claude` command, the plugin manifests
and catalogs, the reserved names at the top level of the plugin folder, and the
theme colors. In CI, the job
`mods` runs the real `setup.sh` and `setup.sh --uninstall` with the real
`claude` command (Claude Code 2.1.311) in a temporary home directory on Linux,
macOS, and Windows. The Windows job
runs the junction, `AGENTS.md` symlink and copy, and PowerShell merge tests
with Git for Windows Bash; native Windows testing is required before a junction
or symlink change -- pruning included -- is considered verified.

# Repository Guidelines

These instructions apply only to work in this repository.

## Project Structure

This repository distributes agent configuration across machines and harnesses.
`global/AGENTS.md` contains global instructions. The root `AGENTS.md` contains project instructions.
Never distribute the root file as global instructions.

- `scripts/setup.sh` installs, synchronizes, and removes managed configuration.
  It installs the plugin `hb` for Claude Code from the clone.
- `plugins/hb/` is the plugin `hb`. This folder is the plugin root.
  `plugins/hb/plugin.json` and `plugins/hb/.claude-plugin/plugin.json` are the manifests of the plugin.
- Do not put a second plugin in `plugins/hb/`.
  claude.ai skips a plugin when its folder contains the manifest of a second plugin.
- `.claude-plugin/marketplace.json` is the Claude Code catalog.
  `.agents/plugins/marketplace.json` is the Codex catalog. The catalog name is `harrison-blair`.
- `plugins/hb/skills/<name>/SKILL.md` defines each portable skill.
- `plugins/hb/themes/` contains the Claude Code color themes of the plugin.
- `hooks/` contains session-start templates for Claude Code, Codex, and Cursor.
- `pi/` contains Pi extensions.
- `mods/<name>/` contains each Claude Code mod and its tests.
  Each mod is a plugin in the Claude Code catalog.
- `mods/<name>/scripts/` contains the scripts that a mod runs.
  Do not name this directory `bin`, because Claude Code puts a plugin `bin/` directory on the `PATH`.
- `statusline/` contains the Python renderer and shared configuration.
- `tests/` contains Python regression tests and Node tests for Pi extensions.

## Development Commands

Use Python 3.11 or later for the statusline. Use Node.js 22.18 or later for the Pi extension tests.
Use Claude Code 2.1.311 for the mod checks. CI uses the same version.
Install the pinned check dependencies:

```sh
python3 -m pip install -r requirements-ci.txt
```

Run these checks before committing relevant changes:

```sh
python3 -B -m unittest discover -s tests -v
node --test tests/test_ask_user_question.ts tests/test_pi_statusline.ts
python3 -B scripts/validate_repo.py
bash -n scripts/setup.sh
sh -n scripts/setup.sh
shellcheck scripts/setup.sh
sh -n mods/mermaid-render/scripts/install-renderer.sh
bash -n mods/mermaid-render/scripts/install-renderer.sh
shellcheck mods/mermaid-render/scripts/install-renderer.sh
claude plugin validate .
claude plugin validate plugins/hb
claude plugin validate mods/mermaid-render
claude plugin test mods/mermaid-render
shellcheck mods/mermaid-render/tests/smoke.sh
git diff --check
```

The tests check behavior. The repository checker checks skills, metadata, and local Markdown links.
It also checks the plugin manifests, the catalogs, and the reserved names of the plugin root.
`claude plugin validate .` checks the catalog. It passes with one accepted warning for each plugin: no `version`.
`claude plugin validate plugins/hb` checks the plugin `hb`.
It passes with two accepted warnings: no `version` and no icon.
Do not use `--strict` with these commands.
There is no separate build command.

## Plugin Manifests and Catalogs

`scripts/validate_repo.py` checks these rules. `tests/test_validate_repo.py` tests them.

- Change the two manifests together.
  Each key of `plugins/hb/plugin.json`, other than `$schema`, must be in `plugins/hb/.claude-plugin/plugin.json` with an equal value.
- Only the key `dependencies` can be in the Claude Code manifest alone.
- Do not add a `version` key to a manifest, to an entry of the Claude Code catalog, or to the manifest of such an entry.
  Each pushed commit is a release. A `version` stops updates until it changes.
- Each entry of the Claude Code catalog needs a `source` that starts with `./` and is a directory.
  That directory must contain `.claude-plugin/plugin.json` with the same `name`.
  It must not contain a second `.claude-plugin/plugin.json` below it.
- Each name in `dependencies` of a manifest must be an entry name of the Claude Code catalog.
- The Codex catalog must have the same catalog `name` as the Claude Code catalog.
  It can contain only entry names that the Claude Code catalog has.
- A local Markdown link in a file of `plugins/hb/` must have its target in `plugins/hb/`.
  A harness can install that folder without the other files of the repository.

The harnesses load some names from the plugin root with no manifest entry. These are the reserved names:
`agents`, `commands`, `bin`, `output-styles`, `themes`, `workflows`, `monitors`, `.mcp.json`, `mcp.json`,
`.lsp.json`, `.app.json`, `package.json`, and `hooks/hooks.json`.
The repository checker fails when a reserved name is at the top level of `plugins/hb/`.
The repository checker permits a reserved name below `plugins/hb/skills/`.
It does not check the reserved names at the repository root.
To ship a reserved name on purpose, add it to `APPROVED_ROOT_NAMES` in `scripts/validate_repo.py`.
`themes` is the only approved name. The repository checker permits the `hooks/` directory itself.

## Style and Skills

Use four spaces for Python indentation. Use two spaces for shell and TypeScript indentation.
Use `snake_case` for Python functions. Name test files `test_*.py` or `test_*.ts`.
Keep portable skill instructions independent of a harness. Put harness-specific notes in provider references.
Use the `asd-ste100` skill when changing this guide.

## Testing and Sync Safeguards

Test setup behavior with temporary fixtures. Keep tests separate from installed harness configuration.
Use a stub `claude` command in each test of `scripts/setup.sh`.
A test must not run the real `claude` command against the installed configuration.
The CI job `mods` runs `scripts/setup.sh` with the real `claude` command in a temporary home directory.
The `mermaid-render` mod installs its renderer. Do not add a download to `scripts/setup.sh`.
Change the colors in `plugins/hb/themes/urple.json` only together with the tests in `tests/test_theme.py`.
Those tests keep the contrast limits and the color distances of the theme.
Preserve local skills, unrelated configuration, and other live clones' installations.
Keep setup, sync, and uninstall behavior consistent. Check repeated runs and ownership conflicts.
Make all files work on Linux, macOS, and Windows.
Do not use a feature that only some operating systems support.
For example, Python `strftime` on Windows does not support `%-I`.
Run native Windows tests for changes to symlinks, junctions, or instruction copies.
Record unavailable platform checks as pending.

## Commits and Pull Requests

Use short, action-oriented commit subjects. Add an area prefix when useful, such as `setup:` or `statusline:`.
Keep independent changes in separate commits.
Describe behavior changes and test results in pull requests. State platform limits.

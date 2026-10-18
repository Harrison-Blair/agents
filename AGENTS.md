# Repository Guidelines

These instructions apply only to work in this repository.

## Project Structure

This repository distributes agent configuration across machines and harnesses.
`global/AGENTS.md` contains global instructions. The root `AGENTS.md` contains project instructions.
Never distribute the root file as global instructions.

- `scripts/setup.sh` installs, synchronizes, and removes managed configuration.
- `skills/<name>/SKILL.md` defines each portable skill.
- `hooks/` contains session-start templates for Claude Code, Codex, and Cursor.
- `pi/` contains Pi extensions.
- `statusline/` contains the Python renderer and shared configuration.
- `tests/` contains Python regression tests.

## Development Commands

Use Python 3.11 or later for the statusline. Install the pinned check dependencies:

```sh
python3 -m pip install -r requirements-ci.txt
```

Run these checks before committing relevant changes:

```sh
python3 -B -m unittest discover -s tests -v
python3 -B scripts/validate_repo.py
bash -n scripts/setup.sh
sh -n scripts/setup.sh
shellcheck scripts/setup.sh
git diff --check
```

The tests check behavior. The repository checker checks skills, metadata, and local Markdown links.
There is no separate build command.

## Style and Skills

Use four spaces for Python indentation. Use two spaces for shell and TypeScript indentation.
Use `snake_case` for Python functions. Name test files `test_*.py`.
Keep portable skill instructions independent of a harness. Put harness-specific notes in provider references.
Use the `asd-ste100` skill when changing this guide.

## Testing and Sync Safeguards

Test setup behavior with temporary fixtures. Keep tests separate from installed harness configuration.
Preserve local skills, unrelated configuration, and other live clones' installations.
Keep setup, sync, and uninstall behavior consistent. Check repeated runs and ownership conflicts.
Run native Windows tests for changes to symlinks, junctions, or instruction copies.
Record unavailable platform checks as pending.

## Commits and Pull Requests

Use short, action-oriented commit subjects. Add an area prefix when useful, such as `setup:` or `statusline:`.
Keep independent changes in separate commits.
Describe behavior changes and test results in pull requests. State platform limits.

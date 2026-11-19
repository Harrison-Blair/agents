# Pi

Use this reference only when Pi must discover or invoke the canonical skill. See [Pi's current skills documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) and the [Agent Skills specification](https://agentskills.io/specification). Runtime observations below use Pi 1.5.0. Pi 1.5.2 has the same skills documentation.

## Discovery and installation

Pi natively discovers (verified in `docs/skills.md`):

- user skills at `~/.agents/skills/` and `~/.pi/agent/skills/`;
- project skills at `.agents/skills/` in the current directory and each ancestor up to the repository root;
- project skills at `.pi/skills/` in the current directory. Both project locations require trust;
- skills listed in a `skills` array in `settings.json`, from packages, or passed with `--skill <path>`.

Pi searches directories recursively for `SKILL.md`. Link a source outside the discovery locations into the appropriate `.agents/skills` directory. Do not add a redundant `~/.pi/agent/skills/<skill-name>` link. Pi 1.5.0 deduplicated links to the same source. An independent copy with the same name caused a collision.

## Portable core

Pi reads the shared `name` and `description` frontmatter. It loads invalid names and descriptions over 1024 characters with a warning. A `SKILL.md` with no description, or malformed frontmatter, is not loaded. Pi 1.5.0 accepted and ignored `license`, `compatibility`, `metadata`, and `allowed-tools`. Pi ignores unknown frontmatter fields. Unlike the specification, Pi does not require `name` to match the directory. Keep them matching for the other harnesses.

## Pi-only metadata

`disable-model-invocation: true` hides a skill from the system prompt. `/skill:<name>` can still load it. This field is not in the Agent Skills specification. Follow the shared skill's rule for provider-only syntax. Behavior that Pi cannot reach through a skill, such as reacting to outside events, belongs in a Pi extension (`~/.pi/agent/extensions/`), not in `SKILL.md`.

## Validation and reload

Pi scans skills at startup and when the user runs `/reload`, which also reloads extensions. The `enableSkillCommands` setting controls interactive command discovery. In Pi 1.5.0, manually entered `/skill:<name>` commands and RPC command listing still worked when it was disabled.

Representative checks, in a fresh session or after `/reload`:

1. The skill appears once in the startup skill list, with no warning for it.
2. `/skill:<name>` loads it.
3. A request matching its description makes the agent read `SKILL.md` (models do not always do this; `/skill:<name>` forces it).

## Conflicts

Pi keeps the first skill found on a name collision. Pi 1.5.0 showed warnings in the interactive interface, but not in tested print or RPC sessions. Before installing, search discovery locations for duplicate names and report their paths. Pi 1.5.0 ignored broken links without warning, so check adapter destinations directly. Preserve and report conflicts under the canonical directory-symlink rules.

# Codex

Use this reference only when Codex must author, discover, validate, or invoke the canonical skill. The source of truth is the current [official OpenAI skill guide](https://learn.chatgpt.com/docs/build-skills).

## Discovery and installation

Codex natively discovers:

- user skills at `$HOME/.agents/skills`;
- repository skills in `.agents/skills` at each directory from the current working directory through the repository root;
- administrator skills at `/etc/codex/skills`; and
- bundled system skills.

Codex follows symlinked skill directories. Link a source outside its discovery locations into the appropriate `.agents/skills` directory. Do not create a redundant `$HOME/.codex/skills/<skill-name>` link. A second discovered copy can produce a second selector entry because skills with the same `name` are not merged.

Before installing, inspect every Codex discovery location in scope for the same frontmatter `name`, not just the folder name. Preserve conflicts and report their paths. Apply the canonical directory-symlink rules if an unusual environment requires an adapter.

## Portable core

Use the required `name` and `description` fields:

```yaml
---
name: skill-name
description: State what the skill does and when it should apply.
---
```

Preserve useful optional fields from the [Agent Skills specification](https://agentskills.io/specification). Check their behavior in each requested harness. The specification marks `allowed-tools` as experimental.

Use lowercase letters, digits, and hyphens for `name`. Use at most 64 characters. Match the directory name. Write the body as standard Markdown with relative links. Keep the description concise and discriminating. Avoid provider-only syntax in the portable core.

## Codex-only metadata

`agents/openai.yaml` is optional. It may define UI appearance, tool dependencies, a default prompt, and invocation policy without changing the portable `SKILL.md`. Automatic invocation is enabled by default; set `policy.allow_implicit_invocation: false` only when explicitly requested. Other harnesses may ignore this file.

## Initialization and validation

Prefer the bundled skill creator when starting a new skill:

```sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/init_skill.py" <skill-name> --path <canonical-parent> --resources references
```

Validate the completed canonical directory with:

```sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" <canonical-skill-directory>
```

The validator checks frontmatter, naming, and unfinished scaffold text. The installed validator may reject the standard `compatibility` field. Check its allowed fields before treating that rejection as a specification error. Check relative links and duplicate names separately.

## Reload and checks

Codex normally detects skill changes automatically. If a new or changed skill is absent, restart Codex. Restart after changing skill enablement in `$HOME/.codex/config.toml`.

In a fresh Codex session:

1. Use `/skills` or type `$` and confirm the skill appears exactly once with its canonical path.
2. Invoke it explicitly as `$<skill-name>` with a representative request.
3. Submit a matching request without naming it and confirm the description supports appropriate implicit selection.

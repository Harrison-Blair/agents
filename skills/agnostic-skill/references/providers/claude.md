# Claude Code

Use this reference only when Claude Code must discover, validate, or invoke the canonical skill. The source of truth is the current [official skills documentation](https://code.claude.com/docs/en/skills.md).

## Discovery and installation

Claude Code natively discovers:

- personal skills at `~/.claude/skills/<skill-name>/SKILL.md`;
- project skills at `.claude/skills/<skill-name>/SKILL.md`, including parent directories up to the repository root and nested directories as files there are touched;
- plugin skills inside enabled plugins; and
- enterprise skills in the managed settings directory.

Claude Code does **not** discover `.agents/skills` (tracked in [issue #31005](https://github.com/anthropics/claude-code/issues/31005)), so each canonical skill needs a per-skill directory symlink:

- user scope: `~/.claude/skills/<skill-name>` → absolute canonical path;
- project scope: `.claude/skills/<skill-name>` → absolute canonical path.

Follow the canonical directory-symlink rules: absolute targets, preserve and report conflicts, and never copy or synchronize. Check for duplicate names before installing. Claude resolves enterprise, personal, and project collisions by precedence. Plugin skills use a namespace. Nested and added-directory skills can use qualified names. See [name resolution](https://code.claude.com/docs/en/skills#resolve-skills-that-share-a-name).

Symlink caveats:

- Per-skill directory symlinks worked in Claude Code 2.1.322. The documentation says a target reachable from more than one location loads only once.
- A project `.claude/skills` directory symlink worked in 2.1.322. The user-scope directory link was not tested. The earlier [report](https://github.com/anthropics/claude-code/issues/38051) is closed.
- A user [reported](https://github.com/anthropics/claude-code/issues/50052) that updates removed per-skill links. This was not reproduced in the 2.1.322 evaluation. Check links after updates.

## Portable core

Claude accepts the standard frontmatter fields, including `license`, `compatibility`, and `metadata`. It accepts `compatibility` but does not act on it. The standard marks `allowed-tools` as experimental. Check its behavior in each requested harness.

Follow the Agent Skills specification's 1,024-character `description` limit. Put trigger keywords first. Claude caps the combined `description` and `when_to_use` listing text at 1,536 characters by default. Its listing budget can also omit descriptions.

Exclude from the portable core every Claude-only feature, because other harnesses render it as literal text or reject it:

- provider-specific frontmatter, including `disable-model-invocation`, `user-invocable`, `argument-hint`, `arguments`, `model`, `context: fork`, `agent`, and `hooks`;
- body substitutions: `$ARGUMENTS`, `$1`-style positional and named arguments, `${CLAUDE_SESSION_ID}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SKILL_DIR}`, and other `${CLAUDE_*}` variables;
- `` !`command` `` shell preprocessing (inline or block), which executes commands before the model reads the skill.

## Claude-only metadata

Claude Code has no provider metadata sidecar equivalent to `agents/openai.yaml`. Its skill extensions use the shared `SKILL.md`. Before adding Claude-only syntax there, explain its effect on each other requested harness and ask the user. Ask before creating a separate body too. Claude-specific instructions may live in a conditionally linked reference.

## Initialization and validation

Run `claude plugin validate <skills-directory>` on the directory containing the real skill folders. It does not follow symlinks. Claude Code 2.1.233 or later checks for invalid YAML frontmatter. Check these separately:

- frontmatter is valid YAML with `name` matching the directory name (lowercase letters, digits, hyphens) and a concise, discriminating `description`;
- every relative Markdown link resolves; and
- no Claude-only syntax from the list above appears in the portable core.

`/skill-doctor` reports skill listing cost where available. `claude plugin eval` runs evaluations for plugin skills.

## Reload and checks

Claude Code watches existing skill directories for `SKILL.md` changes, except in bare mode. If the top-level skills directory did not exist at session start, run `/reload-skills`. Run it again after each later change in that directory. Prefer a fresh session for the acceptance checks.

In a fresh Claude Code session:

1. Confirm the skill appears exactly once in the available-skills listing (type `/` and look for `/<skill-name>`).
2. Invoke it explicitly as `/<skill-name>` with a representative request. Claude uses `/`, not Codex's `$` prefix.
3. Submit a matching request without naming it and confirm the description supports appropriate implicit selection.

---
name: agnostic-skill
description: Create or maintain one portable skill for multiple agent harnesses. Keep its canonical source in .agents/skills. Use provider references for compatibility and installation. Do not use for skills intended for only one provider.
---

# Agnostic Skill

Maintain one editable skill source. Adapt only its discovery and provider-specific features.

Load [asd-ste100](../asd-ste100/SKILL.md) before writing or editing skill instructions. Apply its Strict mode and glossary rules.

## Canonical source

- User scope: `~/.agents/skills/<skill-name>`
- Project scope: `<repository>/.agents/skills/<skill-name>`

Keep portable instructions in the canonical `SKILL.md`. Never maintain synchronized copies for different harnesses.

## Workflow

1. Choose user or project scope for the skill. Identify the harnesses that must discover it.
2. Keep the canonical frontmatter and instructions compatible with every requested harness.
3. Read only the references for those harnesses:
   - For Codex, read [references/providers/codex.md](references/providers/codex.md).
   - For Claude Code, read [references/providers/claude.md](references/providers/claude.md).
   - For Pi, read [references/providers/pi.md](references/providers/pi.md).
   - If a provider has no reference, read its current official documentation. Add a reference under the contract below before installing an adapter.
4. Put provider-only metadata or behavior in separate files when the harness supports that separation. Keep these details outside the portable instructions.
5. Check the canonical skill. Install only required discovery adapters. Test each harness in a new session if its reload behavior requires one.

## Directory symlinks

Create a per-skill directory symlink only when a harness cannot discover the canonical location directly.

- Resolve the canonical skill directory to an absolute target before linking. Do not use `~` or a relative link target.
- If the provider natively discovers the canonical directory, skip the link.
- If the destination is absent, create its parent directory if needed. Then create the directory symlink.
- If the destination is already a symlink that resolves to the canonical directory, leave it unchanged.
- Treat each of these destination states as a conflict:
  - A broken symlink.
  - A symlink to another target.
  - A regular file.
  - A real directory.
- Preserve each destination that has a conflict. Report the exact destination. Never force-replace or merge a conflict.
- Never replace the symlink with a copied mirror. Never introduce a synchronization workflow.

## Provider-reference contract

Add future providers, such as Cursor, under `references/providers/<provider>.md`. Each reference must state:

- User and project discovery locations.
- Whether native discovery makes a symlink unnecessary.
- Compatibility restrictions for `SKILL.md`.
- Provider-only metadata or auxiliary files.
- Procedures to initialize and check the skill.
- Cache or reload behavior and representative invocation checks.
- Handling for correct, missing, broken, and wrong-target symlinks, regular files, and real directories at the destination.

Keep provider references concise. Cite current official documentation. Distinguish verified behavior from assumptions. Add the routing link above only after the reference exists.

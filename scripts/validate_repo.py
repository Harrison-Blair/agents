#!/usr/bin/env python3
"""Validate the repository's skills, metadata, and local Markdown links."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlsplit

import yaml
from markdown_it import MarkdownIt


def _iter_tokens(tokens):
    for token in tokens:
        yield token
        if token.children:
            yield from _iter_tokens(token.children)


# Installed dependencies (a skill's bundled app) are not skill content.
SKIPPED_DIRS = {"node_modules"}

PLUGIN_MANIFEST = "plugin.json"
CLAUDE_MANIFEST = ".claude-plugin/plugin.json"
CLAUDE_CATALOG = ".claude-plugin/marketplace.json"
CODEX_CATALOG = ".agents/plugins/marketplace.json"

# Claude Code and Codex load these names from a plugin root with no manifest entry.
RESERVED_ROOT_NAMES = (
    "agents", "commands", "bin", "output-styles", "themes", "workflows", "monitors",
    ".mcp.json", "mcp.json", ".lsp.json", ".app.json", "package.json", "hooks/hooks.json",
)
# Reserved names that the plugin ships on purpose.
APPROVED_ROOT_NAMES: frozenset[str] = frozenset()


def skill_files(root: Path, pattern: str) -> list[Path]:
    return sorted(
        path for path in (root / "skills").rglob(pattern)
        if not SKIPPED_DIRS.intersection(path.relative_to(root).parts)
    )


def check_markdown_links(root: Path) -> list[str]:
    """Return errors for local links/images whose destinations do not exist."""
    errors: list[str] = []
    markdown_files = [root / "README.md", *skill_files(root, "*.md")]
    parser = MarkdownIt()
    for markdown_file in markdown_files:
        if not markdown_file.is_file():
            errors.append(f"{markdown_file.relative_to(root)}: file does not exist")
            continue
        try:
            tokens = parser.parse(markdown_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as exc:
            errors.append(f"{markdown_file.relative_to(root)}: cannot read: {exc}")
            continue
        for token in _iter_tokens(tokens):
            if token.type == "link_open":
                destination = token.attrGet("href")
            elif token.type == "image":
                destination = token.attrGet("src")
            else:
                continue
            if not destination:
                continue
            parsed = urlsplit(destination)
            # URLs, mailto links, and fragment-only links are outside this check.
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            if parsed.path.startswith("/"):
                continue
            target = markdown_file.parent / unquote(parsed.path)
            if not target.exists():
                relative = markdown_file.relative_to(root)
                errors.append(f"{relative}: missing local target {destination!r}")
    return errors


def check_json_files(root: Path) -> list[str]:
    errors: list[str] = []
    for path in sorted((root / "hooks").glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            errors.append(f"{path.relative_to(root)}: invalid JSON: {exc}")
            continue
        if not isinstance(data, dict):
            errors.append(f"{path.relative_to(root)}: top-level JSON value must be an object")
    return errors


def load_json_object(root: Path, relative: str, errors: list[str]) -> dict | None:
    """Return the object in a JSON file, or add an error and return None."""
    try:
        data = json.loads((root / relative).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors.append(f"{relative}: invalid JSON: {exc}")
        return None
    if not isinstance(data, dict):
        errors.append(f"{relative}: top-level JSON value must be an object")
        return None
    return data


def catalog_entries(data: dict, relative: str, errors: list[str]) -> list[dict]:
    """Return the catalog entries that are objects with a string name."""
    plugins = data.get("plugins")
    if not isinstance(plugins, list):
        errors.append(f"{relative}: 'plugins' must be an array")
        return []
    entries: list[dict] = []
    for index, entry in enumerate(plugins):
        if isinstance(entry, dict) and isinstance(entry.get("name"), str):
            entries.append(entry)
        else:
            errors.append(f"{relative}: plugins[{index}] must be an object with a string 'name'")
    return entries


def check_plugin_manifests(root: Path) -> list[str]:
    """Check that the two plugin manifests of the repository root agree."""
    errors: list[str] = []
    shared = load_json_object(root, PLUGIN_MANIFEST, errors)
    claude = load_json_object(root, CLAUDE_MANIFEST, errors)
    if shared is None or claude is None:
        return errors
    # Each pushed commit is a release. A version stops updates until it changes.
    for relative, manifest in ((PLUGIN_MANIFEST, shared), (CLAUDE_MANIFEST, claude)):
        if "version" in manifest:
            errors.append(f"{relative}: key 'version' is not permitted")
    shared_keys = shared.keys() - {"$schema"}
    for key in sorted(shared_keys):
        if key not in claude:
            errors.append(f"{CLAUDE_MANIFEST}: missing key {key!r} of {PLUGIN_MANIFEST}")
        elif claude[key] != shared[key]:
            errors.append(f"{CLAUDE_MANIFEST}: {key!r} is not equal in {PLUGIN_MANIFEST}")
    # Only Claude Code reads "dependencies".
    for key in sorted(claude.keys() - shared_keys - {"dependencies"}):
        errors.append(f"{CLAUDE_MANIFEST}: key {key!r} is not in {PLUGIN_MANIFEST}")
    return errors


def check_plugin_catalogs(root: Path) -> list[str]:
    """Check the Claude Code catalog entries, and the Codex catalog against them."""
    errors: list[str] = []
    claude = load_json_object(root, CLAUDE_CATALOG, errors)
    codex = load_json_object(root, CODEX_CATALOG, errors)
    if claude is None:
        return errors
    entries = catalog_entries(claude, CLAUDE_CATALOG, errors)
    claude_names = {entry["name"] for entry in entries}
    for entry in entries:
        name = entry["name"]
        # Claude Code uses the version of an entry before the commit SHA.
        if "version" in entry:
            errors.append(f"{CLAUDE_CATALOG}: plugin {name!r}: key 'version' is not permitted")
        source = entry.get("source")
        if not isinstance(source, str) or not source.startswith("./"):
            errors.append(f"{CLAUDE_CATALOG}: plugin {name!r}: 'source' must start with './'")
            continue
        if not (root / source).is_dir():
            errors.append(f"{CLAUDE_CATALOG}: plugin {name!r}: no source directory {source!r}")
            continue
        manifest_path = (Path(source) / CLAUDE_MANIFEST).as_posix()
        manifest = load_json_object(root, manifest_path, errors)
        if manifest is None:
            continue
        if manifest.get("name") != name:
            errors.append(f"{manifest_path}: 'name' must be {name!r}, as in its catalog entry")
        # Claude Code does not load a plugin when one of its dependencies is absent.
        for dependency in manifest.get("dependencies", []):
            if dependency not in claude_names:
                errors.append(
                    f"{manifest_path}: dependency {dependency!r} is not in {CLAUDE_CATALOG}"
                )
    if codex is None:
        return errors
    if codex.get("name") != claude.get("name"):
        errors.append(f"{CODEX_CATALOG}: 'name' is not equal to 'name' in {CLAUDE_CATALOG}")
    for entry in catalog_entries(codex, CODEX_CATALOG, errors):
        if entry["name"] not in claude_names:
            errors.append(f"{CODEX_CATALOG}: plugin {entry['name']!r} is not in {CLAUDE_CATALOG}")
    return errors


def check_reserved_names(root: Path) -> list[str]:
    """Return an error for each unapproved name that the harnesses load from the root."""
    return [
        f"{name}: reserved plugin name at the repository root; approve it in APPROVED_ROOT_NAMES"
        for name in RESERVED_ROOT_NAMES
        if name not in APPROVED_ROOT_NAMES and (root / name).exists()
    ]


def check_yaml_files(root: Path) -> list[str]:
    errors: list[str] = []
    paths = skill_files(root, "*.yaml")
    paths += skill_files(root, "*.yml")
    paths += list((root / ".github/workflows").glob("*.yaml"))
    paths += list((root / ".github/workflows").glob("*.yml"))
    for path in sorted(paths):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            errors.append(f"{path.relative_to(root)}: invalid YAML: {exc}")
            continue
        if not isinstance(data, dict):
            errors.append(f"{path.relative_to(root)}: top-level YAML value must be a mapping")
    return errors


def check_skills(root: Path) -> list[str]:
    """Validate every immediate skills/<name> directory with skills-ref."""
    try:
        from skills_ref.validator import validate
    except ImportError as exc:  # pragma: no cover - exercised by CI setup
        return [f"skills-ref is required: {exc}"]

    errors: list[str] = []
    skills_root = root / "skills"
    if not skills_root.is_dir():
        return ["skills: directory does not exist"]
    for path in sorted(skills_root.iterdir()):
        if not path.is_dir():
            errors.append(f"{path.relative_to(root)}: skill entry must be a directory")
            continue
        try:
            skill_errors = validate(path)
        except Exception as exc:  # keep checking every skill after parser failures
            skill_errors = [f"validator crashed: {exc}"]
        errors.extend(f"{path.relative_to(root)}: {error}" for error in skill_errors)
    return errors


def collect_errors(root: Path) -> list[str]:
    checks = (
        check_skills, check_json_files, check_yaml_files, check_markdown_links,
        check_plugin_manifests, check_plugin_catalogs, check_reserved_names,
    )
    errors: list[str] = []
    for check in checks:
        errors.extend(check(root))
    return errors


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "root", nargs="?", type=Path,
        default=Path(__file__).resolve().parents[1],
        help="repository root (default: the parent of scripts/)",
    )
    args = parser.parse_args(argv)
    root = args.root.resolve()
    errors = collect_errors(root)
    if errors:
        print(f"Repository validation failed with {len(errors)} error(s):")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"Repository validation passed: {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

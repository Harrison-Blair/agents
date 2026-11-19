import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/validate_repo.py"
HAS_SKILLS_REF = importlib.util.find_spec("skills_ref") is not None
MANIFEST = {"name": "demo", "description": "A test plugin.", "author": {"name": "Tester"}}
RESERVED_ROOT_NAMES = (
    "agents", "commands", "bin", "output-styles", "themes", "workflows", "monitors",
    ".mcp.json", "mcp.json", ".lsp.json", ".app.json", "package.json", "hooks/hooks.json",
)


@unittest.skipUnless(HAS_SKILLS_REF, "install requirements-ci.txt to run validator tests")
class ValidatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="skills validator ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write("skills/good/SKILL.md", """---\nname: good\ndescription: A valid test skill.\n---\n\nInstructions.\n""")
        self.write("hooks/ci.json", '{"hooks": {}}\n')
        self.write_json("plugin.json", {"$schema": "https://example.test/schema.json", **MANIFEST})
        self.write_json(".claude-plugin/plugin.json", {**MANIFEST, "dependencies": ["extra"]})
        self.write_json("mods/extra/.claude-plugin/plugin.json", {"name": "extra"})
        self.write_json(".claude-plugin/marketplace.json", {
            "name": "catalog",
            "plugins": [
                {"name": "demo", "source": "./"},
                {"name": "extra", "source": "./mods/extra"},
            ],
        })
        self.write_json(".agents/plugins/marketplace.json", {
            "name": "catalog",
            "plugins": [{"name": "demo", "source": {"source": "local", "path": "./"}}],
        })

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def write_json(self, relative, data):
        return self.write(relative, json.dumps(data) + "\n")

    def run_validator(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(self.root)],
            text=True, capture_output=True,
        )

    def test_valid_repository(self):
        self.write("skills/good/assets/hello world.txt", "asset\n")
        self.write(
            "README.md",
            "See [the skill][ref].\n\n"
            "![asset](skills/good/assets/hello%20world.txt#preview)\n\n"
            "[ref]: skills/good/SKILL.md\n",
        )
        result = self.run_validator()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_missing_skill_file_and_relative_target_are_reported(self):
        (self.root / "skills/good/SKILL.md").unlink()
        self.write("README.md", "[missing](docs/nope.md)\n")
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing required file: SKILL.md", result.stdout)
        self.assertIn("missing local target 'docs/nope.md'", result.stdout)

    def test_installed_dependencies_are_skipped(self):
        self.write("skills/good/app/node_modules/pkg/README.md", "[gone](missing.md)\n")
        self.write("skills/good/app/node_modules/pkg/x.yaml", "- not a mapping\n")
        self.write("skills/good/app/notes.md", "[gone](missing.md)\n")
        result = self.run_validator()
        self.assertNotIn("node_modules", result.stdout)
        self.assertIn("skills/good/app/notes.md: missing local target", result.stdout)

    def test_invalid_frontmatter_is_reported(self):
        self.write("skills/good/SKILL.md", """---\nname: Bad Name\ndescription: nope\n---\n""")
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be lowercase", result.stdout)

    def test_malformed_json_and_yaml_are_reported(self):
        self.write("hooks/bad.json", '{"hooks":\n')
        self.write("skills/good/agents/bad.yaml", "bad: [\n")
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("hooks/bad.json: invalid JSON", result.stdout)
        self.assertIn("skills/good/agents/bad.yaml: invalid YAML", result.stdout)

    def test_code_examples_and_external_links_are_ignored(self):
        self.write("README.md", """[external](https://example.test/nope)\n\n```md\n[code](missing.md)\n```\n""")
        result = self.run_validator()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_claude_manifest_must_hold_each_shared_key_with_an_equal_value(self):
        self.write_json(".claude-plugin/plugin.json", {
            "name": "demo", "description": "Another description.",
        })
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".claude-plugin/plugin.json: missing key 'author' of plugin.json", result.stdout)
        self.assertIn(
            ".claude-plugin/plugin.json: 'description' is not equal in plugin.json", result.stdout,
        )
        self.assertNotIn("'name'", result.stdout)

    def test_claude_manifest_can_add_only_dependencies(self):
        self.write_json(".claude-plugin/plugin.json", {
            **MANIFEST, "dependencies": ["extra"], "version": "1.0.0", "$schema": "x",
        })
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".claude-plugin/plugin.json: key 'version' is not in plugin.json", result.stdout)
        self.assertIn(".claude-plugin/plugin.json: key '$schema' is not in plugin.json", result.stdout)
        self.assertNotIn("'dependencies'", result.stdout)

    def test_version_in_a_manifest_is_reported(self):
        versioned = {**MANIFEST, "version": "1.0.0"}
        self.write_json("plugin.json", versioned)
        self.write_json(".claude-plugin/plugin.json", versioned)
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("  - plugin.json: key 'version' is not permitted", result.stdout)
        self.assertIn(".claude-plugin/plugin.json: key 'version' is not permitted", result.stdout)

    def test_manifest_that_does_not_parse_is_reported(self):
        self.write("plugin.json", '{"name":\n')
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("  - plugin.json: invalid JSON", result.stdout)

    def test_missing_manifest_is_reported(self):
        (self.root / "plugin.json").unlink()
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("  - plugin.json: invalid JSON", result.stdout)

    def test_claude_catalog_source_must_be_an_existing_relative_directory(self):
        self.write_json("mods/bare/.claude-plugin/plugin.json", {"name": "bare"})
        self.write_json(".claude-plugin/marketplace.json", {
            "name": "catalog",
            "plugins": [
                {"name": "demo", "source": "./"},
                {"name": "gone", "source": "./mods/gone"},
                {"name": "bare", "source": "mods/bare"},
                {"name": "remote", "source": {"source": "github", "repo": "example/remote"}},
            ],
        })
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        prefix = ".claude-plugin/marketplace.json: plugin"
        self.assertIn(f"{prefix} 'gone': no source directory './mods/gone'", result.stdout)
        self.assertIn(f"{prefix} 'bare': 'source' must start with './'", result.stdout)
        self.assertIn(f"{prefix} 'remote': 'source' must start with './'", result.stdout)
        self.assertNotIn("'demo'", result.stdout)

    def test_claude_catalog_source_must_hold_a_manifest_with_the_entry_name(self):
        self.write_json("mods/extra/.claude-plugin/plugin.json", {"name": "other"})
        (self.root / "mods/empty").mkdir()
        self.write_json(".claude-plugin/marketplace.json", {
            "name": "catalog",
            "plugins": [
                {"name": "demo", "source": "./"},
                {"name": "extra", "source": "./mods/extra"},
                {"name": "empty", "source": "./mods/empty"},
            ],
        })
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "mods/extra/.claude-plugin/plugin.json: 'name' must be 'extra', as in its catalog entry",
            result.stdout,
        )
        self.assertIn("mods/empty/.claude-plugin/plugin.json: invalid JSON", result.stdout)
        self.assertNotIn("'demo'", result.stdout)

    def test_version_in_a_claude_catalog_entry_is_reported(self):
        self.write_json(".claude-plugin/marketplace.json", {
            "name": "catalog",
            "plugins": [
                {"name": "demo", "source": "./"},
                {"name": "extra", "source": "./mods/extra", "version": "1.0.0"},
            ],
        })
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            ".claude-plugin/marketplace.json: plugin 'extra': key 'version' is not permitted",
            result.stdout,
        )
        self.assertNotIn("'demo'", result.stdout)

    def test_dependency_must_be_a_claude_catalog_entry(self):
        self.write_json(".claude-plugin/plugin.json", {**MANIFEST, "dependencies": ["extra", "gone"]})
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            ".claude-plugin/plugin.json: dependency 'gone' is not in .claude-plugin/marketplace.json",
            result.stdout,
        )
        self.assertNotIn("'extra'", result.stdout)

    def test_missing_claude_catalog_is_reported(self):
        (self.root / ".claude-plugin/marketplace.json").unlink()
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("  - .claude-plugin/marketplace.json: invalid JSON", result.stdout)

    def test_missing_codex_catalog_is_reported(self):
        (self.root / ".agents/plugins/marketplace.json").unlink()
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("  - .agents/plugins/marketplace.json: invalid JSON", result.stdout)

    def test_codex_catalog_must_match_the_claude_catalog(self):
        self.write_json(".agents/plugins/marketplace.json", {
            "name": "other-catalog",
            "plugins": [{"name": "demo"}, {"name": "unlisted"}],
        })
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        prefix = ".agents/plugins/marketplace.json:"
        self.assertIn(
            f"{prefix} 'name' is not equal to 'name' in .claude-plugin/marketplace.json", result.stdout,
        )
        self.assertIn(
            f"{prefix} plugin 'unlisted' is not in .claude-plugin/marketplace.json", result.stdout,
        )
        self.assertNotIn("'demo'", result.stdout)

    def test_catalog_with_a_wrong_shape_is_reported(self):
        self.write_json(".claude-plugin/marketplace.json", {
            "name": "catalog", "plugins": [{"name": "demo", "source": "./"}, "extra"],
        })
        self.write_json(".agents/plugins/marketplace.json", {"name": "catalog", "plugins": {}})
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            ".claude-plugin/marketplace.json: plugins[1] must be an object with a string 'name'",
            result.stdout,
        )
        self.assertIn(".agents/plugins/marketplace.json: 'plugins' must be an array", result.stdout)
        self.assertNotIn("Traceback", result.stderr)

    def test_reserved_root_names_are_reported(self):
        for name in RESERVED_ROOT_NAMES:
            self.write(f"{name}/keep.txt" if "." not in name else name, "{}\n")
        result = self.run_validator()
        self.assertNotEqual(result.returncode, 0)
        for name in RESERVED_ROOT_NAMES:
            with self.subTest(name=name):
                self.assertIn(f"  - {name}: reserved plugin name", result.stdout)

    def test_approved_reserved_root_name_is_permitted(self):
        spec = importlib.util.spec_from_file_location("validate_repo", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        (self.root / "bin").mkdir()
        (self.root / "commands").mkdir()
        with mock.patch.object(module, "APPROVED_ROOT_NAMES", frozenset({"bin"})):
            errors = module.check_reserved_names(self.root)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("commands: reserved plugin name", errors[0])


if __name__ == "__main__":
    unittest.main()

"""Native junction tests; this module intentionally fails on Windows without Git Bash."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == "nt", "native junction tests run on Windows CI")
class WindowsSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="agents setup ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.home = self.base / "home"
        self.repo = self.base / "repo"
        self.shared = self.home / ".agents/skills"
        self.claude = self.home / ".claude/skills"
        self.claude.parent.mkdir(parents=True)
        self.repo.mkdir()
        (self.repo / "scripts").mkdir()
        shutil.copy2(
            Path(__file__).parents[1] / "scripts/setup.sh",
            self.repo / "scripts/setup.sh",
        )
        shutil.copytree(Path(__file__).parents[1] / "hooks", self.repo / "hooks")
        shutil.copytree(Path(__file__).parents[1] / "statusline", self.repo / "statusline")
        shutil.copy2(Path(__file__).parents[1] / "AGENTS.md", self.repo / "AGENTS.md")
        self.add_skill(self.repo / "skills/shared-one")
        self.env = dict(os.environ)
        # Git Bash accepts drive-letter paths with forward slashes and uses HOME
        # for the script's machine-local destinations.
        self.env["HOME"] = self.home.as_posix()
        self.env["USERPROFILE"] = self.home.as_posix()
        self.bash = shutil.which("bash")
        if not self.bash:
            raise AssertionError("Git for Windows Bash is required for native junction tests")
        version = subprocess.run([self.bash, "--version"], text=True, capture_output=True)
        self.assertEqual(version.returncode, 0, version.stderr)

    def add_skill(self, path):
        path.mkdir(parents=True)
        (path / "SKILL.md").write_text(
            "---\nname: %s\ndescription: Test skill.\n---\n" % path.name,
            encoding="utf-8",
        )
        return path

    def run_setup(self, mode="setup"):
        result = subprocess.run(
            [self.bash, "scripts/setup.sh", mode], cwd=self.repo,
            env=self.env, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    @staticmethod
    def is_junction(path):
        return path.is_junction()

    def make_junction(self, link, target):
        result = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
            text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(self.is_junction(link), link)

    def remove_empty_directory(self, path):
        for child in path.iterdir():
            if child.is_junction():
                result = subprocess.run(
                    ["cmd.exe", "/d", "/c", "rmdir", str(child)],
                    text=True, capture_output=True,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            elif child.is_symlink():
                child.unlink()
            elif child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
        path.rmdir()

    def test_fresh_and_repeated_setup_create_real_root_and_junctions(self):
        for _ in range(2):
            self.run_setup()
            self.assertTrue(self.claude.is_dir())
            self.assertFalse(self.is_junction(self.claude))
            link = self.claude / "shared-one"
            self.assertTrue(self.is_junction(link))
            self.assertEqual(link.resolve(), (self.repo / "skills/shared-one").resolve())

    def test_legacy_junction_migration_preserves_targets(self):
        self.run_setup()
        self.add_skill(self.shared / "machine-shared")
        self.remove_empty_directory(self.claude)
        self.make_junction(self.claude, self.shared)
        self.run_setup("--sync")
        self.assertFalse(self.is_junction(self.claude))
        migrated = self.claude / "machine-shared"
        self.assertTrue(self.is_junction(migrated))
        self.assertEqual(migrated.resolve(), (self.shared / "machine-shared").resolve())
        self.assertTrue((self.shared / "machine-shared/SKILL.md").is_file())

    def test_stale_junctions_are_pruned_and_other_junctions_survive(self):
        doomed = self.add_skill(self.repo / "skills/doomed")
        self.run_setup()
        self.assertTrue(self.is_junction(self.shared / "doomed"))
        self.assertTrue(self.is_junction(self.claude / "doomed"))
        external = self.add_skill(self.base / "external")
        self.make_junction(self.shared / "unrelated", external)
        local = self.add_skill(self.shared / "machine-shared")
        shutil.rmtree(doomed)
        result = self.run_setup("--sync")
        self.assertFalse(self.is_junction(self.shared / "doomed"))
        self.assertFalse((self.shared / "doomed").exists())
        self.assertFalse(self.is_junction(self.claude / "doomed"))
        self.assertFalse((self.claude / "doomed").exists())
        # A junction out of this setup's reach, and the real directories on the
        # far side of every junction, are untouched.
        self.assertTrue(self.is_junction(self.shared / "unrelated"))
        self.assertEqual((self.shared / "unrelated").resolve(), external.resolve())
        self.assertTrue((external / "SKILL.md").is_file())
        self.assertTrue((local / "SKILL.md").is_file())
        self.assertTrue(self.is_junction(self.claude / "shared-one"))
        self.assertEqual(result.returncode, 0)

    def test_uninstall_removes_junctions_and_leaves_real_directories(self):
        self.run_setup()
        external = self.add_skill(self.base / "external")
        self.make_junction(self.claude / "unrelated", external)
        local = self.add_skill(self.claude / "claude-only")
        result = self.run_setup("--uninstall")
        self.assertIn("removed:", result.stdout)
        for gone in (self.claude / "shared-one", self.shared / "shared-one"):
            self.assertFalse(self.is_junction(gone), gone)
            self.assertFalse(gone.exists(), gone)
        self.assertTrue(self.claude.is_dir())
        self.assertFalse(self.is_junction(self.claude))
        self.assertTrue(self.is_junction(self.claude / "unrelated"))
        self.assertTrue((external / "SKILL.md").is_file())
        self.assertTrue((local / "SKILL.md").is_file())
        self.assertTrue((self.repo / "skills/shared-one/SKILL.md").is_file())

    def test_local_folders_conflicts_and_unrelated_junctions_survive(self):
        self.run_setup()
        local = self.add_skill(self.claude / "claude-only")
        external = self.add_skill(self.base / "external")
        unrelated = self.claude / "unrelated"
        self.make_junction(unrelated, external)
        self.add_skill(self.repo / "skills/claude-only")
        self.add_skill(self.repo / "skills/new-skill")
        result = self.run_setup("--sync")
        self.assertIn("left untouched", result.stderr)
        self.assertTrue((local / "SKILL.md").is_file())
        self.assertTrue(self.is_junction(unrelated))
        self.assertEqual(unrelated.resolve(), external.resolve())
        self.assertTrue(self.is_junction(self.claude / "new-skill"))

    def test_sync_from_moved_clone_replaces_dangling_junctions(self):
        self.run_setup()
        link = self.shared / "shared-one"
        self.assertTrue(self.is_junction(link))
        moved = self.base / "moved"
        self.repo.rename(moved)
        self.repo = moved
        self.assertFalse(link.exists())
        self.run_setup("--sync")
        self.assertTrue(self.is_junction(link))
        self.assertEqual(link.resolve(), (moved / "skills/shared-one").resolve())
        claude_link = self.claude / "shared-one"
        self.assertTrue(self.is_junction(claude_link))
        self.assertEqual(claude_link.resolve(), (moved / "skills/shared-one").resolve())

    def agents_paths(self):
        (self.home / ".codex").mkdir(exist_ok=True)
        (self.home / ".pi/agent").mkdir(parents=True, exist_ok=True)
        return [self.home / ".agents/AGENTS.md", self.home / ".claude/CLAUDE.md",
                self.home / ".codex/AGENTS.md", self.home / ".pi/agent/AGENTS.md"]

    def marked_copy(self):
        first, rest = (self.repo / "AGENTS.md").read_text(encoding="utf-8").split("\n", 1)
        clone = subprocess.run([self.bash, "-c", "cd \"$1\" && pwd -P", "_",
                                self.repo.as_posix()], text=True, capture_output=True)
        return first.replace("<clone>", clone.stdout.strip()) + "\n" + rest

    def test_agents_md_links_are_real_symlinks_when_allowed(self):
        paths = self.agents_paths()
        result = self.run_setup()
        if "wrote a managed copy" in result.stderr:
            self.skipTest("this runner cannot create symlinks: " + result.stderr)
        for path in paths:
            self.assertTrue(path.is_symlink(), path)
            self.assertEqual(path.read_text(encoding="utf-8"),
                             (self.repo / "AGENTS.md").read_text(encoding="utf-8"))
        self.run_setup("--uninstall")
        for path in paths:
            self.assertFalse(path.exists() or path.is_symlink(), path)

    def test_agents_md_falls_back_to_marked_copies_and_refreshes_them(self):
        paths = self.agents_paths()
        # An `ln` that cannot link stands in for missing symlink rights. It is
        # a function from BASH_ENV, not a PATH entry: Git's bash.exe launcher
        # puts /usr/bin ahead of any PATH the test passes in.
        calls = self.base / "ln-calls"
        shim = self.base / "no-symlinks.sh"
        shim.write_text('ln() { echo "$*" >> "%s"; return 1; }\n' % calls.as_posix(),
                        encoding="utf-8")
        self.env["BASH_ENV"] = shim.as_posix()
        result = self.run_setup()
        self.assertTrue(calls.is_file(), "the ln shim never ran")
        self.assertEqual(result.stderr.count("wrote a managed copy"), 4, result.stderr)
        for path in paths:
            self.assertFalse(path.is_symlink(), path)
            self.assertEqual(path.read_text(encoding="utf-8"), self.marked_copy())
        result = self.run_setup("--sync")
        self.assertNotIn("wrote a managed copy", result.stderr)
        with (self.repo / "AGENTS.md").open("a", encoding="utf-8") as handle:
            handle.write("new rule\n")
        result = self.run_setup("--sync")
        self.assertEqual(result.stderr.count("wrote a managed copy"), 4, result.stderr)
        for path in paths:
            self.assertTrue(path.read_text(encoding="utf-8").endswith("new rule\n"), path)
        self.run_setup("--uninstall")
        for path in paths:
            self.assertFalse(path.exists(), path)

    def run_powershell_merge(self, hooks, action="merge"):
        """Merge the Cursor template with python hidden, so PowerShell runs."""
        definitions = (self.repo / "scripts/setup.sh").read_text(encoding="utf-8")
        harness = self.repo / "scripts/powershell-merge.sh"
        harness.write_text(definitions.split('\nmain "$@"')[0] + r'''
command() {
  if [ "$1" = -v ] && { [ "$2" = python3 ] || [ "$2" = python ]; }; then return 1; fi
  builtin command "$@"
}
merge_hooks "$1" "$REPO/hooks/cursor.json" "$2"
''', encoding="utf-8")
        return subprocess.run([self.bash, "scripts/powershell-merge.sh", hooks.as_posix(),
                               action], cwd=self.repo, env=self.env, text=True,
                              capture_output=True)

    def test_powershell_merges_cursor_hooks_and_leaves_bad_files(self):
        cursor = self.home / ".cursor"
        cursor.mkdir()
        hooks = cursor / "hooks.json"
        herdr = {"command": "bash '/home/x/.cursor/herdr-agent-state.sh' session"}
        hooks.write_text(json.dumps({"hooks": {"sessionStart": [herdr]}, "version": 1}),
                         encoding="utf-8")
        result = self.run_powershell_merge(hooks)
        self.assertEqual(result.returncode, 0, result.stderr)
        entries = json.loads(hooks.read_text(encoding="utf-8"))["hooks"]["sessionStart"]
        self.assertEqual(entries[0], herdr)
        self.assertEqual(len(entries), 2, entries)
        self.assertTrue(entries[1]["command"].endswith('/scripts/setup.sh" --sync'))
        result = self.run_powershell_merge(hooks, "remove")
        self.assertEqual(json.loads(hooks.read_text(encoding="utf-8"))["hooks"]["sessionStart"],
                         [herdr])
        for content in ("{", '{"hooks": []}', '{"hooks": {"sessionStart": {}}}'):
            with self.subTest(content=content):
                hooks.write_text(content, encoding="utf-8")
                result = self.run_powershell_merge(hooks)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(hooks.read_text(encoding="utf-8"), content)
                self.assertIn("by hand", result.stderr)


if __name__ == "__main__":
    unittest.main()

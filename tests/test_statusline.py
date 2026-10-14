#!/usr/bin/env python3
from __future__ import annotations

import copy
from datetime import datetime, timezone, timedelta
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1] / "statusline"
sys.path.insert(0, str(HERE))

import statusline  # noqa: E402


class RendererTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = statusline.load_config(HERE / "config.json")
        self.config = copy.deepcopy(self.config)
        self.config["colors"]["enabled"] = False

    # Tue 2026-08-25 14:00 in a fixed UTC-4 zone.
    TZ = timezone(timedelta(hours=-4))
    NOW = datetime(2026, 8, 25, 14, 0, tzinfo=TZ)

    def test_full_claude_payload_uses_remaining_capacity(self) -> None:
        payload = {
            "model": {"display_name": "Opus 4.6"},
            "effort": {"level": "high"},
            "context_window": {
                "context_window_size": 200_000,
                "current_usage": {
                    "input_tokens": 10_000,
                    "cache_creation_input_tokens": 2_000,
                    "cache_read_input_tokens": 38_000,
                },
            },
            "rate_limits": {
                "five_hour": {
                    "used_percentage": 80,
                    "resets_at": datetime(2026, 8, 25, 15, 5, tzinfo=self.TZ).timestamp(),
                },
                "seven_day": {
                    "used_percentage": 25,
                    "resets_at": datetime(2026, 8, 27, 9, 30, tzinfo=self.TZ).timestamp(),
                },
            },
        }
        self.assertEqual(
            statusline.render_claude(payload, self.config, now=self.NOW),
            "Opus 4.6: high | ctx 50k/200k\n5h: 20% 3:05pm | w: 75% Thu 9:30am",
        )

    def test_reset_time_omitted_when_absent_or_invalid(self) -> None:
        payload = {
            "rate_limits": {
                "five_hour": {"used_percentage": 80},
                "seven_day": {"used_percentage": 25, "resets_at": "soon"},
            },
        }
        self.assertEqual(
            statusline.render_claude(payload, self.config, now=self.NOW),
            "5h: 20% | w: 75%",
        )

    def test_reset_time_uses_local_zone(self) -> None:
        # 15:05 in UTC-4 is 19:05 UTC; rendering in UTC crosses midnight = no.
        payload = {
            "rate_limits": {
                "five_hour": {
                    "used_percentage": 80,
                    "resets_at": datetime(2026, 8, 25, 23, 5, tzinfo=self.TZ).timestamp(),
                },
            },
        }
        utc_now = self.NOW.astimezone(timezone.utc)
        self.assertEqual(
            statusline.render_claude(payload, self.config, now=utc_now),
            "5h: 20% Wed 3:05am",
        )

    def test_missing_context_usage_omits_context_segment(self) -> None:
        payload = {
            "model": {"id": "claude-test"},
            "context_window": {"context_window_size": 200_000},
        }
        self.assertEqual(
            statusline.render_claude(payload, self.config),
            "claude-test",
        )

    def test_quota_values_round_and_clamp(self) -> None:
        payload = {
            "rate_limits": {
                "five_hour": {"used_percentage": 84.5},
                "seven_day": {"remaining_percentage": 101},
            },
        }
        self.assertEqual(
            statusline.render_claude(payload, self.config),
            "5h: 16% | w: 100%",
        )

    def test_context_token_count_formats_millions(self) -> None:
        payload = {
            "context_window": {
                "context_window_size": 2_000_000,
                "current_usage": {
                    "input_tokens": 1_000,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 1_249_000,
                },
            }
        }
        self.assertEqual(
            statusline.render_claude(payload, self.config),
            "ctx 1.3M/2M",
        )

    def test_malformed_json_becomes_empty_payload(self) -> None:
        payload = statusline.parse_json_stream(io.BytesIO(b"{not json"))
        self.assertEqual(statusline.render_claude(payload, self.config), "")

    def test_codex_mapping_follows_shared_order(self) -> None:
        self.assertEqual(
            statusline.codex_status_line(self.config),
            [
                "model-with-reasoning",
                "used-tokens",
                "context-window-size",
                "total-input-tokens",
                "total-output-tokens",
                "estimated-thread-cost",
                "project-name",
                "git-branch",
                "five-hour-limit",
                "weekly-limit",
                "thread-name",
            ],
        )

    def test_second_line_renders_session_details(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "myproj"
            repo.mkdir()
            subprocess.run(
                ["git", "init", "-q", "-b", "feature-x", str(repo)], check=True
            )
            transcript = repo / "t.jsonl"

            def assistant(msg_id: str, sidechain: bool = False) -> str:
                usage = {
                    "input_tokens": 1_000,
                    "cache_creation_input_tokens": 2_000,
                    "cache_read_input_tokens": 7_000,
                    "output_tokens": 500,
                }
                return json.dumps({
                    "type": "assistant",
                    "isSidechain": sidechain,
                    "message": {"id": msg_id, "usage": usage},
                })

            # msg_a is logged twice (one entry per content block); the
            # sidechain message belongs to a subagent and is excluded.
            transcript.write_text("\n".join([
                assistant("msg_a"),
                assistant("msg_a"),
                assistant("msg_b"),
                assistant("msg_side", sidechain=True),
                json.dumps({"type": "user", "message": {"content": "hi"}}),
            ]))
            payload = {
                "cwd": str(repo),
                "workspace": {"current_dir": str(repo), "project_dir": str(repo)},
                "session_name": "status work",
                "transcript_path": str(transcript),
                "cost": {
                    "total_cost_usd": 1.234,
                    "total_lines_added": 156,
                    "total_lines_removed": 23,
                },
                "prompt_cache": {
                    "caching_observed": True,
                    "warm": True,
                    "expires_at": datetime(2026, 8, 25, 15, 5, tzinfo=self.TZ).timestamp(),
                },
            }
            self.assertEqual(
                statusline.render_claude(payload, self.config, now=self.NOW),
                "tok 20k in / 1k out | $1.23 | +156 -23\n"
                "myproj | feature-x\n"
                "status work | cache: warm until 3:05pm",
            )

    def test_cold_cache_and_both_lines(self) -> None:
        payload = {
            "model": {"display_name": "Opus"},
            "prompt_cache": {"caching_observed": True, "warm": False, "expires_at": None},
        }
        self.assertEqual(
            statusline.render_claude(payload, self.config, now=self.NOW),
            "Opus\ncache: cold",
        )


MIB = 1024 * 1024

# Cursor's documented sample payload (~/.cursor/skills-cursor/statusline/SKILL.md).
CURSOR_SAMPLE = {
    "session_id": "abc123",
    "session_name": "my session",
    "transcript_path": "/path/to/transcript.jsonl",
    "render_width_chars": 120,
    "cwd": "/Users/me/project",
    "autorun": False,
    "model": {
        "id": "claude-4-opus",
        "display_name": "Claude 4 Opus",
        "param_summary": "(Thinking)",
        "max_mode": True,
    },
    "workspace": {
        "current_dir": "/Users/me/project",
        "project_dir": "/Users/me/project/.cursor/transcripts",
        "added_dirs": [],
    },
    "version": "1.2.3",
    "output_style": {"name": "default"},
    "context_window": {
        "total_input_tokens": 15234,
        "total_output_tokens": None,
        "context_window_size": 200000,
        "used_percentage": 34.5,
        "remaining_percentage": 65.5,
        "current_usage": None,
    },
    "vim": {"mode": "NORMAL"},
    "worktree": {
        "name": "my-feature",
        "path": "/Users/me/.cursor/worktrees/repo/my-feature",
    },
}

# A payload that sets every field the renderers read.
FULL_PAYLOAD = {
    "model": {"display_name": "Opus", "id": "opus"},
    "effort": {"level": "high"},
    "context_window": {
        "context_window_size": 200_000,
        "current_usage": {
            "input_tokens": 1,
            "cache_creation_input_tokens": 1,
            "cache_read_input_tokens": 1,
        },
    },
    "rate_limits": {
        "five_hour": {"used_percentage": 10, "resets_at": 1_800_000_000},
        "seven_day": {"remaining_percentage": 10, "resets_at": 1_800_000_000},
    },
    "cwd": "/nonexistent/project",
    "workspace": {"current_dir": "/nonexistent/project", "project_dir": "/nonexistent/p"},
    "session_name": "name",
    "transcript_path": "/nonexistent/t.jsonl",
    "cost": {"total_cost_usd": 1, "total_lines_added": 1, "total_lines_removed": 1},
    "prompt_cache": {"caching_observed": True, "warm": True, "expires_at": 1_800_000_000},
}

WRONG_VALUES = [None, True, 5, -1, 1e308, 10**400, "", "x", [], [1], {}]


def _paths(value: object, prefix: tuple[str, ...] = ()) -> list[tuple[str, ...]]:
    paths = [prefix] if prefix else []
    if isinstance(value, dict):
        for key, child in value.items():
            paths.extend(_paths(child, prefix + (key,)))
    return paths


def _with(payload: dict, path: tuple[str, ...], value: object) -> dict:
    result = copy.deepcopy(payload)
    target = result
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return result


class CursorRendererTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = copy.deepcopy(statusline.load_config(HERE / "config.json"))
        self.config["colors"]["enabled"] = False

    def test_sample_payload_labels_project_from_current_dir(self) -> None:
        self.assertEqual(
            statusline.render_cursor(CURSOR_SAMPLE, self.config),
            "Claude 4 Opus\nproject\nmy session",
        )

    def test_project_label_falls_back_to_cwd(self) -> None:
        for workspace in ({"project_dir": "/x/transcripts"}, "bad", {"current_dir": 5}):
            payload = {"cwd": "/Users/me/fallback", "workspace": workspace}
            self.assertEqual(
                statusline.render_cursor(payload, self.config), "fallback", workspace
            )

    def test_session_name_renders_as_for_claude(self) -> None:
        payload = {"session_name": "my session"}
        self.assertEqual(statusline.render_cursor(payload, self.config), "my session")
        self.assertEqual(
            statusline.render_cursor(payload, self.config),
            statusline.render_claude(payload, self.config),
        )

    def test_extra_cursor_fields_are_ignored(self) -> None:
        stripped = copy.deepcopy(CURSOR_SAMPLE)
        for key in ("render_width_chars", "autorun"):
            del stripped[key]
        for key in ("param_summary", "max_mode"):
            del stripped["model"][key]
        self.assertEqual(
            statusline.render_cursor(CURSOR_SAMPLE, self.config),
            statusline.render_cursor(stripped, self.config),
        )

    def test_wrong_typed_fields_never_crash(self) -> None:
        for render in (statusline.render_claude, statusline.render_cursor):
            for top in WRONG_VALUES:
                self.assertIsInstance(render(top, self.config), str)
            for path in _paths(FULL_PAYLOAD):
                for value in WRONG_VALUES:
                    with self.subTest(render=render.__name__, path=path, value=value):
                        payload = _with(FULL_PAYLOAD, path, value)
                        self.assertIsInstance(render(payload, self.config), str)


class BoundedStdinTests(unittest.TestCase):
    def test_reads_at_most_one_mebibyte(self) -> None:
        stream = io.BytesIO(b"{}" + b" " * (2 * MIB))
        self.assertEqual(statusline.parse_json_stream(stream), {})
        self.assertLessEqual(stream.tell(), MIB + 1)

    def test_cap_boundaries(self) -> None:
        body = b'{"session_name": "s"}'
        for size, expected in (
            (MIB - 1, {"session_name": "s"}),
            (MIB, {"session_name": "s"}),
            (MIB + 1, {}),
            (2 * MIB, {}),
        ):
            stream = io.BytesIO(body + b" " * (size - len(body)))
            self.assertEqual(statusline.parse_json_stream(stream), expected, size)

    def test_unparsable_input_becomes_empty_payload(self) -> None:
        for raw in (
            b"",
            b"{not json",
            b"\xff\xfe\x00",
            b"[" * 100_000,
            b"1" * 5_000,
        ):
            self.assertEqual(statusline.parse_json_stream(io.BytesIO(raw)), {}, raw[:20])

    def run_cli(self, provider: str, stdin: bytes) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(HERE / "statusline.py"),
                "--config",
                str(HERE / "config.json"),
                "render",
                provider,
            ],
            input=stdin,
            capture_output=True,
            timeout=30,
        )

    def test_cli_exits_zero_with_minimal_line_on_bad_stdin(self) -> None:
        cases = {
            "empty object": b"{}",
            "empty stdin": b"",
            "non-JSON": b"not json",
            "null": b"null",
            "array": b"[1, 2]",
            "number": b"5",
            "2 MiB": b'{"session_name": "big"}' + b" " * (2 * MIB),
        }
        for provider in ("claude", "cursor"):
            for name, stdin in cases.items():
                with self.subTest(provider=provider, case=name):
                    result = self.run_cli(provider, stdin)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout, b"")
                    self.assertEqual(result.stderr, b"")

    def test_cli_nul_and_newline_paths_never_crash(self) -> None:
        for provider in ("claude", "cursor"):
            for key in ("cwd", "transcript_path"):
                for value in ("\u0000", "a\u0000b", "a\nb", "/tmp/\u0000/x"):
                    with self.subTest(provider=provider, key=key, value=value):
                        result = self.run_cli(provider, json.dumps({key: value}).encode())
                        self.assertEqual(result.returncode, 0, result.stderr)
                        if key == "transcript_path":
                            self.assertEqual(result.stdout, self.run_cli(provider, b"{}").stdout)
                        self.assertEqual(result.stderr, b"")

    def test_session_tokens_survives_malformed_transcript_files(self) -> None:
        cases = {
            "non-dict JSON line": b'["assistant", "usage"]\n',
            "invalid UTF-8": b'\xff\xfe "assistant" "usage"\n',
        }
        for name, content in cases.items():
            with self.subTest(case=name):
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "t.jsonl"
                    path.write_bytes(content)
                    self.assertIsNone(statusline._session_tokens(str(path)))

    def test_cli_render_cursor_sample(self) -> None:
        result = self.run_cli("cursor", json.dumps(CURSOR_SAMPLE).encode())
        self.assertEqual(result.returncode, 0, result.stderr)
        plain = re.sub(rb"\x1b\[[0-9;]*m", b"", result.stdout)
        self.assertEqual(plain, b"Claude 4 Opus\nproject\nmy session")


class CodexSyncTests(unittest.TestCase):
    FIELDS = [
        "model-with-reasoning",
        "used-tokens",
        "context-window-size",
        "five-hour-limit",
        "weekly-limit",
    ]

    def test_adds_tui_table_without_changing_existing_config(self) -> None:
        original = 'model = "gpt-test"\n'
        updated = statusline.update_codex_toml(original, self.FIELDS)
        self.assertIn('model = "gpt-test"', updated)
        self.assertEqual(
            statusline.tomllib.loads(updated)["tui"]["status_line"], self.FIELDS
        )

    def test_updates_multiline_assignment_and_preserves_other_tui_keys(self) -> None:
        original = """[tui]
animations = true
status_line = [
  "current-dir",
]
theme = "test"
"""
        updated = statusline.update_codex_toml(original, self.FIELDS)
        parsed = statusline.tomllib.loads(updated)
        self.assertTrue(parsed["tui"]["animations"])
        self.assertEqual(parsed["tui"]["theme"], "test")
        self.assertEqual(parsed["tui"]["status_line"], self.FIELDS)

    def test_refuses_dotted_assignment(self) -> None:
        with self.assertRaises(statusline.ConfigError):
            statusline.update_codex_toml(
                'tui.status_line = ["current-dir"]\n', self.FIELDS
            )

    def test_sync_is_idempotent_and_preserves_mode(self) -> None:
        config = statusline.load_config(HERE / "config.json")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "config.toml"
            target.write_text('model = "gpt-test"\n', encoding="utf-8")
            target.chmod(0o640)

            self.assertTrue(statusline.sync_codex(target, config))
            first = target.read_text(encoding="utf-8")
            self.assertFalse(statusline.sync_codex(target, config))
            self.assertEqual(target.read_text(encoding="utf-8"), first)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
            self.assertTrue(statusline.check_codex(target, config))


if __name__ == "__main__":
    unittest.main()

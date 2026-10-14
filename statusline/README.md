# statusline

A portable statusline for AI coding agents: one shared config, rendered by
Claude Code, Cursor, and Codex. The repo's `scripts/setup.sh` installs it and keeps it
current (see the [top-level README](../README.md#statusline)). Requires Python
3.11 or newer (`python3`, for `tomllib`).

```
statusline.py   renderer (`render claude`, `render cursor`) and Codex adapter (`sync codex`, `check codex`)
config.json     the shared config: segments, labels, colors, thresholds
```

Its tests are `tests/test_statusline.py` at the repo root.

## Configuration

`config.json` defines field order and presentation for every harness. Claude
Code and Cursor render it directly because they send session JSON to a command. Codex
exposes fixed native footer fields, so `statusline.py` translates the same
segment IDs into Codex's `[tui].status_line` setting.

With the committed `config.json`, Claude renders:

```text
Opus: high | ctx 24k/200k | tok 10k in / 1k out | $1.23 | +156 -23
agents | main | 5h: 20% 3:05pm | w: 75% Thu 9:30am
status work | cache: warm until 3:05pm
```

| Key | Meaning |
| --- | --- |
| `version` | Always `1`. |
| `lines` | Segment IDs per status-line row. |
| `separator` | Text between segments. |
| `labels` | Required prefix for each labelled segment: `context_tokens`, `five_hour_remaining`, `weekly_remaining`, `session_tokens`, `prompt_cache`. |
| `percentage_suffix` | Appended to quota percentages. |
| `colors` | `enabled`, plus ANSI color names for `model`, `label`, `normal`, `warning`, `critical`, `detail`. |
| `remaining_thresholds` | `warning_at_or_below` and `critical_at_or_below`, in percent remaining. |

Segments: `model`, `context_tokens`, `five_hour_remaining`, `weekly_remaining`,
`project`, `git_branch`, `session_name`, `session_tokens`, `cost`,
`lines_changed`, `prompt_cache`.

Codex has a single footer row, so its mapping flattens `lines`; segments
without a native Codex field (`lines_changed`, `prompt_cache`) are skipped
there. Claude's session token totals are summed from the transcript (main
conversation only, cache reads included) because its `context_window` totals
cover only the latest request.

Quota percentages mean capacity remaining, followed by the local clock time the
window resets (`3:05pm`, or `Thu 3:05pm` when not today). Claude renders
context as a compact `24k/200k` value. Codex maps that segment to its native
`used-tokens` and `context-window-size` fields. Provider fields that are
unavailable are omitted.

Cursor's payload follows Claude's shape, but its
`workspace.project_dir` is the directory where it stores transcripts, so
`render cursor` takes the project label from `workspace.current_dir`, else
`cwd`. Its extra fields (`render_width_chars`, `autorun`,
`model.param_summary`, `model.max_mode`) are ignored. Cursor sends no quota or
cost fields, so those segments are omitted there.

Both renderers read at most 1 MiB of stdin. Input that is larger, empty, or not
valid JSON renders as an empty payload; fields that are missing or of the wrong
type are omitted. Either way the command exits 0.

## Commands

```sh
# What Claude's statusLine runs; reads Claude session JSON on stdin.
python3 statusline.py render claude

# What Cursor's statusLine runs; reads Cursor session JSON on stdin.
python3 statusline.py render cursor

# Apply or verify the native Codex mapping without changing other Codex config.
python3 statusline.py sync codex [--target ~/.codex/config.toml]
python3 statusline.py check codex [--target ~/.codex/config.toml]
```

Setup points Cursor at `render cursor` through `statusLine` in
`~/.cursor/cli-config.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "python3 \"<clone>/statusline/statusline.py\" render cursor"
  }
}
```

Restart Cursor to pick up a changed `cli-config.json`.

`--config PATH` (before the command) selects another shared config; setup
always passes this directory's `config.json` and `--target` explicitly.
Otherwise `AI_STATUSLINE_CONFIG` and `CODEX_HOME` are honoured. `sync codex`
writes atomically, preserves the existing file mode, and is idempotent. It
refuses ambiguous TOML rather than overwriting multiple or dotted
`tui.status_line` definitions.

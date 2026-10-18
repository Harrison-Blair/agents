# statusline

A portable statusline for AI coding agents: one shared config, rendered by
Claude Code, Cursor, Codex, and Pi. The repo's `scripts/setup.sh` installs it and keeps it
current (see the [top-level README](../README.md#statusline)). Requires Python
3.11 or newer (`python3`, for `tomllib`).

```
statusline.py   renderer (`render claude`, `render cursor`) and Codex adapter (`sync codex`, `check codex`)
config.json     the shared config: segments, labels, colors, thresholds
```

Pi renders the same config with the `pi/statusline` extension (see [Pi](#pi)).
Its tests are `tests/test_statusline.py` and `tests/test_pi_statusline.ts` at
the repo root. Both run the shared formatting cases in
`tests/statusline_cases.json`, so the two renderers stay in step.

## Configuration

`config.json` defines field order and presentation for every harness. Claude
Code and Cursor render it directly because they send session JSON to a command. Codex
exposes fixed native footer fields, so `statusline.py` translates the same
segment IDs into Codex's `[tui].status_line` setting. Optional `codex.lines`
overrides field order for Codex only; when absent, Codex uses the shared `lines`.
Optional `pi.lines` does the same for Pi. Every layout requires non-empty rows
of supported, non-repeated segment IDs.

The committed Codex layout is project, branch, model with reasoning effort,
context tokens used and capacity, total input tokens, total output tokens,
five-hour quota remaining, and weekly quota remaining. Codex controls the native
labels and separators; shared presentation settings apply to Claude and Cursor.

With the committed `config.json`, Claude renders:

```text
Opus: high | ctx 24k/200k | tok 10k in / 1k out | $1.23 | +156 -23
agents | main | 5h: 20% 3:05pm | w: 75% Thu 9:30am
status work | cache: warm until 3:05pm
```

and Pi renders:

```text
gpt-6.1-sol: high | ctx 24k/272k auto | tok 120k in / 8k out | $0.42 | +156 -23
agents | main | openai-codex | w: 41% Thu 9:30am
fix-footer | cache: 87%
<other extensions' status texts>
```

| Key | Meaning |
| --- | --- |
| `version` | Always `1`. |
| `lines` | Segment IDs per status-line row. |
| `codex.lines` | Optional Codex-only segment rows; falls back to `lines`. |
| `pi.lines` | Optional Pi-only segment rows; falls back to `lines`. |
| `separator` | Text between segments. |
| `labels` | Required prefix for each labelled segment: `context_tokens`, `five_hour_remaining`, `weekly_remaining`, `session_tokens`, `prompt_cache`. |
| `percentage_suffix` | Appended to quota percentages. |
| `colors` | `enabled`, plus ANSI color names for `model`, `label`, `normal`, `warning`, `critical`, `detail`. |
| `remaining_thresholds` | `warning_at_or_below` and `critical_at_or_below`, in percent remaining. |

Segments: `model`, `context_tokens`, `five_hour_remaining`, `weekly_remaining`,
`project`, `git_branch`, `session_name`, `session_tokens`, `cost`,
`lines_changed`, `prompt_cache`, `provider`, `extension_statuses`.
Only Pi has data for `provider` and `extension_statuses`. Claude and Cursor
omit them.

Codex has a single footer row, so its mapping flattens `codex.lines` (or `lines`); segments
without a native Codex field (`lines_changed`, `prompt_cache`, `provider`,
`extension_statuses`) are skipped there. Claude's session token totals are summed from the transcript (main
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

## Pi

The `pi/statusline` extension replaces Pi's footer in the terminal UI. It reads
`config.json` from the clone it links to, or `AI_STATUSLINE_CONFIG` when set,
at every session start. An invalid config keeps Pi's default footer and shows
an error notice. Pi fills the segments from its session:

- `model` is the model ID, plus the thinking level for reasoning models.
- `context_tokens` adds `auto` when automatic compaction is on.
- `session_tokens`, `cost`, and `lines_changed` sum every entry in the session
  file. Input includes cache reads and writes. Cost is Pi's list-price figure,
  also on subscription providers.
- `lines_changed` counts successful edit patches. A write counts all of its
  lines as added. Changes made through bash are not counted.
- `prompt_cache` is the share of the latest prompt read from cache.
- `provider` is the model's provider, such as `openai-codex`.
- `extension_statuses` joins other extensions' `setStatus` texts, sorted by key.
- The quota segments come from the `codex.rate_limits` stream event, so they
  show only on `openai-codex` and only after the first reply. Windows are
  labelled by length: 300 minutes is `five_hour_remaining` and 10080 minutes is
  `weekly_remaining`. The last values are saved to
  `~/.pi/agent/statusline-quota.json` and show dimmed at the next start, until
  a reply brings fresh ones. A window past its reset time is hidden.

Each row is cut to the terminal width.

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
`tui.status_line` definitions. A dangling link, directory, or unreadable file at the
target is left alone and the `[tui]` entry is printed for pasting by hand.

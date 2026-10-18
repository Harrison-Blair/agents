// Tests for pi/statusline/logic.ts. Run: node --test tests/test_pi_statusline.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  clock,
  type Config,
  ConfigError,
  countPatch,
  type FooterInput,
  formatTokenCount,
  joinLines,
  percentageSegment,
  quotaFromCache,
  quotaFromEvent,
  remainingFromUsed,
  renderFooter,
  sessionStats,
  type SessionStats,
  validateConfig,
} from "../pi/statusline/logic.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
const CASES = read("./statusline_cases.json");
const RAW_CONFIG = read("../statusline/config.json");
const NOW = CASES.now as number;
const OFFSET = CASES.offset_minutes as number;

const config = (colors = false, extra: Record<string, unknown> = {}): Config => {
  const data = structuredClone(RAW_CONFIG);
  data.colors.enabled = colors;
  return validateConfig({ ...data, ...extra });
};

// ---- Shared cases (also checked by tests/test_statusline.py) ----

test("shared: token counts", () => {
  for (const [value, expected] of CASES.token_count) assert.equal(formatTokenCount(value), expected, `${value}`);
});

test("shared: clock", () => {
  for (const c of CASES.clock) assert.equal(clock(c.epoch, NOW, c.offset_minutes ?? OFFSET), c.expected, JSON.stringify(c));
});

test("shared: quota segments", () => {
  for (const c of CASES.quota) {
    const reset = c.reset === null ? undefined : clock(c.reset, NOW, OFFSET);
    assert.equal(percentageSegment(c.segment, remainingFromUsed(c.used), reset, config(c.colors)), c.expected, JSON.stringify(c));
  }
});

test("shared: join lines", () => {
  for (const c of CASES.join) assert.deepEqual(joinLines(c.values, c.lines, c.separator), c.expected);
});

test("shared: config validation", () => {
  for (const c of CASES.configs) {
    const data = { ...structuredClone(RAW_CONFIG), ...c.set };
    if (c.valid) validateConfig(data);
    else assert.throws(() => validateConfig(data), ConfigError, JSON.stringify(c.set));
  }
});

// ---- Pi-only behavior ----

test("countPatch counts changed lines and skips file headers", () => {
  const patch = "--- a/x\n+++ b/x\n@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e\n";
  assert.deepEqual(countPatch(patch), { added: 2, removed: 1 });
});

const assistant = (usage: object, content: unknown[] = []) => ({ type: "message", message: { role: "assistant", usage, content } });
const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  cost: { total: cost },
});

test("sessionStats sums all usage sources and counts input with cache", () => {
  const stats = sessionStats([
    assistant(usage(1000, 500, 7000, 2000, 0.5)),
    { type: "usage", usage: usage(100, 0, 0, 0, 0.25) },
    { type: "message", message: { role: "toolResult", toolName: "bash", usage: usage(50, 50) } },
    { type: "compaction", usage: usage(0, 200, 0, 0, 0.25) },
    { type: "message", message: { role: "user", content: "hi" } },
    "garbage",
  ]);
  assert.equal(stats.tokensIn, 10_150);
  assert.equal(stats.tokensOut, 750);
  assert.equal(stats.cost, 1);
  assert.equal(stats.cacheSeen, true);
  assert.equal(stats.latestCacheHit, 70);
});

test("sessionStats counts edit patches and write contents, not errors", () => {
  const stats = sessionStats([
    assistant(usage(1, 1), [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "f", content: "a\nb\nc\n" } }]),
    { type: "message", message: { role: "toolResult", toolName: "write", toolCallId: "w1", isError: false } },
    { type: "message", message: { role: "toolResult", toolName: "edit", details: { patch: "--- f\n+++ f\n-x\n+y\n+z\n" } } },
    { type: "message", message: { role: "toolResult", toolName: "edit", isError: true, details: { patch: "+no\n" } } },
  ]);
  assert.equal(stats.linesAdded, 5);
  assert.equal(stats.linesRemoved, 1);
  assert.equal(stats.cacheSeen, false);
});

// The live event recorded from openai-codex on 2026-10-18 (weekly-only plan).
const LIVE_EVENT = {
  type: "codex.rate_limits",
  plan_type: "prolite",
  rate_limits: {
    allowed: true,
    limit_reached: false,
    primary: { used_percent: 59, window_minutes: 10080, reset_after_seconds: 529713, reset_at: 1792875224 },
    secondary: null,
  },
};

test("quotaFromEvent reads windows and ignores other events", () => {
  assert.deepEqual(quotaFromEvent(LIVE_EVENT, 0), [{ windowMinutes: 10080, usedPercent: 59, resetAt: 1792875224 }]);
  assert.equal(quotaFromEvent({ type: "response.created" }, 0), undefined);
  const noResetAt = { type: "codex.rate_limits", rate_limits: { primary: { used_percent: 10, window_minutes: 300, reset_after_seconds: 60 } } };
  assert.deepEqual(quotaFromEvent(noResetAt, 1000), [{ windowMinutes: 300, usedPercent: 10, resetAt: 1060 }]);
});

test("quotaFromCache rejects malformed data", () => {
  const windows = [{ windowMinutes: 300, usedPercent: 10, resetAt: 5 }];
  assert.deepEqual(quotaFromCache({ windows }), windows);
  for (const bad of [null, {}, { windows: [{}] }, { windows: [{ windowMinutes: "300", usedPercent: 1, resetAt: 1 }] }]) {
    assert.equal(quotaFromCache(bad), undefined);
  }
});

const NO_STATS: SessionStats = { tokensIn: 0, tokensOut: 0, cost: 0, linesAdded: 0, linesRemoved: 0, cacheSeen: false };

const input = (overrides: Partial<FooterInput> = {}): FooterInput => ({
  modelId: "gpt-6.1-sol",
  thinkingLevel: "high",
  provider: "openai-codex",
  contextTokens: 24_000,
  contextWindow: 272_000,
  autoCompact: true,
  stats: {
    tokensIn: 120_000,
    tokensOut: 8_000,
    cost: 0.424,
    linesAdded: 156,
    linesRemoved: 23,
    cacheSeen: true,
    latestCacheHit: 86.6,
  },
  project: "agents",
  branch: "main",
  sessionName: "fix-footer",
  quota: {
    windows: [
      { windowMinutes: 300, usedPercent: 80, resetAt: 1787684700 },
      { windowMinutes: 10080, usedPercent: 59, resetAt: 1787837400 },
    ],
    live: true,
  },
  extensionStatuses: new Map([
    ["zeta", "last"],
    ["alpha", "first\nline"],
  ]),
  ...overrides,
});

test("full footer matches the agreed layout", () => {
  assert.deepEqual(renderFooter(input(), config(), NOW, OFFSET), [
    "gpt-6.1-sol: high | ctx 24k/272k auto | tok 120k in / 8k out | $0.42 | +156 -23",
    "agents | main | openai-codex | 5h: 20% 3:05pm | w: 41% Thu 9:30am",
    "fix-footer | cache: 87%",
    "first line last",
  ]);
});

test("missing data hides segments and empty rows", () => {
  const lines = renderFooter(
    input({
      thinkingLevel: undefined,
      contextTokens: null,
      autoCompact: false,
      stats: NO_STATS,
      branch: null,
      sessionName: undefined,
      quota: undefined,
      extensionStatuses: new Map(),
    }),
    config(),
    NOW,
    OFFSET,
  );
  assert.deepEqual(lines, ["gpt-6.1-sol", "agents | openai-codex"]);
});

test("auto marker follows the compaction setting", () => {
  const off = renderFooter(input({ autoCompact: false }), config(), NOW, OFFSET);
  assert.match(off[0], /\| ctx 24k\/272k \|/);
});

test("quota is hidden on other providers and after its reset", () => {
  const other = renderFooter(input({ provider: "opencode-go" }), config(), NOW, OFFSET);
  assert.equal(other[1], "agents | main | opencode-go");
  const later = 1787700000; // past the 5h reset, before the weekly one
  const lines = renderFooter(input(), config(), later, OFFSET);
  assert.equal(lines[1], "agents | main | openai-codex | w: 41% Thu 9:30am");
});

test("cached quota renders dimmed as one block; live quota uses level colors", () => {
  const quota = { windows: [{ windowMinutes: 10080, usedPercent: 59, resetAt: 1787837400 }], live: false };
  const cached = renderFooter(input({ quota }), config(true), NOW, OFFSET);
  assert.ok(cached[1].endsWith("\x1b[2mw: 41% Thu 9:30am\x1b[0m"), JSON.stringify(cached[1]));
  const live = renderFooter(input({ quota: { ...quota, live: true } }), config(true), NOW, OFFSET);
  assert.ok(live[1].endsWith("\x1b[36mw:\x1b[0m \x1b[32m41%\x1b[0m \x1b[2mThu 9:30am\x1b[0m"), JSON.stringify(live[1]));
});

test("pi.lines overrides the shared layout", () => {
  const lines = renderFooter(input(), config(false, { pi: { lines: [["provider", "model"]] } }), NOW, OFFSET);
  assert.deepEqual(lines, ["openai-codex | gpt-6.1-sol: high"]);
});

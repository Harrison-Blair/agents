// Pure statusline logic for the Pi footer: config validation, segment formatting,
// session stats, and Codex quota. No Pi imports, so tests run under plain Node.
// Formatting mirrors statusline/statusline.py; tests/statusline_cases.json checks both.

export const SUPPORTED_SEGMENTS = new Set([
  "model",
  "context_tokens",
  "five_hour_remaining",
  "weekly_remaining",
  "project",
  "git_branch",
  "session_name",
  "session_tokens",
  "cost",
  "lines_changed",
  "prompt_cache",
  "provider",
  "extension_statuses",
]);

const UNLABELED_SEGMENTS = new Set([
  "model",
  "project",
  "git_branch",
  "session_name",
  "cost",
  "lines_changed",
  "provider",
  "extension_statuses",
]);

export const ANSI: Record<string, string> = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};
const RESET = "\x1b[0m";

type Style = "model" | "label" | "normal" | "warning" | "critical" | "detail";

export interface Config {
  version: 1;
  lines: string[][];
  codex?: { lines: string[][] };
  pi?: { lines: string[][] };
  separator: string;
  labels: Record<string, string>;
  percentage_suffix: string;
  colors: { enabled: boolean } & Record<Style, string>;
  remaining_thresholds: { warning_at_or_below: number; critical_at_or_below: number };
}

export class ConfigError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function validateLines(lines: unknown): void {
  if (!Array.isArray(lines) || lines.length === 0 || lines.some((line) => !Array.isArray(line) || line.length === 0)) {
    throw new ConfigError("lines must be a non-empty list of non-empty lists");
  }
  const segments = (lines as unknown[][]).flat();
  if (segments.some((item) => typeof item !== "string")) {
    throw new ConfigError("every segment ID must be a string");
  }
  const unknown = [...new Set(segments as string[])].filter((item) => !SUPPORTED_SEGMENTS.has(item)).sort();
  if (unknown.length) throw new ConfigError(`unsupported segment IDs: ${unknown.join(", ")}`);
  if (new Set(segments).size !== segments.length) throw new ConfigError("segment IDs must not be repeated");
}

// Accepts and rejects the same configs as load_config() in statusline.py.
export function validateConfig(data: unknown): Config {
  if (!isObject(data) || data.version !== 1) throw new ConfigError("shared config must be an object with version 1");
  validateLines(data.lines);
  for (const harness of ["codex", "pi"]) {
    if (harness in data) {
      const override = data[harness];
      if (!isObject(override)) throw new ConfigError(`${harness} must be an object with lines`);
      validateLines(override.lines);
    }
  }
  if (typeof data.separator !== "string") throw new ConfigError("separator must be a string");
  const labels = data.labels;
  if (!isObject(labels)) throw new ConfigError("labels must be an object");
  for (const key of SUPPORTED_SEGMENTS) {
    if (UNLABELED_SEGMENTS.has(key)) continue;
    if (typeof labels[key] !== "string" || !labels[key]) throw new ConfigError(`labels.${key} must be a non-empty string`);
  }
  if (typeof data.percentage_suffix !== "string") throw new ConfigError("percentage_suffix must be a string");
  const thresholds = data.remaining_thresholds;
  if (!isObject(thresholds)) throw new ConfigError("remaining_thresholds must be an object");
  const warning = finite(thresholds.warning_at_or_below);
  const critical = finite(thresholds.critical_at_or_below);
  if (warning === undefined || critical === undefined || !(0 <= critical && critical <= warning && warning <= 100)) {
    throw new ConfigError("remaining thresholds must satisfy 0 <= critical <= warning <= 100");
  }
  const colors = data.colors;
  if (!isObject(colors) || typeof colors.enabled !== "boolean") {
    throw new ConfigError("colors must be an object with a boolean enabled field");
  }
  for (const key of ["model", "label", "normal", "warning", "critical", "detail"]) {
    if (typeof colors[key] !== "string" || !(colors[key] in ANSI)) {
      throw new ConfigError(`colors.${key} must be one of: ${Object.keys(ANSI).join(", ")}`);
    }
  }
  return data as unknown as Config;
}

export function styled(text: string, style: Style, config: Config): string {
  if (!config.colors.enabled || !text) return text;
  return `${ANSI[config.colors[style]]}${text}${RESET}`;
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.floor(value / 100_000 + 0.5) / 10}M`;
  return `${Math.floor(value / 1_000 + 0.5)}k`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Local clock time of epochSeconds, with the weekday when it is not on now's date.
// Both times use now's UTC offset, as statusline.py does.
export function clock(epochSeconds: number, nowSeconds: number, offsetMinutes: number): string {
  const when = new Date((epochSeconds + offsetMinutes * 60) * 1000);
  const now = new Date((nowSeconds + offsetMinutes * 60) * 1000);
  const hour = when.getUTCHours();
  const text = `${hour % 12 || 12}:${String(when.getUTCMinutes()).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
  const sameDay = when.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  return sameDay ? text : `${WEEKDAYS[when.getUTCDay()]} ${text}`;
}

export function remainingFromUsed(used: number): number {
  return Math.max(0, Math.min(100, Math.floor(100 - used + 0.5)));
}

export function percentageSegment(segment: string, remaining: number, reset: string | undefined, config: Config): string {
  const thresholds = config.remaining_thresholds;
  const level: Style =
    remaining <= thresholds.critical_at_or_below ? "critical" : remaining <= thresholds.warning_at_or_below ? "warning" : "normal";
  let rendered = `${styled(`${config.labels[segment]}:`, "label", config)} ${styled(`${remaining}%`, level, config)}`;
  rendered += styled(config.percentage_suffix, "detail", config);
  if (reset !== undefined) rendered += ` ${styled(reset, "detail", config)}`;
  return rendered;
}

export function joinLines(values: Record<string, string>, lines: string[][], separator: string): string[] {
  const rendered: string[] = [];
  for (const line of lines) {
    const parts = line.filter((segment) => segment in values).map((segment) => values[segment]);
    if (parts.length) rendered.push(parts.join(separator));
  }
  return rendered;
}

// ---- Session stats ----

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

export interface SessionStats {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  linesAdded: number;
  linesRemoved: number;
  cacheSeen: boolean;
  // Share of the latest assistant prompt read from cache, in percent.
  latestCacheHit?: number;
}

const num = (value: unknown): number => finite(value) ?? 0;

// Counts changed lines in a unified diff, skipping the ---/+++ file headers.
export function countPatch(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

const countLines = (text: string): number => (text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0);

// Totals over every session entry, like Pi's default footer. Usage comes from
// assistant messages, tool results, usage entries, and summaries. Lines come
// from successful edit patches and write contents (a write counts as all added).
export function sessionStats(entries: readonly unknown[]): SessionStats {
  const stats: SessionStats = { tokensIn: 0, tokensOut: 0, cost: 0, linesAdded: 0, linesRemoved: 0, cacheSeen: false };
  const writes = new Map<string, string>();
  const add = (usage: unknown) => {
    if (!isObject(usage)) return;
    const u = usage as Usage;
    stats.tokensIn += num(u.input) + num(u.cacheRead) + num(u.cacheWrite);
    stats.tokensOut += num(u.output);
    stats.cost += num(u.cost?.total);
    if (num(u.cacheRead) > 0 || num(u.cacheWrite) > 0) stats.cacheSeen = true;
  };
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
      add(entry.usage);
      continue;
    }
    if (entry.type !== "message" || !isObject(entry.message)) continue;
    const message = entry.message;
    if (message.role === "assistant") {
      add(message.usage);
      if (isObject(message.usage)) {
        const u = message.usage as Usage;
        const prompt = num(u.input) + num(u.cacheRead) + num(u.cacheWrite);
        stats.latestCacheHit = prompt > 0 ? (num(u.cacheRead) / prompt) * 100 : undefined;
      }
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (isObject(part) && part.type === "toolCall" && part.name === "write" && typeof part.id === "string") {
            const args = part.arguments;
            if (isObject(args) && typeof args.content === "string") writes.set(part.id, args.content);
          }
        }
      }
    } else if (message.role === "toolResult") {
      add(message.usage);
      if (message.isError) continue;
      if (message.toolName === "edit" && isObject(message.details) && typeof message.details.patch === "string") {
        const { added, removed } = countPatch(message.details.patch);
        stats.linesAdded += added;
        stats.linesRemoved += removed;
      } else if (message.toolName === "write" && typeof message.toolCallId === "string") {
        stats.linesAdded += countLines(writes.get(message.toolCallId) ?? "");
      }
    }
  }
  return stats;
}

// ---- Codex quota ----

export interface QuotaWindow {
  windowMinutes: number;
  usedPercent: number;
  // Epoch seconds.
  resetAt: number;
}

const QUOTA_SEGMENTS: Record<number, string> = { 300: "five_hour_remaining", 10080: "weekly_remaining" };

// Windows from a `codex.rate_limits` stream event, or undefined for other events.
export function quotaFromEvent(data: unknown, nowSeconds: number): QuotaWindow[] | undefined {
  if (!isObject(data) || data.type !== "codex.rate_limits" || !isObject(data.rate_limits)) return undefined;
  const windows: QuotaWindow[] = [];
  for (const key of ["primary", "secondary"]) {
    const window = data.rate_limits[key];
    if (!isObject(window)) continue;
    const windowMinutes = finite(window.window_minutes);
    const usedPercent = finite(window.used_percent);
    const after = finite(window.reset_after_seconds);
    const resetAt = finite(window.reset_at) ?? (after !== undefined ? nowSeconds + after : undefined);
    if (windowMinutes === undefined || usedPercent === undefined || resetAt === undefined) continue;
    windows.push({ windowMinutes, usedPercent, resetAt });
  }
  return windows;
}

// Reads a cache file's parsed JSON back into windows; anything malformed is no cache.
export function quotaFromCache(data: unknown): QuotaWindow[] | undefined {
  if (!isObject(data) || !Array.isArray(data.windows)) return undefined;
  const windows: QuotaWindow[] = [];
  for (const w of data.windows) {
    if (!isObject(w)) return undefined;
    const windowMinutes = finite(w.windowMinutes);
    const usedPercent = finite(w.usedPercent);
    const resetAt = finite(w.resetAt);
    if (windowMinutes === undefined || usedPercent === undefined || resetAt === undefined) return undefined;
    windows.push({ windowMinutes, usedPercent, resetAt });
  }
  return windows;
}

// Quota segments keyed by segment ID. Windows past their reset are hidden; a
// cached (not live) value renders dimmed as one block.
export function quotaSegments(
  windows: QuotaWindow[],
  live: boolean,
  nowSeconds: number,
  offsetMinutes: number,
  config: Config,
): Record<string, string> {
  const values: Record<string, string> = {};
  const plain = { ...config, colors: { ...config.colors, enabled: false } };
  for (const window of windows) {
    const segment = QUOTA_SEGMENTS[window.windowMinutes];
    if (!segment || window.resetAt <= nowSeconds) continue;
    const reset = clock(window.resetAt, nowSeconds, offsetMinutes);
    const remaining = remainingFromUsed(window.usedPercent);
    values[segment] = live
      ? percentageSegment(segment, remaining, reset, config)
      : styled(percentageSegment(segment, remaining, reset, plain), "detail", config);
  }
  return values;
}

// ---- Footer ----

export interface FooterInput {
  modelId?: string;
  // Present only for reasoning models.
  thinkingLevel?: string;
  provider?: string;
  contextTokens?: number | null;
  contextWindow?: number;
  autoCompact: boolean;
  stats: SessionStats;
  project?: string;
  branch?: string | null;
  sessionName?: string;
  // Codex windows, shown only while the provider is openai-codex.
  quota?: { windows: QuotaWindow[]; live: boolean };
  extensionStatuses: ReadonlyMap<string, string>;
}

const sanitize = (text: string): string => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();

export function footerValues(input: FooterInput, config: Config, nowSeconds: number, offsetMinutes: number): Record<string, string> {
  const values: Record<string, string> = {};
  const labels = config.labels;
  if (input.modelId) {
    values.model = styled(input.modelId, "model", config);
    if (input.thinkingLevel) values.model += styled(`: ${input.thinkingLevel}`, "detail", config);
  }
  if (typeof input.contextTokens === "number" && input.contextWindow) {
    values.context_tokens =
      `${styled(labels.context_tokens, "label", config)} ` +
      `${formatTokenCount(input.contextTokens)}/${formatTokenCount(input.contextWindow)}` +
      (input.autoCompact ? ` ${styled("auto", "detail", config)}` : "");
  }
  const { stats } = input;
  if (stats.tokensIn || stats.tokensOut) {
    values.session_tokens =
      `${styled(labels.session_tokens, "label", config)} ` +
      `${formatTokenCount(stats.tokensIn)} in / ${formatTokenCount(stats.tokensOut)} out`;
  }
  if (stats.cost) values.cost = `$${stats.cost.toFixed(2)}`;
  if (stats.linesAdded || stats.linesRemoved) {
    values.lines_changed = `${styled(`+${stats.linesAdded}`, "normal", config)} ${styled(`-${stats.linesRemoved}`, "critical", config)}`;
  }
  if (input.project) values.project = styled(input.project, "model", config);
  if (input.branch) values.git_branch = input.branch;
  if (input.provider) values.provider = input.provider;
  if (input.sessionName) values.session_name = styled(input.sessionName, "detail", config);
  if (stats.cacheSeen && stats.latestCacheHit !== undefined) {
    values.prompt_cache =
      `${styled(`${labels.prompt_cache}:`, "label", config)} ${styled(`${Math.round(stats.latestCacheHit)}%`, "normal", config)}`;
  }
  if (input.quota && input.provider === "openai-codex") {
    Object.assign(values, quotaSegments(input.quota.windows, input.quota.live, nowSeconds, offsetMinutes, config));
  }
  const statuses = [...input.extensionStatuses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => sanitize(text))
    .filter(Boolean);
  if (statuses.length) values.extension_statuses = statuses.join(" ");
  return values;
}

export function renderFooter(input: FooterInput, config: Config, nowSeconds: number, offsetMinutes: number): string[] {
  const lines = config.pi?.lines ?? config.lines;
  return joinLines(footerValues(input, config, nowSeconds, offsetMinutes), lines, config.separator);
}

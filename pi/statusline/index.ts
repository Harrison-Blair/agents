// Pi extension: replace the footer with the shared statusline (statusline/config.json).
// Linked into ~/.pi/agent/extensions/statusline by scripts/setup.sh.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Config,
  quotaFromCache,
  quotaFromEvent,
  type QuotaWindow,
  renderFooter,
  type SessionStats,
  sessionStats,
  validateConfig,
} from "./logic.ts";

function configPath(): string {
  const override = process.env.AI_STATUSLINE_CONFIG;
  if (override) return override.replace(/^~(?=$|[\\/])/, process.env.HOME ?? "~");
  // realpath resolves the symlink/junction back into the clone.
  const here = realpathSync(dirname(fileURLToPath(import.meta.url)));
  return join(here, "..", "..", "statusline", "config.json");
}

const quotaCachePath = () => join(getAgentDir(), "statusline-quota.json");

function readQuotaCache(): QuotaWindow[] | undefined {
  try {
    return quotaFromCache(JSON.parse(readFileSync(quotaCachePath(), "utf-8")));
  } catch {
    return undefined;
  }
}

function writeQuotaCache(windows: QuotaWindow[]): void {
  const path = quotaCachePath();
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ windows }));
    renameSync(temp, path);
  } catch {
    // The cache is only a startup convenience.
  }
}

export default function (pi: ExtensionAPI) {
  let quota: { windows: QuotaWindow[]; live: boolean } | undefined;
  let requestRender: (() => void) | undefined;

  pi.on("provider_stream_event", async (event) => {
    const windows = quotaFromEvent(event.data, Date.now() / 1000);
    if (!windows) return;
    quota = { windows, live: true };
    writeQuotaCache(windows);
    requestRender?.();
  });

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    let config: Config;
    try {
      config = validateConfig(JSON.parse(readFileSync(configPath(), "utf-8")));
    } catch (error) {
      ctx.ui.notify(`statusline: ${error instanceof Error ? error.message : error}; default footer kept`, "error");
      return;
    }
    if (!quota?.live) {
      const cached = readQuotaCache();
      quota = cached ? { windows: cached, live: false } : undefined;
    }

    ctx.ui.setFooter((tui, _theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      requestRender = () => tui.requestRender();
      // render() runs every frame; entries are append-only, so stats change only
      // with the entry count or leaf.
      let cached: { key: string; stats: SessionStats } | undefined;
      const stats = (): SessionStats => {
        const manager = ctx.sessionManager;
        const entries = manager.getEntries();
        const key = `${manager.getSessionId()}:${manager.getLeafId()}:${entries.length}`;
        if (cached?.key !== key) cached = { key, stats: sessionStats(entries) };
        return cached.stats;
      };
      return {
        dispose() {
          unsubscribe();
          requestRender = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          const model = ctx.model;
          const usage = ctx.getContextUsage();
          const now = Date.now();
          const lines = renderFooter(
            {
              modelId: model?.id,
              thinkingLevel: model?.reasoning ? pi.getThinkingLevel() : undefined,
              provider: model?.provider,
              contextTokens: usage?.tokens,
              contextWindow: usage?.contextWindow ?? model?.contextWindow,
              autoCompact: pi.getSettings().compaction?.enabled !== false,
              stats: stats(),
              project: basename(ctx.sessionManager.getCwd()),
              branch: footerData.getGitBranch(),
              sessionName: ctx.sessionManager.getSessionName(),
              quota,
              extensionStatuses: footerData.getExtensionStatuses(),
            },
            config,
            now / 1000,
            -new Date(now).getTimezoneOffset(),
          );
          return lines.map((line) => truncateToWidth(line, width, "…"));
        },
      };
    });
  });
}

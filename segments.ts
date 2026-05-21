import { hostname as osHostname } from "node:os";
import { basename } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { BuiltinStatusLineSegmentId, RenderedSegment, SegmentContext, SemanticColor, StatusLineSegment, StatusLineSegmentId } from "./types.ts";
import { normalizeCompactExtensionStatus, normalizeExtensionStatusValue } from "./powerline-config.ts";
import { fg, rainbow, applyColor } from "./theme.ts";
import { getIcons, SEP_DOT, getThinkingText } from "./icons.ts";
import { getQuotaData } from "./api-quotas.ts";

function color(ctx: SegmentContext, semantic: SemanticColor, text: string): string {
  return fg(ctx.theme, semantic, text, ctx.colors);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.round(n / 1000000)}M`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Segment Implementations
// ═══════════════════════════════════════════════════════════════════════════

const modelSegment: StatusLineSegment = {
  id: "model",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.model ?? {};

    let modelName = ctx.model?.name || ctx.model?.id || "no-model";
    // Strip "Claude " prefix for brevity
    if (modelName.startsWith("Claude ")) {
      modelName = modelName.slice(7);
    }

    let content = withIcon(icons.model, modelName);

    if (opts.showThinkingLevel !== false && ctx.model?.reasoning) {
      const level = ctx.thinkingLevel || "off";
      if (level !== "off") {
        const thinkingText = getThinkingText(level);
        if (thinkingText) {
          content += `${SEP_DOT}${thinkingText}`;
        }
      }
    }

    return { content: color(ctx, "model", content), visible: true };
  },
};

const shellModeSegment: StatusLineSegment = {
  id: "shell_mode",
  render(ctx) {
    if (!ctx.shellModeActive) {
      return { content: "", visible: false };
    }

    const shellName = ctx.shellName ?? "shell";
    const state = ctx.shellRunning ? "run" : "idle";
    const cwd = ctx.shellCwd ? basename(ctx.shellCwd) : null;
    const parts = [shellName, state];
    if (cwd) {
      parts.push(cwd);
    }

    return { content: color(ctx, "shellMode", parts.join(SEP_DOT)), visible: true };
  },
};

const pathSegment: StatusLineSegment = {
  id: "path",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.path ?? {};
    const mode = opts.mode ?? "basename";

    let pwd = ctx.shellModeActive && ctx.shellCwd ? ctx.shellCwd : (ctx.cwd ?? process.cwd());
    const home = process.env.HOME || process.env.USERPROFILE;

    if (mode === "basename") {
      // Just the last directory component (cross-platform)
      pwd = basename(pwd) || pwd;
    } else {
      // Abbreviate home directory for abbreviated/full modes
      if (home && pwd.startsWith(home)) {
        pwd = `~${pwd.slice(home.length)}`;
      }

      // Strip /work/ prefix (common in containers)
      if (pwd.startsWith("/work/")) {
        pwd = pwd.slice(6);
      }

      // Truncate if too long (only for abbreviated mode)
      if (mode === "abbreviated") {
        const maxLen = opts.maxLength ?? 40;
        if (pwd.length > maxLen) {
          pwd = `…${pwd.slice(-(maxLen - 1))}`;
        }
      }
    }

    const content = withIcon(icons.folder, pwd);
    return { content: color(ctx, "path", content), visible: true };
  },
};

const gitSegment: StatusLineSegment = {
  id: "git",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.git ?? {};
    const { branch, staged, unstaged, untracked } = ctx.git;
    const gitStatus = (staged > 0 || unstaged > 0 || untracked > 0) 
      ? { staged, unstaged, untracked } 
      : null;

    if (!branch && !gitStatus) return { content: "", visible: false };

    const isDirty = gitStatus && (gitStatus.staged > 0 || gitStatus.unstaged > 0 || gitStatus.untracked > 0);
    const showBranch = opts.showBranch !== false;
    const branchColor: SemanticColor = isDirty ? "gitDirty" : "gitClean";

    // Build content - color branch separately from indicators
    let content = "";
    if (showBranch && branch) {
      // Color just the branch name (icon + branch text)
      content = color(ctx, branchColor, withIcon(icons.branch, branch));
    }

    // Add status indicators (each with their own color, not wrapped)
    if (gitStatus) {
      const indicators: string[] = [];
      if (opts.showUnstaged !== false && gitStatus.unstaged > 0) {
        indicators.push(applyColor(ctx.theme, "warning", `*${gitStatus.unstaged}`));
      }
      if (opts.showStaged !== false && gitStatus.staged > 0) {
        indicators.push(applyColor(ctx.theme, "success", `+${gitStatus.staged}`));
      }
      if (opts.showUntracked !== false && gitStatus.untracked > 0) {
        indicators.push(applyColor(ctx.theme, "muted", `?${gitStatus.untracked}`));
      }
      if (indicators.length > 0) {
        const indicatorText = indicators.join(" ");
        if (!content && showBranch === false) {
          // No branch shown, color the git icon with branch color
          content = color(ctx, branchColor, icons.git ? `${icons.git} ` : "") + indicatorText;
        } else {
          content += content ? ` ${indicatorText}` : indicatorText;
        }
      }
    }

    if (!content) return { content: "", visible: false };

    return { content, visible: true };
  },
};

const thinkingSegment: StatusLineSegment = {
  id: "thinking",
  render(ctx) {
    const level = ctx.thinkingLevel || "off";

    const levelText: Record<string, string> = {
      off: "off",
      minimal: "min",
      low: "low",
      medium: "med",
      high: "high",
      xhigh: "xhigh",
    };
    const label = levelText[level] || level;
    const content = `think:${label}`;

    if (level === "high" || level === "xhigh") {
      return { content: rainbow(content), visible: true };
    }

    if (level === "minimal") {
      return { content: color(ctx, "thinkingMinimal", content), visible: true };
    }
    if (level === "low") {
      return { content: color(ctx, "thinkingLow", content), visible: true };
    }
    if (level === "medium") {
      return { content: color(ctx, "thinkingMedium", content), visible: true };
    }

    return { content: color(ctx, "thinking", content), visible: true };
  },
};

const subagentsSegment: StatusLineSegment = {
  id: "subagents",
  render() {
    // Note: pi-mono doesn't have subagent tracking built-in
    // This would require extension state management
    // For now, return not visible
    return { content: "", visible: false };
  },
};

const tokenInSegment: StatusLineSegment = {
  id: "token_in",
  render(ctx) {
    const icons = getIcons();
    const { input } = ctx.usageStats;
    if (!input) return { content: "", visible: false };

    const content = withIcon(icons.input, formatTokens(input));
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const tokenOutSegment: StatusLineSegment = {
  id: "token_out",
  render(ctx) {
    const icons = getIcons();
    const { output } = ctx.usageStats;
    if (!output) return { content: "", visible: false };

    const content = withIcon(icons.output, formatTokens(output));
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const tokenTotalSegment: StatusLineSegment = {
  id: "token_total",
  render(ctx) {
    const icons = getIcons();
    const { input, output, cacheRead, cacheWrite } = ctx.usageStats;
    const total = input + output + cacheRead + cacheWrite;
    if (!total) return { content: "", visible: false };

    const content = withIcon(icons.tokens, formatTokens(total));
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const costSegment: StatusLineSegment = {
  id: "cost",
  render(ctx) {
    const { cost } = ctx.usageStats;
    const usingSubscription = ctx.usingSubscription;

    if (!cost && !usingSubscription) {
      return { content: "", visible: false };
    }

    const costDisplay = usingSubscription ? "(sub)" : `$${cost.toFixed(2)}`;
    return { content: color(ctx, "cost", costDisplay), visible: true };
  },
};

const contextPctSegment: StatusLineSegment = {
  id: "context_pct",
  render(ctx) {
    if (ctx.customCompactionEnabled) return { content: "", visible: false };

    const icons = getIcons();
    const pct = ctx.contextPercent;
    const window = ctx.contextWindow;

    // Progress bar (8 segments)
    const barLen = 8;
    const filled = Math.round(pct / 100 * barLen);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

    const text = `${bar} ${pct.toFixed(1)}%/${formatTokens(window)}`;

    // Use semantic colors for thresholds
    let content: string;
    if (pct > 90) {
      content = color(ctx, "contextError", text);
    } else if (pct > 70) {
      content = color(ctx, "contextWarn", text);
    } else {
      content = color(ctx, "context", text);
    }

    return { content, visible: true };
  },
};

const contextTotalSegment: StatusLineSegment = {
  id: "context_total",
  render(ctx) {
    if (ctx.customCompactionEnabled) return { content: "", visible: false };

    const icons = getIcons();
    const window = ctx.contextWindow;
    if (!window) return { content: "", visible: false };

    return {
      content: color(ctx, "context", withIcon(icons.context, formatTokens(window))),
      visible: true,
    };
  },
};

const timeSpentSegment: StatusLineSegment = {
  id: "time_spent",
  render(ctx) {
    const icons = getIcons();
    const elapsed = Date.now() - ctx.sessionStartTime;
    if (elapsed < 1000) return { content: "", visible: false };

    return { content: withIcon(icons.time, formatDuration(elapsed)), visible: true };
  },
};

const timeSegment: StatusLineSegment = {
  id: "time",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.time ?? {};
    const now = new Date();

    let hours = now.getHours();
    let suffix = "";
    if (opts.format === "12h") {
      suffix = hours >= 12 ? "pm" : "am";
      hours = hours % 12 || 12;
    }

    const mins = now.getMinutes().toString().padStart(2, "0");
    let timeStr = `${hours}:${mins}`;
    if (opts.showSeconds) {
      timeStr += `:${now.getSeconds().toString().padStart(2, "0")}`;
    }
    timeStr += suffix;

    return { content: withIcon(icons.time, timeStr), visible: true };
  },
};

const sessionSegment: StatusLineSegment = {
  id: "session",
  render(ctx) {
    const icons = getIcons();
    const sessionId = ctx.sessionId;
    const display = sessionId?.slice(0, 8) || "new";

    return { content: withIcon(icons.session, display), visible: true };
  },
};

const hostnameSegment: StatusLineSegment = {
  id: "hostname",
  render() {
    const icons = getIcons();
    const name = osHostname().split(".")[0];
    return { content: withIcon(icons.host, name), visible: true };
  },
};

const cacheReadSegment: StatusLineSegment = {
  id: "cache_read",
  render(ctx) {
    const icons = getIcons();
    const { cacheRead } = ctx.usageStats;
    if (!cacheRead) return { content: "", visible: false };

    const parts = [icons.cache, icons.input, formatTokens(cacheRead)].filter(Boolean);
    const content = parts.join(" ");
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const cacheWriteSegment: StatusLineSegment = {
  id: "cache_write",
  render(ctx) {
    const icons = getIcons();
    const { cacheWrite } = ctx.usageStats;
    if (!cacheWrite) return { content: "", visible: false };

    const parts = [icons.cache, icons.output, formatTokens(cacheWrite)].filter(Boolean);
    const content = parts.join(" ");
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const extensionStatusesSegment: StatusLineSegment = {
  id: "extension_statuses",
  render(ctx) {
    const statuses = ctx.extensionStatuses;
    if (!statuses || statuses.size === 0) return { content: "", visible: false };

    // Join compact statuses with a separator
    // Skip: empty strings, notification-style ("[...") shown above editor,
    // and strings that are only ANSI codes with no visible text.
    // Also skip statuses explicitly elevated into dedicated custom segments.
    const parts: string[] = [];
    for (const [statusKey, value] of statuses.entries()) {
      if (ctx.hiddenExtensionStatusKeys.has(statusKey)) continue;
      const normalized = value ? normalizeCompactExtensionStatus(value) : null;
      if (normalized) {
        parts.push(normalized);
      }
    }

    if (parts.length === 0) return { content: "", visible: false };

    // Statuses already have their own styling applied by the extensions
    const content = parts.join(` ${SEP_DOT} `);
    return { content, visible: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Segment Registry
// ═══════════════════════════════════════════════════════════════════════════

export const SEGMENTS: Record<BuiltinStatusLineSegmentId, StatusLineSegment> = {
  model: modelSegment,
  shell_mode: shellModeSegment,
  path: pathSegment,
  git: gitSegment,
  thinking: thinkingSegment,
  subagents: subagentsSegment,
  token_in: tokenInSegment,
  token_out: tokenOutSegment,
  token_total: tokenTotalSegment,
  cost: costSegment,
  context_pct: contextPctSegment,
  context_total: contextTotalSegment,
  time_spent: timeSpentSegment,
  time: timeSegment,
  session: sessionSegment,
  hostname: hostnameSegment,
  cache_read: cacheReadSegment,
  cache_write: cacheWriteSegment,
  extension_statuses: extensionStatusesSegment,
  glm_quota: {
    id: "glm_quota",
    render(ctx) {
      const quota = getQuotaData();
      if (!quota.glm) return { content: "", visible: false };
      const { fiveHrPct, sevenDayPct } = quota.glm;
      const icons = getIcons();
      const text = `${icons.model} GLM ${fiveHrPct}%·${sevenDayPct}%`;
      // Color thresholds
      const maxPct = Math.max(fiveHrPct, sevenDayPct);
      let semantic: SemanticColor = "model";
      if (maxPct >= 90) semantic = "contextError";
      else if (maxPct >= 70) semantic = "contextWarn";
      return { content: color(ctx, semantic, text), visible: true };
    },
  },
  deepseek_balance: {
    id: "deepseek_balance",
    render(ctx) {
      const quota = getQuotaData();
      if (!quota.deepseek) return { content: "", visible: false };
      const icons = getIcons();
      const text = `${icons.cost} DS $${quota.deepseek.balance}`;
      const bal = parseFloat(quota.deepseek.balance);
      let semantic: SemanticColor = "cost";
      if (bal < 1) semantic = "contextError";
      else if (bal < 5) semantic = "contextWarn";
      return { content: color(ctx, semantic, text), visible: true };
    },
  },
};

function renderCustomSegment(id: `custom:${string}`, ctx: SegmentContext): RenderedSegment {
  const customItemId = id.slice("custom:".length);
  const custom = ctx.customItemsById.get(customItemId);
  if (!custom) return { content: "", visible: false };

  const rawStatus = ctx.extensionStatuses.get(custom.statusKey);
  const normalizedStatus = rawStatus ? normalizeExtensionStatusValue(rawStatus) : null;
  if (!normalizedStatus) {
    return custom.hideWhenMissing ? { content: "", visible: false } : { content: custom.prefix ?? custom.id, visible: true };
  }

  let content = normalizedStatus;
  if (custom.prefix) {
    content = `${custom.prefix}${SEP_DOT}${content}`;
  }
  if (custom.color) {
    content = applyColor(ctx.theme, custom.color, content);
  }

  return { content, visible: true };
}

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
  if (id.startsWith("custom:")) {
    return renderCustomSegment(id, ctx);
  }

  const segment = SEGMENTS[id];
  if (!segment) {
    return { content: "", visible: false };
  }
  return segment.render(ctx);
}

import type { BuiltinStatusLinePreset, ColorScheme, PresetDef } from "./types.ts";
import { getDefaultColors } from "./theme.ts";

// Get base colors from theme.ts (single source of truth)
const DEFAULT_COLORS: ColorScheme = getDefaultColors();

// Minimal - more muted, less colorful
const MINIMAL_COLORS: ColorScheme = {
  ...DEFAULT_COLORS,
  model: "text",
  path: "text",
  gitClean: "dim",
};

// Nerd - vibrant colors
const NERD_COLORS: ColorScheme = {
  ...DEFAULT_COLORS,
  model: "accent",
  path: "success",
  tokens: "muted",
  cost: "warning",
};

export const PRESETS: Record<BuiltinStatusLinePreset, PresetDef> = {
  default: {
    leftSegments: ["model", "thinking", "shell_mode", "path", "git", "context_pct", "cache_read", "cost"],
    rightSegments: [],
    secondarySegments: ["extension_statuses"],
    separator: "powerline-thin",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },

  minimal: {
    leftSegments: ["shell_mode", "path", "git"],
    rightSegments: ["context_pct"],
    separator: "slash",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: false, showUnstaged: false, showUntracked: false },
    },
  },

  compact: {
    leftSegments: ["model", "shell_mode", "git"],
    rightSegments: ["cost", "context_pct"],
    separator: "powerline-thin",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
    },
  },

  full: {
    leftSegments: ["hostname", "model", "thinking", "shell_mode", "path", "git", "subagents"],
    rightSegments: ["token_in", "token_out", "cache_read", "cost", "context_pct", "time_spent", "time", "extension_statuses"],
    separator: "powerline",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 50 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: false },
    },
  },

  nerd: {
    leftSegments: ["hostname", "model", "thinking", "shell_mode", "path", "git", "session", "subagents"],
    rightSegments: ["token_in", "token_out", "cache_read", "cache_write", "cost", "context_pct", "context_total", "time_spent", "time", "extension_statuses"],
    separator: "powerline",
    colors: NERD_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 60 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: true },
    },
  },

  ascii: {
    leftSegments: ["model", "shell_mode", "path", "git"],
    rightSegments: ["token_total", "cost", "context_pct"],
    separator: "ascii",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: true },
      path: { mode: "abbreviated", maxLength: 40 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },
};

export function getPreset(name: BuiltinStatusLinePreset): PresetDef {
  return PRESETS[name] ?? PRESETS.default;
}

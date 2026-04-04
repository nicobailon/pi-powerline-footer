import {
  copyToClipboard,
  type ExtensionAPI,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { type SelectItem, SelectList, truncateToWidth, visibleWidth, Input, fuzzyFilter } from "@mariozechner/pi-tui";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import type { ColorScheme, SegmentContext, StatusLinePreset, StatusLineSegmentId } from "./types.js";
import { getPreset, PRESETS } from "./presets.js";
import { getSeparator } from "./separators.js";
import { renderSegment } from "./segments.js";
import { getGitStatus, invalidateGitStatus, invalidateGitBranch } from "./git-status.js";
import { ansi, getFgAnsiCode } from "./colors.js";
import { WelcomeComponent, WelcomeHeader, discoverLoadedCounts, getRecentSessions } from "./welcome.js";
import { getDefaultColors } from "./theme.js";
import { 
  initVibeManager, 
  onVibeBeforeAgentStart, 
  onVibeAgentStart, 
  onVibeAgentEnd,
  onVibeToolCall,
  getVibeTheme,
  setVibeTheme,
  getVibeModel,
  setVibeModel,
  getVibeMode,
  setVibeMode,
  hasVibeFile,
  getVibeFileCount,
  generateVibesBatch,
} from "./working-vibes.js";
import {
  type ProfileConfig,
  findMatchingProfileIndex,
  getActiveProfileIndex,
  getProfileDisplayName,
  getProfilesCache,
  isThinkingLevel,
  parseModelSpec,
  reloadProfiles,
  saveProfiles,
  setActiveProfileIndex,
} from "./profiles.js";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

interface PowerlineConfig {
  preset: StatusLinePreset;
}

let config: PowerlineConfig = {
  preset: "default",
};

interface PowerlineShortcuts {
  stashHistory: string;
  copyEditor: string;
  cutEditor: string;
  profileCycle: string;
  profileSelect: string;
}

type PowerlineShortcutKey = keyof PowerlineShortcuts;

const STASH_HISTORY_LIMIT = 12;
const PROJECT_PROMPT_HISTORY_LIMIT = 50;
const STASH_PREVIEW_WIDTH = 72;
const DEFAULT_SHORTCUTS: PowerlineShortcuts = {
  stashHistory: "ctrl+alt+h",
  copyEditor: "ctrl+alt+c",
  cutEditor: "ctrl+alt+x",
  profileCycle: "alt+shift+tab",
  profileSelect: "ctrl+alt+m",
};
const SHORTCUT_KEYS: PowerlineShortcutKey[] = ["stashHistory", "copyEditor", "cutEditor", "profileCycle", "profileSelect"];
const RESERVED_SHORTCUTS = new Set(["alt+s"]);
const SHORTCUT_MODIFIERS = new Set(["ctrl", "alt", "shift"]);
const SHORTCUT_NAMED_KEYS = new Set([
  "escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert", "clear",
  "home", "end", "pageup", "pagedown", "up", "down", "left", "right",
]);
const SHORTCUT_SYMBOL_KEYS = new Set([
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
  "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "|", "~", "{", "}", ":", "<", ">", "?",
]);
const PROMPT_HISTORY_LIMIT = 100;
const PROMPT_HISTORY_TRACKED = Symbol.for("powerlinePromptHistoryTracked");
const PROMPT_HISTORY_STATE_KEY = Symbol.for("powerlinePromptHistoryState");

function getPromptHistoryState(): { savedPromptHistory: string[] } {
  const globalState = globalThis as any;
  if (!globalState[PROMPT_HISTORY_STATE_KEY]) {
    globalState[PROMPT_HISTORY_STATE_KEY] = { savedPromptHistory: [] };
  }
  return globalState[PROMPT_HISTORY_STATE_KEY];
}

function readPromptHistory(editor: any): string[] {
  const history = editor?.history;
  if (!Array.isArray(history)) return [];

  const normalized: string[] = [];
  for (const entry of history) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (normalized.length > 0 && normalized[normalized.length - 1] === trimmed) continue;
    normalized.push(trimmed);
    if (normalized.length >= PROMPT_HISTORY_LIMIT) break;
  }

  return normalized;
}

function snapshotPromptHistory(editor: any): void {
  const history = readPromptHistory(editor);
  if (history.length > 0) {
    getPromptHistoryState().savedPromptHistory = [...history];
  }
}

function restorePromptHistory(editor: any): void {
  const { savedPromptHistory } = getPromptHistoryState();
  if (!savedPromptHistory.length || typeof editor?.addToHistory !== "function") return;

  for (let i = savedPromptHistory.length - 1; i >= 0; i--) {
    editor.addToHistory(savedPromptHistory[i]);
  }
}

function trackPromptHistory(editor: any): void {
  if (!editor || typeof editor.addToHistory !== "function") return;
  if (editor[PROMPT_HISTORY_TRACKED]) {
    snapshotPromptHistory(editor);
    return;
  }

  const originalAddToHistory = editor.addToHistory.bind(editor);
  editor.addToHistory = (text: string) => {
    originalAddToHistory(text);
    snapshotPromptHistory(editor);
  };
  editor[PROMPT_HISTORY_TRACKED] = true;
  snapshotPromptHistory(editor);
}

function getSettingsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStashHistoryPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "powerline-footer", "stash-history.json");
}

function getSessionsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "sessions");
}

function getProjectSessionsPath(cwd: string): string {
  const projectKey = cwd
    .replace(/^[/\\]+|[/\\]+$/g, "")
    .replace(/[\\/]+/g, "-");

  return join(getSessionsPath(), `--${projectKey}--`);
}

function getPromptHistoryText(content: unknown): string {
  if (typeof content === "string") {
    return content.replace(/\s+/g, " ").trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      continue;
    }
    parts.push(block.text);
  }

  return parts.join("\n").replace(/\s+/g, " ").trim();
}

function readRecentProjectPrompts(cwd: string, limit: number): string[] {
  const sessionsPath = getProjectSessionsPath(cwd);
  if (!existsSync(sessionsPath)) {
    return [];
  }

  const promptEntries: { text: string; timestamp: number }[] = [];
  const fileNames = readdirSync(sessionsPath)
    .filter((fileName) => fileName.endsWith(".jsonl"));

  for (const fileName of fileNames) {
    const filePath = join(sessionsPath, fileName);
    const lines = readFileSync(filePath, "utf-8").split("\n");

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes('"type":"message"') || !line.includes('"role":"user"')) {
        continue;
      }

      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse session file ${filePath}: ${message}`);
      }

      if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") {
        continue;
      }

      const text = getPromptHistoryText(entry.message.content);
      if (!hasNonWhitespaceText(text)) {
        continue;
      }

      const timestamp = typeof entry.message.timestamp === "number"
        ? entry.message.timestamp
        : typeof entry.timestamp === "string"
          ? Date.parse(entry.timestamp)
          : 0;

      promptEntries.push({ text, timestamp: Number.isFinite(timestamp) ? timestamp : 0 });
    }
  }

  promptEntries.sort((a, b) => b.timestamp - a.timestamp);

  const prompts: string[] = [];
  const seen = new Set<string>();
  for (const entry of promptEntries) {
    if (seen.has(entry.text)) {
      continue;
    }

    seen.add(entry.text);
    prompts.push(entry.text);
    if (prompts.length >= limit) {
      return prompts;
    }
  }

  return prompts;
}

function normalizeStashHistoryEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const history: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    if (!hasNonWhitespaceText(entry)) {
      continue;
    }

    if (history[history.length - 1] === entry) {
      continue;
    }

    history.push(entry);
    if (history.length >= STASH_HISTORY_LIMIT) {
      break;
    }
  }

  return history;
}

function readPersistedStashHistory(): string[] {
  const stashHistoryPath = getStashHistoryPath();

  try {
    if (!existsSync(stashHistoryPath)) {
      return [];
    }

    const parsed = JSON.parse(readFileSync(stashHistoryPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[powerline-footer] Ignoring invalid stash history at ${stashHistoryPath}`);
      return [];
    }

    return normalizeStashHistoryEntries(parsed.history);
  } catch (error) {
    console.debug(`[powerline-footer] Failed to read stash history from ${stashHistoryPath}:`, error);
    return [];
  }
}

function persistStashHistory(history: string[]): void {
  const stashHistoryPath = getStashHistoryPath();
  const payload = {
    version: 1,
    history: history.slice(0, STASH_HISTORY_LIMIT),
  };

  try {
    mkdirSync(dirname(stashHistoryPath), { recursive: true });
    writeFileSync(stashHistoryPath, JSON.stringify(payload, null, 2) + "\n");
  } catch (error) {
    console.debug(`[powerline-footer] Failed to persist stash history to ${stashHistoryPath}:`, error);
  }
}

function readSettings(): Record<string, unknown> {
  const settingsPath = getSettingsPath();
  try {
    if (!existsSync(settingsPath)) {
      return {};
    }

    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[powerline-footer] Ignoring non-object settings at ${settingsPath}`);
      return {};
    }
    return parsed;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

function writePowerlinePresetSetting(preset: StatusLinePreset): boolean {
  const settingsPath = getSettingsPath();
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (!isRecord(parsed)) {
        console.debug(`[powerline-footer] Refusing to write preset to non-object settings at ${settingsPath}`);
        return false;
      }
      settings = parsed;
    } catch (error) {
      console.debug(`[powerline-footer] Failed to parse settings at ${settingsPath}:`, error);
      return false;
    }
  }

  settings.powerline = preset;

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to persist preset to ${settingsPath}:`, error);
    return false;
  }
}

function isValidPreset(value: unknown): value is StatusLinePreset {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

function normalizePreset(value: unknown): StatusLinePreset | null {
  if (typeof value !== "string") {
    return null;
  }

  const preset = value.trim().toLowerCase();
  return isValidPreset(preset) ? preset : null;
}

function hasNonWhitespaceText(text: string): boolean {
  return text.trim().length > 0;
}

function getCurrentEditorText(ctx: any, editor: any): string {
  return editor?.getExpandedText?.() ?? ctx.ui.getEditorText();
}

function buildStashPreview(text: string, maxWidth: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "(empty)";
  return truncateWithEllipsisByWidth(compact, maxWidth);
}

function pushStashHistory(history: string[], text: string): boolean {
  if (!hasNonWhitespaceText(text)) return false;
  if (history[0] === text) return false;

  history.unshift(text);
  if (history.length > STASH_HISTORY_LIMIT) {
    history.length = STASH_HISTORY_LIMIT;
  }

  return true;
}

function normalizeShortcut(value: string): string {
  return value.trim().toLowerCase();
}

function isValidShortcutKeyPart(keyPart: string): boolean {
  const lowerKeyPart = keyPart.toLowerCase();

  if (/^[a-z0-9]$/i.test(keyPart)) return true;
  if (/^f([1-9]|1[0-2])$/i.test(keyPart)) return true;
  if (SHORTCUT_NAMED_KEYS.has(lowerKeyPart)) return true;

  return SHORTCUT_SYMBOL_KEYS.has(keyPart);
}

function parseShortcutOverride(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split("+");
  if (parts.some((part) => part.length === 0)) {
    return null;
  }

  const modifierParts = parts.slice(0, -1).map((part) => part.toLowerCase());
  if (new Set(modifierParts).size !== modifierParts.length) {
    return null;
  }

  for (const modifier of modifierParts) {
    if (!SHORTCUT_MODIFIERS.has(modifier)) {
      return null;
    }
  }

  const keyPart = parts[parts.length - 1];
  if (!isValidShortcutKeyPart(keyPart)) {
    return null;
  }

  const normalizedKey = SHORTCUT_SYMBOL_KEYS.has(keyPart) ? keyPart : keyPart.toLowerCase();
  return [...modifierParts, normalizedKey].join("+");
}

function findShortcutReplacement(key: PowerlineShortcutKey, used: Set<string>): string | null {
  const preferred = DEFAULT_SHORTCUTS[key];
  if (!used.has(normalizeShortcut(preferred))) {
    return preferred;
  }

  for (const shortcutKey of SHORTCUT_KEYS) {
    const candidate = DEFAULT_SHORTCUTS[shortcutKey];
    if (!used.has(normalizeShortcut(candidate))) {
      return candidate;
    }
  }

  return null;
}

function resolveShortcutConfig(settings: Record<string, unknown>): PowerlineShortcuts {
  const resolved: PowerlineShortcuts = { ...DEFAULT_SHORTCUTS };
  const shortcutSettings = settings.powerlineShortcuts;

  if (isRecord(shortcutSettings)) {
    for (const key of SHORTCUT_KEYS) {
      const override = parseShortcutOverride(shortcutSettings[key]);
      if (override) {
        resolved[key] = override;
      }
    }
  }

  const used = new Set<string>([...RESERVED_SHORTCUTS]);

  for (const key of SHORTCUT_KEYS) {
    const configured = resolved[key];
    const normalizedConfigured = normalizeShortcut(configured);

    if (!used.has(normalizedConfigured)) {
      used.add(normalizedConfigured);
      continue;
    }

    const replacement = findShortcutReplacement(key, used);
    if (!replacement) {
      console.debug(`[powerline-footer] Shortcut conflict for ${key}: "${configured}" is already in use`);
      continue;
    }

    console.debug(
      `[powerline-footer] Shortcut conflict for ${key}: "${configured}" replaced with "${replacement}"`,
    );

    resolved[key] = replacement;
    used.add(normalizeShortcut(replacement));
  }

  return resolved;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status Line Builder
// ═══════════════════════════════════════════════════════════════════════════

/** Render a single segment and return its content with width */
function renderSegmentWithWidth(
  segId: StatusLineSegmentId,
  ctx: SegmentContext
): { content: string; width: number; visible: boolean } {
  const rendered = renderSegment(segId, ctx);
  if (!rendered.visible || !rendered.content) {
    return { content: "", width: 0, visible: false };
  }
  return { content: rendered.content, width: visibleWidth(rendered.content), visible: true };
}

/** Build content string from pre-rendered parts */
function buildContentFromParts(
  parts: string[],
  presetDef: ReturnType<typeof getPreset>
): string {
  if (parts.length === 0) return "";
  const separatorDef = getSeparator(presetDef.separator);
  const sepAnsi = getFgAnsiCode("sep");
  const sep = separatorDef.left;
  return " " + parts.join(` ${sepAnsi}${sep}${ansi.reset} `) + ansi.reset + " ";
}

function truncateWithEllipsisByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";

  const targetWidth = maxWidth - 1;
  let truncated = "";
  let truncatedWidth = 0;

  for (const char of text) {
    const charWidth = visibleWidth(char);
    if (truncatedWidth + charWidth > targetWidth) break;
    truncated += char;
    truncatedWidth += charWidth;
  }

  return truncated.trimEnd() + "…";
}

/**
 * Responsive segment layout - fits segments into top bar, overflows to secondary row.
 * When terminal is wide enough, secondary segments move up to top bar.
 * When narrow, top bar segments overflow down to secondary row.
 */
function computeResponsiveLayout(
  ctx: SegmentContext,
  presetDef: ReturnType<typeof getPreset>,
  availableWidth: number
): { topContent: string; secondaryContent: string } {
  const separatorDef = getSeparator(presetDef.separator);
  const sepWidth = visibleWidth(separatorDef.left) + 2; // separator + spaces around it
  
  // Get all segments: primary first, then secondary
  const primaryIds = [...presetDef.leftSegments, ...presetDef.rightSegments];
  const secondaryIds = presetDef.secondarySegments ?? [];
  const allSegmentIds = [...primaryIds, ...secondaryIds];
  
  // Render all segments and get their widths
  const renderedSegments: { content: string; width: number }[] = [];
  for (const segId of allSegmentIds) {
    const { content, width, visible } = renderSegmentWithWidth(segId, ctx);
    if (visible) {
      renderedSegments.push({ content, width });
    }
  }
  
  if (renderedSegments.length === 0) {
    return { topContent: "", secondaryContent: "" };
  }
  
  // Calculate how many segments fit in top bar
  // Account for: leading space (1) + trailing space (1) = 2 chars overhead
  const baseOverhead = 2;
  let currentWidth = baseOverhead;
  let topSegments: string[] = [];
  let overflowSegments: { content: string; width: number }[] = [];
  let overflow = false;
  
  for (const seg of renderedSegments) {
    const neededWidth = seg.width + (topSegments.length > 0 ? sepWidth : 0);
    
    if (!overflow && currentWidth + neededWidth <= availableWidth) {
      topSegments.push(seg.content);
      currentWidth += neededWidth;
    } else {
      overflow = true;
      overflowSegments.push(seg);
    }
  }
  
  // Fit overflow segments into secondary row (same width constraint)
  // Stop at first non-fitting segment to preserve ordering
  let secondaryWidth = baseOverhead;
  let secondarySegments: string[] = [];
  
  for (const seg of overflowSegments) {
    const neededWidth = seg.width + (secondarySegments.length > 0 ? sepWidth : 0);
    if (secondaryWidth + neededWidth <= availableWidth) {
      secondarySegments.push(seg.content);
      secondaryWidth += neededWidth;
    } else {
      break;
    }
  }
  
  return {
    topContent: buildContentFromParts(topSegments, presetDef),
    secondaryContent: buildContentFromParts(secondarySegments, presetDef),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension
// ═══════════════════════════════════════════════════════════════════════════

export default function powerlineFooter(pi: ExtensionAPI) {
  const startupSettings = readSettings();
  const resolvedShortcuts = resolveShortcutConfig(startupSettings);

  let enabled = true;
  let sessionStartTime = Date.now();
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let getThinkingLevelFn: (() => string) | null = null;
  let isStreaming = false;
  let tuiRef: any = null; // Store TUI reference for forcing re-renders
  let dismissWelcomeOverlay: (() => void) | null = null; // Callback to dismiss welcome overlay
  let welcomeHeaderActive = false; // Track if welcome header should be cleared on first input
  let welcomeOverlayShouldDismiss = false; // Track early dismissal request (before overlay setup completes)
  let lastUserPrompt = ""; // Last user message for prompt reminder widget
  let showLastPrompt = true; // Cached setting for last prompt visibility
  let stashedEditorText: string | null = null;
  let stashedPromptHistory: string[] = readPersistedStashHistory();
  let currentEditor: any = null;
  
  // Cache for responsive layout (shared between editor and widget for consistency)
  let lastLayoutWidth = 0;
  let lastLayoutResult: { topContent: string; secondaryContent: string } | null = null;
  let lastLayoutTimestamp = 0;
  let profileSwitchInProgress = false;

  function overlaySelectListTheme(theme: Theme) {
    return {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    };
  }

  async function showSelectOverlay(
    ctx: any,
    title: string,
    hint: string,
    items: SelectItem[],
    maxVisible: number,
  ): Promise<SelectItem | null> {
    return ctx.ui.custom<SelectItem | null>(
      (tui: any, theme: Theme, _keybindings: any, done: (result: SelectItem | null) => void) => {
        const selectList = new SelectList(items, maxVisible, overlaySelectListTheme(theme));
        const border = (text: string) => theme.fg("dim", text);
        const wrapRow = (text: string, innerWidth: number): string => {
          return `${border("│")}${truncateToWidth(text, innerWidth, "…", true)}${border("│")}`;
        };

        selectList.onSelect = (item) => done(item);
        selectList.onCancel = () => done(null);

        return {
          render: (width: number) => {
            const innerWidth = Math.max(1, width - 2);
            const lines: string[] = [];

            lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
            lines.push(wrapRow(theme.fg("accent", theme.bold(title)), innerWidth));
            lines.push(border(`├${"─".repeat(innerWidth)}┤`));

            for (const line of selectList.render(innerWidth)) {
              lines.push(wrapRow(line, innerWidth));
            }

            lines.push(border(`├${"─".repeat(innerWidth)}┤`));
            lines.push(wrapRow(theme.fg("dim", hint), innerWidth));
            lines.push(border(`╰${"─".repeat(innerWidth)}╯`));

            return lines;
          },
          invalidate: () => selectList.invalidate(),
          handleInput: (data: string) => {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: () => ({
          verticalAlign: "center",
          horizontalAlign: "center",
        }),
      },
    );
  }

  function getLiveProfileMatchIndex(ctx: any, profiles: ProfileConfig[]): number | null {
    if (!ctx.model?.provider || !ctx.model?.id) {
      return null;
    }

    return findMatchingProfileIndex(profiles, ctx.model.provider, ctx.model.id, pi.getThinkingLevel());
  }

  function reloadAndSyncActiveProfile(ctx: any): void {
    const profiles = reloadProfiles();
    const activeIndex = getLiveProfileMatchIndex(ctx, profiles);
    setActiveProfileIndex(activeIndex);
  }

  async function runWithProfileSwitchLock(action: () => Promise<void>): Promise<void> {
    if (profileSwitchInProgress) {
      return;
    }

    profileSwitchInProgress = true;
    try {
      await action();
    } finally {
      profileSwitchInProgress = false;
    }
  }

  // Track session start
  pi.on("session_start", async (event, ctx) => {
    sessionStartTime = Date.now();
    currentCtx = ctx;
    lastUserPrompt = "";
    isStreaming = false;
    stashedEditorText = null;

    const settings = readSettings();
    showLastPrompt = settings.showLastPrompt !== false;
    config.preset = normalizePreset(settings.powerline) ?? "default";
    stashedPromptHistory = readPersistedStashHistory();

    getThinkingLevelFn = typeof ctx.getThinkingLevel === "function"
      ? () => ctx.getThinkingLevel()
      : null;

    if (ctx.hasUI) {
      ctx.ui.setStatus("stash", undefined);
    }
    
    // Initialize vibe manager (needs modelRegistry from ctx)
    initVibeManager(ctx);
    
    if (enabled && ctx.hasUI) {
      setupCustomEditor(ctx);
      if (event.reason === "startup") {
        if (settings.quietStartup === true) {
          setupWelcomeHeader(ctx);
        } else {
          setupWelcomeOverlay(ctx);
        }
      } else {
        dismissWelcome(ctx);
      }
    }

    reloadAndSyncActiveProfile(ctx);
  });

  // Check if a bash command might change git branch
  const mightChangeGitBranch = (cmd: string): boolean => {
    const gitBranchPatterns = [
      /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
      /\bgit\s+stash\s+(pop|apply)/,
    ];
    return gitBranchPatterns.some(p => p.test(cmd));
  };

  // Invalidate git status on file changes, trigger re-render on potential branch changes
  pi.on("tool_result", async (event) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
    }
    // Check for bash commands that might change git branch
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = String(event.input.command);
      if (mightChangeGitBranch(cmd)) {
        // Invalidate caches since working tree state changes with branch
        invalidateGitStatus();
        invalidateGitBranch();
        // Small delay to let git update, then re-render
        setTimeout(() => tuiRef?.requestRender(), 100);
      }
    }
  });

  // Also catch user escape commands (! prefix)
  // Note: This fires BEFORE execution, so we use a longer delay and multiple re-renders
  // to ensure we catch the update after the command completes.
  pi.on("user_bash", async (event) => {
    if (mightChangeGitBranch(event.command)) {
      // Invalidate immediately so next render fetches fresh data
      invalidateGitStatus();
      invalidateGitBranch();
      // Multiple staggered re-renders to catch fast and slow commands
      setTimeout(() => tuiRef?.requestRender(), 100);
      setTimeout(() => tuiRef?.requestRender(), 300);
      setTimeout(() => tuiRef?.requestRender(), 500);
    }
  });

  // Generate themed working message before agent starts (has access to user's prompt)
  pi.on("before_agent_start", async (event, ctx) => {
    lastUserPrompt = event.prompt;
    if (ctx.hasUI) {
      onVibeBeforeAgentStart(event.prompt, ctx.ui.setWorkingMessage);
    }
  });

  // Track streaming state (footer only shows status during streaming)
  // Also dismiss welcome when agent starts responding (handles `p "command"` case)
  pi.on("agent_start", async (_event, ctx) => {
    isStreaming = true;
    onVibeAgentStart();
    dismissWelcome(ctx);
  });

  // Also dismiss on tool calls (agent is working) + refresh vibe if rate limit allows
  pi.on("tool_call", async (event, ctx) => {
    dismissWelcome(ctx);
    if (ctx.hasUI) {
      // Extract recent agent context from session for richer vibe generation
      const agentContext = getRecentAgentContext(ctx);
      onVibeToolCall(event.toolName, event.input, ctx.ui.setWorkingMessage, agentContext);
    }
  });
  
  // Helper to extract recent agent response text (skipping thinking blocks)
  function getRecentAgentContext(ctx: any): string | undefined {
    const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
    
    // Find the most recent assistant message
    for (let i = sessionEvents.length - 1; i >= 0; i--) {
      const e = sessionEvents[i];
      if (e.type === "message" && e.message?.role === "assistant") {
        const content = e.message.content;
        if (!Array.isArray(content)) continue;
        
        // Extract text content, skip thinking blocks
        for (const block of content) {
          if (block.type === "text" && block.text) {
            // Return first ~200 chars of non-empty text
            const text = block.text.trim();
            if (text.length > 0) {
              return text.slice(0, 200);
            }
          }
        }
      }
    }
    return undefined;
  }

  // Helper to dismiss welcome overlay/header
  function dismissWelcome(ctx: any) {
    if (dismissWelcomeOverlay) {
      dismissWelcomeOverlay();
      dismissWelcomeOverlay = null;
    } else {
      // Overlay not set up yet (100ms delay) - mark for immediate dismissal when it does
      welcomeOverlayShouldDismiss = true;
    }
    if (welcomeHeaderActive) {
      welcomeHeaderActive = false;
      ctx.ui.setHeader(undefined);
    }
  }

  function addStashHistoryEntry(text: string): void {
    const changed = pushStashHistory(stashedPromptHistory, text);
    if (!changed) {
      return;
    }

    persistStashHistory(stashedPromptHistory);
  }

  function copyTextToClipboard(ctx: any, text: string, successMessage?: string): void {
    copyToClipboard(text);
    if (successMessage) {
      ctx.ui.notify(successMessage, "info");
    }
  }

  function getEditorTextForClipboard(ctx: any): string | null {
    const text = getCurrentEditorText(ctx, currentEditor);
    if (hasNonWhitespaceText(text)) {
      return text;
    }

    ctx.ui.notify("Editor is empty", "info");
    return null;
  }

  async function selectStashedPromptFromHistory(ctx: any): Promise<string | null> {
    const historyItems = [...stashedPromptHistory];
    const items: SelectItem[] = historyItems.map((entry, index) => ({
      value: String(index),
      label: `#${index + 1} ${buildStashPreview(entry, STASH_PREVIEW_WIDTH)}`,
    }));

    const selected = await showSelectOverlay(
      ctx, "Stash history", "↑↓ navigate • enter insert • esc cancel",
      items, Math.min(items.length, 10));
    if (!selected) return null;

    const i = Number.parseInt(selected.value, 10);
    return historyItems[i] ?? null;
  }

  async function selectProjectPromptFromHistory(ctx: any, prompts: string[]): Promise<string | null> {
    const items: SelectItem[] = prompts.map((entry, index) => ({
      value: String(index),
      label: `#${index + 1} ${buildStashPreview(entry, STASH_PREVIEW_WIDTH)}`,
    }));

    const selected = await showSelectOverlay(
      ctx, "Recent project prompts", "↑↓ navigate • enter insert • esc cancel",
      items, Math.min(items.length, 10));
    if (!selected) return null;

    const i = Number.parseInt(selected.value, 10);
    return prompts[i] ?? null;
  }

  async function selectPromptHistorySource(
    ctx: any,
    stashCount: number,
    projectPromptCount: number,
  ): Promise<"stash" | "project" | null> {
    const items: SelectItem[] = [];

    if (stashCount > 0) {
      items.push({
        value: "stash",
        label: "Stashed prompts",
        description: `${stashCount} saved`,
      });
    }

    if (projectPromptCount > 0) {
      items.push({
        value: "project",
        label: "Recent project prompts",
        description: `${projectPromptCount} recent`,
      });
    }

    if (items.length === 0) {
      return null;
    }

    if (items.length === 1) {
      return items[0]?.value === "project" ? "project" : "stash";
    }

    const selected = await showSelectOverlay(
      ctx, "Prompt history", "↑↓ navigate • enter open • esc cancel",
      items, items.length);
    if (!selected) return null;

    return selected.value === "project" ? "project" : "stash";
  }

  async function insertSelectedPromptHistoryEntry(ctx: any, selected: string): Promise<void> {
    const currentText = getCurrentEditorText(ctx, currentEditor);
    if (!hasNonWhitespaceText(currentText)) {
      ctx.ui.setEditorText(selected);
      ctx.ui.notify("Inserted prompt", "info");
      return;
    }

    const action = await ctx.ui.select("Insert prompt", ["Replace", "Append", "Cancel"]);

    if (action === "Replace") {
      ctx.ui.setEditorText(selected);
      ctx.ui.notify("Replaced editor with prompt", "info");
      return;
    }

    if (action === "Append") {
      const separator = currentText.endsWith("\n") || selected.startsWith("\n") ? "" : "\n";
      ctx.ui.setEditorText(`${currentText}${separator}${selected}`);
      ctx.ui.notify("Appended prompt", "info");
    }
  }

  async function openStashHistory(ctx: any): Promise<void> {
    let projectPrompts: string[] = [];

    try {
      projectPrompts = readRecentProjectPrompts(ctx.cwd, PROJECT_PROMPT_HISTORY_LIMIT);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to load project prompts: ${message}`, "warning");
    }

    if (stashedPromptHistory.length === 0 && projectPrompts.length === 0) {
      ctx.ui.notify("No prompt history yet", "info");
      return;
    }

    const source = await selectPromptHistorySource(ctx, stashedPromptHistory.length, projectPrompts.length);
    if (!source) {
      return;
    }

    const selected = source === "project"
      ? await selectProjectPromptFromHistory(ctx, projectPrompts)
      : await selectStashedPromptFromHistory(ctx);
    if (!selected) return;

    await insertSelectedPromptHistoryEntry(ctx, selected);
  }

  async function switchToProfile(ctx: any, profiles: ProfileConfig[], index: number): Promise<boolean> {
    const profile = profiles[index];
    if (!profile) {
      return false;
    }

    const modelSpec = parseModelSpec(profile.model);
    if (!modelSpec) {
      return false;
    }

    const model = ctx.modelRegistry.find(modelSpec.provider, modelSpec.modelId);
    if (!model) {
      ctx.ui.notify(`Model not found: ${profile.model}`, "warning");
      return false;
    }

    const switched = await pi.setModel(model);
    if (!switched) {
      ctx.ui.notify(`No API key for model: ${profile.model}`, "warning");
      return false;
    }

    pi.setThinkingLevel(profile.thinking);
    setActiveProfileIndex(index);
    lastLayoutResult = null;

    const effectiveThinking = pi.getThinkingLevel();
    const displayName = getProfileDisplayName(profile, model.name);
    ctx.ui.notify(`Switched to: ${displayName} [${effectiveThinking}]`, "info");
    tuiRef?.requestRender();
    return true;
  }

  function getProfileLabel(ctx: any, profile: ProfileConfig): string {
    const modelSpec = parseModelSpec(profile.model);
    const model = modelSpec ? ctx.modelRegistry.find(modelSpec.provider, modelSpec.modelId) : undefined;
    return getProfileDisplayName(profile, model?.name);
  }

  async function selectProfileFromList(ctx: any, profiles: ProfileConfig[]): Promise<number | null> {
    const activeIndex = getLiveProfileMatchIndex(ctx, profiles);
    const items: SelectItem[] = profiles.map((profile, index) => {
      const num = `#${index + 1}`;
      const name = getProfileLabel(ctx, profile);
      const active = index === activeIndex ? " ✓" : "";
      return {
        value: String(index),
        label: `${num}  ${name}${active}`,
        description: `${profile.model}  [${profile.thinking}]`,
      };
    });

    const selected = await showSelectOverlay(
      ctx, "Model profiles", "↑↓ navigate • enter switch • esc close",
      items, Math.min(items.length, 12));
    if (!selected) return null;

    const i = Number.parseInt(selected.value, 10);
    return Number.isFinite(i) ? i : null;
  }

  async function pickModelFromRegistry(ctx: any): Promise<{ provider: string; id: string; name: string } | null> {
    const available = ctx.modelRegistry.getAvailable();
    if (available.length === 0) {
      ctx.ui.notify("No models available", "warning");
      return null;
    }

    interface ModelEntry { provider: string; id: string; name: string; key: string }
    const allEntries: ModelEntry[] = available.map((m: any) => ({
      provider: m.provider,
      id: m.id,
      name: m.name || m.id,
      key: `${m.provider}/${m.id}`,
    }));

    function entriesToItems(entries: ModelEntry[]): SelectItem[] {
      return entries.map((e) => ({ value: e.key, label: e.name, description: e.provider }));
    }

    return ctx.ui.custom<{ provider: string; id: string; name: string } | null>(
      (tui: any, theme: Theme, _keybindings: any, done: (result: ModelEntry | null) => void) => {
        const listTheme = overlaySelectListTheme(theme);
        const border = (text: string) => theme.fg("dim", text);
        const wrapRow = (text: string, innerWidth: number): string => {
          return `${border("│")}${truncateToWidth(text, innerWidth, "…", true)}${border("│")}`;
        };

        const searchInput = new Input();
        let searchValue = "";
        let filteredEntries = allEntries;
        let selectList = new SelectList(entriesToItems(allEntries), Math.min(allEntries.length, 12), listTheme);

        function wireSelectList() {
          selectList.onSelect = (item) => {
            done(filteredEntries.find((e) => e.key === item.value) ?? null);
          };
          selectList.onCancel = () => done(null);
        }
        wireSelectList();

        function applyFilter(query: string) {
          filteredEntries = query
            ? fuzzyFilter(allEntries, query, (e) => `${e.name} ${e.provider} ${e.id}`)
            : allEntries;
          selectList = new SelectList(entriesToItems(filteredEntries), Math.min(filteredEntries.length, 12), listTheme);
          wireSelectList();
        }

        return {
          render: (width: number) => {
            const innerWidth = Math.max(1, width - 2);
            const lines: string[] = [];

            lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
            lines.push(wrapRow(theme.fg("accent", theme.bold("Select model")), innerWidth));
            lines.push(border(`├${"─".repeat(innerWidth)}┤`));

            const searchLine = ` ${theme.fg("muted", "/")} ${searchValue}`;
            lines.push(wrapRow(searchLine, innerWidth));
            lines.push(border(`├${"─".repeat(innerWidth)}┤`));

            for (const line of selectList.render(innerWidth)) {
              lines.push(wrapRow(line, innerWidth));
            }

            lines.push(border(`├${"─".repeat(innerWidth)}┤`));
            lines.push(wrapRow(theme.fg("dim", "type to filter • enter select • esc cancel"), innerWidth));
            lines.push(border(`╰${"─".repeat(innerWidth)}╯`));

            return lines;
          },
          invalidate: () => selectList.invalidate(),
          handleInput: (data: string) => {
            const before = selectList.getSelectedItem();
            selectList.handleInput(data);
            const after = selectList.getSelectedItem();

            // If selectList didn't consume the key, route to search input
            if (before === after) {
              searchInput.handleInput(data);
              const nextValue = searchInput.getValue();
              if (nextValue !== searchValue) {
                searchValue = nextValue;
                applyFilter(searchValue);
              }
            }

            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: () => ({
          verticalAlign: "center",
          horizontalAlign: "center",
        }),
      },
    );
  }

  async function pickThinkingLevel(ctx: any): Promise<ProfileConfig["thinking"] | null> {
    const levels: ProfileConfig["thinking"][] = ["off", "minimal", "low", "medium", "high", "xhigh"];
    const items: SelectItem[] = levels.map((level) => ({ value: level, label: level }));

    const selected = await showSelectOverlay(
      ctx, "Select thinking level", "↑↓ navigate • enter select • esc cancel",
      items, items.length);
    return selected ? selected.value as ProfileConfig["thinking"] : null;
  }

  async function pickLabel(ctx: any): Promise<string | undefined> {
    return ctx.ui.input("Profile label (optional)", "e.g. Opus Deep");
  }

  async function interactiveAddProfile(ctx: any): Promise<void> {
    const model = await pickModelFromRegistry(ctx);
    if (!model) return;

    const thinking = await pickThinkingLevel(ctx);
    if (!thinking) return;

    const label = await pickLabel(ctx);

    const modelSpec = `${model.provider}/${model.id}`;
    const profiles = reloadProfiles();
    const profile: ProfileConfig = { model: modelSpec, thinking, ...(label ? { label } : {}) };
    const nextProfiles = [...profiles, profile];

    const saved = saveProfiles(nextProfiles);
    if (!saved) {
      ctx.ui.notify("Failed to save profile", "warning");
      return;
    }

    const displayName = label || model.name;
    ctx.ui.notify(`Added profile #${nextProfiles.length}: ${displayName} [${thinking}]`, "info");
  }

  async function openProfileList(ctx: any, profiles: ProfileConfig[]): Promise<void> {
    if (profiles.length === 0) {
      ctx.ui.notify("No profiles configured. Use /model-switcher add to create one.", "info");
      return;
    }

    const selectedIndex = await selectProfileFromList(ctx, profiles);
    if (selectedIndex === null) return;

    await runWithProfileSwitchLock(async () => {
      await switchToProfile(ctx, profiles, selectedIndex);
    });
  }

  pi.on("agent_end", async (_event, ctx) => {
    isStreaming = false;
    if (ctx.hasUI) {
      onVibeAgentEnd(ctx.ui.setWorkingMessage); // working-vibes internal state + reset message
      if (stashedEditorText !== null) {
        if (ctx.ui.getEditorText().trim() === "") {
          ctx.ui.setEditorText(stashedEditorText);
          stashedEditorText = null;
          ctx.ui.setStatus("stash", undefined);
          ctx.ui.notify("Stash restored", "info");
        } else {
          ctx.ui.notify("Stash preserved — clear editor then Alt+S to restore", "info");
        }
      }
    }
  });

  // Command to toggle/configure
  pi.registerCommand("powerline", {
    description: "Configure powerline status (toggle, preset)",
    handler: async (args, ctx) => {
      // Update context reference (command ctx may have more methods)
      currentCtx = ctx;
      
      if (!args?.trim()) {
        // Toggle
        enabled = !enabled;
        if (enabled) {
          setupCustomEditor(ctx);
          ctx.ui.notify("Powerline enabled", "info");
        } else {
          getPromptHistoryState().savedPromptHistory = [];
          stashedEditorText = null;
          setActiveProfileIndex(null);
          ctx.ui.setStatus("stash", undefined);
          // Clear all custom UI components
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);
          ctx.ui.setHeader(undefined);
          ctx.ui.setWidget("powerline-secondary", undefined);
          ctx.ui.setWidget("powerline-status", undefined);
          ctx.ui.setWidget("powerline-last-prompt", undefined);
          footerDataRef = null;
          tuiRef = null;
          currentEditor = null;
          // Clear layout cache
          lastLayoutResult = null;
          ctx.ui.notify("Powerline disabled", "info");
        }
        return;
      }

      const preset = normalizePreset(args);
      if (preset) {
        config.preset = preset;
        lastLayoutResult = null;
        if (enabled) {
          setupCustomEditor(ctx);
        }

        if (writePowerlinePresetSetting(preset)) {
          ctx.ui.notify(`Preset set to: ${preset}`, "info");
        } else {
          ctx.ui.notify(`Preset set to: ${preset} (not persisted; check settings.json)`, "warning");
        }
        return;
      }

      // Show available presets
      const presetList = Object.keys(PRESETS).join(", ");
      ctx.ui.notify(`Available presets: ${presetList}`, "info");
    },
  });

  pi.registerCommand("stash-history", {
    description: "Open prompt history picker",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      if (!enabled) {
        ctx.ui.notify("Powerline is disabled", "info");
        return;
      }

      await openStashHistory(ctx);
    },
  });

  pi.registerShortcut("alt+s", {
    description: "Stash/restore editor text",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;

      const rawText = getCurrentEditorText(ctx, currentEditor);
      const hasText = hasNonWhitespaceText(rawText);
      const hasStash = stashedEditorText !== null;

      if (hasText && !hasStash) {
        stashedEditorText = rawText;
        addStashHistoryEntry(rawText);
        ctx.ui.setEditorText("");
        ctx.ui.setStatus("stash", "📋 stash");
        ctx.ui.notify("Text stashed", "info");
        return;
      }

      if (!hasText && hasStash) {
        ctx.ui.setEditorText(stashedEditorText);
        stashedEditorText = null;
        ctx.ui.setStatus("stash", undefined);
        ctx.ui.notify("Stash restored", "info");
        return;
      }

      if (hasText && stashedEditorText !== null) {
        stashedEditorText = rawText;
        addStashHistoryEntry(rawText);
        ctx.ui.setEditorText("");
        ctx.ui.setStatus("stash", "📋 stash");
        ctx.ui.notify("Stash updated", "info");
        return;
      }

      ctx.ui.notify("Nothing to stash", "info");
    },
  });

  pi.registerShortcut(resolvedShortcuts.stashHistory, {
    description: "Open prompt history picker",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      await openStashHistory(ctx);
    },
  });

  pi.registerShortcut(resolvedShortcuts.copyEditor, {
    description: "Copy full editor text",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;

      const text = getEditorTextForClipboard(ctx);
      if (!text) return;

      copyTextToClipboard(ctx, text, "Copied editor text");
    },
  });

  pi.registerShortcut(resolvedShortcuts.cutEditor, {
    description: "Cut full editor text",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;

      const text = getEditorTextForClipboard(ctx);
      if (!text) return;

      copyTextToClipboard(ctx, text);
      ctx.ui.setEditorText("");
      ctx.ui.notify("Cut editor text", "info");
    },
  });

  pi.registerShortcut(resolvedShortcuts.profileCycle, {
    description: "Cycle to next model profile",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;

      await runWithProfileSwitchLock(async () => {
        const profiles = reloadProfiles();
        if (profiles.length === 0) return;

        const currentMatch = getLiveProfileMatchIndex(ctx, profiles);

        const startIndex = currentMatch !== null ? (currentMatch + 1) % profiles.length : 0;
        for (let attempt = 0; attempt < profiles.length; attempt++) {
          const candidateIndex = (startIndex + attempt) % profiles.length;
          const switched = await switchToProfile(ctx, profiles, candidateIndex);
          if (switched) {
            return;
          }
        }

        ctx.ui.notify("No available profiles", "warning");
      });
    },
  });

  pi.registerShortcut(resolvedShortcuts.profileSelect, {
    description: "Select and switch model profile",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;

      await runWithProfileSwitchLock(async () => {
        const profiles = reloadProfiles();
        if (profiles.length === 0) return;

        const selectedIndex = await selectProfileFromList(ctx, profiles);
        if (selectedIndex === null) return;

        await switchToProfile(ctx, profiles, selectedIndex);
      });
    },
  });

  pi.registerCommand("model-switcher", {
    description: "Manage model profiles. Usage: /model-switcher [add|remove|<number>]",
    handler: async (args, ctx) => {
      const trimmed = args?.trim() ?? "";
      const profiles = reloadProfiles();

      if (!trimmed) {
        await openProfileList(ctx, profiles);
        return;
      }

      const parts = trimmed.split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (subcommand === "add") {
        // No additional args → interactive picker flow
        if (parts.length === 1) {
          await interactiveAddProfile(ctx);
          return;
        }

        // Text-based: /model-switcher add <model> <thinking> [label...]
        const addMatch = trimmed.match(/^add\s+(\S+)\s+(\S+)([\s\S]*)$/i);
        if (!addMatch) {
          ctx.ui.notify("Usage: /model-switcher add [<model> <thinking> [label...]]", "error");
          return;
        }

        const model = addMatch[1];
        const thinking = addMatch[2].toLowerCase();
        if (!parseModelSpec(model)) {
          ctx.ui.notify("Invalid model format. Use: provider/modelId", "error");
          return;
        }
        if (!isThinkingLevel(thinking)) {
          ctx.ui.notify("Invalid thinking level. Use: off|minimal|low|medium|high|xhigh", "error");
          return;
        }

        const label = (addMatch[3] ?? "").trim();
        const nextProfiles: ProfileConfig[] = [...profiles, { model, thinking, ...(label ? { label } : {}) }];
        const saved = saveProfiles(nextProfiles);
        if (!saved) {
          ctx.ui.notify("Failed to save profiles", "warning");
          return;
        }

        ctx.ui.notify(`Added profile #${nextProfiles.length}`, "info");
        return;
      }

      if (subcommand === "remove") {
        if (parts.length !== 2) {
          ctx.ui.notify("Usage: /model-switcher remove <number>", "error");
          return;
        }

        const indexValue = Number.parseInt(parts[1], 10);
        if (!Number.isFinite(indexValue) || indexValue < 1 || indexValue > profiles.length) {
          ctx.ui.notify("Invalid profile number", "error");
          return;
        }

        const removeIndex = indexValue - 1;
        const nextProfiles = profiles.filter((_, index) => index !== removeIndex);
        let nextActiveIndex = getActiveProfileIndex();
        if (nextActiveIndex !== null) {
          if (nextActiveIndex === removeIndex) {
            nextActiveIndex = null;
          } else if (removeIndex < nextActiveIndex) {
            nextActiveIndex -= 1;
          }
          if (nextActiveIndex !== null && nextActiveIndex >= nextProfiles.length) {
            nextActiveIndex = null;
          }
        }

        const saved = saveProfiles(nextProfiles);
        if (!saved) {
          ctx.ui.notify("Failed to save profiles", "warning");
          return;
        }

        setActiveProfileIndex(nextActiveIndex);
        ctx.ui.notify(`Removed profile #${indexValue}`, "info");
        return;
      }

      const indexValue = Number.parseInt(subcommand, 10);
      if (Number.isFinite(indexValue) && parts.length === 1) {
        if (indexValue < 1 || indexValue > profiles.length) {
          ctx.ui.notify("Invalid profile number", "error");
          return;
        }

        await runWithProfileSwitchLock(async () => {
          await switchToProfile(ctx, profiles, indexValue - 1);
        });
        return;
      }

      ctx.ui.notify(
        "Usage: /model-switcher | /model-switcher add | /model-switcher remove <N> | /model-switcher <N>",
        "error",
      );
    },
  });

  // Command to set working message theme
  pi.registerCommand("vibe", {
    description: "Set working message theme. Usage: /vibe [theme|off|mode|model|generate]",
    handler: async (args, ctx) => {
      const parts = args?.trim().split(/\s+/) || [];
      const subcommand = parts[0]?.toLowerCase();
      
      // No args: show current status
      if (!args || !args.trim()) {
        const theme = getVibeTheme();
        const mode = getVibeMode();
        const model = getVibeModel();
        let status = `Vibe: ${theme || "off"} | Mode: ${mode} | Model: ${model}`;
        if (theme && mode === "file") {
          const count = getVibeFileCount(theme);
          status += count > 0 ? ` | File: ${count} vibes` : " | File: not found";
        }
        ctx.ui.notify(status, "info");
        return;
      }
      
      // /vibe model [spec] - show or set model
      if (subcommand === "model") {
        const modelSpec = parts.slice(1).join(" ");
        if (!modelSpec) {
          ctx.ui.notify(`Current vibe model: ${getVibeModel()}`, "info");
          return;
        }
        // Validate format (provider/modelId)
        if (!modelSpec.includes("/")) {
          ctx.ui.notify("Invalid model format. Use: provider/modelId (e.g., anthropic/claude-haiku-4-5)", "error");
          return;
        }
        const persisted = setVibeModel(modelSpec);
        if (persisted) {
          ctx.ui.notify(`Vibe model set to: ${modelSpec}`, "info");
        } else {
          ctx.ui.notify(`Vibe model set to: ${modelSpec} (not persisted; check settings.json)`, "warning");
        }
        return;
      }
      
      // /vibe mode [generate|file] - show or set mode
      if (subcommand === "mode") {
        const newMode = parts[1]?.toLowerCase();
        if (!newMode) {
          ctx.ui.notify(`Current vibe mode: ${getVibeMode()}`, "info");
          return;
        }
        if (newMode !== "generate" && newMode !== "file") {
          ctx.ui.notify("Invalid mode. Use: generate or file", "error");
          return;
        }
        // Check if file exists when switching to file mode
        const theme = getVibeTheme();
        if (newMode === "file" && theme && !hasVibeFile(theme)) {
          ctx.ui.notify(`No vibe file for "${theme}". Run /vibe generate ${theme} first`, "error");
          return;
        }
        const persisted = setVibeMode(newMode);
        if (persisted) {
          ctx.ui.notify(`Vibe mode set to: ${newMode}`, "info");
        } else {
          ctx.ui.notify(`Vibe mode set to: ${newMode} (not persisted; check settings.json)`, "warning");
        }
        return;
      }
      
      // /vibe generate <theme> [count] - generate vibes and save to file
      if (subcommand === "generate") {
        const theme = parts[1];
        const parsedCount = Number.parseInt(parts[2] ?? "", 10);
        const count = Number.isFinite(parsedCount)
          ? Math.min(Math.max(Math.floor(parsedCount), 1), 500)
          : 100;

        if (!theme) {
          ctx.ui.notify("Usage: /vibe generate <theme> [count]", "error");
          return;
        }

        ctx.ui.notify(`Generating ${count} vibes for "${theme}"...`, "info");

        const result = await generateVibesBatch(theme, count);
        
        if (result.success) {
          ctx.ui.notify(`Generated ${result.count} vibes for "${theme}" → ${result.filePath}`, "info");
        } else {
          ctx.ui.notify(`Failed to generate vibes: ${result.error}`, "error");
        }
        return;
      }
      
      // /vibe off - disable
      if (subcommand === "off") {
        const persisted = setVibeTheme(null);
        if (persisted) {
          ctx.ui.notify("Vibe disabled", "info");
        } else {
          ctx.ui.notify("Vibe disabled (not persisted; check settings.json)", "warning");
        }
        return;
      }
      
      // /vibe <theme> - set theme (preserve original casing)
      const theme = args.trim();
      const persisted = setVibeTheme(theme);
      const mode = getVibeMode();
      if (mode === "file" && !hasVibeFile(theme)) {
        const suffix = persisted ? "" : " (not persisted; check settings.json)";
        ctx.ui.notify(`Vibe set to: ${theme} (file mode, but no file found - run /vibe generate ${theme})${suffix}`, "warning");
      } else if (persisted) {
        ctx.ui.notify(`Vibe set to: ${theme}`, "info");
      } else {
        ctx.ui.notify(`Vibe set to: ${theme} (not persisted; check settings.json)`, "warning");
      }
    },
  });

  function buildSegmentContext(ctx: any, theme: Theme): SegmentContext {
    const presetDef = getPreset(config.preset);
    const colors: ColorScheme = presetDef.colors ?? getDefaultColors();

    // Build usage stats and get thinking level from session
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
    let lastAssistant: AssistantMessage | undefined;
    let thinkingLevelFromSession: string | null = null;
    
    const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
    for (const e of sessionEvents) {
      // Check for thinking level change entries
      if (e.type === "thinking_level_change" && e.thinkingLevel) {
        thinkingLevelFromSession = e.thinkingLevel;
      }
      if (e.type === "message" && e.message.role === "assistant") {
        const m = e.message as AssistantMessage;
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          continue;
        }
        input += m.usage.input;
        output += m.usage.output;
        cacheRead += m.usage.cacheRead;
        cacheWrite += m.usage.cacheWrite;
        cost += m.usage.cost.total;
        lastAssistant = m;
      }
    }

    // Calculate context percentage (total tokens used in last turn)
    const contextTokens = lastAssistant
      ? lastAssistant.usage.input + lastAssistant.usage.output +
        lastAssistant.usage.cacheRead + lastAssistant.usage.cacheWrite
      : 0;
    const contextWindow = ctx.model?.contextWindow || 0;
    const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

    // Get git status (cached)
    const gitBranch = footerDataRef?.getGitBranch() ?? null;
    const gitStatus = getGitStatus(gitBranch);

    // Check if using OAuth subscription
    const usingSubscription = ctx.model
      ? ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false
      : false;

    const thinkingLevel = thinkingLevelFromSession ?? getThinkingLevelFn?.() ?? "off";
    const profilesCache = getProfilesCache();
    const activeProfileMatch = ctx.model?.provider && ctx.model?.id
      ? findMatchingProfileIndex(profilesCache, ctx.model.provider, ctx.model.id, thinkingLevel)
      : null;
    const activeProfileLabel = activeProfileMatch !== null
      ? profilesCache[activeProfileMatch]?.label ?? null
      : null;

    return {
      model: ctx.model,
      thinkingLevel,
      activeProfileIndex: activeProfileMatch,
      activeProfileLabel,
      sessionId: ctx.sessionManager?.getSessionId?.(),
      usageStats: { input, output, cacheRead, cacheWrite, cost },
      contextPercent,
      contextWindow,
      autoCompactEnabled: ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? true,
      usingSubscription,
      sessionStartTime,
      git: gitStatus,
      extensionStatuses: footerDataRef?.getExtensionStatuses() ?? new Map(),
      options: presetDef.segmentOptions ?? {},
      theme,
      colors,
    };
  }

  /**
   * Get cached responsive layout or compute fresh one.
   * Layout is cached per render cycle (same width = same layout).
   */
  function getResponsiveLayout(width: number, theme: Theme): { topContent: string; secondaryContent: string } {
    const now = Date.now();
    // Cache is valid if same width and within 50ms (same render cycle)
    if (lastLayoutResult && lastLayoutWidth === width && now - lastLayoutTimestamp < 50) {
      return lastLayoutResult;
    }
    
    const presetDef = getPreset(config.preset);
    const segmentCtx = buildSegmentContext(currentCtx, theme);
    
    lastLayoutWidth = width;
    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, width);
    lastLayoutTimestamp = now;
    
    return lastLayoutResult;
  }

  function setupCustomEditor(ctx: any) {
    snapshotPromptHistory(currentEditor);

    // Import CustomEditor dynamically and create wrapper
    import("@mariozechner/pi-coding-agent").then(({ CustomEditor }) => {
      if (!enabled) {
        return;
      }

      let autocompleteFixed = false;

      const editorFactory = (tui: any, editorTheme: any, keybindings: any) => {
        // Create custom editor that overrides render for status bar below content
        const editor = new CustomEditor(tui, editorTheme, keybindings);
        currentEditor = editor;
        trackPromptHistory(editor);
        restorePromptHistory(editor);
        
        const originalHandleInput = editor.handleInput.bind(editor);
        editor.handleInput = (data: string) => {
          if (!autocompleteFixed && !(editor as any).autocompleteProvider) {
            autocompleteFixed = true;
            snapshotPromptHistory(editor);
            ctx.ui.setEditorComponent(editorFactory);
            currentEditor?.handleInput(data);
            return;
          }
          // Dismiss welcome overlay/header (use setTimeout to avoid re-entrancy)
          setTimeout(() => dismissWelcome(ctx), 0);
          originalHandleInput(data);
        };
        
        // Store original render
        const originalRender = editor.render.bind(editor);
        
        // Override render: status bar, top rule, prompted content, bottom rule
        //  status content
        //  ──────────────────────────────────────
        //  > first line of input
        //    continuation lines
        //  ──────────────────────────────────────
        // + autocomplete items (if showing)
        editor.render = (width: number): string[] => {
          // Fall back to original render on extremely narrow terminals
          if (width < 10) {
            return originalRender(width);
          }
          
          const bc = (s: string) => `${getFgAnsiCode("sep")}${s}${ansi.reset}`;
          const prompt = `${ansi.getFgAnsi(200, 200, 200)}>${ansi.reset}`;
          
          // Content area: 3 chars for prompt prefix (" > " / "   ")
          const promptPrefix = ` ${prompt} `;
          const contPrefix = "   ";
          const contentWidth = Math.max(1, width - 3);
          const lines = originalRender(contentWidth);
          
          if (lines.length === 0 || !currentCtx) return lines;
          
          // Find bottom border (plain ─ or scroll indicator ─── ↓ N more)
          // Lines after it are autocomplete items
          let bottomBorderIndex = lines.length - 1;
          for (let i = lines.length - 1; i >= 1; i--) {
            const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
            if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
              bottomBorderIndex = i;
              break;
            }
          }
          
          const result: string[] = [];
          
          // Status bar above top border
          const layout = getResponsiveLayout(width, ctx.ui.theme);
          result.push(layout.topContent);
          
          // Top border (plain rule, 1-char margins)
          result.push(" " + bc("─".repeat(width - 2)));
          
          // Content lines: first line gets "> " prompt, rest indented to match
          for (let i = 1; i < bottomBorderIndex; i++) {
            const prefix = i === 1 ? promptPrefix : contPrefix;
            result.push(`${prefix}${lines[i] || ""}`);
          }
          
          // If only had top/bottom borders (empty editor), show prompt
          if (bottomBorderIndex === 1) {
            result.push(`${promptPrefix}${" ".repeat(contentWidth)}`);
          }
          
          // Bottom border
          result.push(" " + bc("─".repeat(width - 2)));
          
          // Append any autocomplete lines that come after the bottom border
          for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
            result.push(lines[i] || "");
          }
          
          return result;
        };
        
        return editor;
      };

      if (!enabled) {
        return;
      }

      ctx.ui.setEditorComponent(editorFactory);

      // Set up footer data provider access (needed for git branch, extension statuses)
      // Status bar is rendered inside the editor override, footer is empty
      ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
        footerDataRef = footerData;
        tuiRef = tui; // Store TUI reference for re-renders on git branch changes
        const unsub = footerData.onBranchChange(() => tui.requestRender());

        return {
          dispose: unsub,
          invalidate() {},
          render(): string[] {
            return [];
          },
        };
      });

      // Set up secondary row as a widget below editor (above sub bar)
      // Shows overflow segments when top bar is too narrow
      ctx.ui.setWidget("powerline-secondary", (_tui: any, theme: Theme) => {
        return {
          dispose() {},
          invalidate() {},
          render(width: number): string[] {
            if (!currentCtx) return [];
            
            const layout = getResponsiveLayout(width, theme);
            
            if (layout.secondaryContent) {
              return [layout.secondaryContent];
            }
            
            return [];
          },
        };
      }, { placement: "belowEditor" });

      // Set up status notifications widget above editor
      // Shows extension status messages that look like notifications (e.g., "[pi-annotate] Received: CANCEL")
      // Compact statuses (e.g., "MCP: 6 servers") stay in the powerline bar via extension_statuses segment
      ctx.ui.setWidget("powerline-status", () => {
        return {
          dispose() {},
          invalidate() {},
          render(width: number): string[] {
            if (!currentCtx || !footerDataRef) return [];
            
            const statuses = footerDataRef.getExtensionStatuses();
            if (!statuses || statuses.size === 0) return [];
            
            // Collect notification-style statuses (those starting with "[extensionName]")
            const notifications: string[] = [];
            for (const value of statuses.values()) {
              if (value && value.trimStart().startsWith('[')) {
                // Account for leading space when checking width
                const lineContent = ` ${value}`;
                const contentWidth = visibleWidth(lineContent);
                if (contentWidth <= width) {
                  notifications.push(lineContent);
                }
              }
            }
            
            return notifications;
          },
        };
      }, { placement: "aboveEditor" });

      // Last prompt reminder below editor (configurable via showLastPrompt setting)
      ctx.ui.setWidget("powerline-last-prompt", () => {
        return {
          dispose() {},
          invalidate() {},
          render(width: number): string[] {
            if (!showLastPrompt || !lastUserPrompt) return [];
            
            const prefix = `${getFgAnsiCode("sep")}↳${ansi.reset} `;
            const prefixWidth = 2; // "↳ "
            const availableWidth = width - prefixWidth - 1;
            if (availableWidth < 10) return [];
            
            let promptText = lastUserPrompt.replace(/\s+/g, " ").trim();
            if (!promptText) return [];

            promptText = truncateWithEllipsisByWidth(promptText, availableWidth);

            const styledPrompt = `${getFgAnsiCode("sep")}${promptText}${ansi.reset}`;
            return [` ${prefix}${styledPrompt}`];
          },
        };
      }, { placement: "belowEditor" });
    }).catch((error) => {
      console.debug("[powerline-footer] Failed to initialize custom editor:", error);
    });
  }

  function setupWelcomeHeader(ctx: any) {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts();
    const recentSessions = getRecentSessions(3);
    
    const header = new WelcomeHeader(modelName, providerName, recentSessions, loadedCounts);
    welcomeHeaderActive = true; // Will be cleared on first user input
    
    ctx.ui.setHeader(() => {
      return {
        render(width: number): string[] {
          return header.render(width);
        },
        invalidate() {
          header.invalidate();
        },
      };
    });
  }

  function setupWelcomeOverlay(ctx: any) {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts();
    const recentSessions = getRecentSessions(3);
    
    // Small delay to let pi-mono finish initialization
    setTimeout(() => {
      // Skip overlay if:
      // 1. Extension is disabled
      // 2. Dismissal was explicitly requested (agent_start/keypress fired)
      // 3. Agent is already streaming
      // 4. Session already has assistant messages (agent already responded)
      if (!enabled || welcomeOverlayShouldDismiss || isStreaming) {
        welcomeOverlayShouldDismiss = false;
        return;
      }
      
      // Check if session already has activity (handles p "command" case)
      const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
      const hasActivity = sessionEvents.some((e: any) => 
        (e.type === "message" && e.message?.role === "assistant") ||
        e.type === "tool_call" ||
        e.type === "tool_result"
      );
      if (hasActivity) {
        return;
      }
      
      ctx.ui.custom(
        (tui: any, _theme: any, _keybindings: any, done: (result: void) => void) => {
          const welcome = new WelcomeComponent(
            modelName,
            providerName,
            recentSessions,
            loadedCounts,
          );
          
          let countdown = 30;
          let dismissed = false;
          
          const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            clearInterval(interval);
            dismissWelcomeOverlay = null;
            done();
          };
          
          // Store dismiss callback so agent_start/keypress can trigger it
          dismissWelcomeOverlay = dismiss;
          
          // Double-check: dismissal might have been requested between the outer check
          // and this callback running
          if (welcomeOverlayShouldDismiss) {
            welcomeOverlayShouldDismiss = false;
            dismiss();
          }
          
          const interval = setInterval(() => {
            if (dismissed) return;
            countdown--;
            welcome.setCountdown(countdown);
            tui.requestRender();
            if (countdown <= 0) dismiss();
          }, 1000);
          
          return {
            focused: false,
            invalidate: () => welcome.invalidate(),
            render: (width: number) => welcome.render(width),
            handleInput: () => dismiss(),
            dispose: () => {
              dismissed = true;
              clearInterval(interval);
            },
          };
        },
        {
          overlay: true,
          overlayOptions: () => ({
            verticalAlign: "center",
            horizontalAlign: "center",
          }),
        },
      ).catch((error) => {
        console.debug("[powerline-footer] Welcome overlay failed:", error);
      });
    }, 100);
  }
}

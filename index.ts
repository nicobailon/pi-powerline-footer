import {
  copyToClipboard,
  type ExtensionAPI,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { isKeyRelease, matchesKey, type AutocompleteProvider, type SelectItem, SelectList, truncateToWidth, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import type { ColorScheme, SegmentContext, StatusLinePreset, StatusLineSegmentId } from "./types.ts";
import type { PowerlineConfig } from "./powerline-config.ts";
import { BashTranscriptStore } from "./bash-mode/transcript.ts";
import {
  BashCompletionEngine,
  BashAutocompleteProvider,
  getOneOffBashCommandContext,
  ModeAwareAutocompleteProvider,
  OneOffBashAutocompleteProvider,
} from "./bash-mode/completion.ts";
import { BashModeEditor } from "./bash-mode/editor.ts";
import { ManagedShellSession } from "./bash-mode/shell-session.ts";
import { matchHistoryEntries, readGlobalShellHistory, readProjectHistory, appendProjectHistory } from "./bash-mode/history.ts";
import type { BashModeSettings } from "./bash-mode/types.ts";
import { getPreset, PRESETS } from "./presets.ts";
import { collectHiddenExtensionStatusKeys, getNotificationExtensionStatuses, mergeSegmentOptions, mergeSegmentsWithCustomItems, nextPowerlineSettingWithOptions, nextPowerlineSettingWithPreset, parsePowerlineConfig } from "./powerline-config.ts";
import { getSeparator } from "./separators.ts";
import { renderSegment } from "./segments.ts";
import { getGitStatus, invalidateGitStatus, invalidateGitBranch } from "./git-status.ts";
import { ansi, getFgAnsiCode } from "./colors.ts";
import { WelcomeComponent, WelcomeHeader, discoverLoadedCounts, getRecentSessions } from "./welcome.ts";
import { createWelcomeDismissScheduler } from "./welcome-dismiss.ts";
import { createRenderScheduler } from "./render-scheduler.ts";
import { readCoreContextUsage } from "./context-usage.ts";
import { renderFixedEditorCluster } from "./fixed-editor/cluster.ts";
import { DEFAULT_SCROLL_REPAINT_THROTTLE_MS, emergencyTerminalModeReset, TerminalSplitCompositor } from "./fixed-editor/terminal-split.ts";
import { getDefaultColors } from "./theme.ts";
import {
  isSupportedSuperShortcut,
  matchesConfiguredShortcut,
  shortcutConflictKey,
  shortcutUsesSuper,
} from "./shortcuts.ts";
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
} from "./working-vibes.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

let config: PowerlineConfig = {
  preset: "default",
  customItems: [],
  mouseScroll: true,
  fixedEditor: true,
};

const CUSTOM_COMPACTION_STATUS_KEY = "compact-policy";
let customCompactionEnabled = false;

interface PowerlineShortcuts {
  stashHistory: string;
  copyEditor: string;
  cutEditor: string;
  jumpPreviousUserMessage: string;
  jumpNextUserMessage: string;
  jumpPreviousLlmMessage: string;
  jumpNextLlmMessage: string;
  jumpChatBottom: string;
  scrollChatUp: string;
  scrollChatDown: string;
  editorStart: string;
  editorEnd: string;
}

type PowerlineShortcutKey = keyof PowerlineShortcuts;
type ChatJumpShortcutKey = Extract<PowerlineShortcutKey,
  | "jumpPreviousUserMessage"
  | "jumpNextUserMessage"
  | "jumpPreviousLlmMessage"
  | "jumpNextLlmMessage"
  | "jumpChatBottom"
>;
type ChatJumpRole = "user" | "assistant";
type ChatJumpDirection = "previous" | "next";
type ChatJumpShortcutAction =
  | { kind: "message"; role: ChatJumpRole; direction: ChatJumpDirection }
  | { kind: "bottom" };
type PowerlineShortcutAction =
  | { kind: "stashHistory" }
  | { kind: "copyEditor" }
  | { kind: "cutEditor" }
  | { kind: "bashMode" }
  | { kind: "chat"; action: ChatJumpShortcutAction };

const STASH_HISTORY_LIMIT = 12;
const PROJECT_PROMPT_HISTORY_LIMIT = 50;
const STASH_PREVIEW_WIDTH = 72;
const DEFAULT_SHORTCUTS: PowerlineShortcuts = {
  stashHistory: "ctrl+alt+h",
  copyEditor: "ctrl+alt+c",
  cutEditor: "ctrl+alt+x",
  jumpPreviousUserMessage: "ctrl+shift+u",
  jumpNextUserMessage: "ctrl+shift+i",
  jumpPreviousLlmMessage: "ctrl+alt+,",
  jumpNextLlmMessage: "ctrl+alt+.",
  jumpChatBottom: "ctrl+alt+g",
  scrollChatUp: "super+up",
  scrollChatDown: "super+down",
  editorStart: "super+shift+up",
  editorEnd: "super+shift+down",
};
const DEFAULT_BASH_MODE_SETTINGS: BashModeSettings = {
  toggleShortcut: "ctrl+shift+b",
  transcriptMaxLines: 2000,
  transcriptMaxBytes: 512 * 1024,
};
const CHAT_JUMP_SHORTCUTS: Array<{
  shortcutKey: ChatJumpShortcutKey;
  description: string;
  action: ChatJumpShortcutAction;
}> = [
  {
    shortcutKey: "jumpPreviousUserMessage",
    description: "Jump to previous user message",
    action: { kind: "message", role: "user", direction: "previous" },
  },
  {
    shortcutKey: "jumpNextUserMessage",
    description: "Jump to next user message",
    action: { kind: "message", role: "user", direction: "next" },
  },
  {
    shortcutKey: "jumpPreviousLlmMessage",
    description: "Jump to previous LLM message",
    action: { kind: "message", role: "assistant", direction: "previous" },
  },
  {
    shortcutKey: "jumpNextLlmMessage",
    description: "Jump to next LLM message",
    action: { kind: "message", role: "assistant", direction: "next" },
  },
  {
    shortcutKey: "jumpChatBottom",
    description: "Jump chat to bottom",
    action: { kind: "bottom" },
  },
];
const SHORTCUT_KEYS: PowerlineShortcutKey[] = [
  "stashHistory",
  "copyEditor",
  "cutEditor",
  "jumpPreviousUserMessage",
  "jumpNextUserMessage",
  "jumpPreviousLlmMessage",
  "jumpNextLlmMessage",
  "jumpChatBottom",
  "scrollChatUp",
  "scrollChatDown",
  "editorStart",
  "editorEnd",
];
const APP_RESERVED_SHORTCUTS = [
  "escape",
  "ctrl+c",
  "ctrl+d",
  "ctrl+z",
  "shift+tab",
  "ctrl+p",
  "shift+ctrl+p",
  "ctrl+l",
  "ctrl+o",
  "shift+ctrl+o",
  "ctrl+t",
  "ctrl+n",
  "ctrl+g",
  "alt+enter",
  "alt+up",
  "alt+down",
  "ctrl+v",
  "alt+v",
  "shift+l",
  "shift+t",
  "ctrl+s",
  "ctrl+r",
  "ctrl+backspace",
  "ctrl+a",
  "ctrl+x",
  "ctrl+u",
] as const;
const EXTRA_RESERVED_SHORTCUTS = ["alt+s"] as const;
const SHORTCUT_MODIFIER_ORDER = ["ctrl", "alt", "super", "shift"] as const;
const SHORTCUT_MODIFIERS = new Set(SHORTCUT_MODIFIER_ORDER);
const SHORTCUT_NAMED_KEYS = new Set([
  "escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert", "clear",
  "home", "end", "pageup", "pagedown", "up", "down", "left", "right",
]);
const SHORTCUT_SYMBOL_KEYS = new Set([
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
  "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "|", "~", "{", "}", ":", "<", ">", "?",
]);
const PROMPT_HISTORY_LIMIT = 100;
const LAYOUT_CACHE_TTL_MS = 250;
const STREAMING_LAYOUT_CACHE_TTL_MS = 1000;
const STATUS_RENDER_DEBOUNCE_MS = 33;
const CONTEXT_STATUS_RENDER_MS = 250;
const EDITOR_STATUS_DEFER_MS = 150;
const PROMPT_HISTORY_TRACKED = Symbol.for("powerlinePromptHistoryTracked");
const PROMPT_HISTORY_STATE_KEY = Symbol.for("powerlinePromptHistoryState");

type PromptHistoryState = { savedPromptHistory: string[] };
type SessionAssistantUsage = AssistantMessage["usage"];

function getUsageTokenTotal(usage: SessionAssistantUsage): number {
  const totalTokens = "totalTokens" in usage && typeof usage.totalTokens === "number" ? usage.totalTokens : 0;
  return totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function hasSessionAssistantUsage(value: unknown): value is SessionAssistantUsage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.input !== "number" ||
    typeof value.output !== "number" ||
    typeof value.cacheRead !== "number" ||
    typeof value.cacheWrite !== "number"
  ) {
    return false;
  }

  return isRecord(value.cost) && typeof value.cost.total === "number";
}

function isSessionAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && value.role === "assistant"
    && hasSessionAssistantUsage(value.usage)
    && (value.stopReason === undefined || typeof value.stopReason === "string");
}

function isPromptHistoryState(value: unknown): value is PromptHistoryState {
  return isRecord(value)
    && Array.isArray(value.savedPromptHistory)
    && value.savedPromptHistory.every((entry) => typeof entry === "string");
}

function getPromptHistoryState(): PromptHistoryState {
  const existing = Reflect.get(globalThis, PROMPT_HISTORY_STATE_KEY);
  if (isPromptHistoryState(existing)) {
    return existing;
  }

  const state: PromptHistoryState = { savedPromptHistory: [] };
  Reflect.set(globalThis, PROMPT_HISTORY_STATE_KEY, state);
  return state;
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

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

function getGlobalCompactionPolicyPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "compaction-policy.json");
}

function getCustomCompactionExtensionPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "extensions", "pi-custom-compaction");
}

function mergeSettings(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isRecord(baseValue) && isRecord(overrideValue)
      ? mergeSettings(baseValue, overrideValue)
      : overrideValue;
  }

  return merged;
}

function readSettingsFile(settingsPath: string): Record<string, unknown> {
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
    // Settings are user-edited input. Log and keep the extension running with defaults
    // instead of crashing the UI during startup.
    console.debug(`[powerline-footer] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

function readWritableSettingsFile(settingsPath: string): Record<string, unknown> | null {
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[powerline-footer] Refusing to write settings to non-object file at ${settingsPath}`);
      return null;
    }

    return parsed;
  } catch (error) {
    // Do not overwrite malformed user settings with partial data. Surface the failure
    // through the command handler so the user can fix the file intentionally.
    console.debug(`[powerline-footer] Failed to parse settings at ${settingsPath}:`, error);
    return null;
  }
}

function readCompactionPolicyEnabled(configPath: string): boolean | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!isRecord(parsed) || typeof parsed.enabled !== "boolean") return false;
    return parsed.enabled;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to read compaction policy from ${configPath}:`, error);
    return false;
  }
}

function detectCustomCompactionEnabled(cwd: string): boolean {
  if (!existsSync(getCustomCompactionExtensionPath())) return false;

  const projectSetting = readCompactionPolicyEnabled(join(cwd, ".pi", "compaction-policy.json"));
  if (projectSetting !== undefined) return projectSetting;

  return readCompactionPolicyEnabled(getGlobalCompactionPolicyPath()) ?? false;
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
        throw new Error(`Failed to parse session file ${filePath}: ${message}`, { cause: error });
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

function readSettings(cwd: string = process.cwd()): Record<string, unknown> {
  return mergeSettings(readSettingsFile(getSettingsPath()), readSettingsFile(getProjectSettingsPath(cwd)));
}

function writePowerlineSetting(cwd: string, update: (existingPowerlineSetting: unknown) => unknown): boolean {
  const globalSettingsPath = getSettingsPath();
  const projectSettingsPath = getProjectSettingsPath(cwd);
  const globalSettings = readWritableSettingsFile(globalSettingsPath);
  const projectSettings = readWritableSettingsFile(projectSettingsPath);

  if (globalSettings === null || projectSettings === null) {
    return false;
  }

  const writeToProject = Object.prototype.hasOwnProperty.call(projectSettings, "powerline");
  const settingsPath = writeToProject ? projectSettingsPath : globalSettingsPath;
  const settings = writeToProject ? projectSettings : globalSettings;

  settings.powerline = update(settings.powerline);

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to persist powerline setting to ${settingsPath}:`, error);
    return false;
  }
}

function writePowerlinePresetSetting(preset: StatusLinePreset, cwd: string = process.cwd()): boolean {
  return writePowerlineSetting(cwd, (existingPowerlineSetting) => (
    nextPowerlineSettingWithPreset(existingPowerlineSetting, preset)
  ));
}

function writePowerlineOptionSetting(
  cwd: string,
  updates: Partial<Pick<PowerlineConfig, "mouseScroll" | "fixedEditor">>,
  currentPreset: StatusLinePreset,
): boolean {
  return writePowerlineSetting(cwd, (existingPowerlineSetting) => (
    nextPowerlineSettingWithOptions(existingPowerlineSetting, updates, currentPreset)
  ));
}

const PRESET_NAMES = Object.keys(PRESETS) as StatusLinePreset[];

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

function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("This extension instance is stale");
}

function getCurrentEditorText(ctx: any, editor: any): string {
  const editorText = editor?.getExpandedText?.();
  if (typeof editorText === "string" && editorText.length > 0) return editorText;
  return ctx.ui.getEditorText?.() ?? editorText ?? "";
}

function buildStashPreview(text: string, maxWidth: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "(empty)";
  return truncateToWidth(compact, maxWidth, "…");
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
  const parts = value.trim().toLowerCase().split("+");
  if (parts.length <= 1) return parts[0] ?? "";

  const modifierRank = new Map(SHORTCUT_MODIFIER_ORDER.map((modifier, index) => [modifier, index]));
  const modifiers = parts.slice(0, -1).sort((a, b) => (modifierRank.get(a) ?? 99) - (modifierRank.get(b) ?? 99));
  return [...modifiers, parts[parts.length - 1]].join("+");
}

function formatShortcutLabel(shortcut: string): string {
  return shortcut.split("+").map((part) => part.toLowerCase() === "super" ? "cmd" : part).join("+");
}

function reservedShortcuts(): Set<string> {
  const shortcuts = new Set<string>([
    ...EXTRA_RESERVED_SHORTCUTS,
    ...APP_RESERVED_SHORTCUTS,
  ].map(normalizeShortcut));

  for (const definition of Object.values(TUI_KEYBINDINGS)) {
    const defaultKeys = definition.defaultKeys;
    const keys = defaultKeys === undefined ? [] : Array.isArray(defaultKeys) ? defaultKeys : [defaultKeys];
    for (const key of keys) {
      shortcuts.add(normalizeShortcut(key));
    }
  }

  return shortcuts;
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

  const modifierParts = parts.slice(0, -1).map((part) => {
    const modifier = part.toLowerCase();
    return modifier === "cmd" || modifier === "command" ? "super" : modifier;
  });
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
  const normalizedShortcut = normalizeShortcut([...modifierParts, normalizedKey].join("+"));
  if (shortcutUsesSuper(normalizedShortcut) && !isSupportedSuperShortcut(normalizedShortcut)) {
    return null;
  }

  return normalizedShortcut;
}

function shortcutUsageKey(shortcut: string): string {
  return shortcutConflictKey(normalizeShortcut(shortcut));
}

function findShortcutReplacement(key: PowerlineShortcutKey, used: Set<string>): string | null {
  const preferred = DEFAULT_SHORTCUTS[key];
  if (!used.has(shortcutUsageKey(preferred))) {
    return preferred;
  }

  for (const shortcutKey of SHORTCUT_KEYS) {
    const candidate = DEFAULT_SHORTCUTS[shortcutKey];
    if (!used.has(shortcutUsageKey(candidate))) {
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

  const used = new Set(Array.from(reservedShortcuts(), shortcutUsageKey));

  for (const key of SHORTCUT_KEYS) {
    const configured = resolved[key];
    const configuredUsageKey = shortcutUsageKey(configured);

    if (!used.has(configuredUsageKey)) {
      used.add(configuredUsageKey);
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
    used.add(shortcutUsageKey(replacement));
  }

  return resolved;
}

function parseBashModeSettings(settings: Record<string, unknown>): BashModeSettings {
  const raw = isRecord(settings.bashMode) ? settings.bashMode : {};

  const configuredToggleShortcut = parseShortcutOverride(raw.toggleShortcut);
  const toggleShortcut = configuredToggleShortcut && !reservedShortcuts().has(shortcutUsageKey(configuredToggleShortcut))
    ? configuredToggleShortcut
    : DEFAULT_BASH_MODE_SETTINGS.toggleShortcut;

  if (configuredToggleShortcut && toggleShortcut !== configuredToggleShortcut) {
    console.debug(
      `[powerline-footer] Bash mode shortcut conflict: "${configuredToggleShortcut}" replaced with "${toggleShortcut}"`,
    );
  }
  const transcriptMaxLines = typeof raw.transcriptMaxLines === "number" && Number.isFinite(raw.transcriptMaxLines)
    ? Math.max(100, Math.floor(raw.transcriptMaxLines))
    : DEFAULT_BASH_MODE_SETTINGS.transcriptMaxLines;
  const transcriptMaxBytes = typeof raw.transcriptMaxBytes === "number" && Number.isFinite(raw.transcriptMaxBytes)
    ? Math.max(16 * 1024, Math.floor(raw.transcriptMaxBytes))
    : DEFAULT_BASH_MODE_SETTINGS.transcriptMaxBytes;

  return {
    toggleShortcut,
    transcriptMaxLines,
    transcriptMaxBytes,
  };
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
  const mergedSegments = mergeSegmentsWithCustomItems(presetDef, config.customItems);
  const primaryIds = [...mergedSegments.leftSegments, ...mergedSegments.rightSegments];
  const secondaryIds = mergedSegments.secondarySegments;
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
  config = parsePowerlineConfig(startupSettings.powerline, PRESET_NAMES);
  let resolvedShortcuts = resolveShortcutConfig(startupSettings);
  let bashModeSettings = parseBashModeSettings(startupSettings);

  let enabled = true;
  let sessionStartTime = Date.now();
  let sessionGeneration = 0;
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let getThinkingLevelFn: (() => string) | null = null;
  let currentThinkingLevel: string | null = null;
  let liveAssistantUsage: SessionAssistantUsage | null = null;
  let isStreaming = false;
  let tuiRef: any = null;
  let restoreFooterStatusRepaintHook: (() => void) | null = null;
  let fixedEditorCompositor: TerminalSplitCompositor | null = null;
  let fixedStatusContainer: any = null;
  let fixedEditorContainer: any = null;
  let fixedWidgetContainerAbove: any = null;
  let fixedWidgetContainerBelow: any = null;
  let stashShortcutInputUnsubscribe: (() => void) | null = null;
  let dismissWelcomeOverlay: (() => void) | null = null;
  let welcomeHeaderActive = false;
  let welcomeOverlayShouldDismiss = false;
  let lastUserPrompt = "";
  let showLastPrompt = true;
  let stashedEditorText: string | null = null;
  let stashedPromptHistory: string[] = readPersistedStashHistory();
  let currentEditor: any = null;
  let bashModeActive = false;
  let bashTranscript = new BashTranscriptStore(bashModeSettings);
  let bashCompletionEngine = new BashCompletionEngine();
  let shellSession: ManagedShellSession | null = null;
  
  // Cache for the top and secondary powerline widgets.
  let lastLayoutWidth = 0;
  let lastLayoutResult: { topContent: string; secondaryContent: string } | null = null;
  let lastLayoutTimestamp = 0;
  let layoutDirty = true;
  let forceNextLayoutRecompute = false;
  let lastEditorInputAt = 0;

  const getShellPath = () => process.env.SHELL || "/bin/sh";
  const getShellCwd = () => shellSession?.state.cwd ?? currentCtx?.cwd ?? process.cwd();
  const welcomeDismissScheduler = createWelcomeDismissScheduler({
    dismiss: (ctx: unknown) => dismissWelcome(ctx),
    getGeneration: () => sessionGeneration,
    isEnabled: () => enabled,
  });

  const statusRenderScheduler = createRenderScheduler(() => {
    const msSinceInput = Date.now() - lastEditorInputAt;
    if (layoutDirty && !forceNextLayoutRecompute && msSinceInput < EDITOR_STATUS_DEFER_MS) {
      statusRenderScheduler.schedule(Math.max(0, EDITOR_STATUS_DEFER_MS - msSinceInput));
      return;
    }

    tuiRef?.requestRender();
  }, STATUS_RENDER_DEBOUNCE_MS);

  const resetLayoutCache = () => {
    lastLayoutResult = null;
    layoutDirty = true;
  };

  const requestStatusRender = (delayMs?: number) => {
    layoutDirty = true;
    statusRenderScheduler.schedule(delayMs);
  };

  const requestImmediateStatusRender = (options: { deferDuringTyping?: boolean } = {}) => {
    layoutDirty = true;
    if (options.deferDuringTyping !== false && Date.now() - lastEditorInputAt < EDITOR_STATUS_DEFER_MS) {
      statusRenderScheduler.schedule();
      return;
    }

    forceNextLayoutRecompute = true;
    statusRenderScheduler.cancel();
    statusRenderScheduler.schedule(0);
  };

  const installFooterStatusRepaintHook = (footerData: ReadonlyFooterDataProvider) => {
    restoreFooterStatusRepaintHook?.();
    restoreFooterStatusRepaintHook = null;

    const writableFooterData = footerData as ReadonlyFooterDataProvider & {
      setExtensionStatus?: (key: string, text: string | undefined) => void;
      clearExtensionStatuses?: () => void;
    };
    if (typeof writableFooterData.setExtensionStatus !== "function") return;

    const originalSetExtensionStatus = writableFooterData.setExtensionStatus;
    const originalClearExtensionStatuses = writableFooterData.clearExtensionStatuses;
    const setExtensionStatusAndRepaint = function setExtensionStatusAndRepaint(this: unknown, key: string, text: string | undefined) {
      originalSetExtensionStatus.call(this, key, text);
      requestImmediateStatusRender();
    };
    writableFooterData.setExtensionStatus = setExtensionStatusAndRepaint;

    let clearExtensionStatusesAndRepaint: (() => void) | null = null;
    if (typeof originalClearExtensionStatuses === "function") {
      clearExtensionStatusesAndRepaint = function clearExtensionStatusesAndRepaint(this: unknown) {
        originalClearExtensionStatuses.call(this);
        requestImmediateStatusRender();
      };
      writableFooterData.clearExtensionStatuses = clearExtensionStatusesAndRepaint;
    }

    restoreFooterStatusRepaintHook = () => {
      if (writableFooterData.setExtensionStatus === setExtensionStatusAndRepaint) {
        writableFooterData.setExtensionStatus = originalSetExtensionStatus;
      }
      if (clearExtensionStatusesAndRepaint && writableFooterData.clearExtensionStatuses === clearExtensionStatusesAndRepaint) {
        writableFooterData.clearExtensionStatuses = originalClearExtensionStatuses;
      }
    };
  };

  const getShellHistoryEntries = (prefix: string): string[] => {
    const project = matchHistoryEntries(
      readProjectHistory(currentCtx?.cwd ?? process.cwd()).map((entry) => entry.command),
      prefix,
      50,
    );
    const global = matchHistoryEntries(readGlobalShellHistory(getShellPath()), prefix, 50);
    return [...new Set([...project, ...global])];
  };

  const ensureShellSession = async (): Promise<ManagedShellSession> => {
    if (!shellSession) {
      shellSession = new ManagedShellSession(
        getShellPath(),
        currentCtx?.cwd ?? process.cwd(),
        bashTranscript,
        requestStatusRender,
        (command, cwd) => appendProjectHistory(currentCtx?.cwd ?? process.cwd(), command, cwd),
      );
    }
    await shellSession.ensureReady();
    return shellSession;
  };

  const runShellCommand = async (command: string, ctx: any): Promise<void> => {
    try {
      const session = await ensureShellSession();
      await session.runCommand(command);
      requestStatusRender();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to run shell command: ${message}`, "error");
    }
  };

  const setBashModeActive = async (value: boolean, ctx: any): Promise<void> => {
    if (value === bashModeActive) return;
    if (!value && shellSession?.state.running) {
      ctx.ui.notify("Wait for the current shell command to finish before leaving bash mode", "warning");
      return;
    }

    if (value) {
      try {
        const session = await ensureShellSession();
        bashModeActive = true;
        currentEditor?.dismissBashModeUi?.();
        currentEditor?.refreshGhostSuggestion?.();
        requestStatusRender();
        ctx.ui.notify(`Bash mode enabled (${session.state.shellName})`, "info");
      } catch (error) {
        shellSession?.dispose();
        shellSession = null;
        bashModeActive = false;
        requestStatusRender();
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to start shell session: ${message}`, "error");
      }
      return;
    }

    bashModeActive = value;
    currentEditor?.dismissBashModeUi?.();
    requestStatusRender();
    ctx.ui.notify("Bash mode disabled", "info");
  };

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

  // Track session start
  pi.on("session_start", async (event, ctx) => {
    shellSession?.dispose();
    shellSession = null;
    sessionGeneration++;
    sessionStartTime = Date.now();
    currentCtx = ctx;
    customCompactionEnabled = detectCustomCompactionEnabled(ctx.cwd);
    lastUserPrompt = "";
    isStreaming = false;
    liveAssistantUsage = null;
    stashedEditorText = null;

    const settings = readSettings(ctx.cwd);
    bashModeSettings = parseBashModeSettings(settings);
    resolvedShortcuts = resolveShortcutConfig(settings);
    showLastPrompt = settings.showLastPrompt !== false;
    config = parsePowerlineConfig(settings.powerline, PRESET_NAMES);
    stashedPromptHistory = readPersistedStashHistory();
    bashModeActive = false;
    bashTranscript = new BashTranscriptStore(bashModeSettings);
    bashCompletionEngine = new BashCompletionEngine();

    getThinkingLevelFn = typeof ctx.getThinkingLevel === "function"
      ? () => ctx.getThinkingLevel()
      : null;
    currentThinkingLevel = getThinkingLevelFn?.() ?? null;

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

  });

  pi.on("session_shutdown", async (event) => {
    // When switching sessions (resume/new/fork), preserve keyboard modes
    // (Kitty protocol, modifyOtherKeys) so that Shift+Enter and other
    // modified keys continue to work. Only reset on quit/reload where
    // the terminal should be restored to a clean state.
    const isTerminalExit = event?.reason === "quit" || event?.reason === "reload";

    sessionGeneration++;
    dismissWelcomeOverlay?.();
    dismissWelcomeOverlay = null;
    welcomeHeaderActive = false;
    welcomeOverlayShouldDismiss = false;
    welcomeDismissScheduler.cancel();
    statusRenderScheduler.cancel();
    restoreFooterStatusRepaintHook?.();
    restoreFooterStatusRepaintHook = null;
    teardownFixedEditorCompositor(isTerminalExit ? { resetExtendedKeyboardModes: true } : undefined);
    stashShortcutInputUnsubscribe?.();
    stashShortcutInputUnsubscribe = null;
    shellSession?.dispose();
    shellSession = null;
    bashModeActive = false;
    currentCtx = null;
    footerDataRef = null;
    getThinkingLevelFn = null;
    currentThinkingLevel = null;
    liveAssistantUsage = null;
    tuiRef = null;
    currentEditor = null;
    resetLayoutCache();
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
        setTimeout(() => requestStatusRender(), 100);
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
      setTimeout(() => requestStatusRender(), 100);
      setTimeout(() => requestStatusRender(), 300);
      setTimeout(() => requestStatusRender(), 500);
    }
  });

  pi.on("model_select", async (_event, ctx) => {
    currentCtx = ctx;
    requestStatusRender();
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    currentCtx = ctx;
    currentThinkingLevel = getThinkingLevelFn?.() ?? (typeof event.level === "string" ? event.level : null);
    requestImmediateStatusRender({ deferDuringTyping: false });
  });

  pi.on("session_tree", async (_event, ctx) => {
    currentCtx = ctx;
    currentThinkingLevel = null;
    liveAssistantUsage = null;
    requestImmediateStatusRender({ deferDuringTyping: false });
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
    liveAssistantUsage = null;
    onVibeAgentStart();
    dismissWelcome(ctx);
    currentCtx = ctx;
  });

  pi.on("message_update", async (event, ctx) => {
    if (isSessionAssistantMessage(event.message)
      && event.message.stopReason !== "error"
      && event.message.stopReason !== "aborted"
      && getUsageTokenTotal(event.message.usage) > 0) {
      liveAssistantUsage = event.message.usage;
      currentCtx = ctx;
      layoutDirty = true;
      statusRenderScheduler.schedule(CONTEXT_STATUS_RENDER_MS);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    currentCtx = ctx;
    if (isSessionAssistantMessage(event.message)) {
      if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
        liveAssistantUsage = null;
      } else if (getUsageTokenTotal(event.message.usage) > 0) {
        liveAssistantUsage = event.message.usage;
      }
    }
    requestImmediateStatusRender({ deferDuringTyping: false });
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentCtx = ctx;
    requestImmediateStatusRender({ deferDuringTyping: false });
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

  function dismissWelcome(ctx: any) {
    welcomeDismissScheduler.cancel();

    if (dismissWelcomeOverlay) {
      dismissWelcomeOverlay();
      dismissWelcomeOverlay = null;
    } else {
      // The startup overlay mounts after a delay; dismiss it immediately if it appears later.
      welcomeOverlayShouldDismiss = true;
    }
    if (welcomeHeaderActive) {
      welcomeHeaderActive = false;
      ctx.ui.setHeader(undefined);
    }
  }

  function scheduleDismissWelcome(ctx: any) {
    if (!dismissWelcomeOverlay && welcomeOverlayShouldDismiss && !welcomeHeaderActive) return;
    welcomeDismissScheduler.schedule(ctx);
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

  function isStashShortcutInput(data: string): boolean {
    if (isKeyRelease(data)) return false;

    return data === "ß"
      || data === "\x1bs"
      || data === "\x1bS"
      || /^\x1b\[(?:83|115)(?::\d*)?(?::\d*)?;3(?::\d+)?u$/.test(data)
      || data === "\x1b[27;3;115~"
      || data === "\x1b[27;3;83~"
      || matchesKey(data, "alt+s");
  }

  function getChatJumpShortcutAction(data: string): ChatJumpShortcutAction | null {
    return CHAT_JUMP_SHORTCUTS.find(({ shortcutKey }) => matchesConfiguredShortcut(data, resolvedShortcuts[shortcutKey]))?.action ?? null;
  }

  function isPromptHistoryShortcutInput(data: string): boolean {
    return matchesConfiguredShortcut(data, resolvedShortcuts.stashHistory)
      || (resolvedShortcuts.stashHistory === "ctrl+alt+h" && (
        /^\x1b\[104(?::\d*)?(?::\d*)?;7(?::\d+)?u$/.test(data)
        || data === "\x1b[27;7;104~"
        || data === "\x1b[27;7;72~"
      ));
  }

  function getPowerlineShortcutAction(data: string): PowerlineShortcutAction | null {
    if (isKeyRelease(data)) return null;

    if (isPromptHistoryShortcutInput(data)) {
      return { kind: "stashHistory" };
    }
    if (matchesConfiguredShortcut(data, resolvedShortcuts.copyEditor)) {
      return { kind: "copyEditor" };
    }
    if (matchesConfiguredShortcut(data, resolvedShortcuts.cutEditor)) {
      return { kind: "cutEditor" };
    }
    if (matchesConfiguredShortcut(data, bashModeSettings.toggleShortcut)) {
      return { kind: "bashMode" };
    }

    const chatJumpAction = getChatJumpShortcutAction(data);
    return chatJumpAction ? { kind: "chat", action: chatJumpAction } : null;
  }

  function runPowerlineShortcut(ctx: any, action: PowerlineShortcutAction): void {
    if (action.kind === "stashHistory") {
      void openStashHistory(ctx);
      return;
    }

    if (action.kind === "copyEditor" || action.kind === "cutEditor") {
      const text = getEditorTextForClipboard(ctx);
      if (!text) return;

      copyTextToClipboard(ctx, text, action.kind === "copyEditor" ? "Copied editor text" : undefined);
      if (action.kind === "cutEditor") {
        ctx.ui.setEditorText("");
        ctx.ui.notify("Cut editor text", "info");
      }
      return;
    }

    if (action.kind === "bashMode") {
      void setBashModeActive(!bashModeActive, ctx);
      return;
    }

    if (action.action.kind === "bottom") {
      jumpChatToBottom(ctx);
      return;
    }

    jumpToChatMessage(ctx, action.action.role, action.action.direction);
  }

  function stashOrRestoreEditorText(ctx: any): void {
    const rawText = getCurrentEditorText(ctx, currentEditor);
    const hasStash = stashedEditorText !== null;

    if (!hasNonWhitespaceText(rawText)) {
      if (!hasStash) {
        ctx.ui.notify("Nothing to stash", "info");
        return;
      }

      ctx.ui.setEditorText(stashedEditorText);
      stashedEditorText = null;
      ctx.ui.setStatus("stash", undefined);
      ctx.ui.notify("Stash restored", "info");
      return;
    }

    stashedEditorText = rawText;
    addStashHistoryEntry(rawText);
    ctx.ui.setEditorText("");
    ctx.ui.setStatus("stash", "stash");
    ctx.ui.notify(hasStash ? "Stash updated" : "Text stashed", "info");
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

  pi.on("agent_end", async (_event, ctx) => {
    isStreaming = false;
    liveAssistantUsage = null;
    currentCtx = ctx;
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
    requestStatusRender();
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
          shellSession?.dispose();
          shellSession = null;
          bashTranscript.clear();
          bashModeActive = false;
          dismissWelcomeOverlay?.();
          dismissWelcomeOverlay = null;
          welcomeHeaderActive = false;
          welcomeOverlayShouldDismiss = false;
          welcomeDismissScheduler.cancel();
          getPromptHistoryState().savedPromptHistory = [];
          stashedEditorText = null;
                ctx.ui.setStatus("stash", undefined);
          restoreFooterStatusRepaintHook?.();
          restoreFooterStatusRepaintHook = null;
          teardownFixedEditorCompositor();
          stashShortcutInputUnsubscribe?.();
          stashShortcutInputUnsubscribe = null;
          // Clear all custom UI components
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);
          ctx.ui.setHeader(undefined);
          ctx.ui.setWidget("powerline-top", undefined);
          ctx.ui.setWidget("powerline-secondary", undefined);
          ctx.ui.setWidget("powerline-bash-transcript", undefined);
          ctx.ui.setWidget("powerline-status", undefined);
          ctx.ui.setWidget("powerline-last-prompt", undefined);
          footerDataRef = null;
          tuiRef = null;
          currentEditor = null;
          statusRenderScheduler.cancel();
          resetLayoutCache();
          ctx.ui.notify("Powerline disabled", "info");
        }
        return;
      }

      const normalizedArgs = args.trim().toLowerCase();
      const mouseScrollMatch = /^mouse-scroll(?:\s+(on|off|toggle))?$/.exec(normalizedArgs);
      if (mouseScrollMatch) {
        const mode = mouseScrollMatch[1] ?? "toggle";
        config.mouseScroll = mode === "toggle" ? !config.mouseScroll : mode === "on";
        if (enabled && ctx.hasUI && config.fixedEditor && tuiRef && currentEditor) {
          installFixedEditorCompositor(ctx, tuiRef);
        }

        if (writePowerlineOptionSetting(ctx.cwd, { mouseScroll: config.mouseScroll }, config.preset)) {
          ctx.ui.notify(`Powerline mouse scroll ${config.mouseScroll ? "enabled" : "disabled"}`, "info");
        } else {
          ctx.ui.notify(`Powerline mouse scroll ${config.mouseScroll ? "enabled" : "disabled"} (not persisted; check settings.json)`, "warning");
        }
        return;
      }

      const fixedEditorMatch = /^fixed-editor(?:\s+(on|off|toggle))?$/.exec(normalizedArgs);
      if (fixedEditorMatch) {
        const mode = fixedEditorMatch[1] ?? "toggle";
        config.fixedEditor = mode === "toggle" ? !config.fixedEditor : mode === "on";
        if (enabled && ctx.hasUI) {
          setupCustomEditor(ctx);
        }

        if (writePowerlineOptionSetting(ctx.cwd, { fixedEditor: config.fixedEditor }, config.preset)) {
          ctx.ui.notify(`Powerline fixed editor ${config.fixedEditor ? "enabled" : "disabled"}`, "info");
        } else {
          ctx.ui.notify(`Powerline fixed editor ${config.fixedEditor ? "enabled" : "disabled"} (not persisted; check settings.json)`, "warning");
        }
        return;
      }

      const preset = normalizePreset(args);
      if (preset) {
        config.preset = preset;
        resetLayoutCache();
        if (enabled) {
          setupCustomEditor(ctx);
        }

        if (writePowerlinePresetSetting(preset, ctx.cwd)) {
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

  pi.registerCommand("bash-mode", {
    description: "Toggle sticky bash mode (on, off, toggle)",
    handler: async (args, ctx) => {
      const mode = args?.trim().toLowerCase() || "toggle";
      if (mode === "on") {
        await setBashModeActive(true, ctx);
        return;
      }
      if (mode === "off") {
        await setBashModeActive(false, ctx);
        return;
      }
      if (mode === "toggle") {
        await setBashModeActive(!bashModeActive, ctx);
        return;
      }
      ctx.ui.notify("Usage: /bash-mode [on|off|toggle]", "warning");
    },
  });

  pi.registerCommand("bash-reset", {
    description: "Reset the managed bash session",
    handler: async (_args, ctx) => {
      shellSession?.dispose();
      shellSession = null;
      bashTranscript.clear();
      if (bashModeActive) {
        try {
          await ensureShellSession();
        } catch (error) {
          bashModeActive = false;
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Failed to restart shell session: ${message}`, "error");
          requestStatusRender();
          return;
        }
      }
      requestStatusRender();
      ctx.ui.notify("Bash session reset", "info");
    },
  });

  pi.registerShortcut(bashModeSettings.toggleShortcut, {
    description: "Toggle bash mode",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      await setBashModeActive(!bashModeActive, ctx);
    },
  });

  pi.registerShortcut("alt+s", {
    description: "Stash/restore editor text",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      stashOrRestoreEditorText(ctx);
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

  for (const { shortcutKey, description, action } of CHAT_JUMP_SHORTCUTS) {
    pi.registerShortcut(resolvedShortcuts[shortcutKey], {
      description,
      handler: async (ctx) => {
        if (!enabled || !ctx.hasUI) return;
        runPowerlineShortcut(ctx, { kind: "chat", action });
      },
    });
  }

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
          ctx.ui.notify("Invalid model format. Use: provider/modelId (e.g., openai-codex/gpt-5.4-mini)", "error");
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
      if (!isRecord(e)) {
        continue;
      }

      // Check for thinking level change entries
      if (e.type === "thinking_level_change" && typeof e.thinkingLevel === "string") {
        thinkingLevelFromSession = e.thinkingLevel;
      }

      if (e.type !== "message" || !isSessionAssistantMessage(e.message)) {
        continue;
      }

      const m = e.message;
      if (m.stopReason === "error" || m.stopReason === "aborted") {
        continue;
      }
      input += m.usage.input;
      output += m.usage.output;
      cacheRead += m.usage.cacheRead;
      cacheWrite += m.usage.cacheWrite;
      cost += m.usage.cost.total;
      if (getUsageTokenTotal(m.usage) > 0) {
        lastAssistant = m;
      }
    }

    // Calculate context percentage.
    const latestUsage = isStreaming ? liveAssistantUsage ?? lastAssistant?.usage : lastAssistant?.usage;
    const coreContextUsage = isStreaming && liveAssistantUsage ? null : readCoreContextUsage(ctx);
    const contextTokens = coreContextUsage?.contextTokens ?? (latestUsage ? getUsageTokenTotal(latestUsage) : 0);
    const contextWindow = coreContextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const contextPercent = coreContextUsage?.contextPercent ?? (contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0);

    const segmentOptions = mergeSegmentOptions(presetDef.segmentOptions, config.segmentOptions);

    // Get git status (cached)
    const gitBranch = footerDataRef?.getGitBranch() ?? null;
    const gitStatus = getGitStatus(gitBranch, segmentOptions.git?.polling);
    const extensionStatuses = footerDataRef?.getExtensionStatuses() ?? new Map();
    const customItemsById = new Map(config.customItems.map((item) => [item.id, item]));
    const hiddenExtensionStatusKeys = collectHiddenExtensionStatusKeys(config.customItems);

    // Check if using OAuth subscription
    const usingSubscription = ctx.model
      ? ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false
      : false;

    const thinkingLevel = currentThinkingLevel ?? thinkingLevelFromSession ?? getThinkingLevelFn?.() ?? "off";

    return {
      model: ctx.model,
      thinkingLevel,
      sessionId: ctx.sessionManager?.getSessionId?.(),
      cwd: ctx.cwd,
      usageStats: { input, output, cacheRead, cacheWrite, cost },
      contextPercent,
      contextWindow,
      autoCompactEnabled: ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? true,
      customCompactionEnabled: customCompactionEnabled || extensionStatuses.has(CUSTOM_COMPACTION_STATUS_KEY),
      usingSubscription,
      sessionStartTime,
      shellModeActive: bashModeActive,
      shellRunning: shellSession?.state.running ?? false,
      shellName: shellSession?.state.shellName ?? null,
      shellCwd: shellSession?.state.cwd ?? null,
      git: gitStatus,
      extensionStatuses,
      hiddenExtensionStatusKeys,
      customItemsById,
      options: segmentOptions,
      theme,
      colors,
    };
  }

  /**
   * Get cached responsive layout or compute fresh one.
   * The segment context scans session state, so keep it stable across render bursts.
   */
  function getResponsiveLayout(width: number, theme: Theme): { topContent: string; secondaryContent: string } {
    const now = Date.now();
    const cacheTtl = isStreaming ? STREAMING_LAYOUT_CACHE_TTL_MS : LAYOUT_CACHE_TTL_MS;

    if (lastLayoutResult && lastLayoutWidth === width) {
      const msSinceInput = now - lastEditorInputAt;
      const typingRecently = msSinceInput < EDITOR_STATUS_DEFER_MS;

      if (!forceNextLayoutRecompute && typingRecently && (layoutDirty || now - lastLayoutTimestamp >= cacheTtl)) {
        return lastLayoutResult;
      }

      if (!layoutDirty && now - lastLayoutTimestamp < cacheTtl) {
        return lastLayoutResult;
      }
    }

    const presetDef = getPreset(config.preset);
    let segmentCtx: SegmentContext;
    try {
      segmentCtx = buildSegmentContext(currentCtx, theme);
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
      currentCtx = null;
      lastLayoutWidth = width;
      lastLayoutResult = { topContent: "", secondaryContent: "" };
      lastLayoutTimestamp = now;
      layoutDirty = false;
      forceNextLayoutRecompute = false;
      return lastLayoutResult;
    }

    lastLayoutWidth = width;
    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, width);
    lastLayoutTimestamp = now;
    layoutDirty = false;
    forceNextLayoutRecompute = false;

    return lastLayoutResult;
  }

  function renderPowerlineStatusLines(width: number): string[] {
    if (!currentCtx || !footerDataRef) return [];

    const statuses = footerDataRef.getExtensionStatuses();
    if (!statuses || statuses.size === 0) return [];
    const hiddenExtensionStatusKeys = collectHiddenExtensionStatusKeys(config.customItems);

    const notifications: string[] = [];
    for (const value of getNotificationExtensionStatuses(statuses, hiddenExtensionStatusKeys)) {
      const lineContent = ` ${value}`;
      if (visibleWidth(lineContent) <= width) {
        notifications.push(lineContent);
      }
    }

    return notifications;
  }

  function renderPowerlineTopLines(width: number, theme: Theme): string[] {
    if (!currentCtx) return [];

    const layout = getResponsiveLayout(width, theme);
    return layout.topContent ? [layout.topContent] : [];
  }

  function renderPowerlineSecondaryLines(width: number, theme: Theme): string[] {
    if (!currentCtx) return [];

    const layout = getResponsiveLayout(width, theme);
    return layout.secondaryContent ? [layout.secondaryContent] : [];
  }

  function renderBashTranscriptLines(width: number, theme: Theme): string[] {
    if (!bashModeActive) return [];

    const snapshot = bashTranscript.getSnapshot();
    if (snapshot.commands.length === 0) return [];

    const lines: string[] = [];
    if (snapshot.truncatedCommands > 0) {
      lines.push(` ${theme.fg("dim", `… ${snapshot.truncatedCommands} earlier command${snapshot.truncatedCommands === 1 ? "" : "s"} truncated`)}`);
    }

    const recentCommands = snapshot.commands.slice(-4);
    for (const command of recentCommands) {
      const promptGlyph = (shellSession?.state.shellName ?? "shell") === "fish" ? ">" : "$";
      const status = command.exitCode === null
        ? theme.fg("accent", "running")
        : command.exitCode === 0
          ? theme.fg("success", "ok")
          : theme.fg("error", `exit ${command.exitCode}`);
      const commandLine = truncateToWidth(command.command.replace(/\s+/g, " ").trim(), Math.max(8, width - 8), "…");
      lines.push(` ${theme.fg("accent", promptGlyph)} ${commandLine} ${theme.fg("dim", "(")}${status}${theme.fg("dim", ")")}`);

      const outputTail = command.output.slice(-6);
      for (const outputLine of outputTail) {
        lines.push(`   ${truncateToWidth(outputLine, Math.max(1, width - 3), "…")}`);
      }
    }

    return lines.slice(-16);
  }

  function renderLastPromptLines(width: number): string[] {
    if (bashModeActive || !showLastPrompt || !lastUserPrompt) return [];

    const prefix = ` ${getFgAnsiCode("sep")}↳${ansi.reset} `;
    const availableWidth = width - visibleWidth(prefix);
    if (availableWidth < 10) return [];

    let promptText = lastUserPrompt.replace(/\s+/g, " ").trim();
    if (!promptText) return [];

    promptText = truncateToWidth(promptText, availableWidth, "…");

    const styledPrompt = `${getFgAnsiCode("sep")}${promptText}${ansi.reset}`;
    const line = `${prefix}${styledPrompt}`;
    return [truncateToWidth(line, width, "…")];
  }

  function teardownFixedEditorCompositor(options?: { resetExtendedKeyboardModes?: boolean }) {
    const hadCompositor = fixedEditorCompositor !== null;
    fixedEditorCompositor?.dispose(options);
    if (!hadCompositor && options?.resetExtendedKeyboardModes) {
      try {
        process.stdout.write(emergencyTerminalModeReset());
      } catch {
        // Shutdown cleanup cannot surface useful terminal write failures.
      }
    }
    fixedEditorCompositor = null;
    fixedStatusContainer = null;
    fixedEditorContainer = null;
    fixedWidgetContainerAbove = null;
    fixedWidgetContainerBelow = null;
  }

  function findContainerWithChild(tui: any, child: any): { container: any; index: number } | null {
    const children = Array.isArray(tui?.children) ? tui.children : [];
    const index = children.findIndex((candidate: any) => Array.isArray(candidate?.children) && candidate.children.includes(child));
    if (index === -1) return null;

    return { container: children[index], index };
  }

  function installFixedEditorCompositor(ctx: any, tui: any) {
    teardownFixedEditorCompositor();

    if (!ctx.hasUI || !config.fixedEditor) return;
    if (!tui?.terminal || typeof tui.terminal.write !== "function") {
      throw new Error("[powerline-footer] Fixed editor compositor could not find tui.terminal.write()");
    }
    if (!currentEditor) {
      throw new Error("[powerline-footer] Fixed editor compositor expected the custom editor to be installed first");
    }

    const editorContainerMatch = findContainerWithChild(tui, currentEditor);
    if (!editorContainerMatch) {
      throw new Error("[powerline-footer] Fixed editor compositor could not find the editor container in TUI children");
    }

    const tuiChildren = Array.isArray(tui.children) ? tui.children : [];
    fixedEditorContainer = editorContainerMatch.container;
    const statusContainerCandidate = tuiChildren[editorContainerMatch.index - 2] ?? null;
    fixedStatusContainer = statusContainerCandidate && typeof statusContainerCandidate.render === "function"
      ? statusContainerCandidate
      : null;
    fixedWidgetContainerAbove = tuiChildren[editorContainerMatch.index - 1] ?? null;
    fixedWidgetContainerBelow = tuiChildren[editorContainerMatch.index + 1] ?? null;

    const fallbackTheme = ctx.ui.theme;
    const readRenderTheme = (): Theme => {
      if (!currentCtx) return fallbackTheme;
      try {
        return currentCtx.ui?.theme ?? fallbackTheme;
      } catch (error) {
        if (!isStaleExtensionContextError(error)) throw error;
        currentCtx = null;
        resetLayoutCache();
        return fallbackTheme;
      }
    };

    let compositor: TerminalSplitCompositor;
    compositor = new TerminalSplitCompositor({
      tui,
      terminal: tui.terminal,
      mouseScroll: config.mouseScroll,
      keyboardScrollShortcuts: {
        up: resolvedShortcuts.scrollChatUp,
        down: resolvedShortcuts.scrollChatDown,
      },
      scrollRepaintThrottleMs: DEFAULT_SCROLL_REPAINT_THROTTLE_MS,
      scrollAwayNavigationCard: {
        shortcuts: [
          { id: "bottom", shortcutLabel: formatShortcutLabel(resolvedShortcuts.jumpChatBottom) },
          { id: "previousUser", shortcutLabel: formatShortcutLabel(resolvedShortcuts.jumpPreviousUserMessage) },
          { id: "nextUser", shortcutLabel: formatShortcutLabel(resolvedShortcuts.jumpNextUserMessage) },
          { id: "previousAssistant", shortcutLabel: formatShortcutLabel(resolvedShortcuts.jumpPreviousLlmMessage) },
          { id: "nextAssistant", shortcutLabel: formatShortcutLabel(resolvedShortcuts.jumpNextLlmMessage) },
        ],
        onClickBottom: () => jumpChatToBottom(ctx),
      },
      onCopySelection: (text) => copyTextToClipboard(ctx, text),
      getShowHardwareCursor: () => typeof tui.getShowHardwareCursor === "function" && tui.getShowHardwareCursor(),
      renderCluster: (width, terminalRows) => {
        const theme = readRenderTheme();
        const statusContainerLines = fixedStatusContainer
          ? compositor.renderHidden(fixedStatusContainer, width).filter((line) => visibleWidth(line) > 0)
          : [];
        const aboveWidgetLines = fixedWidgetContainerAbove ? compositor.renderHidden(fixedWidgetContainerAbove, width) : [];
        const belowWidgetLines = fixedWidgetContainerBelow ? compositor.renderHidden(fixedWidgetContainerBelow, width) : [];
        return renderFixedEditorCluster({
          width,
          terminalRows,
          statusLines: [...aboveWidgetLines, ...renderPowerlineStatusLines(width), ...statusContainerLines],
          topLines: renderPowerlineTopLines(width, theme),
          editorLines: fixedEditorContainer ? compositor.renderHidden(fixedEditorContainer, width) : [],
          secondaryLines: [...renderPowerlineSecondaryLines(width, theme), ...belowWidgetLines],
          transcriptLines: renderBashTranscriptLines(width, theme),
          lastPromptLines: renderLastPromptLines(width),
        });
      },
    });

    fixedEditorCompositor = compositor;
    if (fixedStatusContainer?.render) compositor.hideRenderable(fixedStatusContainer);
    if (fixedWidgetContainerAbove?.render) compositor.hideRenderable(fixedWidgetContainerAbove);
    compositor.hideRenderable(fixedEditorContainer);
    if (fixedWidgetContainerBelow?.render) compositor.hideRenderable(fixedWidgetContainerBelow);
    compositor.install();
    tui.requestRender(true);
  }

  function isChatMessageComponentForRole(component: unknown, role: ChatJumpRole): boolean {
    const componentName = typeof component === "object" && component !== null ? component.constructor?.name : undefined;
    if (role === "assistant") {
      return componentName === "AssistantMessageComponent";
    }

    return componentName === "UserMessageComponent" || componentName === "SkillInvocationMessageComponent";
  }

  function renderLineCount(component: unknown, width: number): number {
    if (typeof component !== "object" || component === null) return 0;

    const render = Reflect.get(component, "render");
    if (typeof render !== "function") return 0;

    const lines = render.call(component, width);
    return Array.isArray(lines) ? lines.length : 0;
  }

  function collectMessageStartLines(component: unknown, width: number, role: ChatJumpRole, offset: number): {
    targets: number[];
    lineCount: number;
  } {
    const lineCount = renderLineCount(component, width);
    if (isChatMessageComponentForRole(component, role)) {
      return { targets: [offset], lineCount };
    }

    const children = typeof component === "object" && component !== null ? Reflect.get(component, "children") : null;
    if (!Array.isArray(children) || children.length === 0) {
      return { targets: [], lineCount };
    }

    const targets: number[] = [];
    let childOffset = offset;
    let childrenLineCount = 0;
    for (const child of children) {
      const result = collectMessageStartLines(child, width, role, childOffset);
      targets.push(...result.targets);
      childOffset += result.lineCount;
      childrenLineCount += result.lineCount;
    }

    return { targets, lineCount: Math.max(lineCount, childrenLineCount) };
  }

  function collectChatMessageStartLines(role: ChatJumpRole): number[] {
    const children = Array.isArray(tuiRef?.children) ? tuiRef.children : [];
    const width = Math.max(1, tuiRef?.terminal?.columns ?? 80);
    const targets: number[] = [];
    let offset = 0;

    for (const child of children) {
      const result = collectMessageStartLines(child, width, role, offset);
      targets.push(...result.targets);
      offset += result.lineCount;
    }

    return [...new Set(targets)].sort((a, b) => a - b);
  }

  function jumpToChatMessage(ctx: any, role: ChatJumpRole, direction: ChatJumpDirection): boolean {
    if (!fixedEditorCompositor) {
      ctx.ui.notify("Chat message jumps require /powerline fixed-editor on", "warning");
      return false;
    }

    const targets = collectChatMessageStartLines(role);
    const label = role === "assistant" ? "LLM" : "user";
    if (targets.length === 0) {
      ctx.ui.notify(`No ${label} messages found`, "info");
      return false;
    }

    const jumped = direction === "previous"
      ? fixedEditorCompositor.jumpToPreviousRootTarget(targets)
      : fixedEditorCompositor.jumpToNextRootTarget(targets);
    if (!jumped) {
      ctx.ui.notify(`No ${direction} ${label} message`, "info");
      return false;
    }

    return true;
  }

  function jumpChatToBottom(ctx: any): boolean {
    if (!fixedEditorCompositor) {
      ctx.ui.notify("Chat bottom jump requires /powerline fixed-editor on", "warning");
      return false;
    }

    return fixedEditorCompositor.jumpToRootBottom();
  }

  function followSubmittedEditorToBottom(): void {
    fixedEditorCompositor?.jumpToRootBottom();
  }

  function installPowerlineWidgets(ctx: any) {
    ctx.ui.setWidget("powerline-status", () => ({
      dispose() {},
      invalidate() {
        requestStatusRender();
      },
      render(width: number): string[] {
        return renderPowerlineStatusLines(width);
      },
    }), { placement: "aboveEditor" });

    ctx.ui.setWidget("powerline-top", (_tui: any, theme: Theme) => ({
      dispose() {},
      invalidate() {
        resetLayoutCache();
      },
      render(width: number): string[] {
        return renderPowerlineTopLines(width, theme);
      },
    }), { placement: "aboveEditor" });

    ctx.ui.setWidget("powerline-secondary", (_tui: any, theme: Theme) => ({
      dispose() {},
      invalidate() {
        resetLayoutCache();
      },
      render(width: number): string[] {
        return renderPowerlineSecondaryLines(width, theme);
      },
    }), { placement: "belowEditor" });

    ctx.ui.setWidget("powerline-bash-transcript", (_tui: any, theme: Theme) => ({
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        return renderBashTranscriptLines(width, theme);
      },
    }), { placement: "belowEditor" });

    ctx.ui.setWidget("powerline-last-prompt", () => ({
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        return renderLastPromptLines(width);
      },
    }), { placement: "belowEditor" });
  }

  function setupCustomEditor(ctx: any) {
    snapshotPromptHistory(currentEditor);
    if (!enabled) {
      return;
    }

    stashShortcutInputUnsubscribe?.();
    stashShortcutInputUnsubscribe = typeof ctx.ui.onTerminalInput === "function"
      ? ctx.ui.onTerminalInput((data: string) => {
        if (!enabled || !ctx.hasUI || tuiRef?.hasOverlay?.()) {
          return undefined;
        }
        if (isStashShortcutInput(data)) {
          stashOrRestoreEditorText(ctx);
          scheduleDismissWelcome(ctx);
          tuiRef?.requestRender();
          return { consume: true };
        }

        const powerlineShortcutAction = getPowerlineShortcutAction(data);
        if (!powerlineShortcutAction) {
          return undefined;
        }

        runPowerlineShortcut(ctx, powerlineShortcutAction);
        scheduleDismissWelcome(ctx);
        tuiRef?.requestRender();
        return { consume: true };
      })
      : null;

    teardownFixedEditorCompositor();
    ctx.ui.setWidget("powerline-top", undefined);
    ctx.ui.setWidget("powerline-secondary", undefined);
    ctx.ui.setWidget("powerline-bash-transcript", undefined);
    ctx.ui.setWidget("powerline-status", undefined);
    ctx.ui.setWidget("powerline-last-prompt", undefined);

    let autocompleteFixed = false;
    const previousEditorFactory = typeof ctx.ui.getEditorComponent === "function" ? ctx.ui.getEditorComponent() : undefined;

    const editorFactory = (tui: any, editorTheme: any, keybindings: any) => {
      const previousEditor = previousEditorFactory?.(tui, editorTheme, keybindings);
      const editor = new BashModeEditor(tui, editorTheme, keybindings, {
        keybindings,
        isBashModeActive: () => bashModeActive,
        isShellRunning: () => shellSession?.state.running ?? false,
        onExitBashMode: () => {
          void setBashModeActive(false, ctx);
        },
        onSubmitCommand: (command) => void runShellCommand(command, ctx),
        onEditorSubmit: () => followSubmittedEditorToBottom(),
        editorBoundaryShortcuts: {
          start: resolvedShortcuts.editorStart,
          end: resolvedShortcuts.editorEnd,
        },
        onInterrupt: () => {
          shellSession?.interrupt();
          ctx.ui.notify("Sent interrupt to shell", "info");
        },
        onNotify: (message, level = "info") => ctx.ui.notify(message, level),
        getHistoryEntries: (prefix) => getShellHistoryEntries(prefix),
        resolveGhostSuggestion: async (text, signal) => {
          const oneOffBash = getOneOffBashCommandContext(text);
          if (oneOffBash) {
            const ghost = await bashCompletionEngine.getGhostSuggestion(
              oneOffBash.command,
              getShellCwd(),
              getShellPath(),
              signal,
            );
            return ghost ? { ...ghost, value: `${oneOffBash.prefix}${ghost.value}` } : null;
          }

          return bashCompletionEngine.getGhostSuggestion(text, getShellCwd(), getShellPath(), signal);
        },
      });

      const getEditorAutocompleteProvider = (sourceEditor: unknown): AutocompleteProvider | undefined => {
        const candidate = sourceEditor && typeof sourceEditor === "object" ? Reflect.get(sourceEditor, "autocompleteProvider") : null;
        if (!candidate || typeof candidate !== "object") {
          return undefined;
        }
        if (typeof Reflect.get(candidate, "getSuggestions") !== "function") {
          return undefined;
        }
        if (typeof Reflect.get(candidate, "applyCompletion") !== "function") {
          return undefined;
        }
        return candidate;
      };

      const getInstalledAutocompleteProvider = (): AutocompleteProvider | undefined => {
        return getEditorAutocompleteProvider(editor) ?? getEditorAutocompleteProvider(previousEditor);
      };

      const attachAutocompleteProvider = (): boolean => {
        if (editor.hasWrappedProvider()) return true;
        const defaultProvider = getInstalledAutocompleteProvider();
        if (!defaultProvider) return false;

        const bashProvider = new BashAutocompleteProvider();
        const oneOffBashProvider = new OneOffBashAutocompleteProvider();
        editor.installAutocompleteProvider(
          new ModeAwareAutocompleteProvider(defaultProvider, bashProvider, oneOffBashProvider, () => bashModeActive),
        );
        return true;
      };

      let inheritedOnSubmit: unknown;
      Object.defineProperty(editor, "onSubmit", {
        configurable: true,
        get: () => inheritedOnSubmit,
        set(handler: unknown) {
          inheritedOnSubmit = typeof handler === "function"
            ? (text: string) => {
              followSubmittedEditorToBottom();
              handler(text);
            }
            : handler;
        },
      });

      currentEditor = editor;
      trackPromptHistory(editor);
      restorePromptHistory(editor);
      attachAutocompleteProvider();

      const originalHandleInput = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        lastEditorInputAt = Date.now();

        if (isStashShortcutInput(data)) {
          stashOrRestoreEditorText(ctx);
          scheduleDismissWelcome(ctx);
          return;
        }

        const powerlineShortcutAction = getPowerlineShortcutAction(data);
        if (powerlineShortcutAction) {
          runPowerlineShortcut(ctx, powerlineShortcutAction);
          scheduleDismissWelcome(ctx);
          return;
        }

        if (!autocompleteFixed && !getInstalledAutocompleteProvider()) {
          autocompleteFixed = true;
          snapshotPromptHistory(editor);
          ctx.ui.setEditorComponent(editorFactory);
          if (config.fixedEditor) {
            installFixedEditorCompositor(ctx, tui);
          }
          currentEditor?.handleInput(data);
          return;
        }

        attachAutocompleteProvider();
        const followUpText = keybindings.matches(data, "app.message.followUp") ? getCurrentEditorText(ctx, editor) : "";
        scheduleDismissWelcome(ctx);
        originalHandleInput(data);
        if (hasNonWhitespaceText(followUpText) && !hasNonWhitespaceText(getCurrentEditorText(ctx, editor))) {
          followSubmittedEditorToBottom();
        }
      };

      const originalRender = editor.render.bind(editor);
      editor.render = (width: number): string[] => {
        if (width < 10) {
          return originalRender(width);
        }

        const bc = (s: string) => `${getFgAnsiCode("sep")}${s}${ansi.reset}`;
        const promptGlyph = bashModeActive ? "$" : ">";
        const prompt = `${ansi.getFgAnsi(200, 200, 200)}${promptGlyph}${ansi.reset}`;
        const promptPrefix = ` ${prompt} `;
        const contPrefix = "   ";
        const contentWidth = Math.max(1, width - 3);
        const lines = originalRender(contentWidth);

        if (lines.length === 0) return lines;

        let bottomBorderIndex = lines.length - 1;
        for (let i = lines.length - 1; i >= 1; i--) {
          const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
          if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
            bottomBorderIndex = i;
            break;
          }
        }

        const result: string[] = [];
        result.push(" " + bc("─".repeat(width - 2)));

        for (let i = 1; i < bottomBorderIndex; i++) {
          const prefix = i === 1 ? promptPrefix : contPrefix;
          result.push(`${prefix}${lines[i] || ""}`);
        }

        if (bottomBorderIndex === 1) {
          result.push(`${promptPrefix}${" ".repeat(contentWidth)}`);
        }

        result.push(" " + bc("─".repeat(width - 2)));

        for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
          result.push(lines[i] || "");
        }

        return result;
      };

      return editor;
    };

    ctx.ui.setEditorComponent(editorFactory);

    ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
      footerDataRef = footerData;
      tuiRef = tui;
      installFooterStatusRepaintHook(footerData);
      const unsub = footerData.onBranchChange(() => requestStatusRender());

      return {
        dispose() {
          unsub();
          restoreFooterStatusRepaintHook?.();
          restoreFooterStatusRepaintHook = null;
        },
        invalidate() {
          requestStatusRender();
        },
        render(): string[] {
          return [];
        },
      };
    });

    if (config.fixedEditor) {
      if (tuiRef) {
        installFixedEditorCompositor(ctx, tuiRef);
      }
    } else {
      installPowerlineWidgets(ctx);
    }
  }

  function setupWelcomeHeader(ctx: any) {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts();
    const recentSessions = getRecentSessions(3);
    
    const header = new WelcomeHeader(modelName, providerName, recentSessions, loadedCounts);
    welcomeHeaderActive = true;
    
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
    
    const overlaySessionGeneration = sessionGeneration;

    // Small delay to let pi-mono finish initialization
    setTimeout(() => {
      if (!enabled || welcomeOverlayShouldDismiss || isStreaming || overlaySessionGeneration !== sessionGeneration) {
        welcomeOverlayShouldDismiss = false;
        return;
      }
      
      const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
      const hasActivity = sessionEvents.some((entry: unknown) => {
        if (!isRecord(entry)) return false;
        if (entry.type === "tool_call" || entry.type === "tool_result") return true;
        return entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant";
      });
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
          let interval: ReturnType<typeof setInterval> | null = null;
          
          const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            if (interval) clearInterval(interval);
            dismissWelcomeOverlay = null;
            done();
          };
          
          interval = setInterval(() => {
            if (dismissed) return;
            countdown--;
            welcome.setCountdown(countdown);
            tui.requestRender();
            if (countdown <= 0) dismiss();
          }, 1000);

          dismissWelcomeOverlay = dismiss;

          if (welcomeOverlayShouldDismiss) {
            welcomeOverlayShouldDismiss = false;
            dismiss();
          }

          return {
            focused: false,
            invalidate: () => welcome.invalidate(),
            render: (width: number) => welcome.render(width),
            handleInput: () => dismiss(),
            dispose: () => {
              dismissed = true;
              if (interval) clearInterval(interval);
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

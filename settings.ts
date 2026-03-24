import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PowerlineSettings, PowerlineVibeSettings, StatusLinePreset } from "./types.js";

interface LegacyPowerlineSettings {
  powerline?: unknown;
  showLastPrompt?: unknown;
  powerlineShortcuts?: unknown;
  workingVibe?: unknown;
  workingVibeMode?: unknown;
  workingVibeModel?: unknown;
  workingVibeFallback?: unknown;
  workingVibeRefreshInterval?: unknown;
  workingVibePrompt?: unknown;
  workingVibeMaxLength?: unknown;
}

const LEGACY_POWERLINE_SHORTCUTS_KEY = "powerlineShortcuts";
const LEGACY_POWERLINE_SHOW_LAST_PROMPT_KEY = "showLastPrompt";
const LEGACY_POWERLINE_VIBE_KEYS = [
  "workingVibe",
  "workingVibeMode",
  "workingVibeModel",
  "workingVibeFallback",
  "workingVibeRefreshInterval",
  "workingVibePrompt",
  "workingVibeMaxLength",
] as const;
const LEGACY_POWERLINE_KEYS = [
  LEGACY_POWERLINE_SHOW_LAST_PROMPT_KEY,
  LEGACY_POWERLINE_SHORTCUTS_KEY,
  ...LEGACY_POWERLINE_VIBE_KEYS,
] as const;

export function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readSettings(logPrefix: string = "powerline-footer"): Record<string, unknown> {
  const settingsPath = getSettingsPath();

  try {
    if (!existsSync(settingsPath)) {
      return {};
    }

    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[${logPrefix}] Ignoring non-object settings at ${settingsPath}`);
      return {};
    }

    return parsed;
  } catch (error) {
    console.debug(`[${logPrefix}] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

function readSettingsForWrite(logPrefix: string, scope: string): Record<string, unknown> | null {
  const settingsPath = getSettingsPath();

  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[${logPrefix}] Refusing to write ${scope}: settings at ${settingsPath} is not an object`);
      return null;
    }

    return parsed;
  } catch (error) {
    console.debug(`[${logPrefix}] Failed to parse settings while writing ${scope} at ${settingsPath}:`, error);
    return null;
  }
}

function persistSettings(settings: Record<string, unknown>, logPrefix: string, scope: string): boolean {
  const settingsPath = getSettingsPath();

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[${logPrefix}] Failed to persist ${scope} to ${settingsPath}:`, error);
    return false;
  }
}

const VALID_PRESET_NAMES: StatusLinePreset[] = ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"];

function isValidPreset(value: unknown): value is StatusLinePreset {
  return typeof value === "string" && VALID_PRESET_NAMES.includes(value as StatusLinePreset);
}

export function normalizePreset(value: unknown): StatusLinePreset | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const preset = value.trim().toLowerCase();
  return isValidPreset(preset) ? preset : undefined;
}

function readVibeMode(value: unknown): PowerlineVibeSettings["mode"] | undefined {
  return value === "generate" || value === "file" ? value : undefined;
}

function compactObject<T extends object>(value: T): T | undefined {
  const next = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined),
  ) as T;

  return Object.keys(next as Record<string, unknown>).length > 0 ? next : undefined;
}

function hasLegacyPowerlineSettings(rawSettings: Record<string, unknown>): boolean {
  return LEGACY_POWERLINE_KEYS.some((key) => rawSettings[key] !== undefined);
}

function backfill(target: Record<string, unknown>, source: Record<string, unknown>, key: string): void {
  if (target[key] === undefined && source[key] !== undefined) {
    target[key] = source[key];
  }
}

export function migrateLegacyPowerlineSettings(rawSettings: Record<string, unknown>): boolean {
  if (!hasLegacyPowerlineSettings(rawSettings)) {
    return false;
  }

  const legacy = rawSettings as LegacyPowerlineSettings;
  const rawPowerline = legacy.powerline;
  const nextPowerline = isRecord(rawPowerline) ? { ...rawPowerline } : {};
  const nextVibe: Record<string, unknown> = isRecord(nextPowerline.vibe) ? { ...nextPowerline.vibe } : {};
  const shorthandPreset = typeof rawPowerline === "string" ? normalizePreset(rawPowerline) : undefined;

  if (shorthandPreset && nextPowerline.preset === undefined) {
    nextPowerline.preset = shorthandPreset;
  }

  backfill(nextPowerline, rawSettings, "showLastPrompt");

  if (nextPowerline.shortcuts === undefined && legacy.powerlineShortcuts !== undefined) {
    nextPowerline.shortcuts = legacy.powerlineShortcuts;
  }

  // Vibe fields: legacy key → nested vibe key
  const vibeMapping: [keyof LegacyPowerlineSettings, string][] = [
    ["workingVibe", "theme"],
    ["workingVibeMode", "mode"],
    ["workingVibeModel", "model"],
    ["workingVibeFallback", "fallback"],
    ["workingVibeRefreshInterval", "refreshInterval"],
    ["workingVibePrompt", "prompt"],
    ["workingVibeMaxLength", "maxLength"],
  ];
  for (const [legacyKey, vibeKey] of vibeMapping) {
    backfill(nextVibe, { [vibeKey]: legacy[legacyKey] }, vibeKey);
  }

  const vibe = compactObject(nextVibe);
  if (vibe) {
    nextPowerline.vibe = vibe;
  } else {
    delete nextPowerline.vibe;
  }

  rawSettings.powerline = nextPowerline;

  for (const key of LEGACY_POWERLINE_KEYS) {
    delete rawSettings[key];
  }

  return true;
}

export function migrateLegacyPowerlineSettingsFile(logPrefix: string = "powerline-footer"): boolean {
  const scope = "legacy powerline settings";
  const rawSettings = readSettingsForWrite(logPrefix, scope);
  if (!rawSettings) {
    return false;
  }

  if (!migrateLegacyPowerlineSettings(rawSettings)) {
    return false;
  }

  return persistSettings(rawSettings, logPrefix, scope);
}

export function readPowerlineSettings(rawSettings: Record<string, unknown>): PowerlineSettings {
  const settings: PowerlineSettings = {};
  const rawPowerline = rawSettings.powerline;
  const powerline = isRecord(rawPowerline) ? rawPowerline : undefined;
  const powerlineVibe = isRecord(powerline?.vibe) ? powerline.vibe : undefined;

  const preset = normalizePreset(typeof rawPowerline === "string" ? rawPowerline : powerline?.preset);
  if (preset) {
    settings.preset = preset;
  }

  if (typeof powerline?.showLastPrompt === "boolean") {
    settings.showLastPrompt = powerline.showLastPrompt;
  }

  if (isRecord(powerline?.shortcuts)) {
    settings.shortcuts = { ...powerline.shortcuts };
  }

  const vibe = compactObject<PowerlineVibeSettings>({
    theme: typeof powerlineVibe?.theme === "string" ? powerlineVibe.theme : undefined,
    mode: readVibeMode(powerlineVibe?.mode),
    model: typeof powerlineVibe?.model === "string" ? powerlineVibe.model : undefined,
    fallback: typeof powerlineVibe?.fallback === "string" ? powerlineVibe.fallback : undefined,
    refreshInterval:
      typeof powerlineVibe?.refreshInterval === "number" ? powerlineVibe.refreshInterval : undefined,
    prompt: typeof powerlineVibe?.prompt === "string" ? powerlineVibe.prompt : undefined,
    maxLength: typeof powerlineVibe?.maxLength === "number" ? powerlineVibe.maxLength : undefined,
  });
  if (vibe) {
    settings.vibe = vibe;
  }

  if (isRecord(powerline?.custom)) {
    settings.custom = { ...powerline.custom };
  }

  return settings;
}

export function applyPowerlineSettings(
  rawSettings: Record<string, unknown>,
  settings: PowerlineSettings,
): void {
  const nextPowerline = isRecord(rawSettings.powerline) ? { ...rawSettings.powerline } : {};

  if (settings.preset) {
    nextPowerline.preset = settings.preset;
  } else {
    delete nextPowerline.preset;
  }

  if (typeof settings.showLastPrompt === "boolean") {
    nextPowerline.showLastPrompt = settings.showLastPrompt;
  } else {
    delete nextPowerline.showLastPrompt;
  }

  if (settings.shortcuts && isRecord(settings.shortcuts)) {
    nextPowerline.shortcuts = { ...settings.shortcuts };
  } else {
    delete nextPowerline.shortcuts;
  }

  if (settings.custom && isRecord(settings.custom)) {
    nextPowerline.custom = { ...settings.custom };
  } else {
    delete nextPowerline.custom;
  }

  const vibe = compactObject({
    ...(isRecord(nextPowerline.vibe) ? nextPowerline.vibe : {}),
    ...(settings.vibe ?? {}),
  });
  if (vibe) {
    nextPowerline.vibe = vibe;
  } else {
    delete nextPowerline.vibe;
  }

  if (Object.keys(nextPowerline).length > 0) {
    rawSettings.powerline = nextPowerline;
  } else {
    delete rawSettings.powerline;
  }
}

export function patchPowerlineSetting(
  patch: Partial<PowerlineSettings>,
  logPrefix: string,
  scope: string,
): boolean {
  const rawSettings = readSettingsForWrite(logPrefix, scope);
  if (!rawSettings) {
    return false;
  }

  const settings = readPowerlineSettings(rawSettings);
  Object.assign(settings, patch);
  applyPowerlineSettings(rawSettings, settings);

  return persistSettings(rawSettings, logPrefix, scope);
}

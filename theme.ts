/**
 * Theme system for powerline-footer
 * 
 * Colors are resolved in order:
 * 1. User overrides from theme.json (if exists)
 * 2. Preset colors
 * 3. Default colors
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ColorScheme, ColorValue, PillTextColor, SemanticColor, ThemeLike } from "./types.ts";

export interface PowerlineThemeConfig {
  colors?: unknown;
  icons?: unknown;
}

// Default color scheme (uses pi theme colors)
const DEFAULT_COLORS: Required<ColorScheme> = {
  model: "#d787af",  // Pink/mauve (matching original colors.ts)
  shellMode: "#fab387",  // Catppuccin Mocha peach
  path: "#00afaf",  // Teal/cyan (matching original colors.ts)
  gitDirty: "#fab387",  // Catppuccin peach (distinct from balance yellow)
  gitClean: "#a6e3a1",  // success green
  thinking: "#6c7086",  // dim gray
  thinkingMinimal: "#89b4fa",  // blue
  thinkingLow: "#74c7ec",  // light blue
  thinkingMedium: "#f9e2af",  // yellow
  context: "#6c7086",  // dim
  contextWarn: "#f9e2af",  // warning
  contextError: "#f38ba8",  // error red
  cost: "#a6e3a1",  // green
  tokens: "#bac2de",  // muted text (Catppuccin Mocha subtext1)
  separator: "#585b70",  // surface0
  border: "#45475a",  // surface1
};

// Rainbow colors for high thinking levels
const RAINBOW_COLORS = [
  "#b281d6", "#d787af", "#febc38", "#e4c00f", 
  "#89d281", "#00afaf", "#178fb9", "#b281d6",
];

// Cache for user theme overrides
let userThemeCache: ColorScheme | null = null;
let userThemeCacheTime = 0;
let themeConfigCache: PowerlineThemeConfig | null = null;
let themeConfigCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds
const warnedInvalidThemeColors = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeUserThemeOverrides(value: unknown): ColorScheme {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: ColorScheme = {};
  for (const [key, rawColor] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_COLORS, key)) {
      continue;
    }
    if (typeof rawColor !== "string") {
      continue;
    }

    const color = rawColor.trim();
    if (!color) {
      continue;
    }

    sanitized[key as SemanticColor] = color as ColorValue;
  }

  return sanitized;
}

/** Sanitize a user-provided color override map (theme.json or settings.json powerline.colors) */
export function sanitizeColorOverrides(value: unknown): ColorScheme {
  return sanitizeUserThemeOverrides(value);
}

// Colors from settings.json powerline.colors (highest priority layer)
let settingsColors: ColorScheme = {};

/** Register color overrides coming from settings.json (powerline.colors) */
export function setSettingsColors(colors: ColorScheme | undefined): void {
  settingsColors = colors ?? {};
}

// Bold text inside pills (powerline.pillBold, default true)
let pillBoldEnabled = true;

/** Toggle bold text inside pills */
export function setPillBold(enabled: boolean): void {
  pillBoldEnabled = enabled;
}

/** Whether pill text is rendered bold */
export function isPillBold(): boolean {
  return pillBoldEnabled;
}

/**
 * Get the path to the theme.json file
 */
function getThemePath(): string {
  const extDir = dirname(fileURLToPath(import.meta.url));
  return join(extDir, "theme.json");
}

/**
 * Load user theme config from theme.json
 */
export function loadThemeConfig(): PowerlineThemeConfig {
  const now = Date.now();
  if (themeConfigCache && now - themeConfigCacheTime < CACHE_TTL) {
    return themeConfigCache;
  }

  const themePath = getThemePath();
  try {
    if (existsSync(themePath)) {
      const content = readFileSync(themePath, "utf-8");
      const parsed = JSON.parse(content);
      themeConfigCache = isRecord(parsed) ? parsed : {};
      themeConfigCacheTime = now;
      return themeConfigCache;
    }
  } catch (error) {
    // Theme overrides are optional. If the file is unreadable or malformed,
    // keep rendering with built-in defaults instead of breaking the footer.
    console.debug(`[powerline-theme] Failed to load ${themePath}:`, error);
  }

  themeConfigCache = {};
  themeConfigCacheTime = now;
  return themeConfigCache;
}

function loadUserTheme(): ColorScheme {
  const now = Date.now();
  if (userThemeCache && now - userThemeCacheTime < CACHE_TTL) {
    return userThemeCache;
  }

  userThemeCache = sanitizeUserThemeOverrides(loadThemeConfig().colors);
  userThemeCacheTime = now;
  return userThemeCache;
}

/**
 * Resolve a semantic color to an actual color value
 */
export function resolveColor(
  semantic: SemanticColor,
  presetColors?: ColorScheme
): ColorValue {
  const userTheme = loadUserTheme();
  
  // Priority: settings.json colors > theme.json overrides > preset colors > defaults
  return settingsColors[semantic]
    ?? userTheme[semantic] 
    ?? presetColors?.[semantic] 
    ?? DEFAULT_COLORS[semantic];
}

/**
 * Check if a color value is a hex color
 */
function isHexColor(color: ColorValue): color is `#${string}` {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
}

/**
 * Convert hex color to ANSI escape code (foreground)
 */
export function hexToAnsi(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Convert hex color to ANSI background escape code
 */
export function hexToBgAnsi(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[48;2;${r};${g};${b}m`;
}

const PILL_DARK_FG = "#1e1e2e";   // Catppuccin base (near-black)
const PILL_LIGHT_FG = "#cdd6f4"; // Catppuccin text

/**
 * Compute contrast foreground color for a given background hex.
 * Light backgrounds get dark text, dark backgrounds get light text.
 */
function contrastFg(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // relative luminance
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.5 ? PILL_DARK_FG : PILL_LIGHT_FG;
}

/**
 * Resolve the pill text (foreground) color.
 * "dark"/"light" force a fixed color, "contrast" picks by background luminance,
 * a hex string is used as-is.
 */
export function resolvePillTextColor(bgHex: string, textColor?: PillTextColor): string {
  if (!textColor || textColor === "contrast") return contrastFg(bgHex);
  if (textColor === "dark") return PILL_DARK_FG;
  if (textColor === "light") return PILL_LIGHT_FG;
  return isHexColor(textColor) ? textColor : contrastFg(bgHex);
}

/**
 * Apply a color to text using the pi theme or custom hex
 */
export function applyColor(
  theme: ThemeLike,
  color: ColorValue,
  text: string
): string {
  if (isHexColor(color)) {
    return `${hexToAnsi(color)}${text}\x1b[0m`;
  }

  try {
    return theme.fg(color as ThemeColor, text);
  } catch (error) {
    const key = String(color);
    if (!warnedInvalidThemeColors.has(key)) {
      warnedInvalidThemeColors.add(key);
      if (warnedInvalidThemeColors.size > 200) {
        warnedInvalidThemeColors.clear();
      }
      console.debug(`[powerline-theme] Invalid theme color "${key}"; falling back to "text".`, error);
    }
    return theme.fg("text", text);
  }
}

/**
 * Apply a background color pill to text.
 * Uses background ANSI + pill text color for hex colors;
 * falls back to applyColor for semantic/theme colors.
 */
export function applyBgColor(
  theme: ThemeLike,
  color: ColorValue,
  text: string,
  textColor?: PillTextColor
): string {
  if (isHexColor(color)) {
    const fg = resolvePillTextColor(color, textColor);
    const fgAnsi = hexToAnsi(fg);
    const bgAnsi = hexToBgAnsi(color);
    const bold = pillBoldEnabled ? "\x1b[1m" : "";
    return `${bgAnsi}${fgAnsi}${bold} ${text} \x1b[0m`;
  }
  // semantic colors fall back to foreground-only
  return applyColor(theme, color, text);
}

/**
 * Apply a semantic color to text
 */
export function fg(
  theme: ThemeLike,
  semantic: SemanticColor,
  text: string,
  presetColors?: ColorScheme
): string {
  const color = resolveColor(semantic, presetColors);
  return applyColor(theme, color, text);
}

/**
 * Apply a semantic color as a background pill to text
 */
export function bg(
  theme: ThemeLike,
  semantic: SemanticColor,
  text: string,
  presetColors?: ColorScheme,
  textColor?: PillTextColor
): string {
  const color = resolveColor(semantic, presetColors);
  return applyBgColor(theme, color, text, textColor);
}

/**
 * Apply rainbow gradient to text (for high thinking levels)
 */
export function rainbow(text: string): string {
  let result = "";
  let colorIndex = 0;
  for (const char of text) {
    if (char === " " || char === ":") {
      result += char;
    } else {
      result += hexToAnsi(RAINBOW_COLORS[colorIndex % RAINBOW_COLORS.length]) + char;
      colorIndex++;
    }
  }
  return result + "\x1b[0m";
}

/**
 * Get the default color scheme
 */
export function getDefaultColors(): Required<ColorScheme> {
  return { ...DEFAULT_COLORS };
}

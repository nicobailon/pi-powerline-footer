import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { ansi, fgOnly, getFgAnsiCode } from "./colors.js";

export interface RecentSession {
  name: string;
  timeAgo: string;
}

export interface LoadedCounts {
  contextFiles: number;
  extensions: number;
  skills: number;
  promptTemplates: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared rendering utilities
// ═══════════════════════════════════════════════════════════════════════════

const PI_LOGO = [
  "▀████████████▀",
  " ╘███    ███  ",
  "  ███    ███  ",
  "  ███    ███  ",
  " ▄███▄  ▄███▄ ",
];

const GRADIENT_COLORS = [
  "\x1b[38;5;199m",
  "\x1b[38;5;171m",
  "\x1b[38;5;135m",
  "\x1b[38;5;99m",
  "\x1b[38;5;75m",
  "\x1b[38;5;51m",
];

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

function dim(text: string): string {
  return getFgAnsiCode("sep") + text + ansi.reset;
}

function checkmark(): string {
  return fgOnly("gitClean", "✓");
}

function gradientLine(line: string): string {
  const reset = ansi.reset;
  let result = "";
  let colorIdx = 0;
  const step = Math.max(1, Math.floor(line.length / GRADIENT_COLORS.length));

  for (let i = 0; i < line.length; i++) {
    if (i > 0 && i % step === 0 && colorIdx < GRADIENT_COLORS.length - 1) colorIdx++;
    const char = line[i];
    if (char !== " ") {
      result += GRADIENT_COLORS[colorIdx] + char + reset;
    } else {
      result += char;
    }
  }
  return result;
}

function centerText(text: string, width: number): string {
  const visLen = visibleWidth(text);
  if (visLen > width) return truncateToWidth(text, width);
  if (visLen === width) return text;
  const leftPad = Math.floor((width - visLen) / 2);
  const rightPad = width - visLen - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

function fitToWidth(str: string, width: number): string {
  const visLen = visibleWidth(str);
  if (visLen > width) return truncateToWidth(str, width);
  return str + " ".repeat(width - visLen);
}

function truncateToWidth(str: string, width: number): string {
  const ellipsis = "…";
  const maxWidth = Math.max(0, width - 1);
  let truncated = "";
  let currentWidth = 0;
  let inEscape = false;
  
  for (const char of str) {
    if (char === "\x1b") inEscape = true;
    if (inEscape) {
      truncated += char;
      if (char === "m") inEscape = false;
    } else if (currentWidth < maxWidth) {
      truncated += char;
      currentWidth++;
    }
  }
  
  if (visibleWidth(str) > width) return truncated + ellipsis;
  return truncated;
}

interface WelcomeData {
  modelName: string;
  providerName: string;
  recentSessions: RecentSession[];
  loadedCounts: LoadedCounts;
}

function buildLeftColumn(data: WelcomeData, colWidth: number): string[] {
  const logoColored = PI_LOGO.map((line) => gradientLine(line));
  
  return [
    "",
    centerText(bold("Welcome back!"), colWidth),
    "",
    ...logoColored.map((l) => centerText(l, colWidth)),
    "",
    centerText(fgOnly("model", data.modelName), colWidth),
    centerText(dim(data.providerName), colWidth),
  ];
}

function buildRightColumn(data: WelcomeData, colWidth: number): string[] {
  const hChar = "─";
  const separator = ` ${dim(hChar.repeat(colWidth - 2))}`;
  
  // Session lines
  const sessionLines: string[] = [];
  if (data.recentSessions.length === 0) {
    sessionLines.push(` ${dim("No recent sessions")}`);
  } else {
    for (const session of data.recentSessions.slice(0, 3)) {
      sessionLines.push(
        ` ${dim("• ")}${fgOnly("path", session.name)}${dim(` (${session.timeAgo})`)}`,
      );
    }
  }
  
  // Loaded counts lines
  const countLines: string[] = [];
  const { contextFiles, extensions, skills, promptTemplates } = data.loadedCounts;
  
  if (contextFiles > 0 || extensions > 0 || skills > 0 || promptTemplates > 0) {
    if (contextFiles > 0) {
      countLines.push(` ${checkmark()} ${fgOnly("gitClean", `${contextFiles}`)} context file${contextFiles !== 1 ? "s" : ""}`);
    }
    if (extensions > 0) {
      countLines.push(` ${checkmark()} ${fgOnly("gitClean", `${extensions}`)} extension${extensions !== 1 ? "s" : ""}`);
    }
    if (skills > 0) {
      countLines.push(` ${checkmark()} ${fgOnly("gitClean", `${skills}`)} skill${skills !== 1 ? "s" : ""}`);
    }
    if (promptTemplates > 0) {
      countLines.push(` ${checkmark()} ${fgOnly("gitClean", `${promptTemplates}`)} prompt template${promptTemplates !== 1 ? "s" : ""}`);
    }
  } else {
    countLines.push(` ${dim("No extensions loaded")}`);
  }
  
  return [
    ` ${bold(fgOnly("accent", "Tips"))}`,
    ` ${dim("/")} for commands`,
    ` ${dim("!")} to run bash`,
    ` ${dim("Shift+Tab")} cycle thinking`,
    separator,
    ` ${bold(fgOnly("accent", "Loaded"))}`,
    ...countLines,
    separator,
    ` ${bold(fgOnly("accent", "Recent sessions"))}`,
    ...sessionLines,
    "",
  ];
}

function renderWelcomeBox(
  data: WelcomeData, 
  termWidth: number, 
  bottomLine: string,
): string[] {
  // Minimum width for two-column layout: leftCol(26) + separator(3) + minRightCol(15) = 44
  const minLayoutWidth = 44;
  
  // If terminal is too narrow for the layout, return empty (skip welcome box)
  if (termWidth < minLayoutWidth) {
    return [];
  }
  
  const minWidth = 76;
  const maxWidth = 96;
  // Clamp to termWidth to prevent crash on narrow terminals
  const boxWidth = Math.min(termWidth, Math.max(minWidth, Math.min(termWidth - 2, maxWidth)));
  const leftCol = 26;
  const rightCol = Math.max(1, boxWidth - leftCol - 3); // Ensure rightCol is at least 1
  
  const hChar = "─";
  const v = dim("│");
  const tl = dim("╭");
  const tr = dim("╮");
  const bl = dim("╰");
  const br = dim("╯");
  
  const leftLines = buildLeftColumn(data, leftCol);
  const rightLines = buildRightColumn(data, rightCol);
  
  const lines: string[] = [];
  
  // Top border with title
  const title = " pi agent ";
  const titlePrefix = dim(hChar.repeat(3));
  const titleStyled = titlePrefix + fgOnly("model", title);
  const titleVisLen = 3 + visibleWidth(title);
  const afterTitle = boxWidth - 2 - titleVisLen;
  const afterTitleText = afterTitle > 0 ? dim(hChar.repeat(afterTitle)) : "";
  lines.push(tl + titleStyled + afterTitleText + tr);
  
  // Content rows
  const maxRows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxRows; i++) {
    const left = fitToWidth(leftLines[i] ?? "", leftCol);
    const right = fitToWidth(rightLines[i] ?? "", rightCol);
    lines.push(v + left + v + right + v);
  }
  
  // Bottom border
  lines.push(bl + bottomLine + br);
  
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Welcome Components
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Welcome overlay component for pi agent.
 * Displays a branded splash screen with logo, tips, and loaded counts.
 */
export class WelcomeComponent implements Component {
  private data: WelcomeData;
  private countdown: number = 30;

  constructor(
    modelName: string,
    providerName: string,
    recentSessions: RecentSession[] = [],
    loadedCounts: LoadedCounts = { contextFiles: 0, extensions: 0, skills: 0, promptTemplates: 0 },
  ) {
    this.data = { modelName, providerName, recentSessions, loadedCounts };
  }

  setCountdown(seconds: number): void {
    this.countdown = seconds;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    // Minimum width for two-column layout (must match renderWelcomeBox)
    const minLayoutWidth = 44;
    if (termWidth < minLayoutWidth) {
      return [];
    }
    
    const minWidth = 76;
    const maxWidth = 96;
    // Clamp to termWidth to prevent crash on narrow terminals
    const boxWidth = Math.min(termWidth, Math.max(minWidth, Math.min(termWidth - 2, maxWidth)));
    
    // Bottom line with countdown
    const countdownText = ` Press any key to continue (${this.countdown}s) `;
    const countdownStyled = dim(countdownText);
    const bottomContentWidth = boxWidth - 2;
    const countdownVisLen = visibleWidth(countdownText);
    const leftPad = Math.floor((bottomContentWidth - countdownVisLen) / 2);
    const rightPad = bottomContentWidth - countdownVisLen - leftPad;
    const hChar = "─";
    const bottomLine = dim(hChar.repeat(Math.max(0, leftPad))) + 
      countdownStyled + 
      dim(hChar.repeat(Math.max(0, rightPad)));
    
    return renderWelcomeBox(this.data, termWidth, bottomLine);
  }
}

/**
 * Welcome header - same layout as overlay but persistent (no countdown).
 * Used when quietStartup: true.
 */
export class WelcomeHeader implements Component {
  private data: WelcomeData;

  constructor(
    modelName: string,
    providerName: string,
    recentSessions: RecentSession[] = [],
    loadedCounts: LoadedCounts = { contextFiles: 0, extensions: 0, skills: 0, promptTemplates: 0 },
  ) {
    this.data = { modelName, providerName, recentSessions, loadedCounts };
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    // Minimum width for two-column layout (must match renderWelcomeBox)
    const minLayoutWidth = 44;
    if (termWidth < minLayoutWidth) {
      return [];
    }
    
    const minWidth = 76;
    const maxWidth = 96;
    // Clamp to termWidth to prevent crash on narrow terminals
    const boxWidth = Math.min(termWidth, Math.max(minWidth, Math.min(termWidth - 2, maxWidth)));
    const hChar = "─";
    
    // Bottom line with column separator (leftCol=26, rightCol=boxWidth-29)
    const leftCol = 26;
    const rightCol = Math.max(1, boxWidth - leftCol - 3);
    const bottomLine = dim(hChar.repeat(leftCol)) + dim("┴") + dim(hChar.repeat(rightCol));
    
    const lines = renderWelcomeBox(this.data, termWidth, bottomLine);
    if (lines.length > 0) {
      lines.push(""); // Add empty line for spacing only if we rendered content
    }
    return lines;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Discovery functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discover loaded counts by scanning filesystem.
 */
export function discoverLoadedCounts(): LoadedCounts {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const cwd = process.cwd();
  
  let contextFiles = 0;
  let extensions = 0;
  let skills = 0;
  let promptTemplates = 0;

  const agentsMdPaths = [
    join(homeDir, ".pi", "agent", "AGENTS.md"),
    join(homeDir, ".claude", "AGENTS.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, ".pi", "AGENTS.md"),
    join(cwd, ".claude", "AGENTS.md"),
  ];
  
  for (const path of agentsMdPaths) {
    if (existsSync(path)) contextFiles++;
  }

  const extensionDirs = [
    join(homeDir, ".pi", "agent", "extensions"),
    join(cwd, "extensions"),
    join(cwd, ".pi", "extensions"),
  ];

  const countedExtensions = new Set<string>();

  const settingsPath = join(homeDir, ".pi", "agent", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      let packages: unknown = null;
      if (typeof settings === "object" && settings !== null && !Array.isArray(settings)) {
        packages = (settings as { packages?: unknown }).packages;
      }

      if (Array.isArray(packages)) {
        for (const pkg of packages) {
          let source: unknown = null;
          if (typeof pkg === "string") {
            source = pkg;
          } else if (typeof pkg === "object" && pkg !== null && !Array.isArray(pkg)) {
            source = (pkg as { source?: unknown }).source;
          }

          if (typeof source !== "string" || !source.startsWith("npm:")) {
            continue;
          }

          const body = source.slice(4);
          const versionIndex = body.lastIndexOf("@");
          const name = versionIndex > 0 ? body.slice(0, versionIndex) : body;
          if (!name || countedExtensions.has(name)) {
            continue;
          }

          countedExtensions.add(name);
          extensions++;
        }
      }
    } catch {}
  }

  for (const dir of extensionDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = join(dir, entry);
          const stats = statSync(entryPath);
          
          if (stats.isDirectory()) {
            if (existsSync(join(entryPath, "index.ts")) || existsSync(join(entryPath, "package.json"))) {
              if (!countedExtensions.has(entry)) {
                countedExtensions.add(entry);
                extensions++;
              }
            }
          } else if (entry.endsWith(".ts") && !entry.startsWith(".")) {
            const name = basename(entry, ".ts");
            if (!countedExtensions.has(name)) {
              countedExtensions.add(name);
              extensions++;
            }
          }
        }
      } catch {}
    }
  }

  const skillDirs = [
    join(homeDir, ".pi", "agent", "skills"),
    join(cwd, ".pi", "skills"),
    join(cwd, "skills"),
  ];
  
  const countedSkills = new Set<string>();
  
  for (const dir of skillDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = join(dir, entry);
          try {
            if (statSync(entryPath).isDirectory()) {
              if (existsSync(join(entryPath, "SKILL.md"))) {
                if (!countedSkills.has(entry)) {
                  countedSkills.add(entry);
                  skills++;
                }
              }
            }
          } catch {}
        }
      } catch {}
    }
  }

  const templateDirs = [
    join(homeDir, ".pi", "agent", "commands"),
    join(homeDir, ".claude", "commands"),
    join(cwd, ".pi", "commands"),
    join(cwd, ".claude", "commands"),
  ];
  
  const countedTemplates = new Set<string>();
  
  function countTemplatesInDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            countTemplatesInDir(entryPath);
          } else if (entry.endsWith(".md")) {
            const name = basename(entry, ".md");
            if (!countedTemplates.has(name)) {
              countedTemplates.add(name);
              promptTemplates++;
            }
          }
        } catch {}
      }
    } catch {}
  }
  
  for (const dir of templateDirs) {
    countTemplatesInDir(dir);
  }

  return { contextFiles, extensions, skills, promptTemplates };
}

/**
 * Get recent sessions from the sessions directory.
 */
export function getRecentSessions(maxCount: number = 3): RecentSession[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  
  const sessionsDirs = [
    join(homeDir, ".pi", "agent", "sessions"),
    join(homeDir, ".pi", "sessions"),
  ];
  
  const sessions: { name: string; mtime: number }[] = [];
  
  function scanDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            scanDir(entryPath);
          } else if (entry.endsWith(".jsonl")) {
            const parentName = basename(dir);
            let projectName = parentName;
            if (parentName.startsWith("--")) {
              const parts = parentName.split("-").filter(p => p);
              projectName = parts[parts.length - 1] || parentName;
            }
            sessions.push({ name: projectName, mtime: stats.mtimeMs });
          }
        } catch {}
      }
    } catch {}
  }
  
  for (const sessionsDir of sessionsDirs) {
    scanDir(sessionsDir);
  }
  
  if (sessions.length === 0) return [];
  
  sessions.sort((a, b) => b.mtime - a.mtime);
  
  const seen = new Set<string>();
  const uniqueSessions: typeof sessions = [];
  for (const s of sessions) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      uniqueSessions.push(s);
    }
  }

  const now = Date.now();
  return uniqueSessions.slice(0, maxCount).map(s => ({
    name: s.name.length > 20 ? s.name.slice(0, 17) + "…" : s.name,
    timeAgo: formatTimeAgo(now - s.mtime),
  }));
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

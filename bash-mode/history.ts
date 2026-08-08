import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentPath, getHomeDir } from "../paths.ts";

interface PersistedHistoryEntry {
  command: string;
  cwd: string;
  timestamp: number;
}

// mode and ctimeMs are part of the fingerprint so permission/ACL transitions
// (e.g. chmod 000) invalidate the cache even when content is unchanged.
interface FileFingerprint {
  ctimeMs: number;
  mtimeMs: number;
  mode: number;
  size: number;
}

interface CachedHistory<T> extends FileFingerprint {
  entries: T;
}

function matchesFingerprint(cached: FileFingerprint, stat: FileFingerprint): boolean {
  return cached.ctimeMs === stat.ctimeMs
    && cached.mtimeMs === stat.mtimeMs
    && cached.mode === stat.mode
    && cached.size === stat.size;
}

const projectHistoryCache = new Map<string, CachedHistory<PersistedHistoryEntry[]>>();
const globalHistoryCache = new Map<string, CachedHistory<string[]>>();

function getHistoryDir(): string {
  return getAgentPath("powerline-footer", "bash-history");
}

function projectKey(cwd: string): string {
  return cwd.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "-") || "root";
}

function projectHistoryPath(cwd: string): string {
  return join(getHistoryDir(), `${projectKey(cwd)}.json`);
}

function normalizePersistedEntries(value: unknown): PersistedHistoryEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: PersistedHistoryEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const command = typeof entry.command === "string" ? entry.command.trim() : "";
    const cwd = typeof entry.cwd === "string" ? entry.cwd.trim() : "";
    const timestamp = typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
      ? entry.timestamp
      : 0;
    if (!command || !cwd || !timestamp) continue;
    entries.push({ command, cwd, timestamp });
  }
  return entries;
}

export function readProjectHistory(cwd: string): PersistedHistoryEntry[] {
  const filePath = projectHistoryPath(cwd);
  if (!existsSync(filePath)) {
    projectHistoryCache.delete(filePath);
    return [];
  }

  try {
    const stat = statSync(filePath);
    const cached = projectHistoryCache.get(filePath);
    if (cached && matchesFingerprint(cached, stat)) {
      return cached.entries;
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    const entries = normalizePersistedEntries((parsed as { entries?: unknown }).entries)
      .sort((a, b) => b.timestamp - a.timestamp);
    projectHistoryCache.set(filePath, {
      ctimeMs: stat.ctimeMs,
      mtimeMs: stat.mtimeMs,
      mode: stat.mode,
      size: stat.size,
      entries,
    });
    return entries;
  } catch (error) {
    // Project history is a best-effort cache. If it is unreadable or malformed,
    // bash mode should keep working instead of failing command entry entirely.
    console.debug(`[powerline-footer] Failed to read bash project history from ${filePath}:`, error);
    return [];
  }
}

export function appendProjectHistory(cwd: string, command: string, entryCwd: string): void {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) return;

  const existing = readProjectHistory(cwd);
  const next: PersistedHistoryEntry[] = [
    { command: normalizedCommand, cwd: entryCwd, timestamp: Date.now() },
    ...existing.filter((entry) => entry.command !== normalizedCommand),
  ]
    .slice(0, 500)
    .sort((a, b) => b.timestamp - a.timestamp);

  const filePath = projectHistoryPath(cwd);
  projectHistoryCache.delete(filePath);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ version: 1, entries: next }, null, 2) + "\n");
    const stat = statSync(filePath);
    projectHistoryCache.set(filePath, {
      ctimeMs: stat.ctimeMs,
      mtimeMs: stat.mtimeMs,
      mode: stat.mode,
      size: stat.size,
      entries: next,
    });
  } catch (error) {
    // History persistence should never block a successful shell command from completing.
    console.debug(`[powerline-footer] Failed to persist bash project history to ${filePath}:`, error);
  }
}

function parseZshHistoryLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith(":")) return trimmed;
  const parts = trimmed.split(";");
  if (parts.length < 2) return null;
  return parts.slice(1).join(";").trim() || null;
}

function parseBashHistory(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function parseFishHistory(raw: string): string[] {
  const matches = raw.matchAll(/^\s*-\s*cmd:\s*(.+)$/gm);
  const commands: string[] = [];
  for (const match of matches) {
    const command = match[1]?.trim();
    if (command) commands.push(command);
  }
  return commands;
}

export function readGlobalShellHistory(shellPath: string): string[] {
  const shellName = shellPath.split("/").pop()?.toLowerCase() ?? "";
  const home = getHomeDir();
  const filePath = shellName.includes("fish")
    ? join(home, ".local", "share", "fish", "fish_history")
    : process.env.HISTFILE || join(home, shellName.includes("zsh") ? ".zsh_history" : ".bash_history");
  const cacheKey = `${shellName}\0${filePath}`;

  if (!existsSync(filePath)) {
    globalHistoryCache.delete(cacheKey);
    return [];
  }

  let stat: FileFingerprint | undefined;
  try {
    stat = statSync(filePath);
    const cached = globalHistoryCache.get(cacheKey);
    if (cached && matchesFingerprint(cached, stat)) {
      return cached.entries;
    }

    const raw = readFileSync(filePath, "utf8");
    const entries = shellName.includes("zsh")
      ? raw.split("\n").map(parseZshHistoryLine).filter((entry): entry is string => Boolean(entry)).reverse()
      : shellName.includes("fish")
        ? parseFishHistory(raw).reverse()
        : parseBashHistory(raw.split("\n")).reverse();
    globalHistoryCache.set(cacheKey, { ...stat, entries });
    return entries;
  } catch (error) {
    if (stat) {
      globalHistoryCache.set(cacheKey, { ...stat, entries: [] });
      console.debug(`[powerline-footer] Failed to read global shell history for ${shellName}:`, error);
    }
    return [];
  }
}

export function matchHistoryEntries(entries: string[], prefix: string, limit: number): string[] {
  const trimmedPrefix = prefix.trim();
  const seen = new Set<string>();
  const matches: string[] = [];

  for (const rawEntry of entries) {
    const entry = rawEntry?.trim();
    if (!entry || seen.has(entry)) continue;
    if (trimmedPrefix && !entry.startsWith(trimmedPrefix)) continue;
    seen.add(entry);
    matches.push(entry);
    if (matches.length >= limit) break;
  }

  return matches;
}

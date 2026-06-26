import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { getAgentDir } from "../paths.ts";

interface PersistedHistoryEntry {
  command: string;
  cwd: string;
  timestamp: number;
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getHistoryDir(): string {
  return join(getAgentDir(), "powerline-footer", "bash-history");
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
  if (!existsSync(filePath)) return [];

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    return normalizePersistedEntries((parsed as { entries?: unknown }).entries)
      .sort((a, b) => b.timestamp - a.timestamp);
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
  ].slice(0, 500);

  const filePath = projectHistoryPath(cwd);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ version: 1, entries: next }, null, 2) + "\n");
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

  try {
    if (shellName.includes("zsh")) {
      const filePath = process.env.HISTFILE || join(home, ".zsh_history");
      if (!existsSync(filePath)) return [];
      return readFileSync(filePath, "utf8")
        .split("\n")
        .map(parseZshHistoryLine)
        .filter((entry): entry is string => Boolean(entry))
        .reverse();
    }

    if (shellName.includes("fish")) {
      const filePath = join(home, ".local", "share", "fish", "fish_history");
      if (!existsSync(filePath)) return [];
      return parseFishHistory(readFileSync(filePath, "utf8")).reverse();
    }

    const filePath = process.env.HISTFILE || join(home, ".bash_history");
    if (!existsSync(filePath)) return [];
    return parseBashHistory(readFileSync(filePath, "utf8").split("\n")).reverse();
  } catch (error) {
    // Global shell history is optional recall data. If it is unavailable, shell predictions
    // should degrade to other sources instead of failing the editor.
    console.debug(`[powerline-footer] Failed to read global shell history for ${shellName}:`, error);
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

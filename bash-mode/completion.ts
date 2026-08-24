import { readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { matchHistoryEntries, readGlobalShellHistory, readProjectHistory } from "./history.ts";
import type { ExtendedCompletionItem, GhostSuggestion } from "./types.ts";

interface TokenContext {
  line: string;
  cursorCol: number;
  beforeCursor: string;
  afterCursor: string;
  token: string;
  tokenStart: number;
  tokenEnd: number;
  tokenIndex: number;
  previousTokens: string[];
}

export interface OneOffBashCommandContext {
  prefix: string;
  command: string;
  offset: number;
}

const GIT_SUBCOMMANDS = [
  "add", "bisect", "branch", "checkout", "cherry-pick", "clean", "clone", "commit", "diff", "fetch",
  "grep", "init", "log", "merge", "mv", "pull", "push", "rebase", "reset", "restore", "revert", "rm",
  "show", "stash", "status", "switch", "tag", "worktree",
];

function tokenizeBeforeCursor(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function getTokenContext(line: string, cursorCol: number): TokenContext {
  const beforeCursor = line.slice(0, cursorCol);
  const afterCursor = line.slice(cursorCol);
  const tokens = tokenizeBeforeCursor(beforeCursor);

  let tokenStart = 0;
  for (let i = beforeCursor.length - 1; i >= 0; i -= 1) {
    const char = beforeCursor[i];
    if (char && /\s/.test(char)) {
      tokenStart = i + 1;
      break;
    }
  }

  let tokenEnd = cursorCol;
  for (let i = cursorCol; i < line.length; i += 1) {
    const char = line[i];
    if (char && /\s/.test(char)) break;
    tokenEnd = i + 1;
  }

  return {
    line,
    cursorCol,
    beforeCursor,
    afterCursor,
    token: line.slice(tokenStart, tokenEnd),
    tokenStart,
    tokenEnd,
    tokenIndex: Math.max(0, tokens.length - 1),
    previousTokens: tokens,
  };
}

export function getOneOffBashCommandContext(line: string): OneOffBashCommandContext | null {
  if (line.startsWith("!!")) {
    return {
      prefix: "!!",
      command: line.slice(2),
      offset: 2,
    };
  }

  if (line.startsWith("!")) {
    return {
      prefix: "!",
      command: line.slice(1),
      offset: 1,
    };
  }

  return null;
}

function supportsShouldTriggerFileCompletion(
  provider: AutocompleteProvider,
): provider is AutocompleteProvider & {
  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean;
} {
  return "shouldTriggerFileCompletion" in provider && typeof provider.shouldTriggerFileCompletion === "function";
}

function isExtendedCompletionItem(item: AutocompleteItem): item is ExtendedCompletionItem {
  return "replacement" in item
    && typeof item.replacement === "string"
    && "startCol" in item
    && typeof item.startCol === "number"
    && "endCol" in item
    && typeof item.endCol === "number";
}

function uniqueByReplacement(items: ExtendedCompletionItem[]): ExtendedCompletionItem[] {
  const best = new Map<string, ExtendedCompletionItem>();
  for (const item of items) {
    const key = `${item.startCol}:${item.endCol}:${item.replacement}`;
    const existing = best.get(key);
    if (!existing || item.score > existing.score) {
      best.set(key, item);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function pathBase(token: string, cwd: string): { dir: string; prefix: string; displayPrefix: string } {
  const expanded = token.startsWith("~/")
    ? join(process.env.HOME || "", token.slice(2))
    : token;

  const hasSlash = expanded.includes("/");
  if (!hasSlash) {
    return { dir: cwd, prefix: expanded, displayPrefix: "" };
  }

  const baseDir = expanded.endsWith("/") ? expanded.slice(0, -1) : dirname(expanded);
  const resolvedDir = isAbsolute(baseDir) ? baseDir : resolve(cwd, baseDir);
  const prefix = expanded.endsWith("/") ? "" : basename(expanded);
  const displayPrefix = token.endsWith("/") ? token : token.slice(0, Math.max(0, token.length - prefix.length));
  return { dir: resolvedDir, prefix, displayPrefix };
}

function escapeShellPath(value: string): string {
  return value.replace(/([\\\s"'`$&|;<>()[\]{}?!*])/g, "\\$1");
}

function getPathSuggestions(token: string, cwd: string): ExtendedCompletionItem[] {
  if (!token) return [];
  const { dir, prefix, displayPrefix } = pathBase(token, cwd);

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => prefix.length === 0 || entry.name.startsWith(prefix))
      .slice(0, 100);

    return entries.map((entry) => {
      const suffix = entry.isDirectory() ? "/" : "";
      const label = `${displayPrefix}${entry.name}${suffix}`;
      const replacement = `${displayPrefix}${escapeShellPath(entry.name)}${suffix}`;
      return {
        value: replacement,
        label,
        replacement,
        startCol: 0,
        endCol: 0,
        source: "path",
        score: 40 + (entry.isDirectory() ? 4 : 0),
      } satisfies ExtendedCompletionItem;
    });
  } catch {
    // Missing or unreadable directories should only remove this completion source.
    return [];
  }
}

function runGit(args: string[], cwd: string, signal: AbortSignal): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      execFile("git", args, { cwd, encoding: "utf8", signal, windowsHide: true }, (error, stdout) => {
        if (error || !stdout) {
          resolve([]);
          return;
        }
        resolve(stdout.split("\n").map((line) => line.trim()).filter(Boolean));
      });
    } catch {
      // Git-aware completions are optional and should not break the main completion flow.
      resolve([]);
    }
  });
}

async function getGitSuggestions(
  ctx: TokenContext,
  cwd: string,
  signal: AbortSignal,
): Promise<ExtendedCompletionItem[]> {
  const tokens = ctx.previousTokens;
  if (tokens[0] !== "git") return [];

  if (ctx.tokenIndex <= 1) {
    return GIT_SUBCOMMANDS
      .filter((command) => command.startsWith(ctx.token))
      .map((command) => ({
        value: command,
        label: command,
        replacement: command,
        startCol: 0,
        endCol: 0,
        source: "git",
        score: 52,
      }));
  }

  const subcommand = tokens[1] ?? "";
  if (!["checkout", "switch", "merge", "rebase", "branch", "show", "diff"].includes(subcommand)) {
    return [];
  }

  const [branches, tags] = await Promise.all([
    runGit(["branch", "--format=%(refname:short)"], cwd, signal),
    runGit(["tag", "--list"], cwd, signal),
  ]);
  if (signal.aborted) return [];

  return [...new Set([...branches, ...tags])]
    .filter((ref) => ref.startsWith(ctx.token))
    .slice(0, 100)
    .map((ref) => ({
      value: ref,
      label: ref,
      replacement: ref,
      startCol: 0,
      endCol: 0,
      source: "git",
      score: 50,
    }));
}

function canUseHistorySuggestion(ctx: TokenContext): boolean {
  return ctx.cursorCol === ctx.line.length && ctx.line.trim().length > 0;
}

function withRange(items: ExtendedCompletionItem[], startCol: number, endCol: number): ExtendedCompletionItem[] {
  return items.map((item) => ({ ...item, startCol, endCol }));
}

function applyCompletionToLine(line: string, item: ExtendedCompletionItem): string {
  return line.slice(0, item.startCol) + item.replacement + line.slice(item.endCol);
}

function commandHead(value: string): string {
  return tokenizeBeforeCursor(value.trim())[0] ?? "";
}

function findNewestHistoryMatchForHead(entries: string[], prefix: string, head: string): string | null {
  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry || !entry.startsWith(prefix)) continue;
    if (commandHead(entry) !== head) continue;
    return entry;
  }
  return null;
}

function getCuratedCommandFallback(prefix: string): GhostSuggestion | null {
  const trimmed = prefix.trim();
  if (!trimmed) return null;

  if ("cd".startsWith(trimmed)) {
    return { value: "cd ..", source: "path" };
  }

  if ("git".startsWith(trimmed)) {
    return { value: "git status", source: "git" };
  }

  return null;
}

function isLikelyGitCommandHead(prefix: string): boolean {
  const trimmed = prefix.trim();
  return trimmed.length >= 2 && "git".startsWith(trimmed);
}

function boostValidatedItemsFromGlobalHistory(
  line: string,
  items: ExtendedCompletionItem[],
  globalHistoryMatches: string[],
): ExtendedCompletionItem[] {
  if (items.length === 0 || globalHistoryMatches.length === 0) {
    return items;
  }

  const boosts = new Map<string, number>();
  for (const [index, value] of globalHistoryMatches.entries()) {
    boosts.set(value, Math.max(1, 4 - index));
  }

  return items.map((item) => {
    const boost = boosts.get(applyCompletionToLine(line, item));
    return boost ? { ...item, score: item.score + boost } : item;
  });
}

export class BashCompletionEngine {
  async getGhostSuggestion(line: string, cwd: string, shellPath: string, signal: AbortSignal): Promise<GhostSuggestion | null> {
    const projectHistoryEntries = readProjectHistory(cwd);

    if (line.trim().length === 0) {
      const prefix = line;
      const projectHistory = matchHistoryEntries(
        projectHistoryEntries.map((entry) => entry.command),
        line,
        1,
      );
      if (projectHistory.length > 0) {
        return { value: `${prefix}${projectHistory[0]!}`, source: "project-history" };
      }

      return null;
    }

    const ctx = getTokenContext(line, line.length);
    if (!canUseHistorySuggestion(ctx)) return null;

    const projectHistory = matchHistoryEntries(
      projectHistoryEntries.map((entry) => entry.command),
      line,
      10,
    );
    if (projectHistory.length > 0) {
      return { value: projectHistory[0]!, source: "project-history" };
    }

    if (ctx.tokenIndex === 0) {
      return this.getCommandPositionGhostSuggestion(line, readGlobalShellHistory(shellPath));
    }

    const deterministic = await this.getDeterministicInlineSuggestions(ctx, cwd, signal);
    if (signal.aborted) return null;
    const globalHistory = matchHistoryEntries(readGlobalShellHistory(shellPath), line, 5);
    const ranked = boostValidatedItemsFromGlobalHistory(
      line,
      uniqueByReplacement(deterministic),
      globalHistory,
    );

    for (const item of ranked) {
      const value = this.buildInlineSuggestionValue(line, item);
      if (value) {
        return { value, source: item.source };
      }
    }

    return null;
  }

  private getCommandPositionGhostSuggestion(
    line: string,
    globalHistoryEntries: string[],
  ): GhostSuggestion | null {
    if (isLikelyGitCommandHead(line)) {
      const globalMatch = findNewestHistoryMatchForHead(globalHistoryEntries, line, "git");
      if (globalMatch) {
        return { value: globalMatch, source: "global-history" };
      }
    }

    return getCuratedCommandFallback(line);
  }

  private async getDeterministicInlineSuggestions(
    ctx: TokenContext,
    cwd: string,
    signal: AbortSignal,
  ): Promise<ExtendedCompletionItem[]> {
    const gitSuggestions = getGitSuggestions(ctx, cwd, signal);
    const pathSuggestions = getPathSuggestions(ctx.token, cwd);
    const items = [
      ...withRange(await gitSuggestions, ctx.tokenStart, ctx.tokenEnd),
      ...withRange(pathSuggestions, ctx.tokenStart, ctx.tokenEnd),
    ];

    return uniqueByReplacement(items);
  }

  private buildInlineSuggestionValue(line: string, item: ExtendedCompletionItem): string | null {
    const value = applyCompletionToLine(line, item);
    if (!value.startsWith(line) || value === line) {
      return null;
    }
    return value;
  }

}

export class BashAutocompleteProvider implements AutocompleteProvider {
  async getSuggestions(): Promise<AutocompleteSuggestions | null> {
    return null;
  }

  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem): {
    lines: string[];
    cursorLine: number;
    cursorCol: number;
  } {
    if (!isExtendedCompletionItem(item)) {
      throw new Error("Expected an extended completion item for bash autocomplete");
    }

    return applyExtendedCompletion(lines, cursorLine, item);
  }

  shouldTriggerFileCompletion(): boolean {
    return false;
  }
}

function applyExtendedCompletion(lines: string[], cursorLine: number, item: ExtendedCompletionItem): {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
} {
  const currentLine = lines[cursorLine] || "";
  const startCol = Math.max(0, Math.min(item.startCol, currentLine.length));
  const endCol = Math.max(startCol, Math.min(item.endCol, currentLine.length));
  const nextLine = currentLine.slice(0, startCol) + item.replacement + currentLine.slice(endCol);
  const nextLines = [...lines];
  nextLines[cursorLine] = nextLine;
  return {
    lines: nextLines,
    cursorLine,
    cursorCol: startCol + item.replacement.length,
  };
}

export class OneOffBashAutocompleteProvider implements AutocompleteProvider {
  async getSuggestions(): Promise<AutocompleteSuggestions | null> {
    return null;
  }

  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem): {
    lines: string[];
    cursorLine: number;
    cursorCol: number;
  } {
    if (!isExtendedCompletionItem(item)) {
      throw new Error("Expected an extended completion item for one-off bash autocomplete");
    }

    return applyExtendedCompletion(lines, cursorLine, item);
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    const bang = cursorLine === 0 ? getOneOffBashCommandContext(lines[0] || "") : null;
    return bang !== null && cursorCol >= bang.offset;
  }
}

function getProviderTriggerCharacters(provider: AutocompleteProvider | undefined): string[] {
  const candidate = provider && typeof provider === "object" ? Reflect.get(provider, "triggerCharacters") : undefined;
  return Array.isArray(candidate)
    ? candidate.filter((character): character is string => typeof character === "string" && character.length === 1)
    : [];
}

export class ModeAwareAutocompleteProvider implements AutocompleteProvider {
  readonly triggerCharacters: string[];
  private readonly defaultProvider: AutocompleteProvider | undefined;
  private readonly bashProvider: AutocompleteProvider;
  private readonly oneOffBashProvider: AutocompleteProvider;
  private readonly isBashModeActive: () => boolean;

  constructor(
    defaultProvider: AutocompleteProvider | undefined,
    bashProvider: AutocompleteProvider,
    oneOffBashProvider: AutocompleteProvider,
    isBashModeActive: () => boolean,
  ) {
    this.defaultProvider = defaultProvider;
    this.bashProvider = bashProvider;
    this.oneOffBashProvider = oneOffBashProvider;
    this.isBashModeActive = isBashModeActive;
    this.triggerCharacters = [
      ...new Set([
        ...getProviderTriggerCharacters(defaultProvider),
        ...getProviderTriggerCharacters(bashProvider),
        ...getProviderTriggerCharacters(oneOffBashProvider),
      ]),
    ];
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    if (this.isBashModeActive()) {
      return this.bashProvider.getSuggestions(lines, cursorLine, cursorCol, options);
    }

    const shouldUseOneOffBash = supportsShouldTriggerFileCompletion(this.oneOffBashProvider)
      && this.oneOffBashProvider.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
    if (shouldUseOneOffBash) {
      return this.oneOffBashProvider.getSuggestions(lines, cursorLine, cursorCol, options);
    }

    return this.defaultProvider?.getSuggestions(lines, cursorLine, cursorCol, options) ?? null;
  }

  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string) {
    if (this.isBashModeActive()) {
      return this.bashProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    }

    const shouldUseOneOffBash = supportsShouldTriggerFileCompletion(this.oneOffBashProvider)
      && this.oneOffBashProvider.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
    if (shouldUseOneOffBash) {
      return this.oneOffBashProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    }

    if (!this.defaultProvider) {
      return { lines, cursorLine, cursorCol };
    }
    return this.defaultProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    if (this.isBashModeActive()) {
      if (!supportsShouldTriggerFileCompletion(this.bashProvider)) {
        return true;
      }

      return this.bashProvider.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
    }

    const shouldUseOneOffBash = supportsShouldTriggerFileCompletion(this.oneOffBashProvider)
      && this.oneOffBashProvider.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
    if (shouldUseOneOffBash) {
      return true;
    }

    if (!this.defaultProvider || !supportsShouldTriggerFileCompletion(this.defaultProvider)) {
      return false;
    }

    return this.defaultProvider.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
  }
}

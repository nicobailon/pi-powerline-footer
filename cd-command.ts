import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function unescapePathArg(value: string): string {
  return stripMatchingQuotes(value).replace(/\\(.)/g, "$1");
}

function expandHomePath(value: string, homeDir = homedir()): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return join(homeDir, value.slice(2));
  return value;
}

function escapeCompletionPath(value: string): string {
  return value.replace(/([\\\s"'`$&|;<>()[\]{}?!*])/g, "\\$1");
}

function displayPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function resolveCdTarget(args: string, cwd: string, homeDir = homedir()): { path: string } | { error: string } | null {
  const input = unescapePathArg(args);
  if (!input) return null;

  const expanded = expandHomePath(input, homeDir);
  const target = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);

  if (!existsSync(target)) {
    return { error: `Directory does not exist: ${target}` };
  }

  try {
    if (!statSync(target).isDirectory()) {
      return { error: `Not a directory: ${target}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Cannot access directory: ${message}` };
  }

  return { path: target };
}

function pathBase(token: string, cwd: string, homeDir: string): { dir: string; prefix: string; displayPrefix: string } {
  const unescaped = unescapePathArg(token);
  const expanded = expandHomePath(unescaped, homeDir);
  const hasSlash = expanded.includes("/");

  if (!hasSlash) {
    return { dir: cwd, prefix: expanded, displayPrefix: "" };
  }

  const baseDir = expanded.endsWith("/") ? expanded.slice(0, -1) : dirname(expanded);
  const dir = isAbsolute(baseDir) ? baseDir : resolve(cwd, baseDir);
  const prefix = expanded.endsWith("/") ? "" : basename(expanded);
  const displayPrefix = unescaped.endsWith("/") ? unescaped : unescaped.slice(0, Math.max(0, unescaped.length - prefix.length));
  return { dir, prefix, displayPrefix };
}

function isDirectoryEntry(dir: string, name: string): boolean {
  try {
    return statSync(join(dir, name)).isDirectory();
  } catch {
    return false;
  }
}

export function getCdArgumentCompletions(argumentPrefix: string, cwd: string, homeDir = homedir()): AutocompleteItem[] {
  const prefix = argumentPrefix.trimStart();
  const suggestions: AutocompleteItem[] = [];

  for (const quickPick of ["../", "~/"]) {
    if (!prefix || quickPick.startsWith(prefix)) {
      suggestions.push({ value: quickPick, label: quickPick, description: quickPick === "../" ? "Parent directory" : "Home directory" });
    }
  }

  const { dir, prefix: entryPrefix, displayPrefix } = pathBase(prefix, cwd, homeDir);

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith(entryPrefix) && (entry.isDirectory() || entry.isSymbolicLink() && isDirectoryEntry(dir, entry.name)))
      .slice(0, 50)
      .map((entry) => {
        const path = displayPath(`${displayPrefix}${entry.name}/`);
        return {
          value: escapeCompletionPath(path),
          label: path,
        } satisfies AutocompleteItem;
      });

    suggestions.push(...entries);
  } catch {
    return suggestions;
  }

  const seen = new Set<string>();
  return suggestions.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

function removeSessionFile(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only; the command still reports the cancellation/error.
  }
}

export async function runCdCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const resolved = resolveCdTarget(args, ctx.cwd);
  if (resolved === null) {
    ctx.ui.notify(ctx.cwd, "info");
    return;
  }
  if ("error" in resolved) {
    ctx.ui.notify(resolved.error, "error");
    return;
  }
  if (resolved.path === ctx.cwd) {
    ctx.ui.notify(`Already in ${ctx.cwd}`, "info");
    return;
  }

  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) {
    ctx.ui.notify("/cd requires a persisted Pi session", "error");
    return;
  }

  await ctx.waitForIdle();
  const nextSession = SessionManager.forkFrom(sessionFile, resolved.path);
  const nextSessionFile = nextSession.getSessionFile();

  try {
    const result = await ctx.switchSession(nextSessionFile!, {
      withSession: async (nextCtx) => {
        try {
          process.chdir(nextCtx.cwd);
          nextCtx.ui.notify(`Changed directory to ${nextCtx.cwd}`, "info");
          nextCtx.ui.setTitle(`pi - ${basename(nextCtx.cwd) || nextCtx.cwd}`);
        } catch (error) {
          console.debug("[powerline-footer] Failed to update process cwd after /cd:", error);
        }
      },
    });
    if (result.cancelled) {
      removeSessionFile(nextSessionFile);
      ctx.ui.notify("Directory change cancelled", "warning");
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      ctx.ui.notify(`Failed to change directory: ${message}`, "error");
    } catch {
      console.debug("[powerline-footer] Failed to report /cd error:", error);
    }
  }
}

export function registerCdCommand(pi: ExtensionAPI, getCwd: () => string): void {
  pi.registerCommand("cd", {
    description: "Switch the Pi session working directory",
    getArgumentCompletions(argumentPrefix) {
      return getCdArgumentCompletions(argumentPrefix, getCwd());
    },
    handler: runCdCommand,
  });
}

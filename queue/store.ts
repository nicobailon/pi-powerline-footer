import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentPath } from "../paths.ts";
import type {
  CreateQueueItemInput,
  PowerlineQueueItem,
  QueueAliasMap,
  QueueContext,
  QueueIntent,
  QueueStatus,
  QueueSummary,
  QueueTarget,
} from "./types.ts";
import { ACTIVE_QUEUE_STATUSES } from "./types.ts";

const STORE_DIR = "powerline-footer";
const INBOX_FILE = "inbox.jsonl";
const ALIASES_FILE = "projects.json";
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCwd(cwd: string): string {
  return resolve(cwd);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeTarget(value: unknown): QueueTarget | null {
  if (!isRecord(value)) return null;
  if (value.kind === "current-session") return { kind: "current-session" };
  if (value.kind === "global") return { kind: "global" };
  if (value.kind === "project" && typeof value.cwd === "string" && value.cwd.trim()) {
    const alias = normalizeOptionalString(value.alias);
    return alias
      ? { kind: "project", cwd: normalizeCwd(value.cwd), alias }
      : { kind: "project", cwd: normalizeCwd(value.cwd) };
  }
  return null;
}

function normalizeIntent(value: unknown): QueueIntent | null {
  return value === "steer" || value === "follow-up" || value === "post-compact" || value === "idea"
    ? value
    : null;
}

function normalizeStatus(value: unknown): QueueStatus | null {
  return value === "queued" || value === "blocked" || value === "delivering" || value === "sent" || value === "failed"
    ? value
    : null;
}

function normalizeItem(value: unknown): PowerlineQueueItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.text !== "string" || !value.text.trim()) return null;
  if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return null;
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return null;
  if (!isRecord(value.source) || typeof value.source.cwd !== "string" || !value.source.cwd.trim()) return null;

  const target = normalizeTarget(value.target);
  const intent = normalizeIntent(value.intent);
  const status = normalizeStatus(value.status);
  if (!target || !intent || !status) return null;

  const sessionId = normalizeOptionalString(value.source.sessionId);
  const error = normalizeOptionalString(value.error);

  return {
    id: value.id.trim(),
    text: value.text,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    source: sessionId
      ? { cwd: normalizeCwd(value.source.cwd), sessionId }
      : { cwd: normalizeCwd(value.source.cwd) },
    target,
    intent,
    status,
    ...(error ? { error } : {}),
  };
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  return isRecord(parsed) ? parsed : {};
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function getQueueStorePaths(): { inboxPath: string; aliasesPath: string } {
  return {
    inboxPath: getAgentPath(STORE_DIR, INBOX_FILE),
    aliasesPath: getAgentPath(STORE_DIR, ALIASES_FILE),
  };
}

export function createQueueItem(input: CreateQueueItemInput): PowerlineQueueItem {
  const now = input.now ?? Date.now();
  const sourceSessionId = input.source.sessionId?.trim();
  return {
    id: randomUUID().slice(0, 8),
    text: input.text,
    createdAt: now,
    updatedAt: now,
    source: sourceSessionId
      ? { cwd: normalizeCwd(input.source.cwd), sessionId: sourceSessionId }
      : { cwd: normalizeCwd(input.source.cwd) },
    target: normalizeTarget(input.target) ?? input.target,
    intent: input.intent,
    status: input.status ?? "queued",
  };
}

export class PowerlineQueueStore {
  private readonly inboxPath: string;
  private readonly aliasesPath: string;

  constructor(inboxPath: string = getQueueStorePaths().inboxPath, aliasesPath: string = getQueueStorePaths().aliasesPath) {
    this.inboxPath = inboxPath;
    this.aliasesPath = aliasesPath;
  }

  list(): PowerlineQueueItem[] {
    if (!existsSync(this.inboxPath)) return [];
    const lines = readFileSync(this.inboxPath, "utf-8").split("\n");
    const items: PowerlineQueueItem[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const item = normalizeItem(JSON.parse(trimmed));
        if (item) items.push(item);
      } catch {
        // Ignore malformed internal lines rather than breaking the footer during startup.
      }
    }
    return items.sort((a, b) => a.createdAt - b.createdAt);
  }

  add(input: CreateQueueItemInput): PowerlineQueueItem {
    const item = createQueueItem(input);
    return this.withStoreLock(() => {
      this.writeItems([...this.list(), item]);
      return item;
    });
  }

  get(idPrefix: string): PowerlineQueueItem | null {
    const normalized = idPrefix.trim();
    if (!normalized) return null;
    const matches = this.list().filter((item) => item.id === normalized || item.id.startsWith(normalized));
    return matches.length === 1 ? matches[0] : null;
  }

  update(id: string, updates: Partial<Omit<PowerlineQueueItem, "id" | "createdAt">>): PowerlineQueueItem | null {
    return this.withStoreLock(() => {
      let updated: PowerlineQueueItem | null = null;
      const next = this.list().map((item) => {
        if (item.id !== id) return item;
        updated = {
          ...item,
          ...updates,
          updatedAt: updates.updatedAt ?? Date.now(),
        };
        return updated;
      });
      if (updated) this.writeItems(next);
      return updated;
    });
  }

  clear(id: string): PowerlineQueueItem | null {
    return this.update(id, { status: "sent", error: undefined });
  }

  activeItems(context: QueueContext): PowerlineQueueItem[] {
    return this.list().filter((item) => isActiveForContext(item, context));
  }

  queuedDeliveryItems(context: QueueContext, intent?: QueueIntent): PowerlineQueueItem[] {
    return this.activeItems(context).filter((item) => {
      if (item.status !== "queued") return false;
      if (item.intent === "idea") return false;
      return intent ? item.intent === intent : true;
    });
  }

  summarize(context: QueueContext, compacting: boolean): QueueSummary {
    const active = this.activeItems(context);
    const queueItems = active.filter((item) => item.intent !== "idea");
    const ideaItems = active.filter((item) => item.intent === "idea");
    const blockedItems = active.filter((item) => item.status === "blocked" || item.status === "failed");
    const leading = [...blockedItems, ...queueItems, ...ideaItems][0] ?? null;

    return {
      queueCount: queueItems.length,
      ideaCount: ideaItems.length,
      blockedCount: blockedItems.length,
      compacting,
      leadingText: leading?.text ?? null,
    };
  }

  readAliases(): QueueAliasMap {
    const parsed = readJsonObject(this.aliasesPath);
    const aliases: QueueAliasMap = {};
    for (const [alias, cwd] of Object.entries(parsed)) {
      if (/^[a-zA-Z0-9_-]+$/.test(alias) && typeof cwd === "string" && cwd.trim()) {
        aliases[alias] = normalizeCwd(cwd);
      }
    }
    return aliases;
  }

  setAlias(alias: string, cwd: string): QueueAliasMap {
    const normalizedAlias = alias.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(normalizedAlias)) {
      throw new Error("Alias must contain only letters, numbers, dashes, or underscores");
    }
    return this.withStoreLock(() => {
      const aliases = { ...this.readAliases(), [normalizedAlias]: normalizeCwd(cwd) };
      this.writeJson(this.aliasesPath, aliases);
      return aliases;
    });
  }

  resolveAlias(alias: string): string | null {
    return this.readAliases()[alias] ?? null;
  }

  private withStoreLock<T>(fn: () => T): T {
    mkdirSync(dirname(this.inboxPath), { recursive: true });
    const lockPath = `${this.inboxPath}.lock`;
    const startedAt = Date.now();

    while (true) {
      try {
        mkdirSync(lockPath);
        break;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code !== "EEXIST") throw error;

        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
          throw new Error("Timed out waiting for Powerline queue store lock");
        }
        sleepSync(LOCK_RETRY_MS);
      }
    }

    try {
      return fn();
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  }

  private writeItems(items: readonly PowerlineQueueItem[]): void {
    mkdirSync(dirname(this.inboxPath), { recursive: true });
    const activeOrRecent = items
      .filter((item) => item.status !== "sent" || Date.now() - item.updatedAt < 24 * 60 * 60 * 1000)
      .map((item) => JSON.stringify(item))
      .join("\n");
    this.writeAtomic(this.inboxPath, activeOrRecent ? `${activeOrRecent}\n` : "");
  }

  private writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    this.writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  private writeAtomic(path: string, content: string): void {
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, content, "utf-8");
    renameSync(tempPath, path);
  }
}

export function currentQueueContext(cwd: string, sessionId?: string): QueueContext {
  return sessionId?.trim()
    ? { cwd: normalizeCwd(cwd), sessionId: sessionId.trim() }
    : { cwd: normalizeCwd(cwd) };
}

export function isActiveForContext(item: PowerlineQueueItem, context: QueueContext): boolean {
  if (!ACTIVE_QUEUE_STATUSES.has(item.status)) return false;
  const currentCwd = normalizeCwd(context.cwd);
  if (item.target.kind === "global") return true;
  if (item.target.kind === "project") return normalizeCwd(item.target.cwd) === currentCwd;
  if (item.source.sessionId) return context.sessionId === item.source.sessionId;
  return item.source.cwd === currentCwd;
}

export function targetForIdea(rawTarget: string | null, store: PowerlineQueueStore, cwd: string): QueueTarget {
  if (!rawTarget) return { kind: "project", cwd: normalizeCwd(cwd) };
  if (rawTarget === "current") return { kind: "current-session" };
  if (rawTarget === "global") return { kind: "global" };

  const aliasCwd = store.resolveAlias(rawTarget);
  if (!aliasCwd) {
    throw new Error(`Unknown project alias @${rawTarget}. Use /queue alias ${rawTarget} <path> first.`);
  }
  return { kind: "project", cwd: aliasCwd, alias: rawTarget };
}

export function parseTargetPrefix(text: string): { target: string | null; text: string } {
  const trimmed = text.trim();
  const match = /^@([a-zA-Z0-9_-]+)(?:\s+|$)/.exec(trimmed);
  if (!match) return { target: null, text: trimmed };
  return { target: match[1], text: trimmed.slice(match[0].length).trim() };
}

export function parseSigilIdeaCapture(text: string, sigil: string | false): { target: string | null; text: string } | null {
  if (sigil === false) return null;
  const normalizedSigil = sigil.trim();
  if (!normalizedSigil) return null;

  const trimmed = text.trim();
  if (!trimmed.startsWith(normalizedSigil)) return null;

  const afterSigil = trimmed.slice(normalizedSigil.length);
  if (!/^\s/.test(afterSigil)) return null;

  const parsed = parseTargetPrefix(afterSigil.trim());
  return parsed.text ? parsed : null;
}

export function formatQueueDeliveryText(item: PowerlineQueueItem): string {
  if (item.intent !== "idea") return item.text;
  return `[powerline idea ${item.id}, captured ${new Date(item.createdAt).toISOString()} from ${item.source.cwd}]\n${item.text}`;
}

export function formatIdeaIssuePrompt(item: PowerlineQueueItem): string {
  const target = item.target.kind === "project"
    ? `project ${item.target.alias ? `@${item.target.alias} ` : ""}${item.target.cwd}`
    : item.target.kind;

  return `Please process this saved Powerline idea as a GitHub issue candidate.\n\n${formatQueueDeliveryText(item)}\n\nIssue filing rules:\n- If subagents are available, spawn one low-budget issue-filing lane for this idea; otherwise do the same checks directly.\n- First identify the target repository from the idea target (${target}), source cwd (${item.source.cwd}), and current session context.\n- If the target repository is unclear or is not owned/controlled by the user, ask before filing anything.\n- If the target repository is clear and owned/controlled by the user, dedupe against existing open issues first.\n- If a matching open issue already exists, report it and do not create another issue.\n- If no matching issue exists, create one self-contained GitHub issue in that repository with a clear title, context, acceptance criteria, and the Powerline idea provenance above.\n- Use explicit repository targeting for GitHub commands and do not change source files for this handoff.`;
}

export function parseCompactQueuedPrompt(text: string): string | null {
  const trimmed = text.trim();
  const match = /^\/compact\s+(.+)$/.exec(trimmed);
  if (!match) return null;

  const prompt = match[1].trim();
  return prompt ? prompt : null;
}

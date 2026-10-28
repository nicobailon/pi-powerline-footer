import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { RequestCacheUsage } from "./types.ts";

type SessionUsage = AssistantMessage["usage"];

export interface SessionTokenStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  subagentCost: number;
  lastAssistant: AssistantMessage | undefined;
  // Latest completed request on this branch; cleared by compaction and model switches.
  lastRequestCache: RequestCacheUsage | undefined;
  thinkingLevelFromSession: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasSessionUsage(value: unknown): value is SessionUsage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !isFiniteNumber(value.input) ||
    !isFiniteNumber(value.output) ||
    !isFiniteNumber(value.cacheRead) ||
    !isFiniteNumber(value.cacheWrite)
  ) {
    return false;
  }

  return isRecord(value.cost) && isFiniteNumber(value.cost.total);
}

function isSessionAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && value.role === "assistant"
    && hasSessionUsage(value.usage)
    && (value.stopReason === undefined || typeof value.stopReason === "string");
}

function getUsageTokenTotal(usage: SessionUsage): number {
  const totalTokens = "totalTokens" in usage && isFiniteNumber(usage.totalTokens) ? usage.totalTokens : 0;
  return totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

// Native charges are independent of whether an assistant is usable for context.
function nativeUsage(event: Record<string, unknown>): SessionUsage | undefined {
  const message = event.type === "message" && isRecord(event.message) ? event.message : undefined;
  const usage = message?.role === "assistant" || message?.role === "toolResult"
    ? message.usage
    : event.type === "usage" || event.type === "compaction" || event.type === "branch_summary"
      ? event.usage
      : undefined;
  return hasSessionUsage(usage) ? usage : undefined;
}

// Matches pi-subagents' internal SLASH_RESULT_TYPE custom_message marker.
const SUBAGENT_SLASH_RESULT_TYPE = "subagent-slash-result";

function subagentDetailsFromSessionEntry(e: Record<string, unknown>): { results: unknown[] } | undefined {
  if (e.type === "custom_message" && e.customType === SUBAGENT_SLASH_RESULT_TYPE) {
    const details = isRecord(e.details) ? e.details : undefined;
    const result = isRecord(details?.result) ? details.result : undefined;
    const inner = isRecord(result?.details) ? result.details : undefined;
    return Array.isArray(inner?.results) ? { results: inner.results } : undefined;
  }
  if (e.type === "message" && isRecord(e.message)) {
    const message = e.message as { role?: unknown; toolName?: unknown; details?: unknown };
    if (message.role === "toolResult" && message.toolName === "subagent" && isRecord(message.details) && Array.isArray(message.details.results)) {
      return { results: message.details.results };
    }
  }
  return undefined;
}

// Sums subagent child usage cost recorded on a single session entry (parallel/chain/single runs
// launched via the subagent tool or /parallel, /worker etc. slash commands), so the footer can
// show total spend rather than only the interactive parent session's cost.
function extractSubagentResultCost(e: Record<string, unknown>): number {
  if (nativeUsage(e)) return 0;
  const details = subagentDetailsFromSessionEntry(e);
  if (!details) return 0;
  let total = 0;
  for (const result of details.results) {
    if (!isRecord(result)) continue;
    const usage = isRecord(result.usage) ? result.usage : undefined;
    if (isFiniteNumber(usage?.cost)) total += usage.cost;
  }
  return total;
}

/**
 * Fingerprint of the fields on a session event that influence the aggregated
 * stats. Comparing only the event count is not enough: while streaming, pi
 * may update the trailing assistant message in place (usage grows, stopReason
 * flips), so the same event reference can carry fresh numbers.
 */
function eventStatsSignature(event: unknown): string {
  if (!isRecord(event)) {
    return "?";
  }

  if (event.type === "thinking_level_change") {
    return `t:${typeof event.thinkingLevel === "string" ? event.thinkingLevel : ""}`;
  }

  const message = event.type === "message" && isRecord(event.message) ? event.message : undefined;
  const usage = nativeUsage(event);
  const totalTokens = usage ? getUsageTokenTotal(usage) : 0;
  const type = typeof event.type === "string" ? event.type : "";
  const role = typeof message?.role === "string" ? message.role : "";
  const stopReason = typeof message?.stopReason === "string" ? message.stopReason : "";
  const assistant = isSessionAssistantMessage(message);
  // Include context eligibility as well as billing, even for legacy/native coexistence.
  return `${type}:${role}:${stopReason}:${assistant}:${totalTokens}:`
    + (usage ? `${usage.input}/${usage.output}/${usage.cacheRead}/${usage.cacheWrite}/${usage.cost.total}` : "")
    + `:s:${extractSubagentResultCost(event)}`;
}

function emptySessionTokenStats(): SessionTokenStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    subagentCost: 0,
    lastAssistant: undefined,
    lastRequestCache: undefined,
    thinkingLevelFromSession: null,
  };
}

function copySessionTokenStats(stats: SessionTokenStats): SessionTokenStats {
  return { ...stats };
}

function accumulateSessionEvent(stats: SessionTokenStats, event: unknown): void {
  if (!isRecord(event)) return;

  if (event.type === "thinking_level_change" && typeof event.thinkingLevel === "string") {
    stats.thinkingLevelFromSession = event.thinkingLevel;
  }

  // The cache hit rate describes requests sent since the prompt last changed shape.
  if (event.type === "compaction" || event.type === "model_change") {
    stats.lastRequestCache = undefined;
  }

  stats.subagentCost += extractSubagentResultCost(event);

  const usage = nativeUsage(event);
  if (usage) {
    stats.input += usage.input;
    stats.output += usage.output;
    stats.cacheRead += usage.cacheRead;
    stats.cacheWrite += usage.cacheWrite;
    stats.cost += usage.cost.total;
  }

  if (event.type !== "message" || !isSessionAssistantMessage(event.message)) return;
  const message = event.message;
  if (message.stopReason !== "error" && message.stopReason !== "aborted" && getUsageTokenTotal(message.usage) > 0) {
    stats.lastAssistant = message;
    stats.lastRequestCache = {
      input: message.usage.input,
      cacheRead: message.usage.cacheRead,
      cacheWrite: message.usage.cacheWrite,
    };
  }
}

export interface SessionBranchProvider {
  getLeafId(): string | null;
  getBranch(): readonly unknown[];
}

function isSessionBranchProvider(value: unknown): value is SessionBranchProvider {
  return isRecord(value) && typeof value.getLeafId === "function" && typeof value.getBranch === "function";
}

/**
 * Session branches are immutable for a given leaf. Keep the already-built path
 * while streaming updates mutate only its trailing message in place.
 */
export class SessionBranchCache {
  private provider: SessionBranchProvider | null = null;
  private leafId: string | null = null;
  private branch: readonly unknown[] = [];

  get(source: unknown): readonly unknown[] {
    if (!isSessionBranchProvider(source)) return [];

    const provider = source;
    const leafId = provider.getLeafId();
    // A reset cache holds provider === null, which never matches a live provider.
    if (this.provider !== provider || this.leafId !== leafId) {
      this.provider = provider;
      this.leafId = leafId;
      this.branch = provider.getBranch();
    }
    return this.branch;
  }

  reset(): void {
    this.provider = null;
    this.leafId = null;
    this.branch = [];
  }
}

export function computeSessionTokenStats(sessionEvents: readonly unknown[]): SessionTokenStats {
  const stats = emptySessionTokenStats();
  for (const event of sessionEvents) accumulateSessionEvent(stats, event);
  return stats;
}

/**
 * Cache for token counting: avoid re-scanning the full session event list on
 * every render (250ms-1s cadence while streaming). Historical session entries
 * are append-only, so appended entries are accumulated and an in-place update
 * to the trailing streaming entry only recomputes that entry.
 */
export class SessionTokenStatsCache {
  private eventCount = -1;
  private lastEvent: unknown;
  private lastSignature = "";
  private prefixStats: SessionTokenStats | null = null;
  private stats: SessionTokenStats | null = null;

  get(sessionEvents: readonly unknown[]): SessionTokenStats {
    const eventCount = sessionEvents.length;
    const lastEvent = eventCount > 0 ? sessionEvents[eventCount - 1] : undefined;
    const lastSignature = eventStatsSignature(lastEvent);

    if (
      this.stats !== null
      && this.eventCount === eventCount
      && this.lastEvent === lastEvent
      && this.lastSignature === lastSignature
    ) {
      return this.stats;
    }

    // Branch paths and the full ledger are append-only. An unchanged previous
    // tail lets us reuse totals when the list grows.
    const previousStats = this.stats;
    const canExtendPreviousStats = previousStats !== null
      && eventCount > this.eventCount
      && (this.eventCount === 0 || (
        sessionEvents[this.eventCount - 1] === this.lastEvent
        && eventStatsSignature(sessionEvents[this.eventCount - 1]) === this.lastSignature
      ));

    let prefixStats: SessionTokenStats;
    if (canExtendPreviousStats && previousStats !== null) {
      prefixStats = copySessionTokenStats(previousStats);
      for (let index = this.eventCount; index < eventCount - 1; index += 1) {
        accumulateSessionEvent(prefixStats, sessionEvents[index]);
      }
    } else if (
      this.prefixStats !== null
      && this.eventCount === eventCount
      && this.lastEvent === lastEvent
    ) {
      // Same array with an in-place tail mutation: reuse the cached prefix.
      prefixStats = this.prefixStats;
    } else {
      prefixStats = emptySessionTokenStats();
      for (let index = 0; index < eventCount - 1; index += 1) {
        accumulateSessionEvent(prefixStats, sessionEvents[index]);
      }
    }

    const stats = copySessionTokenStats(prefixStats);
    if (eventCount > 0) accumulateSessionEvent(stats, lastEvent);

    this.eventCount = eventCount;
    this.lastEvent = lastEvent;
    this.lastSignature = lastSignature;
    this.prefixStats = prefixStats;
    this.stats = stats;
    return stats;
  }

  reset(): void {
    this.eventCount = -1;
    this.lastEvent = undefined;
    this.lastSignature = "";
    this.prefixStats = null;
    this.stats = null;
  }
}

/** Full-ledger billing with branch-local context and thinking state. */
export class SessionUsageCache {
  private branch = new SessionBranchCache();
  private branchStats = new SessionTokenStatsCache();
  private ledgerStats = new SessionTokenStatsCache();
  private provider: SessionBranchProvider | null = null;
  private leafId: string | null = null;
  private entries: readonly unknown[] = [];
  private entryCount: number | undefined;

  get(source: unknown): SessionTokenStats {
    const branch = this.branch.get(source);
    const active = this.branchStats.get(branch);
    if (!isSessionBranchProvider(source) || !isRecord(source) || typeof source.getEntries !== "function") return active;

    const leafId = source.getLeafId();
    const entryCount = typeof source.getEntryCount === "function" ? source.getEntryCount() : undefined;
    // getEntries() copies the ledger. Use the count when available; older SDKs
    // rely on leaf changes and the session_tree handler resetting this cache.
    if (this.provider !== source || this.leafId !== leafId || this.entryCount !== entryCount) {
      if (this.provider !== source) this.ledgerStats.reset();
      this.provider = source;
      this.leafId = leafId;
      this.entries = source.getEntries();
      this.entryCount = entryCount;
    }
    const totals = this.ledgerStats.get(this.entries);
    return {
      ...totals,
      lastAssistant: active.lastAssistant,
      lastRequestCache: active.lastRequestCache,
      thinkingLevelFromSession: active.thinkingLevelFromSession,
    };
  }

  reset(): void {
    this.branch.reset();
    this.branchStats.reset();
    this.ledgerStats.reset();
    this.provider = null;
    this.leafId = null;
    this.entries = [];
    this.entryCount = undefined;
  }
}

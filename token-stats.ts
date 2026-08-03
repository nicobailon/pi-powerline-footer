import type { AssistantMessage } from "@earendil-works/pi-ai";

type SessionAssistantUsage = AssistantMessage["usage"];

export interface SessionTokenStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  subagentCost: number;
  lastAssistant: AssistantMessage | undefined;
  thinkingLevelFromSession: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function getUsageTokenTotal(usage: SessionAssistantUsage): number {
  const totalTokens = "totalTokens" in usage && typeof usage.totalTokens === "number" ? usage.totalTokens : 0;
  return totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
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
  const details = subagentDetailsFromSessionEntry(e);
  if (!details) return 0;
  let total = 0;
  for (const result of details.results) {
    if (!isRecord(result)) continue;
    const usage = isRecord(result.usage) ? result.usage : undefined;
    if (typeof usage?.cost === "number") total += usage.cost;
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

  const subagentDetails = subagentDetailsFromSessionEntry(event);
  if (subagentDetails) {
    return `s:${subagentDetails.results.length}:${extractSubagentResultCost(event)}`;
  }

  if (event.type === "message" && isRecord(event.message)) {
    const message = event.message;
    const role = typeof message.role === "string" ? message.role : "";
    const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
    if (role === "assistant" && hasSessionAssistantUsage(message.usage)) {
      const usage = message.usage;
      return `a:${stopReason}:${usage.input}/${usage.output}/${usage.cacheRead}/${usage.cacheWrite}/${usage.cost.total}`;
    }
    return `m:${role}:${stopReason}`;
  }

  return `e:${typeof event.type === "string" ? event.type : "?"}`;
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

  stats.subagentCost += extractSubagentResultCost(event);

  if (event.type !== "message" || !isSessionAssistantMessage(event.message)) return;

  const message = event.message;
  if (message.stopReason === "error" || message.stopReason === "aborted") return;

  stats.input += message.usage.input;
  stats.output += message.usage.output;
  stats.cacheRead += message.usage.cacheRead;
  stats.cacheWrite += message.usage.cacheWrite;
  stats.cost += message.usage.cost.total;
  if (getUsageTokenTotal(message.usage) > 0) {
    stats.lastAssistant = message;
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
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0, subagentCost = 0;
  let lastAssistant: AssistantMessage | undefined;
  let thinkingLevelFromSession: string | null = null;

  for (const e of sessionEvents) {
    if (!isRecord(e)) continue;

    if (e.type === "thinking_level_change" && typeof e.thinkingLevel === "string") {
      thinkingLevelFromSession = e.thinkingLevel;
    }

    subagentCost += extractSubagentResultCost(e);

    if (e.type !== "message" || !isSessionAssistantMessage(e.message)) continue;

    const m = e.message;
    if (m.stopReason === "error" || m.stopReason === "aborted") continue;

    input += m.usage.input;
    output += m.usage.output;
    cacheRead += m.usage.cacheRead;
    cacheWrite += m.usage.cacheWrite;
    cost += m.usage.cost.total;
    if (getUsageTokenTotal(m.usage) > 0) {
      lastAssistant = m;
    }
  }

  return { input, output, cacheRead, cacheWrite, cost, subagentCost, lastAssistant, thinkingLevelFromSession };
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

    // getBranch() walks unique parent links, so an identical trailing event at
    // the previous count proves the whole previous array is an unchanged prefix.
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

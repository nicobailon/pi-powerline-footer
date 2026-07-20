import type { AssistantMessage } from "@earendil-works/pi-ai";

type SessionAssistantUsage = AssistantMessage["usage"];

export interface SessionTokenStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
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

export function computeSessionTokenStats(sessionEvents: readonly unknown[]): SessionTokenStats {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
  let lastAssistant: AssistantMessage | undefined;
  let thinkingLevelFromSession: string | null = null;

  for (const e of sessionEvents) {
    if (!isRecord(e)) {
      continue;
    }

    // Check for thinking level change entries
    if (e.type === "thinking_level_change" && typeof e.thinkingLevel === "string") {
      thinkingLevelFromSession = e.thinkingLevel;
    }

    if (e.type !== "message" || !isSessionAssistantMessage(e.message)) {
      continue;
    }

    const m = e.message;
    if (m.stopReason === "error" || m.stopReason === "aborted") {
      continue;
    }
    input += m.usage.input;
    output += m.usage.output;
    cacheRead += m.usage.cacheRead;
    cacheWrite += m.usage.cacheWrite;
    cost += m.usage.cost.total;
    if (getUsageTokenTotal(m.usage) > 0) {
      lastAssistant = m;
    }
  }

  return { input, output, cacheRead, cacheWrite, cost, lastAssistant, thinkingLevelFromSession };
}

/**
 * Cache for token counting: avoid re-scanning the full session event list on
 * every render (250ms-1s cadence while streaming). Reuses the aggregated
 * totals while the session hasn't changed.
 *
 * An event-count-only check would go stale when streaming updates the last
 * event in place, so validity requires all of:
 *   1. same event count,
 *   2. same last-event reference,
 *   3. same last-event stats signature (usage/stopReason/thinking level).
 */
export class SessionTokenStatsCache {
  private eventCount = -1;
  private lastEvent: unknown;
  private lastSignature = "";
  private stats: SessionTokenStats | null = null;

  get(sessionEvents: readonly unknown[]): SessionTokenStats {
    const eventCount = sessionEvents.length;
    const lastEvent = eventCount > 0 ? sessionEvents[eventCount - 1] : undefined;

    if (
      this.stats !== null
      && this.eventCount === eventCount
      && this.lastEvent === lastEvent
      && this.lastSignature === eventStatsSignature(lastEvent)
    ) {
      return this.stats;
    }

    const stats = computeSessionTokenStats(sessionEvents);
    this.eventCount = eventCount;
    this.lastEvent = lastEvent;
    this.lastSignature = eventStatsSignature(lastEvent);
    this.stats = stats;
    return stats;
  }

  reset(): void {
    this.eventCount = -1;
    this.lastEvent = undefined;
    this.lastSignature = "";
    this.stats = null;
  }
}

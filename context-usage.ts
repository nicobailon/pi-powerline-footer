import { estimateTokens, sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";

export interface CoreContextUsage {
  contextTokens: number | null;
  contextWindow: number;
  contextPercent: number | null;
}

interface DisplayContextUsageInput {
  coreContextUsage: CoreContextUsage | null;
  unknownCoreFallback: CoreContextUsage | null;
  fallbackContextTokens: number;
  fallbackContextWindow: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ContextUsageSource {
  sessionManager: {
    getLeafId(): string | null;
  };
  getContextUsage(): unknown;
}

interface ReloadContextEstimateSource {
  sessionManager: {
    buildContextEntries(): SessionEntry[];
  };
  getContextUsage(): unknown;
  getSystemPrompt(): string;
}

function isContextUsageSource(value: unknown): value is ContextUsageSource {
  if (!isRecord(value) || typeof value.getContextUsage !== "function" || !isRecord(value.sessionManager)) {
    return false;
  }
  return typeof value.sessionManager.getLeafId === "function";
}

function isReloadContextEstimateSource(value: unknown): value is ReloadContextEstimateSource {
  return isRecord(value)
    && typeof value.getContextUsage === "function"
    && typeof value.getSystemPrompt === "function"
    && isRecord(value.sessionManager)
    && typeof value.sessionManager.buildContextEntries === "function";
}

export class CoreContextUsageCache {
  private sessionManager: ContextUsageSource["sessionManager"] | null = null;
  private leafId: string | null = null;
  private usage: CoreContextUsage | null = null;

  get(ctx: unknown): CoreContextUsage | null {
    if (!isContextUsageSource(ctx)) return readCoreContextUsage(ctx);

    const sessionManager = ctx.sessionManager;
    const leafId = sessionManager.getLeafId();
    // A reset cache holds sessionManager === null, which never matches a live one.
    if (this.sessionManager !== sessionManager || this.leafId !== leafId) {
      this.sessionManager = sessionManager;
      this.leafId = leafId;
      this.usage = readCoreContextUsage(ctx);
    }
    return this.usage;
  }

  reset(): void {
    this.sessionManager = null;
    this.leafId = null;
    this.usage = null;
  }
}

export function estimateInitialContextTokens(ctx: unknown): number | null {
  if (!isRecord(ctx) || typeof ctx.getSystemPrompt !== "function") {
    return null;
  }

  const prompt = ctx.getSystemPrompt();
  if (typeof prompt !== "string" || !prompt.trim()) {
    return null;
  }

  return Math.ceil(prompt.length / 4);
}

export function resolveDisplayContextUsage({
  coreContextUsage,
  unknownCoreFallback,
  fallbackContextTokens,
  fallbackContextWindow,
}: DisplayContextUsageInput): CoreContextUsage {
  if (coreContextUsage?.contextTokens === null && unknownCoreFallback) return unknownCoreFallback;
  if (coreContextUsage) return coreContextUsage;

  return {
    contextTokens: fallbackContextTokens,
    contextWindow: fallbackContextWindow,
    contextPercent: fallbackContextWindow > 0 ? (fallbackContextTokens / fallbackContextWindow) * 100 : 0,
  };
}

export function estimateReloadContextUsage(ctx: unknown): CoreContextUsage | null {
  if (!isReloadContextEstimateSource(ctx)) return null;

  const coreContextUsage = readCoreContextUsage(ctx);
  if (!coreContextUsage || coreContextUsage.contextTokens !== null) return null;

  const messageTokens = ctx.sessionManager.buildContextEntries()
    .flatMap(sessionEntryToContextMessages)
    .reduce((total, message) => total + estimateTokens(message), 0);
  const contextTokens = (estimateInitialContextTokens(ctx) ?? 0) + messageTokens;

  return {
    contextTokens,
    contextWindow: coreContextUsage.contextWindow,
    contextPercent: (contextTokens / coreContextUsage.contextWindow) * 100,
  };
}

export function readCoreContextUsage(ctx: unknown): CoreContextUsage | null {
  if (!isRecord(ctx) || typeof ctx.getContextUsage !== "function") {
    return null;
  }

  const usage = ctx.getContextUsage();
  if (!isRecord(usage)) {
    return null;
  }

  const tokens = usage.tokens;
  const contextWindow = usage.contextWindow;
  if (
    !(tokens === null || (typeof tokens === "number" && Number.isFinite(tokens)))
    || typeof contextWindow !== "number"
    || !Number.isFinite(contextWindow)
    || contextWindow <= 0
  ) {
    return null;
  }

  if (tokens === null) {
    return { contextTokens: null, contextWindow, contextPercent: null };
  }

  const percent = usage.percent;
  return {
    contextTokens: tokens,
    contextWindow,
    contextPercent: typeof percent === "number" && Number.isFinite(percent)
      ? percent
      : (tokens / contextWindow) * 100,
  };
}

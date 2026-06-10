export { estimatePromptTokens } from "./token-estimate.ts";
import { estimatePromptTokens } from "./token-estimate.ts";

interface CoreContextUsage {
  contextTokens: number;
  contextWindow: number;
  contextPercent: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    typeof tokens !== "number"
    || !Number.isFinite(tokens)
    || typeof contextWindow !== "number"
    || !Number.isFinite(contextWindow)
    || contextWindow <= 0
  ) {
    return null;
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

export function estimateInitialContextTokens(ctx: unknown): number | null {
  if (!isRecord(ctx) || typeof ctx.getSystemPrompt !== "function") {
    return null;
  }

  const prompt = ctx.getSystemPrompt();
  if (typeof prompt !== "string" || !prompt.trim()) {
    return null;
  }

  return estimatePromptTokens(prompt);
}

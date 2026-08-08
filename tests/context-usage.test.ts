import test from "node:test";
import assert from "node:assert/strict";
import { CoreContextUsageCache, estimateInitialContextTokens, estimateReloadContextUsage, readCoreContextUsage, resolveDisplayContextUsage } from "../context-usage.ts";

test("readCoreContextUsage returns Pi context estimates for branch summaries", () => {
  const usage = readCoreContextUsage({
    getContextUsage() {
      return { tokens: 1250, contextWindow: 5000, percent: 25 };
    },
  });

  assert.deepEqual(usage, {
    contextTokens: 1250,
    contextWindow: 5000,
    contextPercent: 25,
  });
});

test("readCoreContextUsage computes percent when Pi returns only token totals", () => {
  const usage = readCoreContextUsage({
    getContextUsage() {
      return { tokens: 1000, contextWindow: 4000 };
    },
  });

  assert.deepEqual(usage, {
    contextTokens: 1000,
    contextWindow: 4000,
    contextPercent: 25,
  });
});

test("readCoreContextUsage preserves Pi's post-compaction unknown state", () => {
  const usage = readCoreContextUsage({
    getContextUsage() {
      return { tokens: null, contextWindow: 5000, percent: null };
    },
  });

  assert.deepEqual(usage, {
    contextTokens: null,
    contextWindow: 5000,
    contextPercent: null,
  });
});

test("readCoreContextUsage ignores unknown or unusable estimates", () => {
  assert.equal(readCoreContextUsage({}), null);
  assert.equal(readCoreContextUsage({ getContextUsage: () => undefined }), null);
  assert.equal(readCoreContextUsage({ getContextUsage: () => ({ tokens: undefined, contextWindow: 5000, percent: null }) }), null);
  assert.equal(readCoreContextUsage({ getContextUsage: () => ({ tokens: 100, contextWindow: 0, percent: 0 }) }), null);
});

test("core context usage cache reuses a leaf and supports explicit invalidation", () => {
  const cache = new CoreContextUsageCache();
  let leafId = "leaf-1";
  let tokens = 100;
  let reads = 0;
  const ctx = {
    sessionManager: { getLeafId: () => leafId },
    getContextUsage() {
      reads += 1;
      return { tokens, contextWindow: 1000, percent: tokens / 10 };
    },
  };

  assert.equal(cache.get(ctx)?.contextTokens, 100);
  tokens = 200;
  assert.equal(cache.get(ctx)?.contextTokens, 100);
  assert.equal(reads, 1);

  cache.reset();
  assert.equal(cache.get(ctx)?.contextTokens, 200);
  leafId = "leaf-2";
  tokens = 300;
  assert.equal(cache.get(ctx)?.contextTokens, 300);
  assert.equal(reads, 3);
});

test("resolveDisplayContextUsage preserves unknown core usage over assistant fallback usage", () => {
  assert.deepEqual(resolveDisplayContextUsage({
    coreContextUsage: { contextTokens: null, contextWindow: 5000, contextPercent: null },
    unknownCoreFallback: null,
    fallbackContextTokens: 4000,
    fallbackContextWindow: 5000,
  }), {
    contextTokens: null,
    contextWindow: 5000,
    contextPercent: null,
  });
});

test("resolveDisplayContextUsage uses the reload estimate for unknown core usage", () => {
  const reloadEstimate = { contextTokens: 1000, contextWindow: 5000, contextPercent: 20 };
  assert.equal(resolveDisplayContextUsage({
    coreContextUsage: { contextTokens: null, contextWindow: 5000, contextPercent: null },
    unknownCoreFallback: reloadEstimate,
    fallbackContextTokens: 4000,
    fallbackContextWindow: 5000,
  }), reloadEstimate);
});

test("resolveDisplayContextUsage computes assistant fallback usage when Pi has no current estimate", () => {
  assert.deepEqual(resolveDisplayContextUsage({
    coreContextUsage: null,
    unknownCoreFallback: null,
    fallbackContextTokens: 1000,
    fallbackContextWindow: 4000,
  }), {
    contextTokens: 1000,
    contextWindow: 4000,
    contextPercent: 25,
  });
});

test("estimateReloadContextUsage estimates the active compacted context", () => {
  const usage = estimateReloadContextUsage({
    getContextUsage: () => ({ tokens: null, contextWindow: 100, percent: null }),
    getSystemPrompt: () => "12345678",
    sessionManager: {
      buildContextEntries: () => [
        { type: "compaction", summary: "12345678", tokensBefore: 90, timestamp: "2026-08-08T00:00:00.000Z" },
        { type: "message", message: { role: "user", content: "1234", timestamp: 0 } },
      ],
    },
  });

  assert.deepEqual(usage, {
    contextTokens: 5,
    contextWindow: 100,
    contextPercent: 5,
  });
});

test("estimateReloadContextUsage skips sessions with known core usage", () => {
  let entryReads = 0;
  assert.equal(estimateReloadContextUsage({
    getContextUsage: () => ({ tokens: 25, contextWindow: 100, percent: 25 }),
    getSystemPrompt: () => "12345678",
    sessionManager: {
      buildContextEntries() {
        entryReads += 1;
        return [];
      },
    },
  }), null);
  assert.equal(entryReads, 0);
});

test("estimateInitialContextTokens uses Pi's conservative character estimate", () => {
  assert.equal(estimateInitialContextTokens({}), null);
  assert.equal(estimateInitialContextTokens({ getSystemPrompt: () => "" }), null);
  assert.equal(estimateInitialContextTokens({ getSystemPrompt: () => "   " }), null);
  assert.equal(estimateInitialContextTokens({ getSystemPrompt: () => "1234" }), 1);
  assert.equal(estimateInitialContextTokens({ getSystemPrompt: () => "12345" }), 2);
});

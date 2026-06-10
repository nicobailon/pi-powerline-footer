import test from "node:test";
import assert from "node:assert/strict";
import { estimateInitialContextTokens, estimatePromptTokens, readCoreContextUsage } from "../context-usage.ts";

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

test("readCoreContextUsage ignores unknown or unusable estimates", () => {
  assert.equal(readCoreContextUsage({}), null);
  assert.equal(readCoreContextUsage({ getContextUsage: () => undefined }), null);
  assert.equal(readCoreContextUsage({ getContextUsage: () => ({ tokens: null, contextWindow: 5000, percent: null }) }), null);
  assert.equal(readCoreContextUsage({ getContextUsage: () => ({ tokens: 100, contextWindow: 0, percent: 0 }) }), null);
});

test("estimatePromptTokens uses embedded tokenx-style heuristic", () => {
  assert.equal(estimatePromptTokens(""), 0);
  assert.equal(estimatePromptTokens("hello world"), 4);
  assert.equal(estimatePromptTokens("Use `read`, `write`, and `edit` on ./src/index.ts"), 20);
  assert.equal(estimatePromptTokens("Line 1\nLine 2\nLine 3"), 6);
});

test("estimateInitialContextTokens uses system prompt text instead of live usage", () => {
  assert.equal(estimateInitialContextTokens({}), null);
  assert.equal(estimateInitialContextTokens({ getSystemPrompt: () => "" }), null);
  assert.equal(
    estimateInitialContextTokens({ getSystemPrompt: () => "You are helpful. Use bash and read." }),
    estimatePromptTokens("You are helpful. Use bash and read."),
  );
});

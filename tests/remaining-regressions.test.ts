import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NERD_ICONS } from "../icons.ts";
import { isStaleExtensionContextError, shouldResetExtendedKeyboardModesOnShutdown, shouldShowStartupWelcome } from "../lifecycle.ts";
import { renderSegment } from "../segments.ts";
import type { SegmentContext } from "../types.ts";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
const originalNerdFonts = process.env.POWERLINE_NERD_FONTS;
process.env.POWERLINE_NERD_FONTS = "0";

test.after(() => {
  if (originalNerdFonts === undefined) {
    delete process.env.POWERLINE_NERD_FONTS;
  } else {
    process.env.POWERLINE_NERD_FONTS = originalNerdFonts;
  }
});

function plainThemeText(_color: string, text: string): string {
  return text;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function createSegmentContext(overrides: Partial<SegmentContext> = {}): SegmentContext {
  return {
    model: { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    thinkingLevel: "off",
    sessionId: undefined,
    cwd: "/tmp/project",
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    contextTokens: 0,
    contextPercent: 0,
    contextWindow: 0,
    autoCompactEnabled: true,
    customCompactionEnabled: false,
    usingSubscription: false,
    sessionStartTime: Date.now(),
    shellModeActive: false,
    shellRunning: false,
    shellName: null,
    shellCwd: null,
    git: { branch: null, staged: 0, unstaged: 0, untracked: 0 },
    extensionStatuses: new Map(),
    hiddenExtensionStatusKeys: new Set(),
    customItemsById: new Map(),
    options: {},
    theme: { fg: plainThemeText },
    colors: {},
    ...overrides,
  };
}

test("model segment can show provider-qualified ids", () => {
  const normal = renderSegment("model", createSegmentContext());
  const qualified = renderSegment("model", createSegmentContext({
    model: { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "anthropic" },
    options: { model: { display: "qualified" } },
  }));
  const alreadyQualified = renderSegment("model", createSegmentContext({
    model: { id: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai" },
    options: { model: { display: "qualified" } },
  }));

  assert.equal(stripAnsi(normal.content), "Sonnet 4");
  assert.equal(stripAnsi(qualified.content), "anthropic/claude-sonnet-4");
  assert.equal(stripAnsi(alreadyQualified.content), "openai/gpt-4.1");
});

test("cost segment supports subscription display modes", () => {
  const subscription = renderSegment("cost", createSegmentContext({
    usingSubscription: true,
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.42 },
  }));
  const reportedCost = renderSegment("cost", createSegmentContext({
    usingSubscription: true,
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.42 },
    options: { cost: { subscriptionDisplay: "reported-cost" } },
  }));
  const both = renderSegment("cost", createSegmentContext({
    usingSubscription: true,
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.42 },
    options: { cost: { subscriptionDisplay: "both" } },
  }));
  const zeroReported = renderSegment("cost", createSegmentContext({
    usingSubscription: true,
    options: { cost: { subscriptionDisplay: "reported-cost" } },
  }));
  const zeroBoth = renderSegment("cost", createSegmentContext({
    usingSubscription: true,
    options: { cost: { subscriptionDisplay: "both" } },
  }));

  assert.deepEqual(subscription, { content: "(sub)", visible: true });
  assert.deepEqual(reportedCost, { content: "$0.42", visible: true });
  assert.deepEqual(both, { content: "$0.42 (sub)", visible: true });
  assert.deepEqual(zeroReported, { content: "(sub)", visible: true });
  assert.deepEqual(zeroBoth, { content: "(sub)", visible: true });
});

test("context segment shows used tokens, maximum, and percentage", () => {
  const context = renderSegment("context_pct", createSegmentContext({
    contextTokens: 4_500,
    contextPercent: 1.7,
    contextWindow: 272_000,
  }));

  assert.equal(stripAnsi(context.content), "◫ 4.5k/272k (1.7%) AC");
  assert.equal(context.visible, true);
});

test("Nerd Font context icon uses stable database glyph", () => {
  assert.equal(NERD_ICONS.context, "\uF1C0");
});

test("startup welcome predicate respects powerline.welcome false", () => {
  assert.equal(shouldShowStartupWelcome("startup", true), true);
  assert.equal(shouldShowStartupWelcome("startup", false), false);
  assert.equal(shouldShowStartupWelcome("resume", true), false);
  assert.match(source, /setupCustomEditor\(ctx\);\n\s+if \(shouldShowStartupWelcome\(event\.reason, config\.welcome\)\)/);
});

test("only UI quit resets extended keyboard modes", () => {
  assert.equal(shouldResetExtendedKeyboardModesOnShutdown(true, "quit"), true);
  assert.equal(shouldResetExtendedKeyboardModesOnShutdown(true, "reload"), false);
  assert.equal(shouldResetExtendedKeyboardModesOnShutdown(true, "resume"), false);
  assert.equal(shouldResetExtendedKeyboardModesOnShutdown(false, "quit"), false);
  assert.doesNotMatch(source, /event\?\.reason === "quit" \|\| event\?\.reason === "reload"/);
  assert.match(source, /const hasUI = Boolean\(ctx\.hasUI\);/);
  assert.match(source, /shouldResetExtendedKeyboardModesOnShutdown\(hasUI, event\?\.reason\)/);
  assert.match(source, /teardownFixedEditorCompositor\(isTerminalExit \? \{ resetExtendedKeyboardModes: true \} : undefined\)/);
});

test("stale ctx guard handles old and new Pi messages on agent_end", () => {
  assert.equal(isStaleExtensionContextError(new Error("This extension instance is stale after session replacement or reload.")), true);
  assert.equal(isStaleExtensionContextError(new Error("This extension ctx is stale after session replacement or reload.")), true);
  assert.equal(isStaleExtensionContextError(new Error("ctx.hasUI failed for another reason")), false);
  assert.match(source, /let hasUI = false;\n\s+try \{\n\s+hasUI = Boolean\(ctx\.hasUI\);/);
  assert.match(source, /if \(!isStaleExtensionContextError\(error\)\) throw error;\n\s+currentCtx = null;\n\s+return;/);
});

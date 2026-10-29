import test from "node:test";
import assert from "node:assert/strict";
import { renderSegment } from "../segments.ts";
import { mergeSegmentOptions, parsePowerlineConfig } from "../powerline-config.ts";
import { SEP_DOT } from "../icons.ts";
import type { SegmentContext, StatusLineSegmentOptions } from "../types.ts";

const PRESET_NAMES = ["default", "compact"];

const originalNerdFonts = process.env.POWERLINE_NERD_FONTS;
process.env.POWERLINE_NERD_FONTS = "0";

test.after(() => {
  if (originalNerdFonts === undefined) {
    delete process.env.POWERLINE_NERD_FONTS;
  } else {
    process.env.POWERLINE_NERD_FONTS = originalNerdFonts;
  }
});

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function plainTheme(): any {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function createSegmentContext(options: StatusLineSegmentOptions = {}, overrides: Partial<SegmentContext> = {}): SegmentContext {
  return {
    model: undefined,
    thinkingLevel: "off",
    sessionId: undefined,
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, subagentCost: 0 },
    contextTokens: 0,
    contextPercent: 0,
    contextWindow: 0,
    contextApproximate: false,
    autoCompactEnabled: true,
    customCompactionEnabled: false,
    usingSubscription: false,
    queueSummary: { queueCount: 0, blockedCount: 0, compacting: false, leadingText: null, leadingIntent: null, leadingStatus: null },
    sessionStartTime: Date.now(),
    shellModeActive: false,
    shellRunning: false,
    shellName: null,
    shellCwd: null,
    git: { branch: null, staged: 0, unstaged: 0, untracked: 0 },
    extensionStatuses: new Map(),
    hiddenExtensionStatusKeys: new Set(),
    customItemsById: new Map(),
    options,
    theme: plainTheme(),
    colors: {},
    ...overrides,
  };
}

// ── context_pct format ──────────────────────────────────────────────────────

test("context_pct defaults to the full tokens/window rendering", () => {
  const ctx = createSegmentContext({}, {
    contextTokens: 12300,
    contextWindow: 200000,
    contextPercent: 6.15,
  });

  const rendered = renderSegment("context_pct", ctx);
  assert.equal(stripAnsi(rendered.content), "◫ 12k/200k (6.2%) AC");
});

test("context_pct percent format renders a bare rounded percentage", () => {
  const ctx = createSegmentContext({ context: { format: "percent" } }, {
    contextTokens: 12300,
    contextWindow: 200000,
    contextPercent: 6.15,
  });

  const rendered = renderSegment("context_pct", ctx);
  assert.equal(stripAnsi(rendered.content), "6%");
});

test("context_pct renders unknown usage after compaction", () => {
  const full = createSegmentContext({}, {
    contextTokens: null,
    contextWindow: 200000,
    contextPercent: null,
  });
  const percent = createSegmentContext({ context: { format: "percent" } }, {
    contextTokens: null,
    contextWindow: 200000,
    contextPercent: null,
  });

  assert.equal(stripAnsi(renderSegment("context_pct", full).content), "◫ ?/200k AC");
  assert.equal(stripAnsi(renderSegment("context_pct", percent).content), "?");
});

test("context_pct marks context estimates as approximate", () => {
  const full = createSegmentContext({}, {
    contextTokens: 18000,
    contextWindow: 272000,
    contextPercent: 6.6176,
    contextApproximate: true,
  });
  const percent = createSegmentContext({ context: { format: "percent" } }, {
    contextTokens: 18000,
    contextWindow: 272000,
    contextPercent: 6.6176,
    contextApproximate: true,
  });

  assert.equal(stripAnsi(renderSegment("context_pct", full).content), "◫ ~18k/272k (6.6%) AC");
  assert.equal(stripAnsi(renderSegment("context_pct", percent).content), "~7%");
});

test("context_pct percent format keeps threshold colors and drops icons", () => {
  for (const [percent, expected] of [[69, "69%"], [85, "85%"], [95, "95%"]] as const) {
    const ctx = createSegmentContext({ context: { format: "percent" } }, {
      contextTokens: percent,
      contextWindow: 100,
      contextPercent: percent,
    });
    const rendered = renderSegment("context_pct", ctx);
    assert.equal(stripAnsi(rendered.content), expected);
    assert.ok(!rendered.content.includes("◫"), "no context icon in percent mode");
    assert.ok(!rendered.content.includes("AC"), "no auto-compact icon in percent mode");
  }
});

// ── cache_read format ───────────────────────────────────────────────────────

test("cache_read defaults to raw token count", () => {
  const ctx = createSegmentContext({}, {
    usageStats: { input: 1000, output: 0, cacheRead: 12300, cacheWrite: 0, cost: 0, subagentCost: 0 },
  });

  const rendered = renderSegment("cache_read", ctx);
  assert.equal(stripAnsi(rendered.content), "cache in: 12k");
});

test("cache_read percent format renders the cache hit rate", () => {
  const ctx = createSegmentContext({ cache_read: { format: "percent" } }, {
    usageStats: { input: 2000, output: 0, cacheRead: 8000, cacheWrite: 0, cost: 0, subagentCost: 0 },
  });

  const rendered = renderSegment("cache_read", ctx);
  assert.equal(stripAnsi(rendered.content), "cache 80%");
});

test("cache_read both format renders raw token count and cache hit rate", () => {
  const ctx = createSegmentContext({ cache_read: { format: "both" } }, {
    usageStats: { input: 2000, output: 0, cacheRead: 8000, cacheWrite: 0, cost: 0, subagentCost: 0 },
  });

  const rendered = renderSegment("cache_read", ctx);
  assert.equal(stripAnsi(rendered.content), "cache in: 8.0k (80%)");
});

test("cache_read hit rate counts cache writes as prompt tokens", () => {
  // One request: 90 uncached, 5000 read, 27009 written. The written tokens are not hits.
  const usage = { input: 90, output: 0, cacheRead: 5000, cacheWrite: 27009, cost: 0, subagentCost: 0 };

  const percent = createSegmentContext({ cache_read: { format: "percent" } }, { usageStats: usage });
  assert.equal(stripAnsi(renderSegment("cache_read", percent).content), "cache 16%");

  const both = createSegmentContext({ cache_read: { format: "both" } }, { usageStats: usage });
  assert.equal(stripAnsi(renderSegment("cache_read", both).content), "cache in: 5.0k (16%)");
});

test("cache_read hit rate is zero when the prompt was only written to the cache", () => {
  const percent = createSegmentContext({ cache_read: { format: "percent" } }, {
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 27009, cost: 0, subagentCost: 0 },
  });
  // No cache reads to show, so the segment stays hidden as before.
  assert.deepEqual(renderSegment("cache_read", percent), { content: "", visible: false });
});

test("cache_read percent and both formats handle zero input without NaN", () => {
  const percentCtx = createSegmentContext({ cache_read: { format: "percent" } }, {
    usageStats: { input: 0, output: 0, cacheRead: 5, cacheWrite: 0, cost: 0, subagentCost: 0 },
  });
  assert.equal(stripAnsi(renderSegment("cache_read", percentCtx).content), "cache 100%");

  const bothCtx = createSegmentContext({ cache_read: { format: "both" } }, {
    usageStats: { input: 0, output: 0, cacheRead: 5, cacheWrite: 0, cost: 0, subagentCost: 0 },
  });
  assert.equal(stripAnsi(renderSegment("cache_read", bothCtx).content), "cache in: 5 (100%)");

  const hidden = createSegmentContext({ cache_read: { format: "both" } });
  assert.deepEqual(renderSegment("cache_read", hidden), { content: "", visible: false });
});

test("parsePowerlineConfig accepts the request cache_read format", () => {
  const request = parsePowerlineConfig({ cache_read: { format: "request" } }, PRESET_NAMES);
  const sessionRequest = parsePowerlineConfig({ cache_read: { format: "session-request" } }, PRESET_NAMES);

  assert.equal(request.segmentOptions.cache_read?.format, "request");
  assert.equal(sessionRequest.segmentOptions.cache_read?.format, "session-request");
});

// ── cache_read request format ───────────────────────────────────────────────

test("cache_read request format renders the latest request's hit rate, counting cache writes", () => {
  // One request: 90 uncached, 5000 read, 27009 written. Session totals are deliberately different.
  const ctx = createSegmentContext({ cache_read: { format: "request" } }, {
    usageStats: { input: 1000, output: 0, cacheRead: 9000, cacheWrite: 27009, cost: 0, subagentCost: 0 },
    lastRequestCache: { input: 90, cacheRead: 5000, cacheWrite: 27009 },
  });

  assert.equal(stripAnsi(renderSegment("cache_read", ctx).content), "cache 16%");
});

test("cache_read request format shows a placeholder until a request completes after a reset", () => {
  const ctx = createSegmentContext({ cache_read: { format: "request" } }, {
    usageStats: { input: 0, output: 0, cacheRead: 8000, cacheWrite: 0, cost: 0, subagentCost: 0 },
  });

  assert.equal(stripAnsi(renderSegment("cache_read", ctx).content), "cache --");
});

test("cache_read request format shows a request with no prompt tokens as a placeholder", () => {
  const ctx = createSegmentContext({ cache_read: { format: "request" } }, {
    usageStats: { input: 0, output: 0, cacheRead: 5, cacheWrite: 0, cost: 0, subagentCost: 0 },
    lastRequestCache: { input: 0, cacheRead: 0, cacheWrite: 0 },
  });

  assert.equal(stripAnsi(renderSegment("cache_read", ctx).content), "cache --");
});

test("cache_read request format stays visible for a request that only wrote to the cache", () => {
  const ctx = createSegmentContext({ cache_read: { format: "request" } }, {
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 27009, cost: 0, subagentCost: 0 },
    lastRequestCache: { input: 90, cacheRead: 0, cacheWrite: 27009 },
  });

  assert.equal(stripAnsi(renderSegment("cache_read", ctx).content), "cache 0%");
  assert.deepEqual(
    renderSegment("cache_read", createSegmentContext({ cache_read: { format: "request" } })),
    { content: "", visible: false },
  );
});

test("cache_read request format colors the hit rate by band", () => {
  // Tag each theme color so the test can read which band was applied.
  const taggedTheme = { fg: (color: string, text: string) => `<${color}>${text}</>`, bg: (_c: string, t: string) => t, bold: (t: string) => t };
  const bandFor = (rate: number): string => {
    const ctx = createSegmentContext({ cache_read: { format: "request" } }, {
      theme: taggedTheme,
      usageStats: { input: 0, output: 0, cacheRead: 1, cacheWrite: 0, cost: 0, subagentCost: 0 },
      lastRequestCache: { input: 100 - rate, cacheRead: rate, cacheWrite: 0 },
    });
    return renderSegment("cache_read", ctx).content;
  };

  assert.equal(bandFor(29), "<error>cache 29%</>");
  assert.equal(bandFor(30), "<warning>cache 30%</>");
  assert.equal(bandFor(69), "<warning>cache 69%</>");
  assert.equal(bandFor(70), "<success>cache 70%</>");
});

test("cache_read request format colors can be overridden through the colors config", () => {
  const taggedTheme = { fg: (color: string, text: string) => `<${color}>${text}</>`, bg: (_c: string, t: string) => t, bold: (t: string) => t };
  const ctx = createSegmentContext({ cache_read: { format: "request" } }, {
    theme: taggedTheme,
    colors: { cacheHitWarn: "accent" },
    usageStats: { input: 50, output: 0, cacheRead: 50, cacheWrite: 0, cost: 0, subagentCost: 0 },
    lastRequestCache: { input: 50, cacheRead: 50, cacheWrite: 0 },
  });

  assert.equal(renderSegment("cache_read", ctx).content, "<accent>cache 50%</>");
});

// ── cache_read session-request format ───────────────────────────────────────

test("cache_read session-request format shows the session rate and the latest request's rate", () => {
  // Session: 9000 read of 37009 prompt tokens (24%). Latest request: 5000 read of 32099 (16%).
  const ctx = createSegmentContext({ cache_read: { format: "session-request" } }, {
    usageStats: { input: 1000, output: 0, cacheRead: 9000, cacheWrite: 27009, cost: 0, subagentCost: 0 },
    lastRequestCache: { input: 90, cacheRead: 5000, cacheWrite: 27009 },
  });

  assert.equal(stripAnsi(renderSegment("cache_read", ctx).content), `cache 24%${SEP_DOT}last 16%`);
});

test("cache_read session-request format shows a placeholder for the latest request until one completes", () => {
  const ctx = createSegmentContext({ cache_read: { format: "session-request" } }, {
    usageStats: { input: 0, output: 0, cacheRead: 8000, cacheWrite: 0, cost: 0, subagentCost: 0 },
  });

  assert.equal(stripAnsi(renderSegment("cache_read", ctx).content), `cache 100%${SEP_DOT}last --`);
});

test("cache_read session-request format colors each rate by its own band", () => {
  const taggedTheme = { fg: (color: string, text: string) => `<${color}>${text}</>`, bg: (_c: string, t: string) => t, bold: (t: string) => t };
  const ctx = createSegmentContext({ cache_read: { format: "session-request" } }, {
    theme: taggedTheme,
    usageStats: { input: 50, output: 0, cacheRead: 50, cacheWrite: 0, cost: 0, subagentCost: 0 },
    lastRequestCache: { input: 90, cacheRead: 10, cacheWrite: 0 },
  });

  assert.equal(renderSegment("cache_read", ctx).content, `<warning>cache 50%</>${SEP_DOT}<error>last 10%</>`);
});

test("cache_read session-request format is hidden without cache activity", () => {
  const ctx = createSegmentContext({ cache_read: { format: "session-request" } });

  assert.deepEqual(renderSegment("cache_read", ctx), { content: "", visible: false });
});

// ── queue segment ──────────────────────────────────────────────────────────

test("queue segment hides when empty", () => {
  const ctx = createSegmentContext();
  assert.deepEqual(renderSegment("queue", ctx), { content: "", visible: false });
});

test("queue segment summarizes queued and blocked items", () => {
  const ctx = createSegmentContext({}, {
    queueSummary: { queueCount: 2, blockedCount: 1, compacting: false, leadingText: "fix README", leadingIntent: "post-compact", leadingStatus: "blocked" },
  });

  assert.equal(stripAnsi(renderSegment("queue", ctx).content), "q 2 · blocked 1");
});

test("queue segment highlights compaction-held prompts", () => {
  const ctx = createSegmentContext({}, {
    queueSummary: { queueCount: 1, blockedCount: 0, compacting: true, leadingText: "run after compact", leadingIntent: "post-compact", leadingStatus: "queued" },
  });

  assert.equal(stripAnsi(renderSegment("queue", ctx).content), "compact q 1");
});

// ── config parsing / merging ────────────────────────────────────────────────

test("parsePowerlineConfig accepts context and cache_read formats", () => {
  const config = parsePowerlineConfig({
    context: { format: "percent" },
    cache_read: { format: "both" },
  }, PRESET_NAMES);

  assert.equal(config.segmentOptions.context?.format, "percent");
  assert.equal(config.segmentOptions.cache_read?.format, "both");
});

test("parsePowerlineConfig ignores invalid format values", () => {
  const config = parsePowerlineConfig({
    context: { format: "bogus" },
    cache_read: { format: 42 },
  }, PRESET_NAMES);

  assert.equal(config.segmentOptions.context?.format, undefined);
  assert.equal(config.segmentOptions.cache_read?.format, undefined);
});

test("parsePowerlineConfig defaults to upstream rendering when options are absent", () => {
  const config = parsePowerlineConfig({}, PRESET_NAMES);
  assert.equal(config.segmentOptions.context, undefined);
  assert.equal(config.segmentOptions.cache_read, undefined);
});

test("mergeSegmentOptions merges context and cache_read per key", () => {
  const merged = mergeSegmentOptions(
    { context: { format: "percent" }, cache_read: { format: "percent" } },
    { context: { format: "full" }, cache_read: { format: "both" } },
  );

  assert.equal(merged.context?.format, "full");
  assert.equal(merged.cache_read?.format, "both");
});

import test from "node:test";
import assert from "node:assert/strict";
import { renderSegment } from "../segments.ts";
import type { SegmentContext } from "../types.ts";

function createSegmentContext(overrides: Partial<SegmentContext> = {}): SegmentContext {
  return {
    model: undefined,
    thinkingLevel: "off",
    sessionId: "12345678-90ab-cdef-1234-567890abcdef",
    sessionName: undefined,
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
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
    theme: {
      fg(_color, text) {
        return text;
      },
    },
    colors: {},
    ...overrides,
  };
}

function renderSessionWithFontMode(ctx: SegmentContext, nerdFonts: "0" | "1") {
  const previous = process.env.POWERLINE_NERD_FONTS;
  process.env.POWERLINE_NERD_FONTS = nerdFonts;
  try {
    return renderSegment("session", ctx);
  } finally {
    if (previous === undefined) {
      delete process.env.POWERLINE_NERD_FONTS;
    } else {
      process.env.POWERLINE_NERD_FONTS = previous;
    }
  }
}

function renderAsciiSession(ctx: SegmentContext) {
  return renderSessionWithFontMode(ctx, "0");
}

function renderNerdSession(ctx: SegmentContext) {
  return renderSessionWithFontMode(ctx, "1");
}

test("session segment prefers the display name over the session id", () => {
  const rendered = renderAsciiSession(createSegmentContext({ sessionName: "Refactor auth module" }));

  assert.equal(rendered.visible, true);
  assert.equal(rendered.content, "Refactor auth module");
});

test("session segment uses the comments icon in Nerd Font mode", () => {
  const rendered = renderNerdSession(createSegmentContext({ sessionName: "Refactor auth module" }));

  assert.equal(rendered.visible, true);
  assert.equal(rendered.content, "\uF086 Refactor auth module");
});

test("session segment hides unnamed sessions when id fallback is disabled", () => {
  const rendered = renderAsciiSession(
    createSegmentContext({ options: { session: { showIdWhenUnnamed: false } } }),
  );

  assert.equal(rendered.visible, false);
  assert.equal(rendered.content, "");
});

test("session segment still shows names when unnamed id fallback is disabled", () => {
  const rendered = renderAsciiSession(
    createSegmentContext({
      sessionName: "Named session",
      options: { session: { showIdWhenUnnamed: false } },
    }),
  );

  assert.equal(rendered.visible, true);
  assert.equal(rendered.content, "Named session");
});

test("session segment keeps short-id fallback for presets that show unnamed sessions", () => {
  const rendered = renderAsciiSession(createSegmentContext());

  assert.equal(rendered.visible, true);
  assert.equal(rendered.content, "12345678");
});

test("session segment sanitizes and truncates display names", () => {
  const rendered = renderAsciiSession(
    createSegmentContext({
      sessionName: "Feature\nbranch\twith a very long name",
      options: { session: { maxLength: 14 } },
    }),
  );

  assert.equal(rendered.visible, true);
  assert.equal(rendered.content, "Feature branc…");
});

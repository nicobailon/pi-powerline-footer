import test from "node:test";
import assert from "node:assert/strict";
import { isGitHubRemoteUrl } from "../git-status.ts";
import { renderSegment } from "../segments.ts";
import { parsePowerlineConfig, mergeSegmentOptions } from "../powerline-config.ts";
import { PRESETS } from "../presets.ts";
import type { SegmentContext } from "../types.ts";

const PRESET_NAMES = Object.keys(PRESETS) as Array<keyof typeof PRESETS>;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function createCtx(overrides: Partial<SegmentContext> = {}): SegmentContext {
  return {
    model: { id: "k3", name: "Kimi K3" },
    thinkingLevel: "off",
    sessionId: undefined,
    cwd: "/tmp/project",
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    contextTokens: 296_000,
    contextPercent: 28.2,
    contextWindow: 1_000_000,
    autoCompactEnabled: true,
    customCompactionEnabled: false,
    usingSubscription: false,
    sessionStartTime: Date.now(),
    shellModeActive: false,
    shellRunning: false,
    shellName: null,
    shellCwd: null,
    git: { branch: "main", staged: 0, unstaged: 0, untracked: 0 },
    extensionStatuses: new Map(),
    hiddenExtensionStatusKeys: new Set(),
    customItemsById: new Map(),
    options: {},
    theme: { fg: (_c: string, t: string) => t },
    colors: {},
    segmentStyle: "fg",
    ...overrides,
  };
}

test("isGitHubRemoteUrl matches https and ssh remotes only", () => {
  assert.equal(isGitHubRemoteUrl("https://github.com/andy/repo.git"), true);
  assert.equal(isGitHubRemoteUrl("git@github.com:andy/repo.git"), true);
  assert.equal(isGitHubRemoteUrl("ssh://git@github.com/andy/repo.git"), true);
  assert.equal(isGitHubRemoteUrl("https://gitlab.com/andy/repo.git"), false);
  assert.equal(isGitHubRemoteUrl("https://github.example.com/andy/repo.git"), false);
  assert.equal(isGitHubRemoteUrl(null), false);
  assert.equal(isGitHubRemoteUrl(undefined), false);
});

test("context_pct percent format shows a bare percentage without icons", () => {
  // percent is the default format
  const defaultFormat = renderSegment("context_pct", createCtx());
  assert.equal(stripAnsi(defaultFormat.content), "28%");

  const full = renderSegment("context_pct", createCtx({ options: { context: { format: "full" } } }));
  assert.ok(stripAnsi(full.content).includes("296k/1.0M (28.2%)"));

  const percent = renderSegment("context_pct", createCtx({ options: { context: { format: "percent" } } }));
  const plain = stripAnsi(percent.content);
  assert.equal(plain, "28%");
  assert.ok(!plain.includes("/"), "no token ratio");
});

test("context format option is parsed and merged", () => {
  const parsed = parsePowerlineConfig({ context: { format: "percent" } }, PRESET_NAMES);
  assert.equal(parsed.segmentOptions.context?.format, "percent");

  const merged = mergeSegmentOptions({ context: { format: "full" } }, parsed.segmentOptions);
  assert.equal(merged.context?.format, "percent");

  const invalid = parsePowerlineConfig({ context: { format: "tiny" } }, PRESET_NAMES);
  assert.equal(invalid.segmentOptions.context?.format, undefined);
});

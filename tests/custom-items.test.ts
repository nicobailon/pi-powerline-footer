import test from "node:test";
import assert from "node:assert/strict";
import { collectHiddenExtensionStatusKeys, getNotificationExtensionStatuses, normalizeExtensionStatusValue, parsePowerlineConfig, mergeSegmentOptions, mergeSegmentsWithCustomItems, nextPowerlineSettingWithOptions, nextPowerlineSettingWithPreset, normalizeCompactExtensionStatus } from "../powerline-config.ts";
import { getSeparator } from "../separators.ts";
import { PRESETS } from "../presets.ts";

test("fixed custom preset is removed in favor of powerline.layout", () => {
  assert.equal("custom" in PRESETS, false);
});

test("parsePowerlineConfig supports object config with custom items", () => {
  const config = parsePowerlineConfig(
    {
      preset: "compact",
      customItems: [
        { id: "ci", statusKey: "ci-status", position: "right", prefix: "CI" },
        { id: "review", position: "secondary", hideWhenMissing: false },
      ],
    },
    ["default", "compact"],
  );

  assert.equal(config.preset, "compact");
  assert.equal(config.customItems.length, 2);
  assert.equal(config.customItems[0].id, "ci");
  assert.equal(config.customItems[0].statusKey, "ci-status");
  assert.equal(config.customItems[1].statusKey, "review");
  assert.equal(config.customItems[1].hideWhenMissing, false);
  assert.deepEqual(config.disabledSegments, []);
  assert.deepEqual(config.invalidDisabledSegments, []);
  assert.equal(config.layout, null);
  assert.deepEqual(config.invalidLayoutSegments, []);
  assert.equal(config.separator, null);
  assert.equal(config.placement, "above");
  assert.equal(config.invalidPlacement, null);
  assert.equal(config.welcome, true);
  assert.equal(config.stashSharpSShortcut, false);
});

test("parsePowerlineConfig supports disabled segments", () => {
  const config = parsePowerlineConfig(
    {
      preset: "default",
      customItems: [{ id: "ci" }],
      disabledSegments: [
        "queue",
        "cost",
        " extension_statuses ",
        "custom:ci",
        "cost",
        "unknown",
        "custom:missing",
        123,
      ],
    },
    ["default", "compact"],
  );

  assert.deepEqual(config.disabledSegments, ["queue", "cost", "extension_statuses", "custom:ci"]);
  assert.deepEqual(config.invalidDisabledSegments, ["unknown", "custom:missing", "123"]);
});

test("parsePowerlineConfig supports partial explicit layout rows", () => {
  const config = parsePowerlineConfig(
    {
      preset: "default",
      customItems: [{ id: "ci" }],
      layout: {
        left: ["model", "custom:ci", "model", "unknown", 123],
        right: ["model", "cost"],
        secondary: [],
      },
    },
    ["default", "compact"],
  );

  assert.deepEqual(config.layout, {
    left: ["model", "custom:ci"],
    right: ["cost"],
    secondary: [],
  });
  assert.deepEqual(config.invalidLayoutSegments, ["left:unknown", "left:123", "right:model"]);
});

test("parsePowerlineConfig preserves reporter layout groups", () => {
  const config = parsePowerlineConfig(
    {
      preset: "default",
      layout: {
        left: ["model"],
        right: ["path"],
        secondary: ["thinking"],
      },
    },
    ["default", "compact"],
  );

  assert.deepEqual(config.layout, {
    left: ["model"],
    right: ["path"],
    secondary: ["thinking"],
  });
  assert.deepEqual(config.invalidLayoutSegments, []);
  assert.deepEqual(
    mergeSegmentsWithCustomItems(PRESETS.default, config.customItems, {
      layout: config.layout,
      disabledSegments: config.disabledSegments,
    }),
    {
      leftSegments: ["model"],
      rightSegments: ["path"],
      secondarySegments: ["thinking"],
    },
  );
});

test("parsePowerlineConfig supports separator overrides", () => {
  const config = parsePowerlineConfig(
    { preset: "default", separator: " chevron " },
    ["default", "compact"],
  );
  const invalid = parsePowerlineConfig(
    { preset: "default", separator: "sparkle" },
    ["default", "compact"],
  );

  assert.equal(config.separator, "chevron");
  assert.equal(invalid.separator, null);
});

test("configured separators resolve independently of presets", () => {
  const presetSeparator = getSeparator(PRESETS.default.separator).left;
  const configuredSeparator = getSeparator("chevron").left;

  assert.notEqual(configuredSeparator, presetSeparator);
  assert.equal(configuredSeparator, "›");
});

test("parsePowerlineConfig validates primary powerline placement", () => {
  const below = parsePowerlineConfig(
    { preset: "compact", placement: "below" },
    ["default", "compact"],
  );
  const invalid = parsePowerlineConfig(
    { preset: "compact", placement: "sideways" },
    ["default", "compact"],
  );

  assert.equal(below.placement, "below");
  assert.equal(below.invalidPlacement, null);
  assert.equal(invalid.placement, "above");
  assert.equal(invalid.invalidPlacement, "sideways");
});




test("parsePowerlineConfig supports welcome and legacy sharp-S settings", () => {
  const config = parsePowerlineConfig(
    { preset: "compact", welcome: false, stashSharpSShortcut: true },
    ["default", "compact"],
  );
  const shorthand = parsePowerlineConfig("compact", ["default", "compact"]);

  assert.equal(config.welcome, false);
  assert.equal(config.stashSharpSShortcut, true);
  assert.equal(shorthand.welcome, true);
  assert.equal(shorthand.stashSharpSShortcut, false);
});
test("parsePowerlineConfig extracts supported segment options", () => {
  const config = parsePowerlineConfig(
    {
      preset: "default",
      model: { showThinkingLevel: true, display: "qualified" },
      path: { mode: "full", maxLength: 120 },
      git: { showBranch: false, showStaged: false, showUnstaged: true, showUntracked: false, polling: "branch", hostIcon: true },
      time: { format: "12h", showSeconds: true },
      cost: { subscriptionDisplay: "both", currency: "cny" },
      workingVibes: { color: "rainbow" },
    },
    ["default", "compact"],
  );
  const invalidCurrency = parsePowerlineConfig(
    { cost: { currency: "BTC" } },
    ["default", "compact"],
  );

  assert.deepEqual(config.segmentOptions, {
    model: { showThinkingLevel: true, display: "qualified" },
    path: { mode: "full", maxLength: 120 },
    git: { showBranch: false, showStaged: false, showUnstaged: true, showUntracked: false, polling: "branch", hostIcon: true },
    time: { format: "12h", showSeconds: true },
    cost: { subscriptionDisplay: "both", currency: "CNY" },
  });
  assert.deepEqual(config.workingVibes, { color: "rainbow" });
  assert.deepEqual(invalidCurrency.segmentOptions, { cost: {} });
});

test("parsePowerlineConfig accepts working-vibe theme colors and hex colors", () => {
  const semantic = parsePowerlineConfig({ workingVibes: { color: "warning" } }, ["default"]);
  const hex = parsePowerlineConfig({ workingVibes: { color: "#89d281" } }, ["default"]);

  assert.deepEqual(semantic.workingVibes, { color: "warning" });
  assert.deepEqual(hex.workingVibes, { color: "#89d281" });
});

test("mergeSegmentOptions lets user config override preset segment defaults", () => {
  assert.deepEqual(
    mergeSegmentOptions(
      { path: { mode: "basename", maxLength: 20 }, git: { showBranch: true, showUntracked: true } },
      { path: { mode: "full" }, git: { showUntracked: false }, cost: { subscriptionDisplay: "reported-cost" } },
    ),
    {
      model: {},
      path: { mode: "full", maxLength: 20 },
      git: { showBranch: true, showUntracked: false },
      time: {},
      cost: { subscriptionDisplay: "reported-cost" },
      context: {},
      cache_read: {},
    },
  );
});

test("mergeSegmentsWithCustomItems appends custom segment ids by position", () => {
  const merged = mergeSegmentsWithCustomItems(
    {
      leftSegments: ["path"],
      rightSegments: ["git"],
      secondarySegments: ["extension_statuses"],
      separator: "powerline",
    },
    [
      { id: "ci", statusKey: "ci", position: "left", hideWhenMissing: true, excludeFromExtensionStatuses: true },
      { id: "timer", statusKey: "timer", position: "right", hideWhenMissing: true, excludeFromExtensionStatuses: true },
      { id: "review", statusKey: "review", position: "secondary", hideWhenMissing: true, excludeFromExtensionStatuses: true },
    ],
  );

  assert.deepEqual(merged.leftSegments, ["path", "custom:ci"]);
  assert.deepEqual(merged.rightSegments, ["git", "custom:timer"]);
  assert.deepEqual(merged.secondarySegments, ["extension_statuses", "custom:review"]);
});

test("mergeSegmentsWithCustomItems filters disabled segment ids", () => {
  const merged = mergeSegmentsWithCustomItems(
    {
      leftSegments: ["path", "model"],
      rightSegments: ["git", "cost"],
      secondarySegments: ["extension_statuses"],
      separator: "powerline",
    },
    [
      { id: "ci", statusKey: "ci", position: "left", hideWhenMissing: true, excludeFromExtensionStatuses: true },
      { id: "timer", statusKey: "timer", position: "right", hideWhenMissing: true, excludeFromExtensionStatuses: true },
      { id: "review", statusKey: "review", position: "secondary", hideWhenMissing: true, excludeFromExtensionStatuses: true },
    ],
    { disabledSegments: ["model", "cost", "custom:ci", "custom:review"] },
  );

  assert.deepEqual(merged.leftSegments, ["path"]);
  assert.deepEqual(merged.rightSegments, ["git", "custom:timer"]);
  assert.deepEqual(merged.secondarySegments, ["extension_statuses"]);
});

test("mergeSegmentsWithCustomItems applies partial layout rows before disabled filtering", () => {
  const merged = mergeSegmentsWithCustomItems(
    {
      leftSegments: ["path", "model"],
      rightSegments: ["git", "cost", "extension_statuses"],
      secondarySegments: ["extension_statuses"],
      separator: "powerline",
    },
    [
      { id: "ci", statusKey: "ci", position: "right", hideWhenMissing: true, excludeFromExtensionStatuses: true },
      { id: "review", statusKey: "review", position: "secondary", hideWhenMissing: true, excludeFromExtensionStatuses: true },
    ],
    {
      layout: {
        left: ["model", "custom:ci", "extension_statuses"],
        secondary: [],
      },
      disabledSegments: ["model"],
    },
  );

  assert.deepEqual(merged.leftSegments, ["custom:ci", "extension_statuses"]);
  assert.deepEqual(merged.rightSegments, ["git", "cost"]);
  assert.deepEqual(merged.secondarySegments, []);
});

test("nextPowerlineSettingWithPreset preserves object settings", () => {
  const updated = nextPowerlineSettingWithPreset({ preset: "default", customItems: [{ id: "ci" }] }, "compact");
  if (typeof updated !== "object" || updated === null || Array.isArray(updated)) {
    assert.fail("expected an object powerline setting");
  }
  if (!("preset" in updated)) {
    assert.fail("expected preset to be preserved on the updated powerline setting");
  }
  if (!("customItems" in updated)) {
    assert.fail("expected customItems to be preserved on the updated powerline setting");
  }

  assert.equal(updated.preset, "compact");
  assert.deepEqual(updated.customItems, [{ id: "ci" }]);
});

test("nextPowerlineSettingWithOptions preserves object settings", () => {
  const updated = nextPowerlineSettingWithOptions(
    { preset: "default", customItems: [{ id: "ci" }] },
    { placement: "below" },
    "compact",
  );

  assert.deepEqual(updated, { preset: "default", customItems: [{ id: "ci" }], placement: "below" });
});

test("nextPowerlineSettingWithOptions converts string presets to object settings", () => {
  assert.deepEqual(nextPowerlineSettingWithOptions("compact", { placement: "below" }, "compact"), {
    preset: "compact",
    placement: "below",
  });
});

test("collectHiddenExtensionStatusKeys includes default custom status keys", () => {
  const hidden = collectHiddenExtensionStatusKeys([
    { id: "ci", statusKey: "ci-status", position: "right", hideWhenMissing: true, excludeFromExtensionStatuses: true },
    { id: "review", statusKey: "review", position: "secondary", hideWhenMissing: true, excludeFromExtensionStatuses: false },
  ]);

  assert.equal(hidden.has("ci-status"), true);
  assert.equal(hidden.has("review"), false);
});

test("normalizeCompactExtensionStatus strips baked-in trailing separators", () => {
  assert.equal(normalizeCompactExtensionStatus("CI ok · "), "CI ok");
  assert.equal(normalizeCompactExtensionStatus("CI ok |   "), "CI ok");
  assert.equal(normalizeCompactExtensionStatus("[notice] queued"), null);
});

test("normalizeExtensionStatusValue keeps notification-style statuses renderable for custom items", () => {
  assert.equal(normalizeExtensionStatusValue("[review] queued · "), "[review] queued");
});

test("getNotificationExtensionStatuses skips promoted hidden status keys", () => {
  const statuses = new Map<string, string>([
    ["ci-status", "[ci] queued"],
    ["review", "[review] running"],
    ["plain", "plain status"],
  ]);
  const hidden = new Set(["ci-status"]);

  assert.deepEqual(getNotificationExtensionStatuses(statuses, hidden), ["[review] running"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { collectHiddenExtensionStatusKeys, getNotificationExtensionStatuses, normalizeExtensionStatusValue, parsePowerlineConfig, mergeSegmentsWithCustomItems, nextPowerlineSettingWithOptions, nextPowerlineSettingWithPreset, normalizeCompactExtensionStatus } from "../powerline-config.ts";

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
  assert.equal(config.mouseScroll, true);
  assert.equal(config.fixedEditor, true);
});

test("parsePowerlineConfig supports disabling mouse scroll", () => {
  const config = parsePowerlineConfig(
    { preset: "compact", mouseScroll: false },
    ["default", "compact"],
  );

  assert.equal(config.preset, "compact");
  assert.equal(config.mouseScroll, false);
});

test("parsePowerlineConfig supports disabling fixed editor", () => {
  const config = parsePowerlineConfig(
    { preset: "compact", fixedEditor: false },
    ["default", "compact"],
  );

  assert.equal(config.preset, "compact");
  assert.equal(config.fixedEditor, false);
});

test("parsePowerlineConfig supports below placement with bottom alias", () => {
  const config = parsePowerlineConfig(
    { preset: "compact", placement: "bottom" },
    ["default", "compact"],
  );

  assert.equal(config.preset, "compact");
  assert.equal(config.placement, "below");
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
    { preset: "default", customItems: [{ id: "ci" }], mouseScroll: false },
    { fixedEditor: false, placement: "below" },
    "compact",
  );
  if (typeof updated !== "object" || updated === null || Array.isArray(updated)) {
    assert.fail("expected an object powerline setting");
  }
  if (!("preset" in updated && "fixedEditor" in updated && "mouseScroll" in updated && "placement" in updated && "customItems" in updated)) {
    assert.fail("expected all existing object settings to be preserved");
  }

  assert.equal(updated.preset, "default");
  assert.equal(updated.fixedEditor, false);
  assert.equal(updated.mouseScroll, false);
  assert.equal(updated.placement, "below");
  assert.deepEqual(updated.customItems, [{ id: "ci" }]);
});

test("nextPowerlineSettingWithOptions converts string presets to object settings", () => {
  assert.deepEqual(nextPowerlineSettingWithOptions("compact", { mouseScroll: true }, "compact"), {
    preset: "compact",
    mouseScroll: true,
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

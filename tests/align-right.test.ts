import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parsePowerlineConfig } from "../powerline-config.ts";
import { computeRightAlignedLayout } from "../index.ts";
import type { StatusLineSegmentId } from "../types.ts";

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

function segment(id: StatusLineSegmentId, content: string): { id: StatusLineSegmentId; content: string; width: number } {
  return { id, content, width: visibleWidth(content) };
}

// Config parsing

test("parsePowerlineConfig defaults alignRight to an empty list", () => {
  assert.deepEqual(parsePowerlineConfig({}, ["default"]).alignRight, []);
  assert.deepEqual(parsePowerlineConfig("compact", ["default", "compact"]).alignRight, []);
});

test("parsePowerlineConfig keeps valid built-in alignRight segment ids", () => {
  const config = parsePowerlineConfig({ alignRight: ["time", "context_pct"] }, ["default"]);
  assert.deepEqual(config.alignRight, ["time", "context_pct"]);
});

test("parsePowerlineConfig filters unknown, custom, and non-string alignRight entries", () => {
  const config = parsePowerlineConfig(
    {
      alignRight: ["time", "custom:ci", "nope", 42, null],
      customItems: [{ id: "ci" }],
    },
    ["default"],
  );
  assert.deepEqual(config.alignRight, ["time"]);
});

// Right-aligned layout

test("computeRightAlignedLayout pins configured segments to the right edge", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "m"), segment("path", "~/p"), segment("time", "12:00")],
    "pipe",
    40,
    { alignRight: ["time"], padding: 1, secondaryOverflow: "drop" },
  );

  assert.ok(layout);
  assert.equal(stripAnsi(layout.topContent), ` m | ~/p${" ".repeat(26)}12:00 `);
  assert.equal(visibleWidth(layout.topContent), 40);
  assert.deepEqual(layout.secondaryLines, []);
});

test("computeRightAlignedLayout keeps pinned segment order and joins them with the separator", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "m"), segment("time", "12:00"), segment("cost", "5c")],
    "pipe",
    20,
    { alignRight: ["cost", "time"], padding: 1, secondaryOverflow: "drop" },
  );

  assert.ok(layout);
  assert.equal(stripAnsi(layout.topContent), ` m${" ".repeat(7)}12:00 | 5c `);
  assert.equal(visibleWidth(layout.topContent), 20);
});

test("computeRightAlignedLayout returns null without configured segments", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "m"), segment("time", "12:00")],
    "pipe",
    40,
    { alignRight: [], padding: 1, secondaryOverflow: "drop" },
  );
  assert.equal(layout, null);
});

test("computeRightAlignedLayout falls back when no pinned segment is rendered", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "m"), segment("time", "12:00")],
    "pipe",
    40,
    { alignRight: ["cost"], padding: 1, secondaryOverflow: "drop" },
  );
  assert.equal(layout, null);
});

test("computeRightAlignedLayout still pins rendered segments when some configured ones are hidden", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "m"), segment("time", "12:00")],
    "pipe",
    40,
    { alignRight: ["time", "cost"], padding: 1, secondaryOverflow: "drop" },
  );

  assert.ok(layout);
  assert.equal(stripAnsi(layout.topContent), ` m${" ".repeat(32)}12:00 `);
});

test("computeRightAlignedLayout falls back when pinned segments do not fit", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "m"), segment("time", "12:00")],
    "pipe",
    6,
    { alignRight: ["time"], padding: 1, secondaryOverflow: "drop" },
  );
  assert.equal(layout, null);
});

test("computeRightAlignedLayout overflows flow segments to the secondary row and drops the rest", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "mmm"), segment("path", "pppppppppp"), segment("git", "gggggg"), segment("time", "12:00")],
    "pipe",
    14,
    { alignRight: ["time"], padding: 1, secondaryOverflow: "drop" },
  );

  assert.ok(layout);
  assert.equal(stripAnsi(layout.topContent), ` mmm${" ".repeat(4)}12:00 `);
  assert.equal(visibleWidth(layout.topContent), 14);
  assert.deepEqual(layout.secondaryLines.map(stripAnsi), [" pppppppppp "]);
});

test("computeRightAlignedLayout wraps secondary overflow onto extra rows", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "mmm"), segment("path", "pppppppppp"), segment("git", "gggggg"), segment("time", "12:00")],
    "pipe",
    14,
    { alignRight: ["time"], padding: 1, secondaryOverflow: "wrap" },
  );

  assert.ok(layout);
  assert.deepEqual(layout.secondaryLines.map(stripAnsi), [" pppppppppp ", " gggggg "]);
});

test("computeRightAlignedLayout respects padding 0 with flush edges", () => {
  const layout = computeRightAlignedLayout(
    [segment("model", "m"), segment("time", "12:00")],
    "pipe",
    8,
    { alignRight: ["time"], padding: 0, secondaryOverflow: "drop" },
  );

  assert.ok(layout);
  assert.equal(stripAnsi(layout.topContent), "m  12:00");
  assert.equal(visibleWidth(layout.topContent), 8);
});

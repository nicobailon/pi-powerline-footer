import test from "node:test";
import assert from "node:assert/strict";
import { resolveThinkingLevelSelection } from "../thinking-level.ts";

test("thinking-level selection prefers the live event over stale context", () => {
  assert.equal(resolveThinkingLevelSelection("medium", "off"), "medium");
  assert.equal(resolveThinkingLevelSelection("high", "low"), "high");
});

test("thinking-level selection falls back to context when the event has no level", () => {
  assert.equal(resolveThinkingLevelSelection(undefined, "low"), "low");
  assert.equal(resolveThinkingLevelSelection(undefined, undefined), null);
});

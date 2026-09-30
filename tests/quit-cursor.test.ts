import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowStartupWelcome, isStaleExtensionContextError } from "../lifecycle.ts";

test("startup welcome only shows on terminal startup when enabled", () => {
  assert.equal(shouldShowStartupWelcome("startup", true, "tui"), true);
  assert.equal(shouldShowStartupWelcome("reload", true, "tui"), false);
  assert.equal(shouldShowStartupWelcome("startup", false, "tui"), false);
  assert.equal(shouldShowStartupWelcome("startup", true, "rpc"), false);
});

test("stale extension context errors are recognized", () => {
  assert.equal(isStaleExtensionContextError(new Error("This extension instance is stale")), true);
  assert.equal(isStaleExtensionContextError(new Error("other")), false);
});

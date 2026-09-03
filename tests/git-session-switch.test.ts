import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

// Guards the fix for stale git footer info after a session switch lands in a
// different repo. `/cd` (switchSession -> reason "resume"), `/fork`, `/clone`
// (`reason "fork"`), `/new` (`reason "new"`), and `/resume` (`reason "resume"`)
// can all change cwd. The git segment caches branch/status at module scope with
// a TTL, so without invalidation the footer keeps showing the previous repo's
// data until the TTL expires or the next file/git tool_result fires.
test("session_start invalidates git cache when switching into a potentially different repo", () => {
  // The session_start handler must invalidate both branch and status caches.
  assert.match(indexSource, /invalidateGitBranch\(\)/);
  assert.match(indexSource, /invalidateGitStatus\(\)/);

  // Invalidation must be gated on session-switch reasons, not startup/reload
  // (startup would wrongly report the launch directory as a change).
  assert.match(indexSource, /event\.reason === "fork" \|\| event\.reason === "resume" \|\| event\.reason === "new"/);
});

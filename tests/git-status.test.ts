import test from "node:test";
import assert from "node:assert/strict";
import { getCurrentBranch, getGitStatus, invalidateGitBranch, invalidateGitStatus } from "../git-status.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Background fetches spawn git with up to 500ms timeouts; give them room.
const FETCH_SETTLE_MS = 1200;

test("git status supports disabling extension git polling", () => {
  assert.deepEqual(getGitStatus("main", "off"), {
    branch: "main",
    staged: 0,
    unstaged: 0,
    untracked: 0,
  });
});

test("invalidateGitStatus serves stale counts while refreshing (no flicker to zeros)", async () => {
  getGitStatus("provider-branch"); // kick off the initial background fetch
  await sleep(FETCH_SETTLE_MS);

  const seeded = getGitStatus("provider-branch");

  invalidateGitStatus();
  const afterInvalidate = getGitStatus("provider-branch");
  assert.deepEqual(afterInvalidate, seeded);

  // The background refresh converges to real data again (repo is unchanged).
  await sleep(FETCH_SETTLE_MS);
  assert.deepEqual(getGitStatus("provider-branch"), seeded);
});

test("invalidateGitBranch keeps serving the last known branch while refreshing", async () => {
  getGitStatus("provider-fallback"); // seed branch cache
  await sleep(FETCH_SETTLE_MS);

  const realBranch = getCurrentBranch("provider-fallback");
  // Once fetched, the cached branch no longer falls back to the provider
  // (null in non-git directories, the actual branch name inside a repo).
  assert.notEqual(realBranch, "provider-fallback");

  invalidateGitBranch();
  assert.equal(getCurrentBranch("provider-fallback"), realBranch);
});

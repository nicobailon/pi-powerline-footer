import test from "node:test";
import assert from "node:assert/strict";
import { detectGitHost, getCurrentBranch, getGitStatus, invalidateGitBranch, invalidateGitStatus } from "../git-status.ts";

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

test("detectGitHost recognizes known hosts over SSH and HTTPS", () => {
  assert.equal(detectGitHost("git@github.com:owner/repo.git"), "github");
  assert.equal(detectGitHost("https://github.com/owner/repo.git"), "github");
  assert.equal(detectGitHost("ssh://git@gitlab.com/owner/repo.git"), "gitlab");
  assert.equal(detectGitHost("https://gitlab.com/owner/repo"), "gitlab");
  assert.equal(detectGitHost("git@bitbucket.org:owner/repo.git"), "bitbucket");
  assert.equal(detectGitHost("https://user@bitbucket.org/owner/repo.git"), "bitbucket");
});

test("detectGitHost normalizes www and sub-domains", () => {
  assert.equal(detectGitHost("https://www.github.com/owner/repo"), "github");
  assert.equal(detectGitHost("git@ssh.github.com:owner/repo.git"), "github");
});

test("detectGitHost treats unknown or self-hosted remotes as a generic host", () => {
  assert.equal(detectGitHost("git@git.example.com:owner/repo.git"), "other");
  assert.equal(detectGitHost("https://gitea.mycorp.dev/owner/repo.git"), "other");
  assert.equal(detectGitHost("/srv/git/local.git"), "other");
});

test("detectGitHost returns null when there is no remote", () => {
  assert.equal(detectGitHost(null), null);
  assert.equal(detectGitHost(""), null);
  assert.equal(detectGitHost("   "), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGitHost, getCurrentBranch, getGitRemoteHost, getGitStatus, invalidateGitBranch, invalidateGitStatus, subscribeGitUpdates, waitForGitUpdates } from "../git-status.ts";

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "powerline-git-status-"));
  t.after(async () => {
    await waitForGitUpdates();
    rmSync(root, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const repo = (name: string, host: string) => {
    const cwd = join(root, name);
    mkdirSync(cwd);
    git(cwd, "init", "-q", "-b", name);
    git(cwd, "remote", "add", "origin", `https://${host}/owner/repo`);
    return cwd;
  };
  return { root, git, repo };
}

test("status refresh preserves dirty coloring data until new counts arrive", async (t) => {
  const { repo, git } = fixture(t);
  const cwd = repo("main", "github.com");
  let updates = 0;
  t.after(subscribeGitUpdates(() => { updates += 1; }));
  writeFileSync(join(cwd, "tracked"), "first");
  git(cwd, "add", "tracked");
  getGitStatus("main", "full", cwd);
  await waitForGitUpdates();
  assert.ok(updates > 0);
  assert.deepEqual(getGitStatus("main", "full", cwd), { branch: "main", staged: 1, unstaged: 0, untracked: 0 });
  writeFileSync(join(cwd, "tracked"), "second");
  writeFileSync(join(cwd, "new"), "new");
  invalidateGitStatus();
  assert.equal(getGitStatus("main", "full", cwd).staged, 1);
  await waitForGitUpdates();
  assert.deepEqual(getGitStatus("main", "full", cwd), { branch: "main", staged: 1, unstaged: 1, untracked: 1 });
  assert.deepEqual(getGitStatus("main", "branch", cwd), { branch: "main", staged: 0, unstaged: 0, untracked: 0 });
});

test("fallback branch refresh serves stale only within the same cwd", async (t) => {
  const { repo, git } = fixture(t);
  const cwd = repo("main", "github.com");
  getCurrentBranch(null, cwd);
  await waitForGitUpdates();
  assert.equal(getCurrentBranch(null, cwd), "main");
  git(cwd, "symbolic-ref", "HEAD", "refs/heads/feature");
  invalidateGitBranch();
  assert.equal(getCurrentBranch(null, cwd), "main");
  await waitForGitUpdates();
  assert.equal(getCurrentBranch(null, cwd), "feature");
  assert.equal(getCurrentBranch("external", cwd), "external");
  assert.equal(getCurrentBranch("main", cwd), "main");
});

test("cwd changes clear displayed status, branch and host, including in-flight reads", async (t) => {
  const { repo, root } = fixture(t);
  const a = repo("alpha", "github.com");
  const b = repo("beta", "gitlab.com");
  writeFileSync(join(a, "dirty"), "dirty");
  getGitStatus(null, "full", a);
  getGitRemoteHost(a);
  await waitForGitUpdates();
  assert.equal(getGitStatus(null, "full", a).untracked, 1);
  assert.equal(getGitRemoteHost(a), "github");
  invalidateGitBranch();
  invalidateGitStatus();
  getGitStatus(null, "full", a);
  getGitRemoteHost(a);
  const oldReads = waitForGitUpdates();
  assert.deepEqual(getGitStatus(null, "off", b), { branch: null, staged: 0, unstaged: 0, untracked: 0 });
  await oldReads;
  assert.deepEqual(getGitStatus(null, "full", b), { branch: null, staged: 0, unstaged: 0, untracked: 0 });
  assert.equal(getGitRemoteHost(b), null);
  await waitForGitUpdates();
  assert.deepEqual(getGitStatus(null, "full", b), { branch: "beta", staged: 0, unstaged: 0, untracked: 0 });
  assert.equal(getGitRemoteHost(b), "gitlab");
  assert.deepEqual(getGitStatus(null, "full", root), { branch: null, staged: 0, unstaged: 0, untracked: 0 });
  getGitRemoteHost(root);
  await waitForGitUpdates();
  assert.equal(getGitRemoteHost(root), null);
  assert.deepEqual(getGitStatus(null, "full", root), { branch: null, staged: 0, unstaged: 0, untracked: 0 });
});

test("attached, detached and worktree branch displays follow repository transitions", async (t) => {
  const { repo, git, root } = fixture(t);
  const cwd = repo("main", "github.com");
  writeFileSync(join(cwd, "tracked"), "original");
  git(cwd, "add", "tracked");
  // A fixture-only commit supplies a real detached HEAD and linked worktree.
  git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "fixture");
  const sha = git(cwd, "rev-parse", "--short", "HEAD");
  assert.equal(getCurrentBranch("main", cwd), "main");
  git(cwd, "checkout", "-q", "--detach");
  assert.equal(getCurrentBranch("detached", cwd), "detached");
  await waitForGitUpdates();
  assert.equal(getCurrentBranch("detached", cwd), `${sha} (detached)`);
  git(cwd, "checkout", "-q", "main");
  assert.equal(getCurrentBranch("main", cwd), "main");
  const worktree = join(root, "linked");
  git(cwd, "worktree", "add", "-qb", "feature", worktree);
  assert.equal(getCurrentBranch(null, worktree), null);
  await waitForGitUpdates();
  assert.equal(getCurrentBranch(null, worktree), "feature");
  writeFileSync(join(worktree, "tracked"), "modified");
  writeFileSync(join(worktree, "dirty"), "dirty");
  getGitStatus("feature", "full", worktree);
  await waitForGitUpdates();
  assert.deepEqual(getGitStatus("feature", "full", worktree), { branch: "feature", staged: 0, unstaged: 1, untracked: 1 });
  assert.deepEqual(getGitStatus("main", "off", cwd), { branch: "main", staged: 0, unstaged: 0, untracked: 0 });
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

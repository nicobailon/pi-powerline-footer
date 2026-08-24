import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readOnlyGitEnv } from "../git-status.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const gitStatusSource = readFileSync(new URL("../git-status.ts", import.meta.url), "utf-8");
const completionSource = readFileSync(new URL("../bash-mode/completion.ts", import.meta.url), "utf-8");

// Background fetches spawn git with up to 500ms timeouts; give them room.
const FETCH_SETTLE_MS = 1200;

test("read-only git commands opt out of git's optional index lock", () => {
  const env = readOnlyGitEnv({ PATH: "/usr/bin" });
  assert.equal(env.GIT_OPTIONAL_LOCKS, "0");
  assert.equal(env.PATH, "/usr/bin", "must extend the ambient environment, not replace it");
});

test("readOnlyGitEnv overrides an inherited GIT_OPTIONAL_LOCKS=1", () => {
  assert.equal(readOnlyGitEnv({ GIT_OPTIONAL_LOCKS: "1" }).GIT_OPTIONAL_LOCKS, "0");
});

test("footer git polling hides Windows child consoles while preserving read-only env", () => {
  assert.match(
    gitStatusSource,
    /spawn\("git", args, \{\s*stdio: \["ignore", "pipe", "pipe"\],\s*env: readOnlyGitEnv\(\),\s*windowsHide: true,\s*\}\)/s,
  );
});

test("bash git completions hide Windows child consoles", () => {
  assert.match(
    completionSource,
    /execFile\("git", args, \{ cwd, encoding: "utf8", signal, windowsHide: true \}/,
  );
});

// Guards the regression end to end, via a `git` shim on PATH: the footer polls
// every repo the user visits, so it must never take `.git/index.lock`.
test("the git process the footer spawns receives GIT_OPTIONAL_LOCKS=0", { skip: process.platform === "win32" ? "POSIX shim" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "powerline-git-locks-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");

  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\necho "GIT_OPTIONAL_LOCKS=\${GIT_OPTIONAL_LOCKS-unset} ARGS=$*" >> ${JSON.stringify(log)}\nexit 0\n`,
    { mode: 0o755 },
  );

  const originalPath = process.env.PATH;
  const originalOptionalLocks = process.env.GIT_OPTIONAL_LOCKS;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  // Some environments export GIT_OPTIONAL_LOCKS=0 as a machine-wide workaround
  // for this bug; force the opposite so we can't inherit a false pass.
  process.env.GIT_OPTIONAL_LOCKS = "1";
  try {
    // Imported here so the module reads the shimmed PATH when it spawns.
    const { getGitStatus, invalidateGitStatus, invalidateGitBranch } = await import("../git-status.ts");
    invalidateGitStatus();
    invalidateGitBranch();
    getGitStatus("main");
    await sleep(FETCH_SETTLE_MS);
  } finally {
    process.env.PATH = originalPath;
    if (originalOptionalLocks === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
    else process.env.GIT_OPTIONAL_LOCKS = originalOptionalLocks;
  }

  assert.ok(existsSync(log), "expected the footer to spawn git");
  const calls = readFileSync(log, "utf8").trim().split("\n");
  const status = calls.filter((line) => line.includes("ARGS=status --porcelain"));
  assert.ok(status.length > 0, `expected a status call, got:\n${calls.join("\n")}`);
  for (const call of calls) {
    assert.match(call, /GIT_OPTIONAL_LOCKS=0/, `git spawned without the lock opt-out: ${call}`);
  }
});

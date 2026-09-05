import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

import { getGitStatus, invalidateGitStatus, readOnlyGitEnv, waitForGitUpdates } from "../git-status.ts";
const completionSource = readFileSync(new URL("../bash-mode/completion.ts", import.meta.url), "utf-8");

test("read-only git commands opt out of git's optional index lock", () => {
  const env = readOnlyGitEnv({ PATH: "/usr/bin" });
  assert.equal(env.GIT_OPTIONAL_LOCKS, "0");
  assert.equal(env.PATH, "/usr/bin", "must extend the ambient environment, not replace it");
});

test("readOnlyGitEnv overrides an inherited GIT_OPTIONAL_LOCKS=1", () => {
  assert.equal(readOnlyGitEnv({ GIT_OPTIONAL_LOCKS: "1" }).GIT_OPTIONAL_LOCKS, "0");
});

test("footer git polling hides Windows child consoles while preserving read-only env", async (t) => {
  const spawn = childProcess.spawn;
  const calls: Parameters<typeof spawn>[] = [];
  t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    calls.push(args);
    return spawn(...args);
  });
  syncBuiltinESMExports();
  try {
    invalidateGitStatus();
    getGitStatus("main");
    await waitForGitUpdates();
    assert.ok(calls.length > 0);
    for (const [, , options] of calls) {
      assert.equal(options?.windowsHide, true);
      assert.equal(options?.env?.GIT_OPTIONAL_LOCKS, "0");
    }
    t.diagnostic(`Attached full-mode process boundary: ${calls.map(([, args]) => args?.join(" ")).join(", ")}`);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
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
    invalidateGitStatus();
    getGitStatus("main");
    await waitForGitUpdates();
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

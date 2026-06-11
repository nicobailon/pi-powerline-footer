import test from "node:test";
import assert from "node:assert/strict";
import { getGitStatus } from "../git-status.ts";

test("git status supports disabling extension git polling", () => {
  assert.deepEqual(getGitStatus("main", "off"), {
    branch: "main",
    staged: 0,
    unstaged: 0,
    untracked: 0,
  });
});

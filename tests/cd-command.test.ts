import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getCdArgumentCompletions, resolveCdTarget, runCdCommand } from "../cd-command.ts";

const cdCommandSource = readFileSync(new URL("../cd-command.ts", import.meta.url), "utf-8");
const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

test("resolveCdTarget supports current, relative, home, and invalid directories", () => {
  const root = mkdtempSync(join(tmpdir(), "powerline-cd-root-"));
  const home = mkdtempSync(join(tmpdir(), "powerline-cd-home-"));
  const child = join(root, "child");
  const homeProject = join(home, "project");
  mkdirSync(child);
  mkdirSync(homeProject);
  writeFileSync(join(root, "file.txt"), "not a directory");

  assert.equal(resolveCdTarget("", root, home), null);
  assert.deepEqual(resolveCdTarget("child", root, home), { path: child });
  assert.deepEqual(resolveCdTarget("~/project", root, home), { path: homeProject });
  assert.deepEqual(resolveCdTarget("My\\ Folder", root, home), { error: `Directory does not exist: ${join(root, "My Folder")}` });
  assert.match(resolveCdTarget("missing", root, home)?.error ?? "", /Directory does not exist:/);
  assert.match(resolveCdTarget("file.txt", root, home)?.error ?? "", /Not a directory:/);
});

test("cd argument completions suggest directories and quick picks", () => {
  const root = mkdtempSync(join(tmpdir(), "powerline-cd-complete-root-"));
  const home = mkdtempSync(join(tmpdir(), "powerline-cd-complete-home-"));
  mkdirSync(join(root, "child"));
  mkdirSync(join(root, "My Folder"));
  writeFileSync(join(root, "file.txt"), "not a directory");
  mkdirSync(join(home, "project"));

  const rootCompletions = getCdArgumentCompletions("", root, home);
  assert.ok(rootCompletions.some((item) => item.value === "../" && item.label === "../"));
  assert.ok(rootCompletions.some((item) => item.value === "~/" && item.label === "~/"));
  assert.ok(rootCompletions.some((item) => item.value === "child/" && item.label === "child/"));
  assert.ok(rootCompletions.some((item) => item.value === "My\\ Folder/" && item.label === "My Folder/"));
  assert.ok(!rootCompletions.some((item) => item.label === "file.txt"));

  assert.deepEqual(
    getCdArgumentCompletions("~/p", root, home).map((item) => item.value),
    ["~/project/"],
  );
});

test("cd command cleans up the forked session when switching is cancelled", async () => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "powerline-cd-command-root-"));
  const target = join(root, "target");
  const sessionDir = join(root, "sessions");
  mkdirSync(target);

  const session = SessionManager.create(root, sessionDir);
  session.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  session.appendMessage({ role: "assistant", content: "hi", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

  let switchedPath: string | undefined;
  const notifications: Array<{ message: string; type?: string }> = [];
  const ctx = {
    cwd: root,
    sessionManager: {
      getSessionFile: () => session.getSessionFile(),
    },
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
    },
    waitForIdle: async () => {},
    switchSession: async (path: string) => {
      switchedPath = path;
      return { cancelled: true };
    },
  } as any;

  try {
    await runCdCommand("target", ctx);
  } finally {
    process.chdir(originalCwd);
  }

  assert.equal(process.cwd(), originalCwd);
  assert.ok(switchedPath, "switchSession should receive the forked session path");
  assert.equal(existsSync(switchedPath!), false);
  assert.deepEqual(notifications.at(-1), { message: "Directory change cancelled", type: "warning" });
});

test("cd command preserves the target session after a post-apply switch error", async () => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "powerline-cd-post-apply-root-"));
  const target = join(root, "target");
  const sessionDir = join(root, "sessions");
  mkdirSync(target);

  const session = SessionManager.create(root, sessionDir);
  session.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  session.appendMessage({ role: "assistant", content: "hi", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

  let switchedPath: string | undefined;
  const ctx = {
    cwd: root,
    sessionManager: {
      getSessionFile: () => session.getSessionFile(),
    },
    ui: {
      notify() {},
    },
    waitForIdle: async () => {},
    switchSession: async (path: string, options: { withSession?: (ctx: any) => Promise<void> }) => {
      switchedPath = path;
      await options.withSession?.({
        cwd: target,
        ui: {
          notify() {},
          setTitle() {},
        },
      });
      throw new Error("post-apply failure");
    },
  } as any;

  try {
    await runCdCommand("target", ctx);
    assert.equal(realpathSync(process.cwd()), realpathSync(target));
    assert.ok(switchedPath, "switchSession should receive the forked session path");
    assert.equal(existsSync(switchedPath!), true);
  } finally {
    process.chdir(originalCwd);
  }
});

test("cd command uses session replacement instead of private cwd mutation", () => {
  assert.match(indexSource, /registerCdCommand\(pi, \(\) => currentCtx\?\.cwd \?\? process\.cwd\(\)\)/);
  assert.match(cdCommandSource, /SessionManager\.forkFrom\(sessionFile, resolved\.path\)/);
  assert.match(cdCommandSource, /ctx\.switchSession\(nextSessionFile!/);
  assert.match(cdCommandSource, /process\.chdir\(nextCtx\.cwd\)/);
  assert.doesNotMatch(cdCommandSource, /ctx\.cwd\s*=/);
});

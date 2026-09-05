import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PowerlineQueueStore, currentQueueContext, formatQueueDeliveryText, parseCompactQueuedPrompt } from "../queue/store.ts";

function withStore(fn: (store: PowerlineQueueStore, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "powerline-queue-"));
  try {
    fn(new PowerlineQueueStore(join(dir, "inbox.jsonl"), join(dir, "projects.json")), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("queue store summarizes queued and blocked prompts", () => withStore((store) => {
  const cwd = "/tmp/project-a";
  store.add({ text: "run after compact", source: { cwd, sessionId: "s1" }, target: { kind: "current-session" }, intent: "post-compact", now: 100 });
  const blocked = store.add({ text: "retry me", source: { cwd, sessionId: "s1" }, target: { kind: "project", cwd }, intent: "follow-up", now: 101 });
  store.update(blocked.id, { status: "blocked" });

  assert.deepEqual(store.summarize(currentQueueContext(cwd, "s1"), true), {
    queueCount: 2,
    blockedCount: 1,
    compacting: true,
    leadingText: "retry me",
    leadingIntent: "follow-up",
    leadingStatus: "blocked",
  });
}));

test("current-session targets stay scoped to the source session when known", () => withStore((store) => {
  store.add({ text: "session only", source: { cwd: "/tmp/project", sessionId: "s1" }, target: { kind: "current-session" }, intent: "post-compact" });
  assert.equal(store.activeItems(currentQueueContext("/tmp/project", "s1")).length, 1);
  assert.equal(store.activeItems(currentQueueContext("/tmp/project", "s2")).length, 0);
}));

test("queue delivery returns the prompt text", () => {
  assert.equal(formatQueueDeliveryText({
    id: "a1b2c3d4", text: "check logs", createdAt: 1000, updatedAt: 1000,
    source: { cwd: "/tmp/project" }, target: { kind: "current-session" }, intent: "follow-up", status: "queued",
  }), "check logs");
});

test("parseCompactQueuedPrompt treats /compact suffix as queued prompt text", () => {
  assert.equal(parseCompactQueuedPrompt("/compact great lets proceed"), "great lets proceed");
  assert.equal(parseCompactQueuedPrompt("  /compact   great lets proceed  "), "great lets proceed");
  assert.equal(parseCompactQueuedPrompt("/compact"), null);
  assert.equal(parseCompactQueuedPrompt("/compactness great lets proceed"), null);
});

test("queue store clears items from active summary", () => withStore((store) => {
  const item = store.add({ text: "queued prompt", source: { cwd: "/tmp/project" }, target: { kind: "current-session" }, intent: "post-compact" });
  assert.equal(store.summarize(currentQueueContext("/tmp/project"), false).queueCount, 1);
  store.clear(item.id);
  assert.equal(store.summarize(currentQueueContext("/tmp/project"), false).queueCount, 0);
}));

test("summaries follow external edits and replacement without losing writes or exposing cached items", () => withStore((store, dir) => {
  const path = join(dir, "inbox.jsonl");
  const context = currentQueueContext(dir);
  const input = { source: { cwd: dir }, target: { kind: "global" } as const, intent: "follow-up" as const };
  const first = store.add({ ...input, text: "first", now: 100 });
  assert.equal(store.summarize(context, false).leadingText, "first");

  // Same-sized in-place edit, with mtime restored: ctime must still invalidate.
  const originalStat = statSync(path);
  writeFileSync(path, readFileSync(path, "utf8").replace("first", "other"));
  utimesSync(path, originalStat.atime, originalStat.mtime);
  assert.equal(store.summarize(context, false).leadingText, "other");

  const listed = store.list();
  listed[0].text = "mutated";
  listed.length = 0;
  assert.equal(store.summarize(context, false).leadingText, "other");

  const external = new PowerlineQueueStore(path, join(dir, "projects.json"));
  const second = external.add({ ...input, text: "second", now: 101 });
  // Local read-modify-write must include the external addition, even with a warm snapshot.
  store.update(first.id, { status: "blocked" });
  assert.equal(store.summarize(context, false).queueCount, 2);
  external.update(second.id, { text: "external change" });
  store.add({ ...input, text: "third", now: 102 });
  assert.equal(store.get(second.id)?.text, "external change");

  assert.equal(store.summarize(context, false).leadingText, "other");

  const replacement = join(dir, "replacement.jsonl");
  const beforeReplacement = statSync(path);
  writeFileSync(replacement, readFileSync(path, "utf8").replace("other", "newer"));
  utimesSync(replacement, beforeReplacement.atime, beforeReplacement.mtime);
  renameSync(replacement, path);
  assert.equal(store.summarize(context, false).leadingText, "newer");
}));

test("summary snapshots recover after missing files and read errors", () => withStore((store, dir) => {
  const path = join(dir, "inbox.jsonl");
  const context = currentQueueContext(dir);
  store.add({ text: "visible", source: { cwd: dir }, target: { kind: "global" }, intent: "steer" });
  const content = readFileSync(path, "utf8");
  assert.equal(store.summarize(context, false).leadingText, "visible");
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    chmodSync(path, 0);
    try {
      assert.throws(() => store.summarize(context, false), { code: "EACCES" });
    } finally {
      chmodSync(path, 0o600);
    }
    assert.equal(store.summarize(context, false).leadingText, "visible");
  }
  rmSync(path);
  assert.equal(store.summarize(context, false).queueCount, 0);
  writeFileSync(path, content.replace("visible", "restored"));
  assert.equal(store.summarize(context, false).leadingText, "restored");
}));

test("queue store times out instead of stealing an existing lock", () => withStore((store, dir) => {
  const lockPath = join(dir, "inbox.jsonl.lock");
  mkdirSync(lockPath);
  assert.throws(() => store.add({ text: "blocked write", source: { cwd: "/tmp/project" }, target: { kind: "project", cwd: "/tmp/project" }, intent: "follow-up" }), /Timed out waiting for Powerline queue store lock/);
  assert.equal(existsSync(lockPath), true);
}));

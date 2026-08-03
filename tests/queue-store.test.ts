import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PowerlineQueueStore, currentQueueContext, parseTargetPrefix, targetForIdea } from "../queue/store.ts";

function withStore(fn: (store: PowerlineQueueStore, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "powerline-queue-"));
  try {
    fn(new PowerlineQueueStore(join(dir, "inbox.jsonl"), join(dir, "projects.json")), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("queue store adds active project ideas and summarizes them", () => withStore((store) => {
  const cwd = "/tmp/project-a";
  store.add({
    text: "remember deploy note",
    source: { cwd, sessionId: "s1" },
    target: { kind: "project", cwd },
    intent: "idea",
    now: 100,
  });
  store.add({
    text: "run after compact",
    source: { cwd, sessionId: "s1" },
    target: { kind: "current-session" },
    intent: "post-compact",
    now: 101,
  });

  assert.equal(store.list().length, 2);
  assert.deepEqual(store.summarize(currentQueueContext(cwd, "s1"), true), {
    queueCount: 1,
    ideaCount: 1,
    blockedCount: 0,
    compacting: true,
    leadingText: "run after compact",
  });
}));

test("queue store filters inactive project items", () => withStore((store) => {
  store.add({
    text: "other project",
    source: { cwd: "/tmp/project-a" },
    target: { kind: "project", cwd: "/tmp/project-a" },
    intent: "idea",
  });

  assert.equal(store.activeItems(currentQueueContext("/tmp/project-b")).length, 0);
  assert.equal(store.activeItems(currentQueueContext("/tmp/project-a")).length, 1);
}));

test("current-session targets stay scoped to the source session when known", () => withStore((store) => {
  store.add({
    text: "session only",
    source: { cwd: "/tmp/project", sessionId: "s1" },
    target: { kind: "current-session" },
    intent: "post-compact",
  });

  assert.equal(store.activeItems(currentQueueContext("/tmp/project", "s1")).length, 1);
  assert.equal(store.activeItems(currentQueueContext("/tmp/project", "s2")).length, 0);
}));

test("queue store aliases resolve idea targets", () => withStore((store) => {
  store.setAlias("pika", "/tmp/pika");

  assert.deepEqual(targetForIdea("pika", store, "/tmp/current"), {
    kind: "project",
    cwd: "/tmp/pika",
    alias: "pika",
  });
  assert.deepEqual(targetForIdea("global", store, "/tmp/current"), { kind: "global" });
  assert.deepEqual(targetForIdea("current", store, "/tmp/current"), { kind: "current-session" });
  assert.throws(() => targetForIdea("missing", store, "/tmp/current"), /Unknown project alias/);
}));

test("parseTargetPrefix separates optional @target", () => {
  assert.deepEqual(parseTargetPrefix("@pika check logs"), { target: "pika", text: "check logs" });
  assert.deepEqual(parseTargetPrefix("plain idea"), { target: null, text: "plain idea" });
});

test("queue store clears items from active summary", () => withStore((store) => {
  const item = store.add({
    text: "queued prompt",
    source: { cwd: "/tmp/project" },
    target: { kind: "current-session" },
    intent: "post-compact",
  });

  assert.equal(store.summarize(currentQueueContext("/tmp/project"), false).queueCount, 1);
  store.clear(item.id);
  assert.equal(store.summarize(currentQueueContext("/tmp/project"), false).queueCount, 0);
}));

test("queue store times out instead of stealing an existing lock", () => withStore((store, dir) => {
  const lockPath = join(dir, "inbox.jsonl.lock");
  mkdirSync(lockPath);

  assert.throws(() => store.add({
    text: "blocked write",
    source: { cwd: "/tmp/project" },
    target: { kind: "project", cwd: "/tmp/project" },
    intent: "idea",
  }), /Timed out waiting for Powerline queue store lock/);
  assert.equal(existsSync(lockPath), true);
}));

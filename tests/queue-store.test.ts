import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PowerlineQueueStore, currentQueueContext, formatIdeaIssuePrompt, formatQueueDeliveryText, parseCompactQueuedPrompt, parseSigilIdeaCapture, parseTargetPrefix, targetForIdea } from "../queue/store.ts";

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
    leadingIntent: "post-compact",
    leadingStatus: "queued",
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

test("queue store exposes the leading item intent for idea-only summaries", () => withStore((store) => {
  store.add({
    text: "saved follow-up idea",
    source: { cwd: "/tmp/project" },
    target: { kind: "project", cwd: "/tmp/project" },
    intent: "idea",
    now: 100,
  });

  assert.deepEqual(store.summarize(currentQueueContext("/tmp/project"), false), {
    queueCount: 0,
    ideaCount: 1,
    blockedCount: 0,
    compacting: false,
    leadingText: "saved follow-up idea",
    leadingIntent: "idea",
    leadingStatus: "queued",
  });
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
    cwd: resolve("/tmp/pika"),
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

test("parseSigilIdeaCapture turns leading sigil text into target-aware ideas", () => {
  assert.deepEqual(parseSigilIdeaCapture("# check logs", "#"), { target: null, text: "check logs" });
  assert.deepEqual(parseSigilIdeaCapture("# @global check logs", "#"), { target: "global", text: "check logs" });
  assert.deepEqual(parseSigilIdeaCapture("# @pika check logs\nthen inspect events", "#"), {
    target: "pika",
    text: "check logs\nthen inspect events",
  });
  assert.deepEqual(parseSigilIdeaCapture("note # check logs", "#"), null);
  assert.deepEqual(parseSigilIdeaCapture("## markdown heading", "#"), null);
  assert.deepEqual(parseSigilIdeaCapture("#   ", "#"), null);
  assert.deepEqual(parseSigilIdeaCapture("# check logs", false), null);
  assert.deepEqual(parseSigilIdeaCapture("// check logs", "//"), { target: null, text: "check logs" });
});

test("formatQueueDeliveryText adds provenance only for ideas", () => {
  const idea = {
    id: "a1b2c3d4",
    text: "check logs",
    createdAt: 1000,
    updatedAt: 1000,
    source: { cwd: "/tmp/project" },
    target: { kind: "current-session" as const },
    intent: "idea" as const,
    status: "queued" as const,
  };
  const prompt = { ...idea, intent: "follow-up" as const };

  assert.equal(
    formatQueueDeliveryText(idea),
    "[powerline idea a1b2c3d4, captured 1970-01-01T00:00:01.000Z from /tmp/project]\ncheck logs",
  );
  assert.equal(formatQueueDeliveryText(prompt), "check logs");
});

test("formatIdeaIssuePrompt requires dedupe and clear owned repo before filing", () => {
  const prompt = formatIdeaIssuePrompt({
    id: "a1b2c3d4",
    text: "add typed issue handoff",
    createdAt: 1000,
    updatedAt: 1000,
    source: { cwd: "/tmp/project" },
    target: { kind: "project", cwd: "/tmp/project", alias: "powerline" },
    intent: "idea",
    status: "queued",
  });

  assert.match(prompt, /spawn one low-budget issue-filing lane/);
  assert.match(prompt, /target repository is unclear or is not owned\/controlled by the user, ask before filing/);
  assert.match(prompt, /dedupe against existing open issues first/);
  assert.match(prompt, /If a matching open issue already exists, report it and do not create another issue/);
  assert.match(prompt, /create one self-contained GitHub issue/);
  assert.match(prompt, /project @powerline \/tmp\/project/);
});

test("parseCompactQueuedPrompt treats /compact suffix as queued prompt text", () => {
  assert.equal(parseCompactQueuedPrompt("/compact great lets proceed"), "great lets proceed");
  assert.equal(parseCompactQueuedPrompt("  /compact   great lets proceed  "), "great lets proceed");
  assert.equal(parseCompactQueuedPrompt("/compact\tgreat lets proceed"), "great lets proceed");
  assert.equal(parseCompactQueuedPrompt("/compact"), null);
  assert.equal(parseCompactQueuedPrompt("/compact   "), null);
  assert.equal(parseCompactQueuedPrompt("/compactness great lets proceed"), null);
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

import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSessionCwd } from "../welcome.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

function setup() {
  tmpDir = join(tmpdir(), `pi-powerline-test-${process.pid}`);
  mkdirSync(tmpDir, { recursive: true });
}

function teardown() {
  rmSync(tmpDir, { recursive: true, force: true });
}

function writeTempSession(filename: string, firstLine: string, rest = ""): string {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, firstLine + (rest ? "\n" + rest : ""), "utf-8");
  return filePath;
}

// ── readSessionCwd ────────────────────────────────────────────────────────────

test("readSessionCwd returns cwd from a valid session header", () => {
  setup();
  try {
    const filePath = writeTempSession(
      "valid.jsonl",
      JSON.stringify({ type: "session", version: 3, id: "abc", cwd: "/Users/jsmith/src/foo-bar" }),
    );
    assert.equal(readSessionCwd(filePath), "/Users/jsmith/src/foo-bar");
  } finally {
    teardown();
  }
});

test("readSessionCwd returns cwd when file has multiple lines", () => {
  setup();
  try {
    const header = JSON.stringify({ type: "session", cwd: "/Users/jsmith/dotfiles" });
    const filePath = writeTempSession(
      "multi.jsonl",
      header,
      JSON.stringify({ type: "model_change", modelId: "claude-sonnet-4" }),
    );
    assert.equal(readSessionCwd(filePath), "/Users/jsmith/dotfiles");
  } finally {
    teardown();
  }
});

test("readSessionCwd handles dashes in the cwd path without truncation", () => {
  setup();
  try {
    // This is the case that was broken: a project name containing dashes
    // (e.g. "foo-bar") would be mangled to "bar" by the old dir-splitting logic.
    const filePath = writeTempSession(
      "dashed.jsonl",
      JSON.stringify({ type: "session", cwd: "/Users/jsmith/src/github.com/org/foo-bar" }),
    );
    assert.equal(readSessionCwd(filePath), "/Users/jsmith/src/github.com/org/foo-bar");
  } finally {
    teardown();
  }
});

test("readSessionCwd returns null for a non-existent file", () => {
  assert.equal(readSessionCwd("/nonexistent/path/session.jsonl"), null);
});

test("readSessionCwd returns null when first line is not valid JSON", () => {
  setup();
  try {
    const filePath = writeTempSession("bad-json.jsonl", "not json at all");
    assert.equal(readSessionCwd(filePath), null);
  } finally {
    teardown();
  }
});

test("readSessionCwd returns null when cwd field is missing", () => {
  setup();
  try {
    const filePath = writeTempSession(
      "no-cwd.jsonl",
      JSON.stringify({ type: "session", version: 3, id: "abc" }),
    );
    assert.equal(readSessionCwd(filePath), null);
  } finally {
    teardown();
  }
});

test("readSessionCwd returns null when cwd is not a string", () => {
  setup();
  try {
    const filePath = writeTempSession(
      "bad-cwd.jsonl",
      JSON.stringify({ type: "session", cwd: 42 }),
    );
    assert.equal(readSessionCwd(filePath), null);
  } finally {
    teardown();
  }
});

test("readSessionCwd returns null for an empty file", () => {
  setup();
  try {
    const filePath = writeTempSession("empty.jsonl", "");
    assert.equal(readSessionCwd(filePath), null);
  } finally {
    teardown();
  }
});

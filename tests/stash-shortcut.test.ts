import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isStashShortcutInput } from "../shortcuts.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

test("stash shortcut matches Alt/Meta-S without consuming German sharp-s by default", () => {
  assert.equal(isStashShortcutInput("ß"), false);
  assert.equal(isStashShortcutInput("ß", true), true);

  for (const sequence of ["\x1bs", "\x1bS", "\x1b[115;3u", "\x1b[83;3u", "\x1b[27;3;115~", "\x1b[27;3;83~"]) {
    assert.equal(isStashShortcutInput(sequence), true);
  }
});

test("index passes stash shortcut config to the shared matcher", () => {
  assert.equal([...indexSource.matchAll(/isStashShortcutInput\(data, config\.stashSharpSShortcut\)/g)].length, 2);
});

test("index does not register a core Alt-S shortcut", () => {
  assert.doesNotMatch(indexSource, /registerShortcut\("alt\+s"/);
});

test("index keeps prompt-history shortcut behavior", () => {
  assert.match(indexSource, /function isPromptHistoryShortcutInput\(data: string\): boolean/);
  assert.match(indexSource, /matchesConfiguredShortcut\(data, resolvedShortcuts\.stashHistory\)/);
  assert.doesNotMatch(indexSource, /data === "\\x1b\\b"/);
  assert.doesNotMatch(indexSource, /data === "\\x1b\\x7f"/);
  assert.match(indexSource, /104\(\?:/);
  assert.match(indexSource, /27;7;104/);
  assert.match(indexSource, /return \{ kind: "stashHistory" \};/);
  assert.match(indexSource, /void openStashHistory\(ctx\);/);
});

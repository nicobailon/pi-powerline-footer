import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

test("stash shortcut supports macOS Option+S character input", () => {
  assert.match(source, /isKeyRelease, matchesKey, type AutocompleteProvider/);
  assert.match(source, /pi\.registerShortcut\("alt\+s"/);
  assert.match(source, /function isStashShortcutInput\(data: string\): boolean/);
  assert.match(source, /if \(isKeyRelease\(data\)\) return false;/);
  assert.match(source, /data === "ß"/);
  assert.match(source, /data === "\\x1bs"/);
  assert.match(source, /data === "\\x1bS"/);
  assert.match(source, /27;3;115/);
  assert.match(source, /matchesKey\(data, "alt\+s"\)/);
  assert.match(source, /ctx\.ui\.onTerminalInput\(\(data: string\) =>/);
  assert.match(source, /if \(isStashShortcutInput\(data\)\)/);
  assert.match(source, /return \{ consume: true \};/);
  assert.match(source, /function getCurrentEditorText\(ctx: any, editor: any\): string \{\n\s+const editorText = editor\?\.getExpandedText\?\.\(\);\n\s+if \(typeof editorText === "string" && editorText\.length > 0\) return editorText;\n\s+return ctx\.ui\.getEditorText\?\.\(\) \?\? editorText \?\? "";\n\}/);
  assert.match(source, /function stashOrRestoreEditorText\(ctx: any\): void/);
  assert.match(source, /if \(isStashShortcutInput\(data\)\)/);
  assert.match(source, /stashOrRestoreEditorText\(ctx\);/);
  assert.match(source, /function isPromptHistoryShortcutInput\(data: string\): boolean/);
  assert.match(source, /if \(isKeyRelease\(data\)\) return null;/);
  assert.match(source, /matchesConfiguredShortcut\(data, resolvedShortcuts\.stashHistory\)/);
  assert.doesNotMatch(source, /data === "\\x1b\\b"/);
  assert.doesNotMatch(source, /data === "\\x1b\\x7f"/);
  assert.match(source, /104\(\?:/);
  assert.match(source, /27;7;104/);
  assert.match(source, /return \{ kind: "stashHistory" \};/);
  assert.match(source, /void openStashHistory\(ctx\);/);
});

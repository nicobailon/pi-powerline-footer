import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorCursorBlink, displayColumnToStringIndex } from "../index.ts";
import { NERD_ICONS } from "../icons.ts";
import { parsePowerlineConfig } from "../powerline-config.ts";
import { PRESETS } from "../presets.ts";

const PRESET_NAMES = Object.keys(PRESETS) as Array<keyof typeof PRESETS>;

test("displayColumnToStringIndex maps display columns to string indices", () => {
  // ASCII: display col == string index
  assert.equal(displayColumnToStringIndex("hello world", 0, 7), 7);
  assert.equal(displayColumnToStringIndex("hello", 0, 0), 0);
  // past the end clamps to line end
  assert.equal(displayColumnToStringIndex("hi", 0, 99), 2);
  // CJK wide chars count double
  // "你好ab": 你(2) 好(2) a(1) b(1) → col 3 lands after 好 → index 2? col 3 → consume 你(col2) 好(col4) stop at col4>=3 → i=2
  assert.equal(displayColumnToStringIndex("你好ab", 0, 3), 2);
  assert.equal(displayColumnToStringIndex("你好ab", 0, 4), 2);
  assert.equal(displayColumnToStringIndex("你好ab", 0, 5), 3);
  // fromIndex offset: start inside the line
  assert.equal(displayColumnToStringIndex("abcdef", 3, 2), 5);
});

test("applyEditorCursorBlink turns the reverse-block cursor into a blinking one", () => {
  const line = "text \x1b[7m \x1b[0m more";
  assert.equal(applyEditorCursorBlink(line), "text \x1b[5;7m \x1b[0m more");
  // cursor on a character
  assert.equal(applyEditorCursorBlink("\x1b[7mx\x1b[0m"), "\x1b[5;7mx\x1b[0m");
  // multi-char reverse sequences (selection etc.) are left alone
  assert.equal(applyEditorCursorBlink("\x1b[7mabc\x1b[0m"), "\x1b[7mabc\x1b[0m");
  // no cursor → unchanged
  assert.equal(applyEditorCursorBlink("plain"), "plain");
});

test("editor cursor blink and click-to-position configs default on", () => {
  const defaults = parsePowerlineConfig({}, PRESET_NAMES);
  assert.equal(defaults.editorCursorBlink, true);
  assert.equal(defaults.editorClickCursor, true);
  const off = parsePowerlineConfig({ editorCursorBlink: false, editorClickCursor: false }, PRESET_NAMES);
  assert.equal(off.editorCursorBlink, false);
  assert.equal(off.editorClickCursor, false);
});

test("cache icon differs from context icon", () => {
  assert.notEqual(NERD_ICONS.cache, NERD_ICONS.context);
  assert.equal(NERD_ICONS.cache, "\uF0E7"); // bolt
  assert.equal(NERD_ICONS.context, "\uF1C0"); // database
});

import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorCursorStyle, displayColumnToStringIndex } from "../index.ts";

const REVERSE_CURSOR = "> hello \x1b[7m \x1b[0m";

test("applyEditorCursorStyle leaves the block cursor untouched", () => {
  assert.equal(applyEditorCursorStyle(REVERSE_CURSOR, "block"), REVERSE_CURSOR);
});

test("applyEditorCursorStyle swaps the reverse block for an underline", () => {
  assert.equal(applyEditorCursorStyle(REVERSE_CURSOR, "underline"), "> hello \x1b[4m \x1b[0m");
});

test("applyEditorCursorStyle drops the software cursor for terminal mode", () => {
  assert.equal(applyEditorCursorStyle(REVERSE_CURSOR, "terminal"), "> hello  ");
});

test("applyEditorCursorStyle restyles a cursor sitting on a character", () => {
  assert.equal(applyEditorCursorStyle("ab\x1b[7mc\x1b[0md", "terminal"), "abcd");
  assert.equal(applyEditorCursorStyle("ab\x1b[7mc\x1b[0md", "underline"), "ab\x1b[4mc\x1b[0md");
});

test("displayColumnToStringIndex counts wide characters by display width", () => {
  // Two-column CJK glyphs: display column 4 lands after the second glyph.
  assert.equal(displayColumnToStringIndex("你好x", 0, 4), 2);
  // Within the ASCII tail, columns map one to one from the given offset.
  assert.equal(displayColumnToStringIndex("你好xyz", 2, 2), 4);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRestoreInlineEditorCursorOnShutdown } from "../lifecycle.ts";
import { clampTerminalRow, inlineEditorQuitCursorRestore, inlineEditorQuitCursorRow } from "../terminal-cursor.ts";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

test("inline editor quit cursor restore clamps terminal rows", () => {
  assert.equal(clampTerminalRow(24), 24);
  assert.equal(clampTerminalRow(24.9), 24);
  assert.equal(clampTerminalRow(0), 1);
  assert.equal(clampTerminalRow(-5), 1);
  assert.equal(clampTerminalRow(Number.NaN), 1);
  assert.equal(clampTerminalRow(undefined), 1);
  assert.equal(inlineEditorQuitCursorRow({ rows: 20, cursorRow: 9, previousViewportTop: 4 }), 6);
  assert.equal(inlineEditorQuitCursorRow({ rows: 20, cursorRow: 99, previousViewportTop: 0 }), 20);
  assert.equal(inlineEditorQuitCursorRow({ rows: 20, cursorRow: -3, previousViewportTop: 0 }), 1);
  assert.equal(inlineEditorQuitCursorRow({ rows: 12 }), 12);
  assert.equal(inlineEditorQuitCursorRestore({ rows: 12, cursorRow: 5, previousViewportTop: 1 }), "\x1b[5;1H\x1b[2K\x1b[?25h\n");
});

test("inline editor cursor restore only runs on UI quit without fixed editor cleanup", () => {
  assert.equal(shouldRestoreInlineEditorCursorOnShutdown(true, "quit", false, false), true);
  assert.equal(shouldRestoreInlineEditorCursorOnShutdown(true, "reload", false, false), false);
  assert.equal(shouldRestoreInlineEditorCursorOnShutdown(true, "switch", false, false), false);
  assert.equal(shouldRestoreInlineEditorCursorOnShutdown(true, "quit", true, false), false);
  assert.equal(shouldRestoreInlineEditorCursorOnShutdown(true, "quit", false, true), false);
  assert.equal(shouldRestoreInlineEditorCursorOnShutdown(false, "quit", false, false), false);

  assert.match(source, /const hadFixedEditorCompositor = teardownFixedEditorCompositor/);
  assert.match(source, /shouldRestoreInlineEditorCursorOnShutdown\(hasUI, event\?\.reason, config\.fixedEditor, hadFixedEditorCompositor\)/);
  assert.match(source, /inlineEditorQuitCursorRestore\(\{\n\s+rows: tuiRef\?\.terminal\?\.rows \?\? process\.stdout\.rows,\n\s+cursorRow: tuiRef\?\.cursorRow,\n\s+previousViewportTop: tuiRef\?\.previousViewportTop,/);
});

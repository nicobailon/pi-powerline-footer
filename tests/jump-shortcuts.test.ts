import test from "node:test";
import assert from "node:assert/strict";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { isSupportedSuperShortcut, matchesConfiguredShortcut, shortcutConflictKey } from "../shortcuts.ts";
import { parseBashModeSettings, renderFastPowerlineEditor, resolveShortcutConfig } from "../index.ts";

test("surviving editor shortcuts resolve without app-owned chat scrolling", () => {
  const resolved = resolveShortcutConfig({});
  assert.equal(resolved.stashHistory, "ctrl+alt+h");
  assert.equal(resolved.copyEditor, "ctrl+alt+c");
  assert.equal(resolved.cutEditor, "ctrl+alt+x");
  assert.equal(resolved.reply, null);
  assert.equal(resolved.editorStart, "super+shift+up");
  assert.equal(resolved.editorEnd, "super+shift+down");
  assert.equal(Object.keys(resolved).some((key) => key.startsWith("scroll")), false);
  assert.equal(Object.keys(resolved).some((key) => key.startsWith("jump")), false);
});

test("super shortcut matching and conflict normalization remain supported", () => {
  assert.equal(matchesConfiguredShortcut("\x1b[1;9A", "super+up"), true);
  assert.equal(matchesConfiguredShortcut("c", "super+c"), false);
  assert.equal(isSupportedSuperShortcut("super+up"), true);
  assert.equal(isSupportedSuperShortcut("super+z"), false);
  assert.equal(shortcutConflictKey("super+home"), "super+up");
});


test("editor boundary shortcuts remain configurable", () => {
  const resolved = resolveShortcutConfig({
    powerlineShortcuts: {
      editorStart: "ctrl+shift+u",
      editorEnd: "ctrl+shift+d",
    },
  });

  assert.equal(resolved.editorStart, "ctrl+shift+u");
  assert.equal(resolved.editorEnd, "ctrl+shift+d");
});

test("reply shortcut is opt-in and configurable", () => {
  assert.equal(resolveShortcutConfig({ powerlineShortcuts: { reply: null } }).reply, null);
  assert.equal(resolveShortcutConfig({ powerlineShortcuts: { reply: "ctrl+shift+r" } }).reply, "ctrl+shift+r");
});

test("conflicting reply shortcut disables reply instead of borrowing another action", () => {
  const reserved = resolveShortcutConfig({ powerlineShortcuts: { reply: "ctrl+r" } });
  assert.equal(reserved.reply, null);
  assert.equal(reserved.editorStart, "super+shift+up");
  assert.equal(reserved.editorEnd, "super+shift+down");

  const duplicate = resolveShortcutConfig({ powerlineShortcuts: { reply: "ctrl+alt+h" } });
  assert.equal(duplicate.reply, null);
  assert.equal(duplicate.stashHistory, "ctrl+alt+h");

  const editorStartDefault = resolveShortcutConfig({ powerlineShortcuts: { reply: "super+shift+up" } });
  assert.equal(editorStartDefault.reply, null);
  assert.equal(editorStartDefault.editorStart, "super+shift+up");
  assert.equal(editorStartDefault.editorEnd, "super+shift+down");

  const editorEndDefault = resolveShortcutConfig({ powerlineShortcuts: { reply: "super+shift+down" } });
  assert.equal(editorEndDefault.reply, null);
  assert.equal(editorEndDefault.editorStart, "super+shift+up");
  assert.equal(editorEndDefault.editorEnd, "super+shift+down");
});

test("bash completions are opt-in", () => {
  assert.equal(parseBashModeSettings({}).completions, false);
  assert.equal(parseBashModeSettings({ bashMode: { completions: true } }).completions, true);
  assert.equal(parseBashModeSettings({ bashMode: { completions: false } }).completions, false);
});

test("fast editor render keeps Powerline chrome for large drafts", () => {
  const editor = {
    focused: true,
    isShowingAutocomplete: () => false,
    tui: { terminal: { rows: 24 } },
  };
  Reflect.set(editor, "state", {
    lines: ["intro", "x".repeat(5000)],
    cursorLine: 1,
    cursorCol: 5000,
  });

  const rendered = renderFastPowerlineEditor(editor, 80, {
    bashModeActive: false,
    completionsEnabled: false,
  });

  assert.ok(rendered);
  assert.ok(rendered[0]?.includes("↑"));
  assert.ok(rendered.some((line) => line.includes(CURSOR_MARKER)));
  assert.ok(rendered.some((line) => line.includes(">")));
});

test("fast editor render falls back for short drafts and enabled completions", () => {
  const editor = {
    focused: true,
    isShowingAutocomplete: () => false,
    tui: { terminal: { rows: 24 } },
  };
  Reflect.set(editor, "state", { lines: ["short"], cursorLine: 0, cursorCol: 5 });

  assert.equal(renderFastPowerlineEditor(editor, 80, {
    bashModeActive: false,
    completionsEnabled: false,
  }), null);

  Reflect.set(editor, "state", { lines: ["x".repeat(5000)], cursorLine: 0, cursorCol: 5000 });
  assert.equal(renderFastPowerlineEditor(editor, 80, {
    bashModeActive: false,
    completionsEnabled: true,
  }), null);
});

test("fast editor render falls back for wide characters", () => {
  const editor = {
    focused: true,
    isShowingAutocomplete: () => false,
    tui: { terminal: { rows: 24 } },
  };
  Reflect.set(editor, "state", { lines: ["漢".repeat(1300)], cursorLine: 0, cursorCol: 1291 });

  assert.equal(renderFastPowerlineEditor(editor, 80, {
    bashModeActive: false,
    completionsEnabled: false,
  }), null);
});

test("fast editor render updates the editor navigation width", () => {
  const editor = {
    focused: true,
    isShowingAutocomplete: () => false,
    lastWidth: 12,
    tui: { terminal: { rows: 24 } },
  };
  Reflect.set(editor, "state", { lines: ["x".repeat(5000)], cursorLine: 0, cursorCol: 5000 });

  assert.ok(renderFastPowerlineEditor(editor, 80, {
    bashModeActive: false,
    completionsEnabled: false,
  }));
  assert.equal(Reflect.get(editor, "lastWidth"), 76);
});

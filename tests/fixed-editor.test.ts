import test from "node:test";
import assert from "node:assert/strict";
import { TUI, visibleWidth } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, renderFixedEditorCluster } from "../fixed-editor/cluster.ts";
import {
  buildFixedClusterPaint,
  emergencyTerminalModeReset,
  endSynchronizedOutput,
  beginSynchronizedOutput,
  moveCursor,
  resetScrollRegion,
  setScrollRegion,
  TerminalSplitCompositor,
} from "../fixed-editor/terminal-split.ts";

class FakeTerminal {
  columns = 40;
  private rowCount = 12;
  writes: string[] = [];

  get rows(): number {
    return this.rowCount;
  }

  setRows(rows: number): void {
    this.rowCount = rows;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  hideCursor(): void {}

  showCursor(): void {}
}

test("fixed cluster keeps the editor visible before optional rows", () => {
  const rendered = renderFixedEditorCluster({
    width: 80,
    terminalRows: 6,
    statusLines: ["status"],
    topLines: ["top"],
    editorLines: ["edit-a", `edit-b ${CURSOR_MARKER}`, "edit-c"],
    secondaryLines: ["secondary"],
    transcriptLines: ["old-1", "old-2"],
    lastPromptLines: ["last"],
  });

  assert.deepEqual(rendered.lines, ["top", "edit-a", "edit-b ", "edit-c", "secondary"]);
  assert.deepEqual(rendered.cursor, { row: 2, col: 7 });
});

test("fixed cluster caps oversized editor around the cursor", () => {
  const rendered = renderFixedEditorCluster({
    width: 80,
    terminalRows: 4,
    statusLines: ["status"],
    editorLines: ["edit-a", "edit-b", `edit-c ${CURSOR_MARKER}`, "edit-d", "edit-e"],
    transcriptLines: ["old"],
  });

  assert.deepEqual(rendered.lines, ["edit-a", "edit-b", "edit-c "]);
  assert.deepEqual(rendered.cursor, { row: 2, col: 7 });
});

test("fixed cluster caps selector-style editor replacements around the selected row", () => {
  const rendered = renderFixedEditorCluster({
    width: 80,
    terminalRows: 4,
    editorLines: [
      "title",
      "  option-a",
      "  option-b",
      "\x1b[38;5;39m→ \x1b[0m\x1b[38;5;39moption-c\x1b[0m",
      "  option-d",
      "hint",
    ],
  });

  assert.deepEqual(rendered.lines, ["  option-b", "\x1b[38;5;39m→ \x1b[0m\x1b[38;5;39moption-c\x1b[0m", "  option-d"]);
});

test("fixed cluster keeps tail status lines when compact", () => {
  const rendered = renderFixedEditorCluster({
    width: 80,
    terminalRows: 3,
    statusLines: ["above-widget", "powerline-status", "⠏ Shaolin Switchblade Sync..."],
    editorLines: ["edit"],
  });

  assert.deepEqual(rendered.lines, ["⠏ Shaolin Switchblade Sync...", "edit"]);
});

test("terminal split can render a hidden status container in the fixed cluster", () => {
  const terminal = new FakeTerminal();
  const status = {
    text: "⠏ Shaolin Switchblade Sync...",
    render() {
      return ["", this.text];
    },
  };
  const editor = {
    render() {
      return ["editor"];
    },
  };
  const tui = {
    terminal,
    render() {
      return ["chat"];
    },
    doRender() {
      this.terminal.write("body");
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    getShowHardwareCursor: () => false,
    renderCluster: (width) => ({
      lines: [
        ...compositor.renderHidden(status, width).filter((line) => visibleWidth(line) > 0),
        ...compositor.renderHidden(editor, width),
      ],
      cursor: null,
    }),
  });

  compositor.hideRenderable(status);
  compositor.hideRenderable(editor);
  compositor.install();

  assert.deepEqual(status.render(), []);
  tui.doRender();
  assert.ok(terminal.writes.at(-1)?.includes("⠏ Shaolin Switchblade Sync..."));

  status.text = "⠙ Shaolin Switchblade Sync...";
  compositor.requestRepaint();
  assert.ok(terminal.writes.at(-1)?.includes("⠙ Shaolin Switchblade Sync..."));

  compositor.dispose();
  assert.deepEqual(status.render(), ["", "⠙ Shaolin Switchblade Sync..."]);
});

test("terminal split escape helpers generate DEC scroll region controls", () => {
  assert.equal(beginSynchronizedOutput(), "\x1b[?2026h");
  assert.equal(endSynchronizedOutput(), "\x1b[?2026l");
  assert.equal(setScrollRegion(1, 18), "\x1b[1;18r");
  assert.equal(resetScrollRegion(), "\x1b[r");
  assert.equal(moveCursor(20, 3), "\x1b[20;3H");
});

test("fixed cluster paint clears bottom rows and positions hardware cursor", () => {
  const paint = buildFixedClusterPaint(
    { lines: ["top", "edit"], cursor: { row: 1, col: 2 } },
    10,
    20,
    true,
  );

  assert.match(paint, /^\x1b\[r/);
  assert.ok(paint.includes("\x1b[9;1H\x1b[2Ktop"));
  assert.ok(paint.includes("\x1b[10;1H\x1b[2Kedit"));
  assert.ok(paint.endsWith("\x1b[10;3H\x1b[?25h"));
});

test("terminal split reserves rows, hides root renderables, repaints, and cleans up", () => {
  const terminal = new FakeTerminal();
  const hidden = {
    render(width: number) {
      return [`hidden:${width}`];
    },
  };
  const tui = {
    terminal,
    hardwareCursorRow: 2,
    cursorRow: 2,
    previousViewportTop: 0,
    rendered: 0,
    doRender() {
      this.rendered += 1;
      this.terminal.write("body");
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    getShowHardwareCursor: () => false,
    renderCluster: (width) => ({
      lines: [`cluster:${width}`, ...compositor.renderHidden(hidden, width)],
      cursor: null,
    }),
  });

  compositor.hideRenderable(hidden);
  compositor.install();

  assert.deepEqual(hidden.render(40), []);
  assert.equal(terminal.rows, 10);

  tui.doRender();

  assert.equal(tui.rendered, 1);
  assert.equal(terminal.writes.length, 3);
  assert.ok(terminal.writes[0]?.includes("\x1b[?1049h"));
  assert.ok(terminal.writes[0]?.includes("\x1b[?1007l"));
  assert.ok(terminal.writes[0]?.includes("\x1b[?1002h"));
  assert.ok(terminal.writes[0]?.includes("\x1b[?1006h"));
  assert.ok(terminal.writes[1]?.includes("\x1b[1;10r\x1b[3;1Hbody"));
  assert.ok(terminal.writes[1]?.includes("cluster:40"));
  assert.ok(terminal.writes[1]?.includes("hidden:40"));
  assert.ok(terminal.writes[2]?.includes("cluster:40"));

  compositor.dispose();

  assert.deepEqual(hidden.render(8), ["hidden:8"]);
  assert.equal(terminal.rows, 12);
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[r"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1006l"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1002l"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1000l"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1007h"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1049l"));
  assert.ok(!terminal.writes.at(-1)?.includes("\x1b[<u"));
  assert.ok(!terminal.writes.at(-1)?.includes("\x1b[>4;0m"));
});

test("terminal split re-enables Kitty keyboard protocol in alternate screen", () => {
  const terminal = new FakeTerminal();
  Object.defineProperty(terminal, "kittyProtocolActive", { value: true });
  const compositor = new TerminalSplitCompositor({
    tui: { terminal },
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();

  const setup = terminal.writes[0] ?? "";
  assert.ok(setup.includes("\x1b[?1049h"));
  assert.ok(setup.includes("\x1b[>7u"));
  assert.ok(setup.indexOf("\x1b[?1049h") < setup.indexOf("\x1b[>7u"));

  compositor.dispose();

  const cleanup = terminal.writes.at(-1) ?? "";
  assert.ok(cleanup.includes("\x1b[<u"));
  assert.ok(cleanup.indexOf("\x1b[<u") < cleanup.indexOf("\x1b[?1049l"));
  assert.ok(!cleanup.includes("\x1b[<999u"));
});

test("terminal split re-enables modifyOtherKeys in alternate screen", () => {
  const terminal = new FakeTerminal();
  Reflect.set(terminal, "_modifyOtherKeysActive", true);
  const compositor = new TerminalSplitCompositor({
    tui: { terminal },
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();

  const setup = terminal.writes[0] ?? "";
  assert.ok(setup.includes("\x1b[?1049h"));
  assert.ok(setup.includes("\x1b[>4;2m"));
  assert.ok(setup.indexOf("\x1b[?1049h") < setup.indexOf("\x1b[>4;2m"));

  compositor.dispose();

  const cleanup = terminal.writes.at(-1) ?? "";
  assert.ok(cleanup.includes("\x1b[>4;0m"));
  assert.ok(cleanup.indexOf("\x1b[>4;0m") < cleanup.indexOf("\x1b[?1049l"));
  assert.ok(!cleanup.includes("\x1b[<999u"));
});

test("terminal split restores main screen mode when Kitty activates after install", () => {
  const terminal = new FakeTerminal();
  const compositor = new TerminalSplitCompositor({
    tui: { terminal },
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  terminal.kittyProtocolActive = true;
  compositor.dispose();

  const cleanup = terminal.writes.at(-1) ?? "";
  assert.ok(cleanup.includes("\x1b[<u"));
  assert.ok(cleanup.includes("\x1b[>7u"));
  assert.ok(cleanup.indexOf("\x1b[<u") < cleanup.indexOf("\x1b[?1049l"));
  assert.ok(cleanup.indexOf("\x1b[?1049l") < cleanup.indexOf("\x1b[>7u"));
});

test("terminal split restores main screen mode when modifyOtherKeys activates after install", () => {
  const terminal = new FakeTerminal();
  const compositor = new TerminalSplitCompositor({
    tui: { terminal },
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  Reflect.set(terminal, "_modifyOtherKeysActive", true);
  compositor.dispose();

  const cleanup = terminal.writes.at(-1) ?? "";
  assert.ok(cleanup.includes("\x1b[>4;0m"));
  assert.ok(cleanup.includes("\x1b[>4;2m"));
  assert.ok(cleanup.indexOf("\x1b[>4;0m") < cleanup.indexOf("\x1b[?1049l"));
  assert.ok(cleanup.indexOf("\x1b[?1049l") < cleanup.indexOf("\x1b[>4;2m"));
});

test("terminal split shutdown cleanup resets extended keyboard modes", () => {
  const terminal = new FakeTerminal();
  const compositor = new TerminalSplitCompositor({
    tui: { terminal },
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  compositor.dispose({ resetExtendedKeyboardModes: true });

  const cleanup = terminal.writes.at(-1) ?? "";
  assert.ok(cleanup.includes("\x1b[<999u"));
  assert.ok(cleanup.includes("\x1b[>4;0m"));
  assert.ok(cleanup.indexOf("\x1b[?1049l") < cleanup.indexOf("\x1b[<999u"));
});

test("terminal row reservation does not recurse when hidden editor render reads terminal rows", () => {
  const terminal = new FakeTerminal();
  const tui = { terminal };
  const hidden = {
    render() {
      return [`rows:${terminal.rows}`];
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: (width) => ({
      lines: compositor.renderHidden(hidden, width),
      cursor: null,
    }),
  });

  compositor.hideRenderable(hidden);
  compositor.install();

  assert.equal(terminal.rows, 11);
  compositor.requestRepaint();
  assert.ok(terminal.writes.at(-1)?.includes("rows:12"));

  compositor.dispose();
});

test("terminal split anchors diff writes to the visible viewport row", () => {
  const terminal = new FakeTerminal();
  const tui = {
    terminal,
    hardwareCursorRow: 100,
    cursorRow: 100,
    previousViewportTop: 95,
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  terminal.write("diff");

  assert.ok(terminal.writes[1]?.includes("\x1b[1;10r\x1b[6;1Hdiff"));

  compositor.dispose();
});

test("terminal split does not repaint the fixed cluster over visible overlays", () => {
  const terminal = new FakeTerminal();
  const tui = {
    terminal,
    overlayStack: [{}],
    rendered: 0,
    doRender() {
      this.rendered += 1;
      this.terminal.write("overlay-frame");
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  tui.doRender();
  compositor.requestRepaint();

  assert.deepEqual(terminal.writes, [
    "\x1b[?2026h\x1b[?1049h\x1b[?1007l\x1b[?1002h\x1b[?1006h\x1b[?2026l",
    "overlay-frame",
  ]);

  compositor.dispose();
});

test("terminal split strips OSC markers from root lines while overlays are visible", () => {
  const terminal = new FakeTerminal();
  terminal.columns = 20;
  const tui = {
    terminal,
    overlayStack: [{}],
    render() {
      return ["\x1b]133;B\x07" + "x".repeat(20) + "\x1b]133;C\x07"];
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  const rendered = tui.render(20);

  assert.equal(rendered.length, 1);
  assert.equal(visibleWidth(rendered[0] ?? ""), 20);
  assert.doesNotMatch(rendered[0] ?? "", /\]133/);

  compositor.dispose();
});

test("terminal split keeps tabbed overlay composition within terminal width", () => {
  const terminal = new FakeTerminal();
  terminal.columns = 250;
  terminal.setRows(40);
  const tui = new TUI(terminal, false);
  const overlay = "\x1b[38;2;119;125;136m[grep]: render.ts-706- \treturn [...lines.slice(0, visibleLines), truncLine(theme.fg(\"dim\", hint), width)];\x1b[39m";

  const before = tui.compositeLineAt("Validation before " + " ".repeat(232), overlay, 20, 210, 250);
  assert.ok(visibleWidth(before) > 250);

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  const after = tui.compositeLineAt("Validation before " + " ".repeat(232), overlay, 20, 210, 250);

  assert.ok(visibleWidth(after) <= 250);
  assert.doesNotMatch(after, /\t/);

  compositor.dispose();
});

test("terminal split renders chat through an app-owned scroll viewport", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const renderRequests: Array<boolean | undefined> = [];
  let rootLines = Array.from({ length: 15 }, (_, index) => `line-${index}`);
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender(force?: boolean) {
      renderRequests.push(force);
    },
    render() {
      return rootLines;
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();

  assert.equal(terminal.rows, 10);
  assert.deepEqual(tui.render(40), [
    "line-5", "line-6", "line-7", "line-8", "line-9",
    "line-10", "line-11", "line-12", "line-13", "line-14",
  ]);

  assert.deepEqual(inputListener?.("\x1b[<2;1;1M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1bOA"), undefined);
  assert.deepEqual(inputListener?.("\x1bOB"), undefined);
  assert.deepEqual(inputListener?.("\x1b[A"), undefined);
  assert.deepEqual(renderRequests, []);
  assert.deepEqual(inputListener?.("\x1b[<64;1;1M"), { consume: true });
  assert.deepEqual(renderRequests, [undefined]);
  assert.deepEqual(tui.render(40), [
    "line-2", "line-3", "line-4", "line-5", "line-6",
    "line-7", "line-8", "line-9", "line-10", "line-11",
  ]);

  rootLines = [...rootLines, "line-15"];
  assert.deepEqual(tui.render(40), [
    "line-2", "line-3", "line-4", "line-5", "line-6",
    "line-7", "line-8", "line-9", "line-10", "line-11",
  ]);

  assert.deepEqual(inputListener?.("\x1b[<65;1;1M"), { consume: true });
  assert.deepEqual(renderRequests, [undefined, undefined]);
  assert.deepEqual(tui.render(40), [
    "line-5", "line-6", "line-7", "line-8", "line-9",
    "line-10", "line-11", "line-12", "line-13", "line-14",
  ]);

  assert.deepEqual(inputListener?.("\x1b[5~"), { consume: true });
  assert.deepEqual(renderRequests, [undefined, undefined, undefined]);
  assert.deepEqual(tui.render(40), [
    "line-0", "line-1", "line-2", "line-3", "line-4",
    "line-5", "line-6", "line-7", "line-8", "line-9",
  ]);

  compositor.dispose();
  assert.equal(inputListener, null);
});

test("terminal split refreshes scroll bounds after fixed status rows appear", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const renderRequests: Array<boolean | undefined> = [];
  const rootLines = Array.from({ length: 11 }, (_, index) => `line-${index}`);
  let statusVisible = false;
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender(force?: boolean) {
      renderRequests.push(force);
    },
    render() {
      return rootLines;
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({
      lines: statusVisible ? ["⠏ fixed status", "editor"] : ["editor"],
      cursor: null,
    }),
  });

  compositor.install();

  assert.deepEqual(tui.render(40), rootLines);

  statusVisible = true;
  compositor.requestRepaint();

  assert.deepEqual(inputListener?.("\x1b[<64;1;1M"), { consume: true });
  assert.deepEqual(renderRequests, [undefined]);
  assert.match(terminal.writes.at(-1) ?? "", /line-0/);
  assert.match(terminal.writes.at(-1) ?? "", /⠏ fixed status/);
  assert.deepEqual(tui.render(40), [
    "line-0", "line-1", "line-2", "line-3", "line-4",
    "line-5", "line-6", "line-7", "line-8", "line-9",
  ]);

  compositor.dispose();
});

test("terminal split handles modified SGR wheel packets", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const renderRequests: Array<boolean | undefined> = [];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender(force?: boolean) {
      renderRequests.push(force);
    },
    render() {
      return Array.from({ length: 15 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render(40);

  assert.deepEqual(inputListener?.("\x1b[<68;1;1M"), { consume: true });
  assert.deepEqual(renderRequests, [undefined]);
  assert.deepEqual(tui.render(40), [
    "line-2", "line-3", "line-4", "line-5", "line-6",
    "line-7", "line-8", "line-9", "line-10", "line-11",
  ]);

  assert.deepEqual(inputListener?.("\x1b[<68;1;1M\x1b[<68;1;1M"), { consume: true });
  assert.deepEqual(renderRequests, [undefined, undefined]);
  assert.deepEqual(tui.render(40), [
    "line-0", "line-1", "line-2", "line-3", "line-4",
    "line-5", "line-6", "line-7", "line-8", "line-9",
  ]);

  assert.deepEqual(inputListener?.("\x1b[<69;1;1M"), { consume: true });
  assert.deepEqual(renderRequests, [undefined, undefined, undefined]);

  compositor.dispose();
});

test("terminal split guards wrapped terminal writes", () => {
  const terminal = new FakeTerminal();
  const tui = {
    terminal,
    hardwareCursorRow: 2,
    previousViewportTop: 0,
    render() {
      return Array.from({ length: 15 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render(40);

  terminal.write("\x1b[?1006l\x1b[?1002l" + "x".repeat(40));

  const write = terminal.writes.at(-1) ?? "";
  assert.ok(write.includes("\x1b[?1006l\x1b[?1002l" + "x".repeat(40)));
  assert.ok(write.indexOf("\x1b[?7l") < write.indexOf("x".repeat(40)));
  assert.ok(write.lastIndexOf("\x1b[?7h") > write.lastIndexOf("x".repeat(40)));
  assert.ok(write.lastIndexOf("\x1b[?1002h\x1b[?1006h") > write.lastIndexOf("\x1b[?1006l\x1b[?1002l"));

  compositor.dispose();
});

test("terminal split pauses mouse reporting on right click for the terminal context menu", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const renderRequests: Array<boolean | undefined> = [];
  const copied: string[] = [];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender(force?: boolean) {
      renderRequests.push(force);
    },
    render() {
      return Array.from({ length: 20 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    onCopySelection: (text) => copied.push(text),
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render(40);

  assert.deepEqual(inputListener?.("\x1b[<0;5;5M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;5;5m"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<2;5;5M"), { consume: true });
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1006l\x1b[?1002l\x1b[?1000l"));
  assert.deepEqual(inputListener?.("\x1b[<0;5;5M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;5;5m"), { consume: true });
  assert.deepEqual(copied, []);
  assert.deepEqual(renderRequests, [undefined, undefined, undefined, undefined]);

  compositor.dispose();
});

test("terminal split selects visible chat text and copies it on drag release", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const renderRequests: Array<boolean | undefined> = [];
  const copied: string[] = [];
  const rootLines = [
    "old-0", "old-1", "old-2", "old-3", "old-4",
    "alpha one", "bravo two", "charlie three", "delta four", "echo five",
    "foxtrot six", "golf seven", "hotel eight", "india nine", "juliet ten",
  ];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender(force?: boolean) {
      renderRequests.push(force);
    },
    render() {
      return rootLines;
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    onCopySelection: (text) => copied.push(text),
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  assert.deepEqual(tui.render(40), [
    "alpha one", "bravo two", "charlie three", "delta four", "echo five",
    "foxtrot six", "golf seven", "hotel eight", "india nine", "juliet ten",
  ]);

  assert.deepEqual(inputListener?.("\x1b[<0;2;2M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<32;7;4M"), { consume: true });
  assert.deepEqual(tui.render(40).slice(1, 4), [
    "b\x1b[7mravo two\x1b[27m",
    "\x1b[7mcharlie three\x1b[27m",
    "\x1b[7mdelta \x1b[27mfour",
  ]);
  assert.deepEqual(inputListener?.("\x1b[<0;7;4m"), { consume: true });

  assert.deepEqual(copied, ["ravo two\ncharlie three\ndelta"]);
  assert.ok(!terminal.writes.at(-1)?.includes("\x1b[?1006l\x1b[?1002l\x1b[?1000l"));
  assert.deepEqual(renderRequests, [undefined, undefined, undefined]);

  compositor.dispose();
});

test("terminal split refreshes root lines before mouse selection hit-testing", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const copied: string[] = [];
  let rootLines = ["alpha one", "bravo two", "charlie three"];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return rootLines;
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    onCopySelection: (text) => copied.push(text),
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render(40);
  rootLines = Array.from({ length: 15 }, (_, index) => `line-${index}`);

  assert.deepEqual(inputListener?.("\x1b[<0;1;1M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<32;1;2M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;1;2m"), { consume: true });

  assert.deepEqual(copied, ["line-5"]);

  compositor.dispose();
});

test("terminal split restores app-owned selection after context menu copy", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  let clipboard = "";
  const rootLines = [
    "old-0", "old-1", "old-2", "old-3", "old-4",
    "alpha one", "bravo two", "charlie three", "delta four", "echo five",
    "foxtrot six", "golf seven", "hotel eight", "india nine", "juliet ten",
  ];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render(_width?: number) {
      return rootLines;
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    onCopySelection: (text) => {
      clipboard = text;
    },
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render(40);

  assert.deepEqual(inputListener?.("\x1b[<0;2;2M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<32;7;4M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;7;4m"), { consume: true });
  assert.equal(clipboard, "ravo two\ncharlie three\ndelta");

  clipboard = "clicked-word";
  assert.deepEqual(inputListener?.("\x1b[<2;4;3M"), { consume: true });
  assert.equal(clipboard, "ravo two\ncharlie three\ndelta");
  assert.ok(tui.render(40)[1]?.includes("b\x1b[7mravo two\x1b[27m"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1006l\x1b[?1002l\x1b[?1000l"));

  clipboard = "terminal-clicked-word-copy";
  t.mock.timers.tick(1200);
  assert.equal(clipboard, "ravo two\ncharlie three\ndelta");
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1002h\x1b[?1006h"));

  clipboard = "late-terminal-clicked-word-copy";
  t.mock.timers.tick(100);
  assert.equal(clipboard, "ravo two\ncharlie three\ndelta");

  clipboard = "other-copy";
  assert.deepEqual(inputListener?.("\x1b[<2;5;5M"), { consume: true });
  assert.equal(clipboard, "other-copy");
  t.mock.timers.tick(1200);
  assert.equal(clipboard, "other-copy");
  assert.ok(!tui.render(40)[1]?.includes("\x1b[7mravo two\x1b[27m"));

  compositor.dispose();
});

test("terminal split selection does not expose OSC control sequences as text", () => {
  const terminal = new FakeTerminal();
  terminal.columns = 20;
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const rootLines = [
    "old-0", "old-1", "old-2", "old-3", "old-4",
    "alpha", "bravo", "charlie", "delta", "echo",
    "foxtrot", "golf", "hotel", "india", "\x1b]133;B\x07\x1b]133;C\x07juliet",
  ];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return rootLines;
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render(20);

  assert.deepEqual(inputListener?.("\x1b[<0;1;10M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<32;6;10M"), { consume: true });
  const selectedLine = tui.render(20).at(-1) ?? "";

  assert.ok(visibleWidth(selectedLine) <= 20);
  assert.ok(!selectedLine.includes("]133"));
  assert.ok(selectedLine.includes("\x1b[7mjulie\x1b[27mt"));

  compositor.dispose();
});

test("terminal split selection highlighting does not duplicate wide glyphs", () => {
  for (const glyph of ["🪃", "👨‍👩‍👧‍👦"]) {
    const terminal = new FakeTerminal();
    terminal.columns = 30;
    let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
    const prefix = "Done shows ";
    const line = `${prefix}${glyph} auto${" ".repeat(30 - visibleWidth(`${prefix}${glyph} auto`))}`;
    const tui = {
      terminal,
      addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
        inputListener = listener;
        return () => {
          inputListener = null;
        };
      },
      requestRender() {},
      render() {
        return ["old-0", "old-1", "old-2", "old-3", "old-4", "old-5", "old-6", "old-7", "old-8", line];
      },
    };

    const compositor = new TerminalSplitCompositor({
      tui,
      terminal,
      renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
    });

    compositor.install();
    tui.render(30);

    const glyphCol = visibleWidth(prefix);
    assert.deepEqual(inputListener?.(`\x1b[<0;${glyphCol + 1};10M`), { consume: true });
    assert.deepEqual(inputListener?.(`\x1b[<32;${glyphCol + 2};10M`), { consume: true });
    const selectedLine = tui.render(30).at(-1) ?? "";

    assert.ok(visibleWidth(selectedLine) <= 30);
    assert.equal(selectedLine.includes(glyph), true);
    assert.ok(selectedLine.includes(`\x1b[7m${glyph}\x1b[27m`));

    compositor.dispose();
  }
});

test("terminal split copies chat and fixed cluster selections", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const copied: string[] = [];
  const rootLines = [
    "old-0", "old-1", "old-2", "old-3", "old-4",
    "alpha one", "bravo two", "charlie three", "delta four", "echo five",
    "foxtrot six", "golf seven", "hotel eight", "india nine", "juliet ten",
  ];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return rootLines;
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    onCopySelection: (text) => copied.push(text),
    renderCluster: () => ({ lines: ["cluster-a", "  > hello world"], cursor: null }),
  });

  compositor.install();
  tui.render(40);

  assert.deepEqual(inputListener?.("\x1b[<0;1;9M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;5;11m"), { consume: true });
  assert.deepEqual(copied, ["india nine\njuli"]);

  assert.deepEqual(inputListener?.("\x1b[<0;5;12M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<32;10;12M"), { consume: true });
  compositor.requestRepaint();
  assert.ok(terminal.writes.at(-1)?.includes("  > \x1b[7mhello\x1b[27m world"));
  assert.deepEqual(inputListener?.("\x1b[<0;10;12m"), { consume: true });
  assert.deepEqual(copied, ["india nine\njuli", "hello"]);

  assert.deepEqual(inputListener?.("\x1b[<0;8;12M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;8;12m"), { consume: true });
  assert.deepEqual(copied, ["india nine\njuli", "hello"]);

  assert.deepEqual(inputListener?.("\x1b[<0;4;3M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;4;3m"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;5;3M"), { consume: true });
  assert.ok(tui.render(40)[2]?.includes("\x1b[7mcharlie three\x1b[27m"));
  assert.deepEqual(inputListener?.("\x1b[<0;5;3m"), { consume: true });
  assert.deepEqual(copied, ["india nine\njuli", "hello", "charlie three"]);

  assert.deepEqual(inputListener?.("\x1b[<0;8;12M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;8;12m"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<0;9;12M"), { consume: true });
  compositor.requestRepaint();
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[7m  > hello world\x1b[27m"));
  assert.deepEqual(inputListener?.("\x1b[<0;9;12m"), { consume: true });
  assert.deepEqual(copied, ["india nine\njuli", "hello", "charlie three", "  > hello world"]);

  compositor.dispose();
});

test("terminal split selection scrolls when dragged to viewport edges", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const copied: string[] = [];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return Array.from({ length: 30 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    onCopySelection: (text) => copied.push(text),
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render();
  inputListener?.("\x1b[5~");
  assert.equal(tui.render()[0], "line-10");

  assert.deepEqual(inputListener?.("\x1b[<0;1;9M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<32;5;12M"), { consume: true });
  assert.equal(tui.render()[0], "line-11");
  assert.ok(tui.render()[9]?.includes("\x1b[7mline\x1b[27m-20"));
  assert.deepEqual(inputListener?.("\x1b[<0;5;12m"), { consume: true });
  assert.deepEqual(copied, ["line-18\nline-19\nline"]);

  compositor.jumpToRootBottom();
  assert.equal(tui.render()[0], "line-20");
  assert.deepEqual(inputListener?.("\x1b[<0;1;2M"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[<32;5;1M"), { consume: true });
  assert.equal(tui.render()[0]?.replace(/\x1b\[[0-9;]*m/g, ""), "line-19");
  assert.ok(tui.render()[0]?.includes("line\x1b[7m-19\x1b[27m"));
  assert.deepEqual(inputListener?.("\x1b[<0;5;1m"), { consume: true });
  assert.deepEqual(copied, ["line-18\nline-19\nline", "-19\nline-20"]);

  compositor.dispose();
});

test("terminal split copies edge-scrolled selections without waiting for render", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const copied: string[] = [];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return Array.from({ length: 30 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    onCopySelection: (text) => copied.push(text),
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render();
  inputListener?.("\x1b[5~");
  tui.render();

  inputListener?.("\x1b[<0;1;9M");
  inputListener?.("\x1b[<32;5;12M");
  inputListener?.("\x1b[<0;5;12m");
  assert.deepEqual(copied, ["line-18\nline-19\nline"]);

  inputListener?.("\x1b[<0;1;9M");
  for (let i = 0; i < 9; i++) {
    inputListener?.("\x1b[<32;5;12M");
  }
  inputListener?.("\x1b[<0;5;12m");
  assert.deepEqual(copied.at(-1), [
    "line-19", "line-20", "line-21", "line-22", "line-23",
    "line-24", "line-25", "line-26", "line-27", "line-28", "line",
  ].join("\n"));

  compositor.dispose();
});

test("terminal split maps post-edge-scroll drags against the updated viewport", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const copied: string[] = [];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return Array.from({ length: 30 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    onCopySelection: (text) => copied.push(text),
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render();
  inputListener?.("\x1b[5~");
  tui.render();

  inputListener?.("\x1b[<0;1;9M");
  inputListener?.("\x1b[<32;1;12M");
  inputListener?.("\x1b[<32;1;3M");
  inputListener?.("\x1b[<0;5;4m");
  assert.deepEqual(copied, ["-14\nline-15\nline-16\nline-17"]);

  compositor.dispose();
});

test("terminal split keyboard scroll supports Pi page aliases and preserves app shortcuts", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return Array.from({ length: 30 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render();

  assert.deepEqual(inputListener?.("\x1b[5~"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[5;9~"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[57421;9u"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[1;9A"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[57419;9u"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[1;9H"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[57423;9u"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[7;9~"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[1;6A"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[57419;6u"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[6;9~"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[57422;9u"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[1;9B"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[57420;9u"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[1;9F"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[57424;9u"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[8;9~"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[1;6B"), { consume: true });
  assert.deepEqual(inputListener?.("\x1b[57420;6u"), { consume: true });
  assert.equal(inputListener?.("\x1b[1;10A"), undefined);
  assert.equal(inputListener?.("\x1b[57419;10u"), undefined);
  assert.equal(inputListener?.("\x1b[1;10B"), undefined);
  assert.equal(inputListener?.("\x1b[57420;10u"), undefined);
  assert.equal(inputListener?.("\x1b[1;10:3A"), undefined);
  assert.equal(inputListener?.("\x1b[57419;10:3u"), undefined);
  assert.equal(inputListener?.("\x1bp"), undefined);
  assert.equal(inputListener?.("\x1bn"), undefined);

  compositor.dispose();
});

test("terminal split keyboard scroll accepts configured shortcuts", () => {
  const terminal = new FakeTerminal();
  const renderRequests: Array<boolean | undefined> = [];
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender(force?: boolean) {
      renderRequests.push(force);
    },
    render() {
      return Array.from({ length: 30 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    keyboardScrollShortcuts: { up: "ctrl+shift+u", down: "ctrl+shift+d" },
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render();

  assert.equal(inputListener?.("\x1b[1;9A"), undefined);
  assert.deepEqual(inputListener?.("\x1b[117;6u"), { consume: true });
  assert.deepEqual(renderRequests, [undefined]);
  assert.deepEqual(inputListener?.("\x1b[100;6u"), { consume: true });
  assert.deepEqual(renderRequests, [undefined, undefined]);

  compositor.dispose();
});

test("terminal split clears Kitty images when the scroll viewport moves", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return Array.from({ length: 30 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render();
  terminal.writes = [];

  assert.deepEqual(inputListener?.("\x1b[5~"), { consume: true });
  assert.equal(terminal.writes.length, 1);
  assert.match(terminal.writes[0] ?? "", /\x1b_Ga=d,d=A,q=2\x1b\\/);

  terminal.writes = [];
  terminal.write("root update");
  assert.doesNotMatch(terminal.writes[0] ?? "", /\x1b_Ga=d,d=A,q=2\x1b\\/);

  compositor.dispose();
});

test("terminal split jumps to previous root target lines", () => {
  const terminal = new FakeTerminal();
  const renderRequests: Array<boolean | undefined> = [];
  const tui = {
    terminal,
    requestRender(force?: boolean) {
      renderRequests.push(force);
    },
    render() {
      return Array.from({ length: 30 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  assert.deepEqual(tui.render(40), [
    "line-20", "line-21", "line-22", "line-23", "line-24",
    "line-25", "line-26", "line-27", "line-28", "line-29",
  ]);

  assert.equal(compositor.jumpToPreviousRootTarget([6, 14, 24]), true);
  assert.deepEqual(renderRequests, [undefined]);
  assert.deepEqual(tui.render(40), [
    "line-14", "line-15", "line-16", "line-17", "line-18",
    "line-19", "line-20", "line-21", "line-22", "line-23",
  ]);

  assert.equal(compositor.jumpToPreviousRootTarget([6, 14, 24]), true);
  assert.deepEqual(renderRequests, [undefined, undefined]);
  assert.deepEqual(tui.render(40), [
    "line-6", "line-7", "line-8", "line-9", "line-10",
    "line-11", "line-12", "line-13", "line-14", "line-15",
  ]);

  assert.equal(compositor.jumpToPreviousRootTarget([6, 14, 24]), false);

  assert.equal(compositor.jumpToNextRootTarget([6, 14, 24]), true);
  assert.deepEqual(tui.render(40), [
    "line-14", "line-15", "line-16", "line-17", "line-18",
    "line-19", "line-20", "line-21", "line-22", "line-23",
  ]);

  assert.equal(compositor.jumpToNextRootTarget([6, 14, 24]), true);
  assert.deepEqual(tui.render(40), [
    "line-20", "line-21", "line-22", "line-23", "line-24",
    "line-25", "line-26", "line-27", "line-28", "line-29",
  ]);

  assert.equal(compositor.jumpToNextRootTarget([6, 14, 24]), false);

  assert.equal(compositor.jumpToPreviousRootTarget([6, 14, 24]), true);
  assert.deepEqual(tui.render(40), [
    "line-14", "line-15", "line-16", "line-17", "line-18",
    "line-19", "line-20", "line-21", "line-22", "line-23",
  ]);
  assert.equal(compositor.jumpToRootBottom(), true);
  assert.deepEqual(tui.render(40), [
    "line-20", "line-21", "line-22", "line-23", "line-24",
    "line-25", "line-26", "line-27", "line-28", "line-29",
  ]);
  assert.equal(compositor.jumpToRootBottom(), false);
  compositor.dispose();
});

test("terminal split previous root target only moves to older targets", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender() {},
    render() {
      return Array.from({ length: 30 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  assert.deepEqual(tui.render(), [
    "line-20", "line-21", "line-22", "line-23", "line-24",
    "line-25", "line-26", "line-27", "line-28", "line-29",
  ]);
  assert.deepEqual(inputListener?.("\x1b[5~"), { consume: true });
  assert.deepEqual(tui.render(), [
    "line-10", "line-11", "line-12", "line-13", "line-14",
    "line-15", "line-16", "line-17", "line-18", "line-19",
  ]);

  assert.equal(compositor.jumpToPreviousRootTarget([6, 14, 24]), true);
  assert.deepEqual(tui.render(), [
    "line-6", "line-7", "line-8", "line-9", "line-10",
    "line-11", "line-12", "line-13", "line-14", "line-15",
  ]);

  compositor.dispose();
});

test("terminal split can disable mouse reporting for normal selection", () => {
  const terminal = new FakeTerminal();
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const renderRequests: Array<boolean | undefined> = [];
  const tui = {
    terminal,
    addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputListener = listener;
      return () => {
        inputListener = null;
      };
    },
    requestRender(force?: boolean) {
      renderRequests.push(force);
    },
    render() {
      return Array.from({ length: 15 }, (_, index) => `line-${index}`);
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    mouseScroll: false,
    renderCluster: () => ({ lines: ["cluster-a", "cluster-b"], cursor: null }),
  });

  compositor.install();
  tui.render(40);

  assert.ok(!terminal.writes[0]?.includes("\x1b[?1002h"));
  assert.ok(!terminal.writes[0]?.includes("\x1b[?1006h"));
  assert.deepEqual(inputListener?.("\x1b[<64;1;1M"), undefined);
  assert.deepEqual(inputListener?.("\x1b[A"), undefined);
  assert.deepEqual(inputListener?.("\x1b[5~"), { consume: true });
  assert.deepEqual(renderRequests, [undefined]);

  compositor.dispose();
  assert.ok(!terminal.writes.at(-1)?.includes("\x1b[?1006l"));
  assert.ok(!terminal.writes.at(-1)?.includes("\x1b[?1002l"));
});

test("terminal split reuses the fixed cluster during one render pass", () => {
  const terminal = new FakeTerminal();
  let renderClusterCount = 0;
  const tui = {
    terminal,
    hardwareCursorRow: 0,
    cursorRow: 0,
    previousViewportTop: 0,
    render() {
      return ["root-a", "root-b"];
    },
    doRender() {
      void this.terminal.rows;
      this.render(this.terminal.columns);
      this.terminal.write("body");
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => {
      renderClusterCount += 1;
      return { lines: ["cluster-a", "cluster-b"], cursor: null };
    },
  });

  compositor.install();
  tui.doRender();

  assert.equal(renderClusterCount, 1);

  compositor.dispose();
});

test("emergency terminal reset exits alternate screen before clearing keyboard modes", () => {
  const cleanup = emergencyTerminalModeReset();
  assert.ok(cleanup.includes("\x1b[?1049l"));
  assert.ok(cleanup.includes("\x1b[<999u"));
  assert.ok(cleanup.includes("\x1b[>4;0m"));
  assert.ok(cleanup.indexOf("\x1b[?1049l") < cleanup.indexOf("\x1b[<999u"));
});

test("terminal split emergency exit cleanup resets extended keyboard modes", () => {
  const terminal = new FakeTerminal();
  const compositor = new TerminalSplitCompositor({
    tui: { terminal },
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  process.emit("exit", 0);

  const cleanup = terminal.writes.at(-1) ?? "";
  assert.ok(cleanup.includes("\x1b[<999u"));
  assert.ok(cleanup.includes("\x1b[>4;0m"));
  assert.ok(cleanup.indexOf("\x1b[?1049l") < cleanup.indexOf("\x1b[<999u"));

  compositor.dispose();
});

test("terminal split unregisters emergency exit cleanup on dispose", () => {
  const terminal = new FakeTerminal();
  const before = process.listenerCount("exit");
  const compositor = new TerminalSplitCompositor({
    tui: { terminal },
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  assert.equal(process.listenerCount("exit"), before + 1);

  compositor.dispose();
  assert.equal(process.listenerCount("exit"), before);
});

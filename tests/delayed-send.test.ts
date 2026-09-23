import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Editor = { getText(): string; handleInput(data: string): void; onSubmit?: (text: string) => void };

async function editorHarness(t: test.TestContext, powerline: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "powerline-send-delay-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  writeFileSync(join(root, "settings.json"), JSON.stringify({ powerline: { welcome: false, ...powerline }, bashMode: { completions: false } }));
  const { default: extension } = await import("../index.ts");
  const { KeybindingsManager } = await import(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js", import.meta.url).href);
  const sent: string[] = [];
  let editor!: Editor;
  const ctx = {
    cwd: root, hasUI: true, model: { name: "Test model", provider: "test" }, modelRegistry: {},
    sessionManager: { getBranch: () => [], getSessionId: () => "send-delay-test", getCwd: () => root },
    ui: {
      getEditorText: () => editor.getText(),
      setEditorComponent(factory?: (tui: object, theme: object, keys: object) => Editor) {
        if (!factory) return;
        editor = factory({ requestRender() {}, terminal: { columns: 80, rows: 24 } }, {}, KeybindingsManager.create());
        // Pi wires its submit handler onto the extension editor after the factory returns.
        editor.onSubmit = (text) => { sent.push(text); };
      },
      getEditorComponent: () => undefined,
      setStatus() {}, setWidget() {}, setFooter() {}, setHeader() {}, setWorkingMessage() {}, notify() {},
      onTerminalInput: () => () => {},
    },
  };
  const handlers = new Map<string, (event: object, context: typeof ctx) => unknown>();
  (extension as unknown as (api: object) => void)({
    on: (name: string, handler: (event: object, context: typeof ctx) => unknown) => handlers.set(name, handler),
    registerCommand() {},
    sendUserMessage() {},
    getCommands: () => [],
  });
  await handlers.get("session_start")?.({ reason: "new" }, ctx);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  t.after(async () => {
    await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
    t.mock.timers.reset();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
  });
  return {
    sent,
    text: () => editor.getText(),
    type: (text: string) => { for (const char of text) editor.handleInput(char); },
    enter: () => editor.handleInput("\r"),
    escape: () => editor.handleInput("\x1b"),
    tick: (ms: number) => t.mock.timers.tick(ms),
  };
}

test("Esc during the send delay returns the prompt to the editor without sending it", async (t) => {
  const h = await editorHarness(t, { sendDelayMs: 4000 });
  h.type("fix the test");
  h.enter();
  assert.equal(h.text(), "");
  h.type("also lint");
  h.tick(3999);
  h.escape();
  assert.equal(h.text(), "fix the test\n\nalso lint");
  h.tick(10000);
  assert.deepEqual(h.sent, []);
});

test("delayed prompts send after the delay, or right away on Enter with an empty editor", async (t) => {
  const h = await editorHarness(t, { sendDelayMs: 4000 });
  h.type("first");
  h.enter();
  h.tick(3999);
  assert.deepEqual(h.sent, []);
  h.tick(1);
  assert.deepEqual(h.sent, ["first"]);

  h.type("second");
  h.enter();
  h.enter();
  assert.deepEqual(h.sent, ["first", "second"]);
});

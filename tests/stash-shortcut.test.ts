import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchesStashShortcutInput } from "../shortcuts.ts";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

function projectSessionsPath(agentDir: string, cwd: string): string {
  const projectKey = cwd
    .replace(/^[/\\]+|[/\\]+$/g, "")
    .replace(/[/\\]+/g, "-");
  return join(agentDir, "sessions", `--${projectKey}--`);
}

function writeAgentSettings(agentDir: string): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ powerline: { welcome: false } }));
}

function writeStashHistory(agentDir: string, history: string[]): void {
  mkdirSync(join(agentDir, "powerline-footer"), { recursive: true });
  writeFileSync(join(agentDir, "powerline-footer", "stash-history.json"), JSON.stringify({ version: 1, history }));
}

function sessionLine(text: string, timestamp: number): string {
  return JSON.stringify({
    type: "message",
    message: { role: "user", content: text, timestamp },
    timestamp: new Date(timestamp).toISOString(),
  });
}

async function loadPowerline(agentDir: string) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const moduleUrl = new URL("../index.ts", import.meta.url);
  const mod = await import(`${moduleUrl.href}?stashTest=${Date.now()}-${Math.random()}`);
  return {
    extension: mod.default as (pi: any) => void,
    restoreEnv: () => {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    },
  };
}

function fakeTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function createFakePi() {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  return {
    handlers,
    commands,
    pi: {
      on(name: string, handler: (event: any, ctx: any) => Promise<void>) {
        handlers.set(name, handler);
      },
      registerCommand(name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) {
        commands.set(name, command);
      },
      sendUserMessage() {},
    },
  };
}

function createCtx(options: { cwd: string; text?: string; customInputs?: string[][] } = { cwd: process.cwd() }) {
  let text = options.text ?? "";
  let terminalInput: ((data: string) => unknown) | null = null;
  const setEditorTextCalls: string[] = [];
  const notifications: { message: string; level?: string }[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const customTitles: string[] = [];
  const customInputs = [...(options.customInputs ?? [])];

  const ctx = {
    cwd: options.cwd,
    hasUI: true,
    model: { name: "test", provider: "test" },
    modelRegistry: {},
    ui: {
      getEditorText: () => text,
      setEditorText: (next: string) => {
        setEditorTextCalls.push(next);
        text = next;
      },
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      notify: (message: string, level?: string) => notifications.push({ message, level }),
      setWorkingMessage() {},
      onTerminalInput: (handler: (data: string) => unknown) => {
        terminalInput = handler;
        return () => { terminalInput = null; };
      },
      custom: async (factory: any) => new Promise((resolve) => {
        const done = (result: unknown) => resolve(result);
        const component = factory({ requestRender() {} }, fakeTheme(), {}, done);
        const rendered = component.render(80).join("\n");
        const title = rendered.includes("Stashed prompts") && rendered.includes("Recent project prompts")
          ? "Prompt history"
          : rendered.includes("Stash history")
            ? "Stash history"
            : rendered.includes("Recent project prompts")
              ? "Recent project prompts"
              : "unknown";
        customTitles.push(title);
        for (const input of customInputs.shift() ?? ["\r"]) {
          component.handleInput(input);
        }
      }),
      select: async () => "Insert",
      setWidget() {},
      setFooter() {},
      setHeader() {},
      setEditorComponent() {},
      getEditorComponent: () => undefined,
    },
  };

  return {
    ctx,
    get text() { return text; },
    setEditorTextCalls,
    notifications,
    statuses,
    customTitles,
    sendTerminalInput: (data: string) => {
      assert.ok(terminalInput, "expected terminal input handler to be installed");
      return terminalInput(data);
    },
  };
}

test("stash shortcut matches Alt+S encodings without consuming literal sharp-S by default", () => {
  assert.equal(matchesStashShortcutInput("ß"), false);
  assert.equal(matchesStashShortcutInput("ß", { includePrintableSharpS: true }), true);

  for (const data of [
    "\x1bs",
    "\x1bS",
    "\x1b[115;3u",
    "\x1b[83;3u",
    "\x1b[27;3;115~",
    "\x1b[27;3;83~",
  ]) {
    assert.equal(matchesStashShortcutInput(data), true, data);
  }

  assert.equal(matchesStashShortcutInput("s"), false);
  assert.equal(matchesStashShortcutInput("\x1b[115;5u"), false);
});

test("stash shortcut stays in terminal/editor fallback routing", () => {
  assert.doesNotMatch(source, /pi\.registerShortcut\("alt\+s"/);
  assert.match(source, /matchesStashShortcutInput\(data, \{ includePrintableSharpS: config\.stashSharpSShortcut \}\)/);
  assert.match(source, /ctx\.ui\.onTerminalInput\(\(data: string\) =>/);
  assert.match(source, /if \(isStashShortcutInput\(data\)\)/);
  assert.match(source, /function stashOrRestoreEditorText\(ctx: any\): void/);
  assert.match(source, /function isPromptHistoryShortcutInput\(data: string\): boolean/);
  assert.match(source, /matchesConfiguredShortcut\(data, resolvedShortcuts\.stashHistory\)/);
  assert.doesNotMatch(source, /data === "\\x1b\\b"/);
  assert.doesNotMatch(source, /data === "\\x1b\\x7f"/);
});

test("agent_end leaves an active stash untouched until explicit restore", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "powerline-stash-agent-end-"));
  const cwd = mkdtempSync(join(tmpdir(), "powerline-stash-cwd-"));
  writeAgentSettings(agentDir);
  const { extension, restoreEnv } = await loadPowerline(agentDir);

  try {
    const fake = createFakePi();
    extension(fake.pi);
    const runtime = createCtx({ cwd, text: "draft to keep" });
    await fake.handlers.get("session_start")?.({ reason: "resume" }, runtime.ctx);

    runtime.sendTerminalInput("\x1bs");
    assert.equal(runtime.text, "");
    assert.deepEqual(runtime.statuses.at(-1), ["stash", "stash"]);

    runtime.setEditorTextCalls.length = 0;
    await fake.handlers.get("agent_end")?.({}, runtime.ctx);
    assert.deepEqual(runtime.setEditorTextCalls, []);
    assert.equal(runtime.text, "");
    assert.deepEqual(runtime.statuses.at(-1), ["stash", "stash"]);
    assert.equal(runtime.notifications.some((entry) => entry.message === "Stash restored"), false);

    runtime.sendTerminalInput("\x1bs");
    assert.equal(runtime.text, "draft to keep");
    assert.deepEqual(runtime.statuses.at(-1), ["stash", undefined]);
    assert.equal(runtime.notifications.some((entry) => entry.message === "Stash restored"), true);
  } finally {
    restoreEnv();
  }
});

test("stash history can open stashed prompts without reading project JSONL", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "powerline-stash-history-fast-"));
  const cwd = "/tmp/powerline-stash-history-cwd";
  writeAgentSettings(agentDir);
  writeStashHistory(agentDir, ["saved stash"]);
  const sessionsPath = projectSessionsPath(agentDir, cwd);
  mkdirSync(sessionsPath, { recursive: true });
  writeFileSync(join(sessionsPath, "broken.jsonl"), '{"type":"message","message":{"role":"user",');
  const { extension, restoreEnv } = await loadPowerline(agentDir);

  try {
    const fake = createFakePi();
    extension(fake.pi);
    const runtime = createCtx({ cwd, customInputs: [["\r"], ["\r"]] });
    await fake.commands.get("stash-history")?.handler("", runtime.ctx);

    assert.deepEqual(runtime.customTitles, ["Prompt history", "Stash history"]);
    assert.equal(runtime.text, "saved stash");
    assert.equal(runtime.notifications.some((entry) => entry.level === "warning"), false);
  } finally {
    restoreEnv();
  }
});

test("stash history loads project prompts on demand from bounded newest files", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "powerline-project-history-"));
  const cwd = "/tmp/powerline-project-history-cwd";
  writeAgentSettings(agentDir);
  writeStashHistory(agentDir, ["saved stash"]);
  const sessionsPath = projectSessionsPath(agentDir, cwd);
  mkdirSync(sessionsPath, { recursive: true });

  const now = Date.now();
  for (let i = 0; i < 50; i += 1) {
    const filePath = join(sessionsPath, `recent-${String(i).padStart(2, "0")}.jsonl`);
    writeFileSync(filePath, `${sessionLine(`project prompt ${i}`, now - i)}\n`);
    const mtime = new Date(now - i * 1000);
    utimesSync(filePath, mtime, mtime);
  }
  const oldBrokenPath = join(sessionsPath, "old-broken.jsonl");
  writeFileSync(oldBrokenPath, '{"type":"message","message":{"role":"user",');
  const oldTime = new Date(now - 100_000);
  utimesSync(oldBrokenPath, oldTime, oldTime);

  const { extension, restoreEnv } = await loadPowerline(agentDir);

  try {
    const fake = createFakePi();
    extension(fake.pi);
    const runtime = createCtx({ cwd, customInputs: [["\x1b[B", "\r"], ["\r"]] });
    await fake.commands.get("stash-history")?.handler("", runtime.ctx);

    assert.deepEqual(runtime.customTitles, ["Prompt history", "Recent project prompts"]);
    assert.equal(runtime.text, "project prompt 0");
    assert.equal(runtime.notifications.some((entry) => entry.level === "warning"), false);
  } finally {
    restoreEnv();
  }
});

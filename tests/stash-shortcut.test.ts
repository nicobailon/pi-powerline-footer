import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchesStashShortcutInput } from "../shortcuts.ts";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { PowerlineQueueStore } from "../queue/store.ts";
import childProcess from "node:child_process";
import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { waitForGitUpdates } from "../git-status.ts";
import { NERD_ICONS } from "../icons.ts";

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

type FakeTheme = ReturnType<typeof fakeTheme>;
interface FakeComponent {
  render(width: number): string[];
  handleInput(data: string): void;
}
type CustomFactory = (
  tui: { requestRender(): void },
  theme: FakeTheme,
  keybindings: Record<string, never>,
  done: (result: unknown) => void,
) => FakeComponent;
interface FakeCtx {
  cwd: string;
  sessionManager?: { getCwd(): string };
  hasUI: boolean;
  model: { name: string; provider: string };
  modelRegistry: Record<string, never>;
  ui: {
    getEditorText(): string;
    setEditorText(next: string): void;
    setStatus(key: string, value: string | undefined): void;
    notify(message: string, level?: string): void;
    setWorkingMessage(): void;
    onTerminalInput(handler: (data: string) => unknown): () => void;
    custom(factory: CustomFactory): Promise<unknown>;
    select(): Promise<string>;
    setWidget(name: string, factory: ((tui: { requestRender(): void }, theme: FakeTheme) => { render(width: number): string[] }) | undefined): void;
    setFooter(factory?: (tui: { requestRender(): void }, theme: FakeTheme, provider: ReadonlyFooterDataProvider) => { dispose(): void }): void;
    setHeader(): void;
    setEditorComponent(): void;
    getEditorComponent(): undefined;
  };
}
type TestHandler = (event: unknown, ctx: FakeCtx) => Promise<void> | void;
type TestCommand = { handler: (args: string, ctx: FakeCtx) => Promise<void> | void };
interface TestPi {
  on(name: string, handler: TestHandler): void;
  registerCommand(name: string, command: TestCommand): void;
  sendUserMessage(): void;
}

async function loadPowerline(agentDir: string) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const moduleUrl = new URL("../index.ts", import.meta.url);
  const mod = await import(`${moduleUrl.href}?stashTest=${Date.now()}-${Math.random()}`);
  return {
    extension: mod.default as (pi: TestPi) => void,
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
  const handlers = new Map<string, TestHandler>();
  const commands = new Map<string, TestCommand>();
  return {
    handlers,
    commands,
    pi: {
      on(name: string, handler: TestHandler) {
        handlers.set(name, handler);
      },
      registerCommand(name: string, command: TestCommand) {
        commands.set(name, command);
      },
      sendUserMessage() {},
    },
  };
}

function createCtx(options: { cwd: string; text?: string; customInputs?: string[][]; footerData?: ReadonlyFooterDataProvider; theme?: FakeTheme } = { cwd: process.cwd() }) {
  let text = options.text ?? "";
  let terminalInput: ((data: string) => unknown) | null = null;
  const setEditorTextCalls: string[] = [];
  const notifications: { message: string; level?: string }[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const customTitles: string[] = [];
  const customInputs = [...(options.customInputs ?? [])];
  const widgets = new Map<string, { render(width: number): string[] }>();
  let footer: { dispose(): void } | undefined;

  const ctx: FakeCtx = {
    cwd: options.cwd,
    sessionManager: { getCwd: () => options.cwd },
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
      custom: async (factory: CustomFactory) => new Promise((resolve) => {
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
      setWidget(name, factory) {
        if (factory) widgets.set(name, factory({ requestRender() {} }, options.theme ?? fakeTheme()));
        else widgets.delete(name);
      },
      setFooter(factory) {
        footer?.dispose();
        footer = factory && options.footerData ? factory({ requestRender() {} }, fakeTheme(), options.footerData) : undefined;
      },
      setHeader() {},
      setEditorComponent() {},
      getEditorComponent: () => undefined,
    },
  };

  return {
    ctx,
    widgets,
    disposeFooter: () => ctx.ui.setFooter(undefined),
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

test("Git rendering reuses the cwd-owned provider only on demand and refreshes across sessions", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "powerline-git-display-"));
  const repoA = join(root, "repo-a");
  const repoB = join(root, "repo-b");
  for (const [cwd, branch, host] of [[repoA, "branch-a", "github.com"], [repoB, "branch-b", "gitlab.com"]]) {
    mkdirSync(cwd);
    childProcess.execFileSync("git", ["init", "-q", "-b", branch], { cwd });
    childProcess.execFileSync("git", ["remote", "add", "origin", `https://${host}/owner/repo`], { cwd });
  }
  writeFileSync(join(repoA, "dirty"), "untracked");
  const oldFonts = process.env.POWERLINE_NERD_FONTS;
  process.env.POWERLINE_NERD_FONTS = "1";
  const { extension, restoreEnv } = await loadPowerline(root);
  const fake = createFakePi();
  let providerCwd = repoA;
  let allowBranchRead = false;
  const listeners = new Set<() => void>();
  const footerData: ReadonlyFooterDataProvider = {
    getGitBranch() {
      assert.ok(allowBranchRead, "unused Git must not read Pi's branch getter");
      return readFileSync(join(providerCwd, ".git", "HEAD"), "utf8").trim().replace("ref: refs/heads/", "");
    },
    getExtensionStatuses: () => new Map(),
    getAvailableProviderCount: () => 0,
    onBranchChange(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
  const spawn = childProcess.spawn;
  const calls: Parameters<typeof spawn>[] = [];
  t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    calls.push(args);
    return spawn(...args);
  });
  syncBuiltinESMExports();
  let runtime: ReturnType<typeof createCtx> | undefined;
  const layout = { left: ["git"], right: [], secondary: [] };
  const hiddenCounts = { showStaged: false, showUnstaged: false, showUntracked: false };
  const start = async (powerline: Record<string, unknown>, cwd = repoA) => {
    runtime?.disposeFooter();
    // Mirror Pi's applyRuntimeSettings -> bindExtensions -> session_start ordering.
    providerCwd = cwd;
    writeFileSync(join(root, "settings.json"), JSON.stringify({ powerline: { welcome: false, layout, ...powerline } }));
    runtime = createCtx({ cwd, footerData, theme: { ...fakeTheme(), fg: (color, text) => `<${color}>${text}</${color}>` } });
    await fake.handlers.get("session_start")?.({ reason: "resume" }, runtime.ctx);
    calls.length = 0;
  };
  const render = () => runtime!.widgets.get("powerline-top")!.render(240).join("\n");
  try {
    extension(fake.pi);
    for (const settings of [
      { preset: "full", layout: undefined, disabledSegments: ["git"] },
      { layout: { left: ["model"], right: [], secondary: [] } },
      { git: { ...hiddenCounts, showBranch: false, hostIcon: true } },
    ]) {
      await start(settings);
      render();
      await waitForGitUpdates();
      assert.deepEqual(calls, [], "no Git process for absent, disabled, or wholly hidden Git");
    }
    t.diagnostic("Unused Git: provider getter forbidden; no Git subprocesses in disabled/omitted/hidden layouts");
    allowBranchRead = true;
    for (const polling of ["off", "branch", "full"]) {
      await start({ git: { ...hiddenCounts, polling } });
      assert.match(render(), /branch-a/);
      await waitForGitUpdates();
      assert.deepEqual(calls.map(([, args]) => args), polling === "full" ? [["status", "--porcelain"]] : []);
      t.diagnostic(`Attached ${polling}: ${calls.map(([, args]) => args?.join(" ")).join(", ") || "no subprocesses"}`);
    }
    assert.match(render(), /<warning>[^<]*branch-a<\/warning>/, "full mode keeps dirty coloring with hidden counts");
    fs.unlinkSync(join(repoA, "dirty"));
    for (const notify of listeners) notify();
    assert.match(render(), /<warning>[^<]*branch-a<\/warning>/, "same-cwd refresh serves stale counts");
    await waitForGitUpdates();
    assert.match(render(), /<success>[^<]*branch-a<\/success>/);

    writeFileSync(join(repoA, "dirty"), "untracked again");
    await start({ git: { hostIcon: true } });
    render();
    await waitForGitUpdates();
    assert.ok(render().includes(NERD_ICONS.github));
    assert.match(render(), /<warning>/);
    await start({ git: { hostIcon: true } }, repoB);
    const immediate = render();
    assert.match(immediate, /branch-b/);
    assert.doesNotMatch(immediate, /branch-a|<warning>/);
    assert.ok(!immediate.includes(NERD_ICONS.github));
    await waitForGitUpdates();
    assert.ok(render().includes(NERD_ICONS.gitlab));
    assert.ok(calls.every(([, , options]) => options?.cwd === repoB), "status and host reads use ctx.cwd, not ambient cwd");
    runtime!.disposeFooter();
    assert.equal(listeners.size, 0, "footer disposal unsubscribes branch notifications");
  } finally {
    await waitForGitUpdates();
    runtime?.disposeFooter();
    if (runtime) await fake.handlers.get("session_shutdown")?.({}, runtime.ctx);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (oldFonts === undefined) delete process.env.POWERLINE_NERD_FONTS;
    else process.env.POWERLINE_NERD_FONTS = oldFonts;
    restoreEnv();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("footer queue demand follows resolved layout while preview and picker stay independent", async () => {
  for (const powerline of [
    { preset: "full", disabledSegments: ["queue"] },
    { layout: { left: ["model"], right: [], secondary: [] } },
    { layout: { left: [], right: [], secondary: ["queue"] } },
  ]) {
    const root = mkdtempSync(join(tmpdir(), "powerline-queue-display-"));
    writeFileSync(join(root, "settings.json"), JSON.stringify({ powerline: { welcome: false, ...powerline } }));
    const inbox = join(root, "powerline-footer", "inbox.jsonl");
    const store = new PowerlineQueueStore(inbox, join(root, "projects.json"));
    store.add({ text: "independent preview", source: { cwd: root }, target: { kind: "global" }, intent: "follow-up" });
    const { extension, restoreEnv } = await loadPowerline(root);
    const fake = createFakePi();
    const runtime = createCtx({ cwd: root, customInputs: [["\x1b"]] });
    const originalRead = fs.readFileSync;
    try {
      extension(fake.pi);
      await fake.handlers.get("session_start")?.({ reason: "resume" }, runtime.ctx);
      const denied = Object.assign(new Error("inbox denied"), { code: "EACCES" });
      fs.readFileSync = ((path, ...args) => {
        if (path === inbox) throw denied;
        return Reflect.apply(originalRead, fs, [path, ...args]);
      }) as typeof fs.readFileSync;
      syncBuiltinESMExports();
      const renderFooter = () => runtime.widgets.get("powerline-top")!.render(120);
      if (powerline.layout?.secondary.includes("queue")) assert.throws(renderFooter, denied);
      else assert.doesNotThrow(renderFooter);
      assert.throws(() => runtime.widgets.get("powerline-queue-preview")!.render(120), denied);
      fs.readFileSync = originalRead;
      syncBuiltinESMExports();
      assert.match(runtime.widgets.get("powerline-queue-preview")!.render(120).join("\n"), /queued: independent preview/);
      await fake.commands.get("queue")!.handler("", runtime.ctx);
      assert.equal(runtime.customTitles.length, 1, "queue picker opens independently of footer layout");
    } finally {
      fs.readFileSync = originalRead;
      syncBuiltinESMExports();
      await fake.handlers.get("session_shutdown")?.({}, runtime.ctx);
      restoreEnv();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

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

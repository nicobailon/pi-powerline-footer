import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { discoverLoadedCounts, getRecentSessions, WelcomeHeader } from "../welcome.ts";

test("discoverLoadedCounts ignores dangling skill symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "powerline-welcome-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const skillsDir = join(home, ".pi", "agent", "skills");
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalCwd = process.cwd();
  const originalDebug = console.debug;
  const debugCalls: unknown[][] = [];

  mkdirSync(join(skillsDir, "valid-skill"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(skillsDir, "valid-skill", "SKILL.md"), "# Valid skill\n");
  symlinkSync(join(root, "missing-skill"), join(skillsDir, "pi-intercom"), "dir");

  console.debug = (...args: unknown[]) => {
    debugCalls.push(args);
  };

  try {
    process.env.HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    process.chdir(project);

    assert.equal(discoverLoadedCounts().skills, 1);
    assert.deepEqual(debugCalls, []);
  } finally {
    console.debug = originalDebug;
    process.chdir(originalCwd);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

async function withTemporaryHome(run: (home: string) => void | Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "powerline-welcome-home-"));
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

  try {
    process.env.HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    await run(home);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

test("welcome renders the initial system prompt token estimate", () => {
  const counts = { contextFiles: 1, extensions: 1, skills: 1, promptTemplates: 1 };
  const rendered = new WelcomeHeader("Model", "Provider", [], counts, 1900)
    .render(96)
    .join("\n")
    .replace(/\x1b\[[0-9;]*m/g, "");
  const withoutEstimate = [undefined, 0, Number.NaN].map((tokens) => new WelcomeHeader(
    "Model",
    "Provider",
    [],
    counts,
    tokens,
  ).render(96).join("\n").replace(/\x1b\[[0-9;]*m/g, ""));

  assert.match(rendered, /≈ 1\.9k initial prompt tokens/);
  for (const output of withoutEstimate) {
    assert.doesNotMatch(output, /initial prompt tokens/);
  }
});

test("getRecentSessions prefers cwd basename from session header", async () => {
  await withTemporaryHome(async (home) => {
    const sessionsDir = join(home, ".pi", "agent", "sessions", "--Users-nico-dev-encoded-name--");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session.jsonl"), JSON.stringify({ cwd: "/Users/nico/dev/my-dashed-project" }) + "\n");

    assert.equal((await getRecentSessions(1))[0]?.name, "my-dashed-project");
  });
});

test("getRecentSessions falls back to encoded directory when header cwd is unusable", async () => {
  await withTemporaryHome(async (home) => {
    const root = join(home, ".pi", "agent", "sessions");
    const cases = [
      ["invalid-json", "not-json\n"],
      ["missing-cwd", JSON.stringify({ type: "session" }) + "\n"],
      ["non-string-cwd", JSON.stringify({ cwd: 123 }) + "\n"],
    ];

    for (const [name, content] of cases) {
      const sessionsDir = join(root, `--Users-nico-dev-${name}--`);
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, "session.jsonl"), content);
    }

    const names = (await getRecentSessions(10)).map((session) => session.name);
    assert.ok(names.includes("json"));
    assert.ok(names.includes("cwd"));
  });
});

test("welcome discovery respects PI_CODING_AGENT_DIR for agent-global files", async () => {
  await withTemporaryHome((home) => {
    const root = mkdtempSync(join(tmpdir(), "powerline-welcome-agent-dir-"));
    const project = join(root, "project");
    const agentDir = join(root, "agent-dir");
    const originalCwd = process.cwd();

    try {
      process.env.PI_CODING_AGENT_DIR = agentDir;
      mkdirSync(project, { recursive: true });
      mkdirSync(join(agentDir, "extensions", "local-ext"), { recursive: true });
      mkdirSync(join(agentDir, "skills", "skill-a"), { recursive: true });
      mkdirSync(join(agentDir, "commands"), { recursive: true });
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      writeFileSync(join(agentDir, "AGENTS.md"), "# Agent instructions\n");
      writeFileSync(join(agentDir, "extensions", "local-ext", "index.ts"), "export default {};\n");
      writeFileSync(join(agentDir, "skills", "skill-a", "SKILL.md"), "# Skill\n");
      writeFileSync(join(agentDir, "commands", "hello.md"), "hello\n");
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pkg-one@1.0.0"] }));
      writeFileSync(join(home, ".pi", "agent", "AGENTS.md"), "# Should not count\n");
      process.chdir(project);

      assert.deepEqual(discoverLoadedCounts(), {
        contextFiles: 1,
        extensions: 2,
        skills: 1,
        promptTemplates: 1,
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("getRecentSessions reads custom agent sessions and existing legacy sessions", async () => {
  await withTemporaryHome(async (home) => {
    const root = mkdtempSync(join(tmpdir(), "powerline-welcome-sessions-"));
    const agentDir = join(root, "agent-dir");

    try {
      process.env.PI_CODING_AGENT_DIR = agentDir;
      const customSessionDir = join(agentDir, "sessions", "--custom--");
      const legacySessionDir = join(home, ".pi", "sessions", "--legacy--");
      mkdirSync(customSessionDir, { recursive: true });
      mkdirSync(legacySessionDir, { recursive: true });
      writeFileSync(join(customSessionDir, "session.jsonl"), JSON.stringify({ cwd: "/tmp/custom-project" }) + "\n");
      writeFileSync(join(legacySessionDir, "session.jsonl"), JSON.stringify({ cwd: "/tmp/legacy-project" }) + "\n");

      const names = (await getRecentSessions(10)).map((session) => session.name);
      assert.ok(names.includes("custom-project"));
      assert.ok(names.includes("legacy-project"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("getRecentSessions selects newest distinct projects across a large nested archive", async () => {
  await withTemporaryHome(async (home) => {
    const root = join(home, ".pi", "agent", "sessions");
    const nested = join(root, "--encoded--", "artifacts", "nested");
    mkdirSync(nested, { recursive: true });
    const now = Date.now();
    for (let i = 0; i < 1000; i++) {
      const file = join(nested, `${i}.jsonl`);
      writeFileSync(file, JSON.stringify({ cwd: "/projects/older" }) + "\n");
      utimesSync(file, (now - 86_400_000) / 1000, (now - 86_400_000) / 1000);
    }
    const recent = [
      ["a.jsonl", JSON.stringify({ cwd: "/projects/my-dashed-project" }), 60_000],
      ["b.jsonl", JSON.stringify({ cwd: "/other/my-dashed-project" }), 120_000],
      ["c.jsonl", "not-json", 180_000],
      ["d.jsonl", JSON.stringify({ cwd: "/projects/third" }), 240_000],
    ] as const;
    for (const [name, header, age] of recent) {
      const file = join(nested, name);
      writeFileSync(file, header + "\n" + "ignored body".repeat(1000));
      utimesSync(file, (now - age) / 1000, (now - age) / 1000);
    }

    assert.deepEqual(await getRecentSessions(), [
      { name: "my-dashed-project", timeAgo: "1m ago" },
      { name: "nested", timeAgo: "3m ago" },
      { name: "third", timeAgo: "4m ago" },
    ]);
  });
});

test("getRecentSessions rejects pre-aborted and in-flight discovery without partial results", async () => {
  await withTemporaryHome(async (home) => {
    const root = join(home, ".pi", "agent", "sessions");
    mkdirSync(root, { recursive: true });
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(root, `${i}.jsonl`), JSON.stringify({ cwd: `/projects/${i}` }) + "\n");
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(getRecentSessions(3, controller.signal), { name: "AbortError" });

    const running = new AbortController();
    const result = getRecentSessions(3, running.signal);
    const rejected = assert.rejects(result, { name: "AbortError" });
    await setImmediate();
    running.abort();
    await rejected;
    // Cleanup immediately after completion also exercises closed handles on Windows.
    rmSync(root, { recursive: true });
    assert.deepEqual(await getRecentSessions(), []);
  });
});

test("getRecentSessions follows nested directory links without looping", async () => {
  await withTemporaryHome(async (home) => {
    const root = join(home, ".pi", "agent", "sessions");
    const archive = join(home, "archive");
    mkdirSync(root, { recursive: true });
    mkdirSync(archive);
    writeFileSync(join(archive, "session.jsonl"), JSON.stringify({ cwd: "/projects/linked" }) + "\n");
    symlinkSync(archive, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    symlinkSync(root, join(archive, "cycle"), process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual(await getRecentSessions(), [{ name: "linked", timeAgo: "just now" }]);
  });
});

type WelcomeView = { render(width: number): string[]; handleInput?(data: string): void };
type WelcomeEditor = { getText(): string; handleInput(data: string): void };

async function welcomeHarness(t: test.TestContext, home: string, quietStartup: boolean) {
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    quietStartup, powerline: { welcome: true }, bashMode: { completions: false },
  }));
  const { default: extension } = await import("../index.ts");
  const { KeybindingsManager } = await import(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js", import.meta.url).href);
  const timeouts = new Map<object, () => unknown>();
  t.mock.method(globalThis, "setTimeout", (callback: () => unknown) => {
    const handle = {};
    timeouts.set(handle, callback);
    return handle;
  });
  t.mock.method(globalThis, "clearTimeout", (handle: object) => timeouts.delete(handle));
  const tui = { requestRender() {}, terminal: { columns: 96, rows: 30 } };
  let editor: WelcomeEditor;
  let view: WelcomeView | undefined;
  let installations = 0;
  const ctx = {
    cwd: home, hasUI: true, model: { name: "Test model", provider: "test" }, modelRegistry: {},
    sessionManager: { getBranch: () => [], getSessionId: () => "welcome-test" },
    ui: {
      getEditorText: () => editor?.getText() ?? "",
      setEditorComponent(factory?: (tui: object, theme: object, keys: object) => WelcomeEditor) {
        if (factory) editor = factory(tui, {}, KeybindingsManager.create());
      },
      getEditorComponent: () => undefined,
      setHeader(factory?: () => WelcomeView) {
        view = factory?.();
        if (view) installations++;
      },
      custom(factory: (tui: object, theme: object, keys: object, done: () => void) => WelcomeView) {
        return new Promise<void>((resolve) => {
          view = factory(tui, {}, {}, () => { view = undefined; resolve(); });
          installations++;
        });
      },
      setStatus() {}, setWidget() {}, setFooter() {}, setWorkingMessage() {}, notify() {},
      onTerminalInput: () => () => {},
    },
  };
  type Handler = (event: { reason?: string }, context: typeof ctx) => unknown;
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand() {},
    sendUserMessage() {},
  };
  (extension as unknown as (api: typeof pi) => void)(pi);
  return {
    ctx,
    get view() { return view; },
    get installations() { return installations; },
    type: (text: string) => editor.handleInput(text),
    event: async (name: string, reason?: string) => { await handlers.get(name)?.({ reason }, ctx); },
    runStartupWork: () => {
      const callbacks = [...timeouts.values()];
      timeouts.clear();
      return Promise.all(callbacks.map((callback) => callback()));
    },
  };
}

test("pending welcome discovery is cancelled by typing or nonblocking shutdown", async (t) => {
  for (const quiet of [true, false]) {
    for (const action of ["typing", "shutdown"] as const) {
      await t.test(`${quiet ? "header" : "overlay"}: ${action}`, async (t) => {
        await withTemporaryHome(async (home) => {
          const harness = await welcomeHarness(t, home, quiet);
          const entered = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const realpath = fsPromises.realpath;
          t.mock.method(fsPromises, "realpath", async (path: string) => {
            if (path === join(home, ".pi", "agent", "sessions")) {
              entered.resolve();
              await release.promise;
            }
            return realpath(path);
          });
          syncBuiltinESMExports();
          let operation: Promise<unknown> | undefined;
          try {
            await harness.event("session_start", "startup");
            operation = harness.runStartupWork();
            await entered.promise;
            if (action === "typing") {
              harness.type("x");
              harness.type("\x7f"); // Empty again: cancellation, not draft text, must prevent resurrection.
              assert.equal(harness.ctx.ui.getEditorText(), "");
            } else {
              // Shutdown must finish even while the filesystem operation remains blocked.
              await harness.event("session_shutdown");
            }
            release.resolve();
            await operation;
            assert.equal(harness.installations, 0);
          } finally {
            release.resolve();
            await operation;
            await harness.event("session_shutdown");
            t.mock.restoreAll();
            syncBuiltinESMExports();
          }
        });
      });
    }
  }
});

test("eligible welcome installs and dismisses without losing input", async (t) => {
  for (const quiet of [true, false]) {
    await t.test(quiet ? "header" : "overlay", async (t) => {
      await withTemporaryHome(async (home) => {
        const harness = await welcomeHarness(t, home, quiet);
        try {
          await harness.event("session_start", "startup");
          await harness.runStartupWork();
          const view = harness.view;
          assert.ok(view);
          assert.match(view.render(96).join("\n"), /Test model/);
          if (!quiet) {
            view.handleInput?.("x");
            assert.equal(harness.ctx.ui.getEditorText(), "x");
          } else {
            harness.type("x");
          }
          assert.equal(harness.view, undefined);
          assert.equal(harness.installations, 1);
        } finally {
          await harness.event("session_shutdown");
          t.mock.restoreAll();
        }
      });
    });
  }
});

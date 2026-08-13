import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLoadedCounts, getRecentSessions, WelcomeHeader } from "../welcome.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

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

function withTemporaryHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "powerline-welcome-home-"));
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

  try {
    process.env.HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    run(home);
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
  assert.match(indexSource, /new WelcomeHeader\(modelName, providerName, recentSessions, loadedCounts, initialContextTokens\)/);

  const overlayStart = indexSource.indexOf("function setupWelcomeOverlay");
  const delayStart = indexSource.indexOf("setTimeout(() => {", overlayStart);
  const activityGuardStart = indexSource.indexOf("if (hasActivity) {", delayStart);
  const estimateStart = indexSource.indexOf("const initialContextTokens = estimateInitialContextTokens(ctx);", overlayStart);
  const componentStart = indexSource.indexOf("new WelcomeComponent(", overlayStart);
  assert.ok(overlayStart >= 0);
  assert.ok(delayStart > overlayStart);
  assert.ok(activityGuardStart > delayStart);
  assert.ok(estimateStart > activityGuardStart);
  assert.ok(componentStart > estimateStart);
});

test("getRecentSessions prefers cwd basename from session header", () => {
  withTemporaryHome((home) => {
    const sessionsDir = join(home, ".pi", "agent", "sessions", "--Users-nico-dev-encoded-name--");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session.jsonl"), JSON.stringify({ cwd: "/Users/nico/dev/my-dashed-project" }) + "\n");

    assert.equal(getRecentSessions(1)[0]?.name, "my-dashed-project");
  });
});

test("getRecentSessions falls back to encoded directory when header cwd is unusable", () => {
  withTemporaryHome((home) => {
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

    const names = getRecentSessions(10).map((session) => session.name);
    assert.ok(names.includes("json"));
    assert.ok(names.includes("cwd"));
  });
});

test("welcome discovery respects PI_CODING_AGENT_DIR for agent-global files", () => {
  withTemporaryHome((home) => {
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

test("welcome input dismissal is synchronous", () => {
  const dismissForInputStart = indexSource.indexOf("function dismissWelcomeForInput");
  const directDismissStart = indexSource.indexOf("dismissWelcome(ctx);", dismissForInputStart);
  const inputHandlerStart = indexSource.indexOf("const handlePowerlineEditorInput = (data: string) => {");
  const inputDismissStart = indexSource.indexOf("dismissWelcomeForInput(ctx);", inputHandlerStart);
  const printableStart = indexSource.indexOf("if (isPrintableInput(data))", inputHandlerStart);

  assert.ok(dismissForInputStart >= 0);
  assert.ok(directDismissStart > dismissForInputStart);
  assert.ok(inputDismissStart > inputHandlerStart);
  assert.ok(printableStart > inputDismissStart);
  assert.equal(indexSource.includes("welcomeDismissScheduler"), false);
});

test("welcome overlay forwards the dismissing keypress to the editor", () => {
  const overlayStart = indexSource.indexOf("function setupWelcomeOverlay");
  const handleInputStart = indexSource.indexOf("handleInput: (data: string) => {", overlayStart);
  const wantsKeyReleaseStart = indexSource.indexOf("wantsKeyRelease: true,", overlayStart);
  const dismissStart = indexSource.indexOf("dismiss();", handleInputStart);
  const forwardStart = indexSource.indexOf("if (!isKeyRelease(data)) currentEditor?.handleInput(data);", handleInputStart);

  assert.ok(overlayStart >= 0);
  assert.ok(wantsKeyReleaseStart > overlayStart);
  assert.ok(handleInputStart > wantsKeyReleaseStart);
  assert.ok(dismissStart > handleInputStart);
  assert.ok(forwardStart > dismissStart);
});

test("getRecentSessions reads custom agent sessions and existing legacy sessions", () => {
  withTemporaryHome((home) => {
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

      const names = getRecentSessions(10).map((session) => session.name);
      assert.ok(names.includes("custom-project"));
      assert.ok(names.includes("legacy-project"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

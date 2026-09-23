import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type InputEvent = { type: "input"; text: string; source: string; streamingBehavior?: "steer" | "followUp" };

async function harness(t: test.TestContext, jevAnswer: () => Response) {
  const root = mkdtempSync(join(tmpdir(), "powerline-auto-follow-up-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousKey = process.env.TYPESAFE_API_KEY;
  process.env.PI_CODING_AGENT_DIR = root;
  process.env.TYPESAFE_API_KEY = "test-key";
  writeFileSync(join(root, "settings.json"), JSON.stringify({ powerline: { welcome: false, autoFollowUp: true } }));
  const requests: { state: Record<string, string> }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return jevAnswer();
  });
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
    rmSync(root, { recursive: true, force: true });
  });

  const { default: extension } = await import("../index.ts");
  const sent: unknown[][] = [];
  const warnings: string[] = [];
  const ctx = {
    cwd: root, hasUI: false,
    sessionManager: { getBranch: () => [], getSessionId: () => "auto-follow-up-test", getCwd: () => root },
    ui: { notify: (message: string, level: string) => { if (level === "warning") warnings.push(message); } },
  };
  const handlers = new Map<string, (event: object, context: typeof ctx) => unknown>();
  (extension as unknown as (api: object) => void)({
    on: (name: string, handler: (event: object, context: typeof ctx) => unknown) => handlers.set(name, handler),
    registerCommand() {},
    sendUserMessage: (...args: unknown[]) => { sent.push(args); },
    getCommands: () => [],
  });
  await handlers.get("before_agent_start")?.({ prompt: "Fix the checkout bug" }, ctx);
  return {
    requests,
    sent,
    warnings,
    input: (event: Omit<InputEvent, "type">) => handlers.get("input")!({ type: "input", ...event }, ctx),
  };
}

const jevRoute = (choice: string, confidence: number) => () =>
  Response.json({ answers: { route: { choice, confidence } } });

test("a steered message Jev is confident can wait is queued as a follow-up", async (t) => {
  const h = await harness(t, jevRoute("follow_up", 0.95));
  const result = await h.input({ text: "What is the weather in Lisbon?", source: "interactive", streamingBehavior: "steer" });
  assert.deepEqual(result, { action: "handled" });
  assert.deepEqual(h.sent, [["What is the weather in Lisbon?", { deliverAs: "followUp" }]]);
  assert.equal(h.requests[0]?.state.current_task, "Fix the checkout bug");
  assert.equal(h.requests[0]?.state.new_message, "What is the weather in Lisbon?");
});

test("corrections and unsure answers stay as steering", async (t) => {
  for (const answer of [jevRoute("steer", 0.99), jevRoute("follow_up", 0.5)]) {
    const h = await harness(t, answer);
    const result = await h.input({ text: "Actually, preserve the public API.", source: "interactive", streamingBehavior: "steer" });
    assert.equal(result, undefined);
    assert.deepEqual(h.sent, []);
  }
});

test("Jev failures stay as steering and say so", async (t) => {
  const h = await harness(t, () => new Response("bad key", { status: 401 }));
  assert.equal(await h.input({ text: "also lint", source: "interactive", streamingBehavior: "steer" }), undefined);
  assert.deepEqual(h.sent, []);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0]!, /401.*sent as steering/);
});

test("Alt+Enter follow-ups, idle prompts, slash commands, and extension messages skip Jev", async (t) => {
  const h = await harness(t, jevRoute("follow_up", 0.95));
  const skipped: Omit<InputEvent, "type">[] = [
    { text: "later task", source: "interactive", streamingBehavior: "followUp" },
    { text: "new task", source: "interactive" },
    { text: "/compact", source: "interactive", streamingBehavior: "steer" },
    { text: "from an extension", source: "extension", streamingBehavior: "steer" },
  ];
  for (const event of skipped) assert.equal(await h.input(event), undefined);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.sent, []);
});

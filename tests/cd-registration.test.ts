import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parsePowerlineConfig } from "../powerline-config.ts";

async function registeredCommands(powerline: unknown): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "powerline-cd-registration-"));
  const agentDir = join(root, "agent");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousCwd = process.cwd();
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ powerline }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.chdir(root);
  try {
    const { default: powerlineFooter } = await import("../index.ts");
    const commands: string[] = [];
    powerlineFooter({
      on() {},
      registerCommand(name: string) { commands.push(name); },
      registerShortcut() {},
    } as unknown as ExtensionAPI);
    return commands.sort();
  } finally {
    process.chdir(previousCwd);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
  }
}

test("cd is enabled by default and only an explicit false disables it", async () => {
  const defaults = await registeredCommands(undefined);
  assert.ok(defaults.includes("cd"), "precondition: default footer owns cd");
  assert.ok(defaults.includes("queue"), "precondition: other footer commands are registered");
  assert.deepEqual(await registeredCommands({ cdCommand: false }), defaults.filter(name => name !== "cd"));
  for (const powerline of ["compact", {}, { cdCommand: true }, { cdCommand: "false" }, { cdCommand: null }]) {
    assert.equal(parsePowerlineConfig(powerline, ["default", "compact"]).cdCommand, true);
    assert.deepEqual(await registeredCommands(powerline), defaults);
  }
  assert.equal(parsePowerlineConfig({ cdCommand: false }, ["default"]).cdCommand, false);
});

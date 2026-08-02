import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseVibeGenerateArgs } from "../working-vibes.ts";

const FAUX_PROVIDER_PATH = new URL("../node_modules/@earendil-works/pi-ai/dist/providers/faux.js", import.meta.url).href;

async function importFauxProviderTools() {
  try {
    return await import("@earendil-works/pi-ai/compat");
  } catch (error) {
    const code = error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
    if (code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
    return import(FAUX_PROVIDER_PATH);
  }
}

function ensurePiModuleLinks(): { cleanup: () => void } {
  const nodeModulesDir = join(process.cwd(), "node_modules", "@earendil-works");
  mkdirSync(nodeModulesDir, { recursive: true });
  const links = [
    {
      link: join(nodeModulesDir, "pi-coding-agent"),
      target: "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
    },
    {
      link: join(nodeModulesDir, "pi-ai"),
      target: "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai",
    },
  ];

  const createdLinks: string[] = [];
  for (const { link, target } of links) {
    if (!existsSync(link)) {
      symlinkSync(target, link);
      createdLinks.push(link);
    }
  }

  return {
    cleanup() {
      for (const link of createdLinks.reverse()) {
        if (existsSync(link)) {
          rmSync(link, { recursive: true, force: true });
        }
      }
    },
  };
}

test("parseVibeGenerateArgs supports multi-word themes", () => {
  assert.deepEqual(parseVibeGenerateArgs(["pirate", "200"]), { theme: "pirate", count: 200 });
  assert.deepEqual(parseVibeGenerateArgs(["star", "trek", "200"]), { theme: "star trek", count: 200 });
  assert.deepEqual(parseVibeGenerateArgs(["star", "trek"]), { theme: "star trek", count: 100 });
  assert.deepEqual(parseVibeGenerateArgs(["star", "trek", "abc"]), { theme: "star trek abc", count: 100 });
  assert.deepEqual(parseVibeGenerateArgs(["lord", "of", "rings", "999"]), { theme: "lord of rings", count: 500 });
  assert.equal(parseVibeGenerateArgs([]), null);
});

test("generateVibesBatch includes a system prompt so faux providers can return text", async () => {
  const links = ensurePiModuleLinks();
  const home = mkdtempSync(join(tmpdir(), "powerline-vibes-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;

  try {
    const { fauxAssistantMessage, fauxProvider } = await importFauxProviderTools();
    const { generateVibesBatch, initVibeManager, setVibeModel } = await import("../working-vibes.ts");

    const registration = fauxProvider({
      provider: "test-provider",
      models: [{ id: "test-model" }],
    });

    const model = registration.getModel("test-model");
    assert.ok(model);

    registration.setResponses([
      (context) => {
        assert.match(context.systemPrompt ?? "", /loading messages/i);
        return fauxAssistantMessage("Engaging warp drive...\nRunning diagnostics...");
      },
    ]);

    initVibeManager({
      modelRegistry: {
        find(provider: string, modelId: string) {
          return provider === "test-provider" && modelId === "test-model" ? model : undefined;
        },
        async getApiKeyAndHeaders() {
          return { ok: true, apiKey: "test-key", headers: {} };
        },
        getProvider(provider: string) {
          return provider === "test-provider" ? registration.provider : undefined;
        },
        async getProviderAuth() {
          return undefined;
        },
      },
    });

    assert.equal(setVibeModel("test-provider/test-model"), true);

    const result = await generateVibesBatch("star trek", 2);

    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.equal(existsSync(result.filePath), true);
    assert.deepEqual(readFileSync(result.filePath, "utf8").trim().split("\n"), [
      "Engaging warp drive...",
      "Running diagnostics...",
    ]);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(home, { recursive: true, force: true });
    links.cleanup();
  }
});

test("generateVibesBatch forwards resolved provider env and credential base URL", async () => {
  const links = ensurePiModuleLinks();
  const home = mkdtempSync(join(tmpdir(), "powerline-vibes-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;

  try {
    const { fauxAssistantMessage, fauxProvider } = await importFauxProviderTools();
    const { generateVibesBatch, initVibeManager, setVibeModel } = await import("../working-vibes.ts");

    const registration = fauxProvider({
      provider: "test-provider",
      models: [{ id: "test-model" }],
    });

    const model = registration.getModel("test-model");
    assert.ok(model);

    registration.setResponses([
      (_context, options, _state, requestModel) => {
        assert.deepEqual(options?.env, { AWS_PROFILE: "vibes" });
        assert.equal(requestModel.baseUrl, "https://credential.example/v1");
        return fauxAssistantMessage("Signing the request...");
      },
    ]);

    initVibeManager({
      modelRegistry: {
        find(provider: string, modelId: string) {
          return provider === "test-provider" && modelId === "test-model" ? model : undefined;
        },
        async getApiKeyAndHeaders() {
          return { ok: true, apiKey: "test-key", headers: {}, env: { AWS_PROFILE: "vibes" } };
        },
        getProvider(provider: string) {
          return provider === "test-provider" ? registration.provider : undefined;
        },
        async getProviderAuth() {
          return { auth: { apiKey: "test-key", baseUrl: "https://credential.example/v1" } };
        },
      },
    });

    assert.equal(setVibeModel("test-provider/test-model"), true);

    const result = await generateVibesBatch("bedrock", 1);

    assert.equal(result.success, true);
    assert.deepEqual(readFileSync(result.filePath, "utf8").trim().split("\n"), [
      "Signing the request...",
    ]);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(home, { recursive: true, force: true });
    links.cleanup();
  }
});

test("on-demand vibe generation includes a system prompt for providers that require instructions", async () => {
  const links = ensurePiModuleLinks();
  const home = mkdtempSync(join(tmpdir(), "powerline-vibes-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;

  try {
    const { fauxAssistantMessage, fauxProvider } = await importFauxProviderTools();
    const { initVibeManager, onVibeAgentStart, onVibeBeforeAgentStart, setVibeModel, setVibeTheme } = await import("../working-vibes.ts");

    const registration = fauxProvider({
      provider: "test-provider",
      models: [{ id: "test-model" }],
    });

    const model = registration.getModel("test-model");
    assert.ok(model);

    registration.setResponses([
      (context) => {
        assert.match(context.systemPrompt ?? "", /loading messages/i);
        return fauxAssistantMessage("Engaging warp drive...");
      },
    ]);

    initVibeManager({
      modelRegistry: {
        find(provider: string, modelId: string) {
          return provider === "test-provider" && modelId === "test-model" ? model : undefined;
        },
        async getApiKeyAndHeaders() {
          return { ok: true, apiKey: "test-key", headers: {} };
        },
        getProvider(provider: string) {
          return provider === "test-provider" ? registration.provider : undefined;
        },
        async getProviderAuth() {
          return undefined;
        },
      },
    });

    assert.equal(setVibeTheme("star trek"), true);
    assert.equal(setVibeModel("test-provider/test-model"), true);

    const updates: Array<string | undefined> = [];
    onVibeAgentStart();
    onVibeBeforeAgentStart("fix a bug", (message) => {
      updates.push(message);
    });

    const start = Date.now();
    while (!updates.includes("Engaging warp drive...") && Date.now() - start < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(updates[0], "Channeling star trek...");
    assert.ok(updates.includes("Engaging warp drive..."));
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(home, { recursive: true, force: true });
    links.cleanup();
  }
});

test("generateVibesBatch preserves provider errors instead of reporting an empty response", async () => {
  const links = ensurePiModuleLinks();
  const home = mkdtempSync(join(tmpdir(), "powerline-vibes-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;

  try {
    const { fauxAssistantMessage, fauxProvider } = await importFauxProviderTools();
    const { generateVibesBatch, initVibeManager, setVibeModel } = await import("../working-vibes.ts");

    const registration = fauxProvider({
      provider: "test-provider",
      models: [{ id: "test-model" }],
    });

    const model = registration.getModel("test-model");
    assert.ok(model);

    registration.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "Instructions are required",
      }),
    ]);

    initVibeManager({
      modelRegistry: {
        find(provider: string, modelId: string) {
          return provider === "test-provider" && modelId === "test-model" ? model : undefined;
        },
        async getApiKeyAndHeaders() {
          return { ok: true, apiKey: "test-key", headers: {} };
        },
        getProvider(provider: string) {
          return provider === "test-provider" ? registration.provider : undefined;
        },
        async getProviderAuth() {
          return undefined;
        },
      },
    });

    assert.equal(setVibeModel("test-provider/test-model"), true);

    const result = await generateVibesBatch("noir", 2);

    assert.equal(result.success, false);
    assert.equal(result.error, "Instructions are required");
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(home, { recursive: true, force: true });
    links.cleanup();
  }
});

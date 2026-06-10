import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const welcomeSource = readFileSync(new URL("../welcome.ts", import.meta.url), "utf-8");
const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
const contextUsageSource = readFileSync(new URL("../context-usage.ts", import.meta.url), "utf-8");
const tokenEstimateSource = readFileSync(new URL("../token-estimate.ts", import.meta.url), "utf-8");

test("welcome renders initial context token estimate when available", () => {
  assert.match(welcomeSource, /initialContextTokens: number \| null/);
  assert.match(welcomeSource, /function formatTokens\(n: number\): string/);
  assert.match(welcomeSource, /typeof data\.initialContextTokens === "number"/);
  assert.match(welcomeSource, /countLines\.push\(` \$\{itemPrefix\}\$\{fgOnly\("gitClean", `≈ ?\$\{formatTokens\(data\.initialContextTokens\)\}`\)\} initial tokens`\);/);
});

test("welcome setup pulls initial context tokens from system prompt estimate", () => {
  assert.match(contextUsageSource, /export \{ estimatePromptTokens \} from "\.\/token-estimate\.ts";/);
  assert.match(tokenEstimateSource, /export function estimatePromptTokens\(text: string\): number/);
  assert.match(contextUsageSource, /export function estimateInitialContextTokens\(ctx: unknown\): number \| null/);
  assert.match(contextUsageSource, /const prompt = ctx\.getSystemPrompt\(\);/);
  assert.match(indexSource, /const initialContextTokens = estimateInitialContextTokens\(ctx\);/);
  assert.match(indexSource, /new WelcomeHeader\(/);
  assert.match(indexSource, /loadedCounts,\n\s+initialContextTokens,\n\s+\);/);
});

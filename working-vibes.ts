// working-vibes.ts
// AI-generated contextual working messages that match a user's preferred theme/vibe.
// Uses module-level state (matching powerline-footer pattern).

import { complete, type Context } from "@mariozechner/pi-ai";
import { getAgentDir, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  patchPowerlineSetting,
  readPowerlineSettings,
  readSettings,
} from "./settings.js";

type VibeMode = "generate" | "file";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";

const DEFAULT_PROMPT = `Generate a 2-4 word "{theme}" themed loading message ending in "...".

Task: {task}

Be creative and unexpected. Avoid obvious/clichéd phrases for this theme.
The message should hint at the task using theme vocabulary.
{exclude}
Output only the message, nothing else.`;

const BATCH_PROMPT = `Generate {count} unique 2-4 word loading messages for a "{theme}" theme.
Each message should end with "..."
Be creative, varied, and thematic. No duplicates.
Output one message per line, nothing else. No numbering, no bullets.`;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface VibeConfig {
  theme: string | null;        // null = disabled
  mode: VibeMode;              // "generate" (on-demand) or "file" (pre-generated)
  modelSpec: string;           // default: "anthropic/claude-haiku-4-5"
  fallback: string;            // default: "Working"
  timeout: number;             // default: 3000ms
  refreshInterval: number;     // default: 30000ms (30s)
  promptTemplate: string;      // template with {theme}, {task}, {exclude} placeholders
  maxLength: number;           // default: 65 chars
}

interface VibeGenContext {
  theme: string;
  userPrompt: string;          // from event.prompt in before_agent_start
}

// ═══════════════════════════════════════════════════════════════════════════
// Module-level State
// ═══════════════════════════════════════════════════════════════════════════

function getDefaultConfig(): VibeConfig {
  return {
    theme: null,
    mode: "generate",
    modelSpec: DEFAULT_MODEL,
    fallback: "Working",
    timeout: 3000,
    refreshInterval: 30000,
    promptTemplate: DEFAULT_PROMPT,
    maxLength: 65,
  };
}

let config: VibeConfig = getDefaultConfig();
let extensionCtx: ExtensionContext | null = null;
let currentGeneration: AbortController | null = null;
let isStreaming = false;
let lastVibeTime = 0;

// File-based mode state
let vibeCache: string[] = [];        // Cached vibes from file
let vibeCacheTheme: string | null = null;  // Theme the cache is for
let vibeSeed = Date.now();           // Seed for deterministic shuffle
let vibeIndex = 0;                   // Current position in shuffled list

// Recent vibes tracking (to avoid repetition in generate mode)
const MAX_RECENT_VIBES = 5;
let recentVibes: string[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// Configuration Management
// ═══════════════════════════════════════════════════════════════════════════

function loadConfig(): VibeConfig {
  const rawSettings = readSettings("working-vibes");
  const settings = readPowerlineSettings(rawSettings);
  const rawTheme = typeof settings.vibe?.theme === "string" ? settings.vibe.theme : null;
  const theme = rawTheme?.toLowerCase() === "off" ? null : rawTheme;
  const rawMode = settings.vibe?.mode;
  const mode: VibeMode = rawMode === "file" || rawMode === "generate" ? rawMode : "generate";

  const refreshSeconds =
    typeof settings.vibe?.refreshInterval === "number" && Number.isFinite(settings.vibe.refreshInterval)
      ? Math.max(0, settings.vibe.refreshInterval)
      : 30;

  const maxLength =
    typeof settings.vibe?.maxLength === "number" && Number.isFinite(settings.vibe.maxLength)
      ? Math.max(4, Math.floor(settings.vibe.maxLength))
      : 65;

  return {
    theme,
    mode,
    modelSpec: typeof settings.vibe?.model === "string" ? settings.vibe.model : DEFAULT_MODEL,
    fallback: typeof settings.vibe?.fallback === "string" ? settings.vibe.fallback : "Working",
    timeout: 3000,
    refreshInterval: refreshSeconds * 1000,
    promptTemplate: typeof settings.vibe?.prompt === "string" ? settings.vibe.prompt : DEFAULT_PROMPT,
    maxLength,
  };
}

function patchVibeSetting(scope: string, patch: Record<string, unknown>): boolean {
  return patchPowerlineSetting({ vibe: patch }, "working-vibes", scope);
}


// ═══════════════════════════════════════════════════════════════════════════
// File-Based Vibe Management
// ═══════════════════════════════════════════════════════════════════════════

function getVibesDir(): string {
  return join(getAgentDir(), "vibes");
}

function toVibeFileSlug(theme: string): string {
  const slug = theme
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return slug || "theme";
}

function getVibeFilePath(theme: string): string {
  const filename = `${toVibeFileSlug(theme)}.txt`;
  return join(getVibesDir(), filename);
}

function loadVibesFromFile(theme: string): string[] {
  const filePath = getVibeFilePath(theme);
  if (!existsSync(filePath)) return [];
  
  try {
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && line.endsWith("..."));
  } catch (error) {
    console.debug(`[working-vibes] Failed to load vibe file ${filePath}:`, error);
    return [];
  }
}

function saveVibesToFile(theme: string, vibes: string[]): void {
  const vibesDir = getVibesDir();
  const filePath = getVibeFilePath(theme);
  
  // Ensure directory exists
  if (!existsSync(vibesDir)) {
    mkdirSync(vibesDir, { recursive: true });
  }
  
  writeFileSync(filePath, vibes.join("\n"));
}

// Mulberry32 PRNG - fast, deterministic, good distribution
function mulberry32(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Get vibe at index using seeded shuffle (no-repeat until all used)
function getVibeAtIndex(vibes: string[], index: number, seed: number): string {
  if (vibes.length === 0) return `${config.fallback}...`;
  
  // For small lists or when we've cycled through, just use modulo
  const effectiveIndex = index % vibes.length;
  
  // Create deterministic shuffle using seed
  const rng = mulberry32(seed);
  const indices = Array.from({ length: vibes.length }, (_, i) => i);
  
  // Fisher-Yates shuffle with seeded RNG
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  
  return vibes[indices[effectiveIndex]];
}

function getNextVibeFromFile(): string {
  if (!config.theme) return `${config.fallback}...`;
  
  // Load/reload cache if theme changed
  if (vibeCacheTheme !== config.theme) {
    vibeCache = loadVibesFromFile(config.theme);
    vibeCacheTheme = config.theme;
    vibeSeed = Date.now();  // New seed for new theme
    vibeIndex = 0;
  }
  
  if (vibeCache.length === 0) {
    return `${config.fallback}...`;
  }
  
  const vibe = getVibeAtIndex(vibeCache, vibeIndex, vibeSeed);
  vibeIndex++;
  return vibe;
}

// ═══════════════════════════════════════════════════════════════════════════
// Prompt Building & Response Parsing (Pure Functions)
// ═══════════════════════════════════════════════════════════════════════════

function buildVibePrompt(ctx: VibeGenContext): string {
  // Truncate user prompt to save tokens (most context in first 100 chars)
  const task = ctx.userPrompt.slice(0, 100);
  
  // Build exclusion list from recent vibes
  const exclude = recentVibes.length > 0 
    ? `Don't use: ${recentVibes.join(", ")}`
    : "";
  
  // Use configured template with variable substitution
  return config.promptTemplate
    .replace(/\{theme\}/g, ctx.theme)
    .replace(/\{task\}/g, task)
    .replace(/\{exclude\}/g, exclude);
}

function parseVibeResponse(response: string, fallback: string): string {
  if (!response) return `${fallback}...`;
  
  // Take only the first line (AI sometimes adds explanations)
  let vibe = response.trim().split('\n')[0].trim();
  
  // Remove quotes if model wrapped the response
  vibe = vibe.replace(/^["']|["']$/g, "");
  
  // Ensure ellipsis
  if (!vibe.endsWith("...")) {
    vibe = vibe.replace(/\.+$/, "") + "...";
  }
  
  // Enforce length limit (configurable, default 65 chars)
  if (vibe.length > config.maxLength) {
    vibe = vibe.slice(0, config.maxLength - 3) + "...";
  }
  
  // Final validation
  if (!vibe || vibe === "...") {
    return `${fallback}...`;
  }
  
  return vibe;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI Generation
// ═══════════════════════════════════════════════════════════════════════════

async function generateVibe(
  ctx: VibeGenContext,
  signal: AbortSignal,
): Promise<string> {
  if (!extensionCtx) {
    return `${config.fallback}...`;
  }
  
  // Parse model spec (provider/modelId format, where modelId may contain slashes)
  const slashIndex = config.modelSpec.indexOf("/");
  if (slashIndex === -1) {
    return `${config.fallback}...`;
  }
  const provider = config.modelSpec.slice(0, slashIndex);
  const modelId = config.modelSpec.slice(slashIndex + 1);
  if (!provider || !modelId) {
    return `${config.fallback}...`;
  }
  
  // Resolve model from registry
  const model = extensionCtx.modelRegistry.find(provider, modelId);
  if (!model) {
    console.debug(`[working-vibes] Model not found: ${config.modelSpec}`);
    return `${config.fallback}...`;
  }
  
  // Get auth
  const auth = await extensionCtx.modelRegistry.getApiKeyAndHeaders(model);
  if (auth.ok === false) {
    console.debug(`[working-vibes] Auth failed for ${provider}: ${auth.error}`);
    return `${config.fallback}...`;
  }
  
  // Build minimal context (just a user message, no system prompt or tools)
  const aiContext: Context = {
    messages: [{
      role: "user",
      content: [{ type: "text", text: buildVibePrompt(ctx) }],
      timestamp: Date.now(),
    }],
  };
  
  // Call model with timeout
  const response = await complete(model, aiContext, { apiKey: auth.apiKey, headers: auth.headers, signal });
  
  // Extract and parse response
  const textContent = response.content.find(c => c.type === "text");
  return parseVibeResponse(textContent?.text || "", config.fallback);
}

function trackRecentVibe(vibe: string): void {
  // Don't track fallback messages
  if (vibe === `${config.fallback}...`) return;
  
  // Add to front, remove duplicates
  recentVibes = [vibe, ...recentVibes.filter(v => v !== vibe)].slice(0, MAX_RECENT_VIBES);
}

function updateVibeFromFile(setWorkingMessage: (msg?: string) => void): void {
  const vibe = getNextVibeFromFile();
  // Always set message - file mode is synchronous, no need for isStreaming check
  // (unlike generate mode which needs to check if still streaming after async API call)
  setWorkingMessage(vibe);
}

async function generateAndUpdate(
  prompt: string, 
  setWorkingMessage: (msg?: string) => void,
): Promise<void> {
  // File mode: instant, no API call
  if (config.mode === "file") {
    updateVibeFromFile(setWorkingMessage);
    return;
  }
  
  // Generate mode: API call with abort handling
  // Cancel any in-flight generation and create new controller
  // Capture in local variable to avoid race condition with subsequent calls
  const controller = new AbortController();
  currentGeneration?.abort();
  currentGeneration = controller;
  
  // Create timeout signal (3 seconds)
  const timeoutSignal = AbortSignal.timeout(config.timeout);
  const combinedSignal = AbortSignal.any([
    controller.signal,
    timeoutSignal,
  ]);
  
  try {
    const vibe = await generateVibe(
      { theme: config.theme!, userPrompt: prompt },
      combinedSignal,
    );
    
    // Only update if still streaming and THIS generation wasn't aborted
    if (isStreaming && !controller.signal.aborted) {
      trackRecentVibe(vibe);
      setWorkingMessage(vibe);
    }
  } catch (error) {
    // AbortError is expected on timeout/cancel - don't log as error
    if (error instanceof Error && error.name === "AbortError") {
      console.debug("[working-vibes] Generation aborted");
    } else {
      console.debug("[working-vibes] Generation failed:", error);
    }
    // Fallback already showing, no action needed
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported Functions (called from index.ts)
// ═══════════════════════════════════════════════════════════════════════════

export function initVibeManager(ctx: ExtensionContext): void {
  extensionCtx = ctx;
  config = loadConfig(); // Refresh config in case settings changed
}

export function getVibeTheme(): string | null {
  return config.theme;
}

export function setVibeTheme(theme: string | null): boolean {
  config = { ...config, theme };
  recentVibes = [];  // Clear recent vibes on theme change
  return patchVibeSetting("workingVibe", {
    theme: config.theme ?? undefined,
  });
}

export function getVibeModel(): string {
  return config.modelSpec;
}

export function setVibeModel(modelSpec: string): boolean {
  config = { ...config, modelSpec };
  return patchVibeSetting("workingVibeModel", {
    model: config.modelSpec === DEFAULT_MODEL ? undefined : config.modelSpec,
  });
}

export function onVibeBeforeAgentStart(
  prompt: string, 
  setWorkingMessage: (msg?: string) => void,
): void {
  // Skip if no theme configured or no extensionCtx
  if (!config.theme || !extensionCtx) return;
  
  // Queue themed placeholder BEFORE agent_start creates the loader
  // This sets pendingWorkingMessage which is applied when loader is created
  setWorkingMessage(`Channeling ${config.theme}...`);
  
  // Mark vibe generation time for rate limiting
  lastVibeTime = Date.now();
  
  // Async: generate and update (fire-and-forget, don't await)
  generateAndUpdate(prompt, setWorkingMessage);
}

export function onVibeAgentStart(): void {
  isStreaming = true;
}

export function onVibeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  setWorkingMessage: (msg?: string) => void,
  agentContext?: string,  // Optional: recent agent response text for richer context
): void {
  // Skip if no theme, not streaming, or no extensionCtx
  if (!config.theme || !extensionCtx || !isStreaming) return;
  
  // Rate limit: skip if not enough time has passed
  const now = Date.now();
  if (now - lastVibeTime < config.refreshInterval) return;
  
  // Prefer agent context if provided (richer, more contextual)
  // Fall back to tool-based hint
  let hint: string;
  if (agentContext && agentContext.length > 10) {
    // Use first ~150 chars of agent context
    hint = agentContext.slice(0, 150);
  } else {
    // Build hint from tool name and input
    hint = `using ${toolName} tool`;
    if (toolName === "read" && toolInput.path) {
      hint = `reading file: ${toolInput.path}`;
    } else if (toolName === "write" && toolInput.path) {
      hint = `writing file: ${toolInput.path}`;
    } else if (toolName === "edit" && toolInput.path) {
      hint = `editing file: ${toolInput.path}`;
    } else if (toolName === "bash" && toolInput.command) {
      const cmd = String(toolInput.command).slice(0, 40);
      hint = `running command: ${cmd}`;
    }
  }
  
  // Update time and generate new vibe
  lastVibeTime = now;
  generateAndUpdate(hint, setWorkingMessage);
}

export function onVibeAgentEnd(setWorkingMessage: (msg?: string) => void): void {
  isStreaming = false;
  // Cancel any in-flight generation
  currentGeneration?.abort();
  // Reset to pi's default working message
  setWorkingMessage(undefined);
}

export function getVibeMode(): VibeMode {
  return config.mode;
}

export function setVibeMode(mode: VibeMode): boolean {
  config = { ...config, mode };
  return patchVibeSetting("workingVibeMode", {
    mode: config.mode === "generate" ? undefined : config.mode,
  });
}

export function hasVibeFile(theme: string): boolean {
  return existsSync(getVibeFilePath(theme));
}

export function getVibeFileCount(theme: string): number {
  const vibes = loadVibesFromFile(theme);
  return vibes.length;
}

export interface GenerateVibesResult {
  success: boolean;
  count: number;
  filePath: string;
  error?: string;
}

export async function generateVibesBatch(
  theme: string,
  count: number = 100,
): Promise<GenerateVibesResult> {
  const filePath = getVibeFilePath(theme);
  const safeCount = Number.isFinite(count) ? Math.min(Math.max(Math.floor(count), 1), 500) : 100;
  
  if (!extensionCtx) {
    return { success: false, count: 0, filePath, error: "Extension not initialized" };
  }
  
  // Parse model spec
  const slashIndex = config.modelSpec.indexOf("/");
  if (slashIndex === -1) {
    return { success: false, count: 0, filePath, error: "Invalid model spec" };
  }
  const provider = config.modelSpec.slice(0, slashIndex);
  const modelId = config.modelSpec.slice(slashIndex + 1);
  
  // Resolve model
  const model = extensionCtx.modelRegistry.find(provider, modelId);
  if (!model) {
    return { success: false, count: 0, filePath, error: `Model not found: ${config.modelSpec}` };
  }
  
  // Get auth
  const auth = await extensionCtx.modelRegistry.getApiKeyAndHeaders(model);
  if (auth.ok === false) {
    return { success: false, count: 0, filePath, error: auth.error };
  }
  
  // Build batch prompt
  const prompt = BATCH_PROMPT
    .replace(/\{theme\}/g, theme)
    .replace(/\{count\}/g, String(safeCount));
  
  const aiContext: Context = {
    messages: [{
      role: "user",
      content: [{ type: "text", text: prompt }],
      timestamp: Date.now(),
    }],
  };
  
  try {
    // Use longer timeout for batch generation (30 seconds)
    const signal = AbortSignal.timeout(30000);
    const response = await complete(model, aiContext, { apiKey: auth.apiKey, headers: auth.headers, signal });
    
    const textContent = response.content.find(c => c.type === "text");
    if (!textContent?.text) {
      return { success: false, count: 0, filePath, error: "Empty response from model" };
    }
    
    // Parse response: one vibe per line
    const vibes = textContent.text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Clean up each line
        let vibe = line.replace(/^["'\d.\-)\s]+/, "").trim();  // Remove leading quotes, numbers, bullets
        vibe = vibe.replace(/["']$/g, "");  // Remove trailing quotes
        if (!vibe.endsWith("...")) {
          vibe = vibe.replace(/\.+$/, "") + "...";
        }
        return vibe;
      })
      .filter(vibe => vibe.length > 3 && vibe !== "...");  // Filter invalid
    
    if (vibes.length === 0) {
      return { success: false, count: 0, filePath, error: "No valid vibes generated" };
    }
    
    // Save to file
    saveVibesToFile(theme, vibes);
    
    // Clear cache so next use loads fresh
    if (vibeCacheTheme === theme) {
      vibeCache = [];
      vibeCacheTheme = null;
    }
    
    return { success: true, count: vibes.length, filePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, count: 0, filePath, error: message };
  }
}

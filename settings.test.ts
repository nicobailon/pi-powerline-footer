import { describe, expect, test } from "vitest";

import {
  applyPowerlineSettings,
  migrateLegacyPowerlineSettings,
  readPowerlineSettings,
} from "./settings.js";

describe("readPowerlineSettings", () => {
  test("supports string shorthand preset selection", () => {
    expect(readPowerlineSettings({ powerline: "nerd" })).toEqual({
      preset: "nerd",
    });
  });

  test("reads nested powerline object settings", () => {
    expect(
      readPowerlineSettings({
        powerline: {
          preset: "compact",
          showLastPrompt: false,
          shortcuts: { stashHistory: "ctrl+alt+k" },
          vibe: {
            theme: "nested-theme",
            mode: "file",
            model: "openai/gpt-5-mini",
          },
        },
      }),
    ).toEqual({
      preset: "compact",
      showLastPrompt: false,
      shortcuts: { stashHistory: "ctrl+alt+k" },
      vibe: {
        theme: "nested-theme",
        mode: "file",
        model: "openai/gpt-5-mini",
      },
    });
  });
});

describe("migrateLegacyPowerlineSettings", () => {
  test("moves legacy aliases into powerline and deletes old keys", () => {
    const settings: Record<string, unknown> = {
      powerline: {
        preset: "minimal",
        vibe: {
          model: "openai/gpt-5-mini",
        },
      },
      showLastPrompt: false,
      powerlineShortcuts: { stashHistory: "ctrl+alt+p" },
      workingVibe: "star trek",
      workingVibeMode: "file",
      workingVibeFallback: "Working",
    };

    expect(migrateLegacyPowerlineSettings(settings)).toBe(true);
    expect(settings).toEqual({
      powerline: {
        preset: "minimal",
        showLastPrompt: false,
        shortcuts: { stashHistory: "ctrl+alt+p" },
        vibe: {
          theme: "star trek",
          mode: "file",
          model: "openai/gpt-5-mini",
          fallback: "Working",
        },
      },
    });
  });

  test("keeps nested values when both nested and legacy are present", () => {
    const settings: Record<string, unknown> = {
      powerline: {
        preset: "compact",
        showLastPrompt: false,
        shortcuts: { stashHistory: "ctrl+alt+k" },
        vibe: {
          theme: "nested-theme",
          mode: "file",
          model: "openai/gpt-5-mini",
        },
      },
      showLastPrompt: true,
      powerlineShortcuts: { stashHistory: "ctrl+alt+h" },
      workingVibe: "legacy-theme",
      workingVibeMode: "generate",
      workingVibeModel: "anthropic/claude-haiku-4-5",
    };

    expect(migrateLegacyPowerlineSettings(settings)).toBe(true);
    expect(settings).toEqual({
      powerline: {
        preset: "compact",
        showLastPrompt: false,
        shortcuts: { stashHistory: "ctrl+alt+k" },
        vibe: {
          theme: "nested-theme",
          mode: "file",
          model: "openai/gpt-5-mini",
        },
      },
    });
  });
});

describe("applyPowerlineSettings", () => {
  test("writes nested powerline settings", () => {
    const settings: Record<string, unknown> = {
      powerline: "nerd",
      unrelated: true,
    };

    applyPowerlineSettings(settings, {
      preset: "compact",
      shortcuts: { stashHistory: "ctrl+alt+k" },
      vibe: { theme: "zen" },
    });

    expect(settings).toEqual({
      powerline: {
        preset: "compact",
        shortcuts: { stashHistory: "ctrl+alt+k" },
        vibe: { theme: "zen" },
      },
      unrelated: true,
    });
  });
});

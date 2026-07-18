import test from "node:test";
import assert from "node:assert/strict";
import { buildContentFromParts, ensurePillBg, resolveSeparatorStyle } from "../index.ts";
import { parsePowerlineConfig } from "../powerline-config.ts";
import { getPreset, PRESETS } from "../presets.ts";
import { applyBgColor, rainbow, resolveColor, setPillBold, setSettingsColors } from "../theme.ts";
import { renderSegment } from "../segments.ts";
import { getSeparatorChars } from "../icons.ts";

const PRESET_NAMES = Object.keys(PRESETS) as Array<keyof typeof PRESETS>;
const plainTheme = { fg: (_color: string, text: string) => text };

const originalNerdFonts = process.env.POWERLINE_NERD_FONTS;
process.env.POWERLINE_NERD_FONTS = "1";
test.after(() => {
  if (originalNerdFonts === undefined) {
    delete process.env.POWERLINE_NERD_FONTS;
  } else {
    process.env.POWERLINE_NERD_FONTS = originalNerdFonts;
  }
});

function bgAnsi(rgb: [number, number, number]): string {
  return `\x1b[48;2;${rgb.join(";")}m`;
}

function fgAnsi(rgb: [number, number, number]): string {
  return `\x1b[38;2;${rgb.join(";")}m`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("settings.json separator is parsed", () => {
  const parsed = parsePowerlineConfig({ segmentStyle: "pill", separator: "powerline" }, PRESET_NAMES);
  assert.equal(parsed.segmentStyle, "pill");
  assert.equal(parsed.separator, "powerline");

  const invalid = parsePowerlineConfig({ separator: "nope" }, PRESET_NAMES);
  assert.equal(invalid.separator, null);

  const missing = parsePowerlineConfig({ segmentStyle: "pill" }, PRESET_NAMES);
  assert.equal(missing.separator, null);
});

test("resolveSeparatorStyle: explicit config wins, pill defaults to solid powerline", () => {
  const defaultPreset = getPreset("default"); // preset separator: powerline-thin
  assert.equal(resolveSeparatorStyle(defaultPreset, "pill", "powerline-thin"), "powerline-thin");
  assert.equal(resolveSeparatorStyle(defaultPreset, "pill", null), "powerline");
  assert.equal(resolveSeparatorStyle(defaultPreset, "fg", null), "powerline-thin");
  assert.equal(resolveSeparatorStyle(getPreset("full"), "pill", null), "powerline");
});

test("ensurePillBg keeps existing pills and wraps fg-only content in a neutral pill", () => {
  const pill = applyBgColor(plainTheme, "#d787af", "model");
  assert.equal(ensurePillBg(pill), pill);

  const wrapped = ensurePillBg(rainbow("think:high"));
  assert.ok(wrapped.startsWith(bgAnsi(hexToRgb("#45475a"))));
  assert.equal(stripAnsi(wrapped), " think:high ");
});

test("pill mode renders a seamless starship-style bar with transitions and end cap", () => {
  const arrow = getSeparatorChars().powerlineLeft;
  const modelRgb = hexToRgb("#d787af");
  const pathRgb = hexToRgb("#00afaf");
  const gitRgb = hexToRgb("#f9e2af");
  const neutralRgb = hexToRgb("#45475a");

  const parts = [
    applyBgColor(plainTheme, "#d787af", " Kimi K3"),
    rainbow("think:high"), // fg-only: must be wrapped, not break the chain
    applyBgColor(plainTheme, "#00afaf", " project"),
    applyBgColor(plainTheme, "#f9e2af", " main *1"),
  ];

  const out = buildContentFromParts(parts, "powerline", "pill", "arrow");

  // Every boundary gets a colored transition arrow: bg=next, fg=current
  const transition = (from: [number, number, number], to: [number, number, number]) =>
    `${bgAnsi(to)}${fgAnsi(from)}${arrow}`;
  assert.ok(out.includes(transition(modelRgb, neutralRgb)), "model → thinking transition");
  assert.ok(out.includes(transition(neutralRgb, pathRgb)), "thinking → path transition");
  assert.ok(out.includes(transition(pathRgb, gitRgb)), "path → git transition");

  // No dark gaps: no reset inside the bar body (leading clean-slate reset is fine)
  const body = out.slice("\x1b[0m ".length, out.lastIndexOf("\x1b[0m"));
  assert.ok(!body.includes("\x1b[0m"), "bar body never resets to terminal background");

  // End cap closes the bar in the last pill's color, drawn on the default background
  assert.ok(out.endsWith(`${fgAnsi(gitRgb)}${arrow}\x1b[0m `), "end cap in last pill color");
  assert.ok(
    out.includes(`\x1b[49m${fgAnsi(gitRgb)}${arrow}`),
    "end cap resets background first or it would be invisible (fg-on-same-bg)"
  );

  // Visible text unchanged (pills pad with one space per side, bar has leading/trailing space)
  assert.equal(stripAnsi(out), `   Kimi K3 ${arrow} think:high ${arrow}  project ${arrow}  main *1 ${arrow} `);
});

test("pill mode with powerline-thin keeps thin arrows and end cap", () => {
  const thin = getSeparatorChars().powerlineThinLeft;
  const modelRgb = hexToRgb("#d787af");
  const pathRgb = hexToRgb("#00afaf");
  const parts = [
    applyBgColor(plainTheme, "#d787af", "m"),
    applyBgColor(plainTheme, "#00afaf", "p"),
  ];
  const out = buildContentFromParts(parts, "powerline-thin", "pill", "arrow");
  assert.ok(out.includes(`${bgAnsi(pathRgb)}${fgAnsi(modelRgb)}${thin}`));
  assert.ok(out.endsWith(`${fgAnsi(pathRgb)}${thin}\x1b[0m `));
});

test("fg mode rendering is unchanged", () => {
  const out = buildContentFromParts(["aaa", "bbb"], "powerline-thin", "fg");
  const thin = getSeparatorChars().powerlineThinLeft;
  assert.equal(stripAnsi(out), ` aaa ${thin} bbb `);
});

test("non-arrow separators in pill mode get transitions but no end cap", () => {
  const parts = [
    applyBgColor(plainTheme, "#d787af", "m"),
    applyBgColor(plainTheme, "#00afaf", "p"),
  ];
  const out = buildContentFromParts(parts, "dot", "pill");
  assert.ok(out.includes("·"));
  assert.ok(out.endsWith("\x1b[0m "));
});

test("round caps render half-circle ends in the edge pill colors", () => {
  const modelRgb = hexToRgb("#d787af");
  const pathRgb = hexToRgb("#00afaf");
  const parts = [
    applyBgColor(plainTheme, "#d787af", "m"),
    applyBgColor(plainTheme, "#00afaf", "p"),
  ];
  const out = buildContentFromParts(parts, "powerline", "pill", "round");
  assert.ok(out.startsWith(`\x1b[0m ${fgAnsi(modelRgb)}\uE0B6`), "left round cap in first pill color");
  assert.ok(out.endsWith(`${fgAnsi(pathRgb)}\uE0B4\x1b[0m `), "right round cap in last pill color");
  assert.ok(
    out.includes(`\x1b[49m${fgAnsi(pathRgb)}\uE0B4`),
    "right round cap resets background first or it would be invisible"
  );
  assert.equal(stripAnsi(out), ` \uE0B6 m ${getSeparatorChars().powerlineLeft} p \uE0B4 `);
});

test("flat caps render no end glyphs", () => {
  const parts = [applyBgColor(plainTheme, "#d787af", "m")];
  const out = buildContentFromParts(parts, "powerline", "pill", "flat");
  assert.ok(out.endsWith("\x1b[0m "));
  assert.ok(!out.includes("\uE0B6") && !out.includes("\uE0B4"));
});

test("pill text color: dark forces near-black, contrast follows luminance, hex passes through", () => {
  const darkOnPink = applyBgColor(plainTheme, "#d787af", "m", "dark");
  assert.ok(darkOnPink.includes(fgAnsi(hexToRgb("#1e1e2e"))));

  const lightOnPink = applyBgColor(plainTheme, "#d787af", "m", "light");
  assert.ok(lightOnPink.includes(fgAnsi(hexToRgb("#cdd6f4"))));

  const autoOnPink = applyBgColor(plainTheme, "#d787af", "m", "contrast");
  assert.ok(autoOnPink.includes(fgAnsi(hexToRgb("#1e1e2e"))), "light bg auto-gets dark text");

  const autoOnGray = applyBgColor(plainTheme, "#45475a", "m", "contrast");
  assert.ok(autoOnGray.includes(fgAnsi(hexToRgb("#cdd6f4"))), "dark bg auto-gets light text");

  const custom = applyBgColor(plainTheme, "#d787af", "m", "#ff0000");
  assert.ok(custom.includes(fgAnsi(hexToRgb("#ff0000"))));
});

test("settings.json powerline.colors overrides theme/preset/default resolution", () => {
  try {
    setSettingsColors({ model: "#112233" });
    assert.equal(resolveColor("model", { model: "#445566" }), "#112233");
    assert.equal(resolveColor("path", { path: "#445566" }), "#445566", "preset still works for unset keys");
  } finally {
    setSettingsColors({});
  }
});

test("powerline config parses caps, pillTextColor, and colors", () => {
  const parsed = parsePowerlineConfig({
    segmentStyle: "pill",
    caps: "round",
    pillTextColor: "#000000",
    colors: { model: "#112233", bogus: "#000000" },
  }, PRESET_NAMES);
  assert.equal(parsed.caps, "round");
  assert.equal(parsed.pillTextColor, "#000000");
  assert.deepEqual(parsed.colors, { model: "#112233" });

  const defaults = parsePowerlineConfig({}, PRESET_NAMES);
  assert.equal(defaults.caps, "round");
  assert.equal(defaults.pillTextColor, "dark");
  assert.deepEqual(defaults.colors, {});

  const invalid = parsePowerlineConfig({ caps: "triangle", pillTextColor: "blueish" }, PRESET_NAMES);
  assert.equal(invalid.caps, "round");
  assert.equal(invalid.pillTextColor, "dark");
});

test("pill bold is on by default and can be disabled", () => {
  try {
    setPillBold(true);
    assert.ok(applyBgColor(plainTheme, "#d787af", "m", "dark").includes("\x1b[1m"));
    setPillBold(false);
    assert.ok(!applyBgColor(plainTheme, "#d787af", "m", "dark").includes("\x1b[1m"));
  } finally {
    setPillBold(true);
  }

  assert.equal(parsePowerlineConfig({}, PRESET_NAMES).pillBold, true);
  assert.equal(parsePowerlineConfig({ pillBold: false }, PRESET_NAMES).pillBold, false);
});

test("prompt color defaults to mocha mauve and accepts hex overrides", () => {
  assert.equal(parsePowerlineConfig({}, PRESET_NAMES).promptColor, "#cba6f7");
  assert.equal(parsePowerlineConfig({ promptColor: "#febc38" }, PRESET_NAMES).promptColor, "#febc38");
  assert.equal(parsePowerlineConfig({ promptColor: "gold" }, PRESET_NAMES).promptColor, "#cba6f7");
});

test("custom segments strip extension fg colors in pill mode", () => {
  const ctx: any = {
    segmentStyle: "pill",
    pillTextColor: "dark",
    theme: plainTheme,
    colors: {},
    customItemsById: new Map([["tavily", {
      id: "tavily",
      statusKey: "tavily-status",
      position: "right",
      color: "#a6e3a1",
      hideWhenMissing: true,
      excludeFromExtensionStatuses: true,
    }]]),
    extensionStatuses: new Map([["tavily-status", "\x1b[38;2;205;214;244mTavily:0%\x1b[0m"]]),
    hiddenExtensionStatusKeys: new Set(),
    options: {},
  };
  const rendered = renderSegment("custom:tavily", ctx);
  // extension's light fg is gone; pill dark text wins
  assert.ok(!rendered.content.includes("38;2;205;214;244"));
  assert.ok(rendered.content.includes(fgAnsi(hexToRgb("#1e1e2e"))));
  assert.equal(stripAnsi(rendered.content), " Tavily:0% ");
});

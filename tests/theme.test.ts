import test from "node:test";
import assert from "node:assert/strict";
import { fg, getDefaultColors, rainbow, resolveColor } from "../theme.ts";
import type { ThemeLike } from "../types.ts";

function theme(name: string): ThemeLike {
  return {
    name,
    fg(color, text) {
      return `<${color}>${text}</${color}>`;
    },
  };
}

test("default fixed colors use higher contrast variants with Pi's light theme", () => {
  const colors = getDefaultColors();

  assert.equal(resolveColor("model", colors, theme("dark")), "#d787af");
  assert.equal(resolveColor("path", colors, theme("dark")), "#00afaf");
  assert.equal(resolveColor("model", colors, theme("light")), "#8f3f71");
  assert.equal(resolveColor("path", colors, theme("light")), "#007070");
});

test("light palette preserves preset and semantic theme colors", () => {
  const light = theme("light");

  assert.equal(resolveColor("model", { model: "#123456" }, light), "#123456");
  assert.equal(fg(light, "context", "42%", getDefaultColors()), "<dim>42%</dim>");
});

test("rainbow uses a darker palette with Pi's light theme", () => {
  assert.match(rainbow(theme("dark"), "think:high"), /^\x1b\[38;2;178;129;214m/);
  assert.match(rainbow(theme("light"), "think:high"), /^\x1b\[38;2;111;66;193m/);
});

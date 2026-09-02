import { test } from "node:test";
import assert from "node:assert/strict";
import { hasNerdFonts } from "../icons.ts";

test("hasNerdFonts detects kitty via TERM when TERM_PROGRAM is unset", () => {
  const saved = { ...process.env };
  try {
    delete process.env.TERM_PROGRAM;
    delete process.env.POWERLINE_NERD_FONTS;
    delete process.env.GHOSTTY_RESOURCES_DIR;

    process.env.TERM = "xterm-kitty";
    assert.equal(hasNerdFonts(), true, "kitty TERM=xterm-kitty should be detected");

    process.env.TERM = "xterm-256color";
    assert.equal(hasNerdFonts(), false, "plain xterm should not be detected");
  } finally {
    for (const key of ["TERM", "TERM_PROGRAM", "POWERLINE_NERD_FONTS", "GHOSTTY_RESOURCES_DIR"]) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
  }
});

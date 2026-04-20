import { visibleWidth } from "@mariozechner/pi-tui";

import { ansi } from "./colors.js";
import type { EditorChromeKind } from "./types.js";

interface RenderEditorChromeArgs {
  width: number;
  kind: EditorChromeKind;
  topContent: string | null;
  bashModeActive: boolean;
  originalRender: (contentWidth: number) => string[];
  borderAnsi: (text: string) => string;
  promptAnsi: (text: string) => string;
  openBarAnsi: string;
  openBgAnsi: string;
  openTextAnsi: string;
}

interface RenderChromeSharedArgs {
  width: number;
  topContent: string;
  lines: string[];
  promptGlyph: string;
  borderAnsi: (text: string) => string;
  promptAnsi: (text: string) => string;
  openBarAnsi: string;
  openBgAnsi: string;
  openTextAnsi: string;
}

export function renderEditorChrome(args: RenderEditorChromeArgs): string[] {
  const contentWidth = args.kind === "rounded"
    ? Math.max(1, args.width - 5)
    : args.kind === "ohmy"
      ? Math.max(1, args.width - 6)
      : Math.max(1, args.width - 4);
  const lines = args.originalRender(contentWidth);

  if (lines.length === 0 || args.topContent === null) {
    return lines;
  }

  const sharedArgs: RenderChromeSharedArgs = {
    width: args.width,
    topContent: args.topContent,
    lines,
    promptGlyph: args.bashModeActive ? "$" : ">",
    borderAnsi: args.borderAnsi,
    promptAnsi: args.promptAnsi,
    openBarAnsi: args.openBarAnsi,
    openBgAnsi: args.openBgAnsi,
    openTextAnsi: args.openTextAnsi,
  };

  if (args.kind === "rounded") {
    return renderRoundedChrome(sharedArgs);
  }

  if (args.kind === "ohmy") {
    return renderOhMyChrome(sharedArgs);
  }

  return renderOpenChrome(sharedArgs);
}

function renderOpenChrome(args: RenderChromeSharedArgs): string[] {
  const { width, topContent, lines, openBarAnsi, openBgAnsi, openTextAnsi } = args;
  const promptPrefix = "   ";
  const contPrefix = "   ";
  const contentWidth = Math.max(1, width - 4);
  const bottomBorderIndex = findBottomBorderIndex(lines);
  const blueBar = `${openBarAnsi}│${ansi.reset}`;
  const openChromeAnsi = `${openBgAnsi}${openTextAnsi}`;
  const reset = ansi.reset;

  const wrap = (body: string): string => {
    return `${blueBar}${openChromeAnsi}${body.replace(/\x1b\[0m/g, `${reset}${openChromeAnsi}`)}${reset}`;
  };

  const blankPad = wrap(" ".repeat(3 + contentWidth));
  const result: string[] = [];
  result.push(topContent);
  result.push(blankPad);

  for (let i = 1; i < bottomBorderIndex; i++) {
    const prefix = i === 1 ? promptPrefix : contPrefix;
    const content = padToVisibleWidth(lines[i] || "", contentWidth);
    result.push(wrap(`${prefix}${content}`));
  }

  if (bottomBorderIndex === 1) {
    result.push(wrap(`${promptPrefix}${" ".repeat(contentWidth)}`));
  }

  result.push(blankPad);

  for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
    result.push(lines[i] || "");
  }

  return result;
}

function renderRoundedChrome(args: RenderChromeSharedArgs): string[] {
  const { width, topContent, lines, promptGlyph, borderAnsi, promptAnsi } = args;
  const prompt = promptAnsi(promptGlyph);
  const promptPrefix = ` ${prompt} `;
  const contPrefix = "   ";
  const bottomBorderIndex = findBottomBorderIndex(lines);

  const result: string[] = [];
  result.push(topContent);
  result.push(borderAnsi(`╭${"─".repeat(width - 2)}╮`));

  for (let i = 1; i < bottomBorderIndex; i++) {
    const prefix = i === 1 ? promptPrefix : contPrefix;
    const content = padToVisibleWidth(lines[i] || "", Math.max(0, width - 2 - visibleWidth(prefix)));
    result.push(`${borderAnsi("│")}${prefix}${content}${borderAnsi("│")}`);
  }

  if (bottomBorderIndex === 1) {
    result.push(`${borderAnsi("│")}${promptPrefix}${" ".repeat(Math.max(0, width - 2 - visibleWidth(promptPrefix)))}${borderAnsi("│")}`);
  }

  result.push(borderAnsi(`╰${"─".repeat(width - 2)}╯`));

  for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
    result.push(lines[i] || "");
  }

  return result;
}

function renderOhMyChrome(args: RenderChromeSharedArgs): string[] {
  const { width, topContent, lines, borderAnsi } = args;
  const bottomBorderIndex = findBottomBorderIndex(lines, true);
  const topLeft = borderAnsi("╭─");
  const topRight = borderAnsi("─╮");
  const bottomLeft = borderAnsi("╰─");
  const bottomRight = borderAnsi("─╯");
  const vertical = borderAnsi("│");
  const contentWidth = Math.max(1, width - 6);

  const result: string[] = [];
  const statusWidth = visibleWidth(topContent);
  const topFillWidth = width - 4;
  const fillWidth = Math.max(0, topFillWidth - statusWidth);

  result.push(topLeft + topContent + borderAnsi("─".repeat(fillWidth)) + topRight);

  for (let i = 1; i < bottomBorderIndex; i++) {
    const content = padToVisibleWidth(lines[i] || "", contentWidth);
    const isLastContent = i === bottomBorderIndex - 1;

    if (isLastContent) {
      result.push(`${bottomLeft} ${content} ${bottomRight}`);
    } else {
      result.push(`${vertical}  ${content}  ${vertical}`);
    }
  }

  if (bottomBorderIndex === 1) {
    result.push(`${bottomLeft} ${" ".repeat(contentWidth)} ${bottomRight}`);
  }

  for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
    result.push(lines[i] || "");
  }

  return result;
}

function findBottomBorderIndex(lines: string[], strict = false): number {
  let bottomBorderIndex = lines.length - 1;
  for (let i = lines.length - 1; i >= 1; i--) {
    const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
    if (stripped.length > 0 && (strict ? /^─+$/.test(stripped) : /^─{3,}/.test(stripped))) {
      bottomBorderIndex = i;
      break;
    }
  }

  return bottomBorderIndex;
}

function padToVisibleWidth(text: string, targetWidth: number): string {
  const width = visibleWidth(text);
  if (width >= targetWidth) return text;
  return text + " ".repeat(targetWidth - width);
}

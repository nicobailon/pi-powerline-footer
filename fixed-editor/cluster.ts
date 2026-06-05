import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PowerlinePlacement } from "../types.ts";

export const CURSOR_MARKER = "\x1b_pi:c\x07";

export interface FixedEditorClusterInput {
  width: number;
  terminalRows: number;
  statusLines?: string[];
  topLines?: string[];
  editorLines: string[];
  secondaryLines?: string[];
  transcriptLines?: string[];
  lastPromptLines?: string[];
  powerlinePlacement?: PowerlinePlacement;
}

export interface FixedEditorCursor {
  row: number;
  col: number;
}

export interface FixedEditorClusterRender {
  lines: string[];
  cursor: FixedEditorCursor | null;
}

function normalizeLines(lines: string[] | undefined, width: number): string[] {
  if (!lines || width <= 0) return [];

  return lines
    .filter((line) => line !== undefined && line !== null)
    .map((line) => visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line);
}

function takeTail(lines: string[], count: number): string[] {
  if (count <= 0) return [];
  return lines.length <= count ? lines : lines.slice(lines.length - count);
}

function capEditorLines(lines: string[], count: number): string[] {
  if (count <= 0) return [];
  if (lines.length <= count) return lines;

  const cursorRow = lines.findIndex((line) => line.includes(CURSOR_MARKER));
  if (cursorRow !== -1) {
    const start = Math.max(0, Math.min(cursorRow - count + 1, lines.length - count));
    return lines.slice(start, start + count);
  }

  const selectedRow = lines.findIndex((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trimStart().startsWith("→ "));
  if (selectedRow === -1) {
    return lines.slice(0, count);
  }

  const start = Math.max(0, Math.min(selectedRow - Math.floor(count / 2), lines.length - count));
  return lines.slice(start, start + count);
}

function extractCursor(lines: string[]): FixedEditorClusterRender {
  let cursor: FixedEditorCursor | null = null;
  const cleaned = lines.map((line, row) => {
    const markerIndex = line.indexOf(CURSOR_MARKER);
    if (markerIndex === -1) return line;

    if (!cursor) {
      cursor = {
        row,
        col: visibleWidth(line.slice(0, markerIndex)),
      };
    }

    return line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
  });

  return { lines: cleaned, cursor };
}

export function renderFixedEditorCluster(input: FixedEditorClusterInput): FixedEditorClusterRender {
  const width = Math.max(1, input.width);
  const maxRows = Math.max(1, input.terminalRows - 1);

  const statusLines = normalizeLines(input.statusLines, width);
  const topLines = normalizeLines(input.topLines, width);
  const editorSource = normalizeLines(input.editorLines, width);
  const secondaryLines = normalizeLines(input.secondaryLines, width);
  const transcriptLines = normalizeLines(input.transcriptLines, width);
  const lastPromptLines = normalizeLines(input.lastPromptLines, width);

  const editorLines = capEditorLines(editorSource, maxRows);
  let remaining = maxRows - editorLines.length;

  if (input.powerlinePlacement === "below") {
    const top = takeTail(topLines, remaining);
    remaining -= top.length;

    const secondary = takeTail(secondaryLines, remaining);
    remaining -= secondary.length;

    const lastPrompt = takeTail(lastPromptLines, remaining);
    remaining -= lastPrompt.length;

    const status = takeTail(statusLines, remaining);
    remaining -= status.length;

    const transcript = takeTail(transcriptLines, remaining);

    return extractCursor([
      ...status,
      ...editorLines,
      ...top,
      ...secondary,
      ...transcript,
      ...lastPrompt,
    ]);
  }

  const top = takeTail(topLines, remaining);
  remaining -= top.length;

  const secondary = takeTail(secondaryLines, remaining);
  remaining -= secondary.length;

  const lastPrompt = takeTail(lastPromptLines, remaining);
  remaining -= lastPrompt.length;

  const status = takeTail(statusLines, remaining);
  remaining -= status.length;

  const transcript = takeTail(transcriptLines, remaining);

  return extractCursor([
    ...status,
    ...top,
    ...editorLines,
    ...secondary,
    ...transcript,
    ...lastPrompt,
  ]);
}

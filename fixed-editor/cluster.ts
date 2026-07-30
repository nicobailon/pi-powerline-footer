import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PowerlinePlacement } from "../types.ts";

export const CURSOR_MARKER = "\x1b_pi:c\x07";

export interface FixedEditorClusterInput {
  width: number;
  terminalRows: number;
  statusLines?: string[];
  primaryLines?: string[];
  placement: PowerlinePlacement;
  editorLines: string[];
  secondaryLines?: string[];
  transcriptLines?: string[];
  lastPromptLines?: string[];
}

export interface FixedEditorCursor {
  row: number;
  col: number;
}

export interface FixedEditorClusterRender {
  lines: string[];
  cursor: FixedEditorCursor | null;
}

function normalizeLine(line: string, width: number): string {
  return visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line;
}

function normalizeLines(lines: string[] | undefined, width: number): string[] {
  if (!lines || width <= 0) return [];

  return lines
    .filter((line) => line !== undefined && line !== null)
    .map((line) => normalizeLine(line, width));
}

function normalizeTailLines(lines: string[] | undefined, count: number, width: number): string[] {
  if (!lines || count <= 0 || width <= 0) return [];

  const normalized: string[] = [];
  for (let index = lines.length - 1; index >= 0 && normalized.length < count; index -= 1) {
    const line = lines[index];
    if (line === undefined || line === null) continue;
    normalized.push(normalizeLine(line, width));
  }
  normalized.reverse();
  return normalized;
}

function capEditorLines(lines: string[], count: number, width: number): string[] {
  if (count <= 0) return [];
  if (lines.length <= count) return lines;

  // Width-aware checks preserve pre-optimization semantics: truncation can
  // drop a marker/arrow that sits beyond the visible width, and such rows must
  // not win row selection. The raw includes() is a cheap short-circuit.
  const cursorRow = lines.findIndex((line) => line.includes(CURSOR_MARKER)
    && normalizeLine(line, width).includes(CURSOR_MARKER));
  if (cursorRow !== -1) {
    const start = Math.max(0, Math.min(cursorRow - count + 1, lines.length - count));
    return lines.slice(start, start + count);
  }

  const selectedRow = lines.findIndex((line) => line.includes("→")
    && normalizeLine(line, width).replace(/\x1b\[[0-9;]*m/g, "").trimStart().startsWith("→ "));
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

  const editorSource = (input.editorLines ?? []).filter((line) => line !== undefined && line !== null);
  const editorLines = normalizeLines(capEditorLines(editorSource, maxRows, width), width);
  let remaining = maxRows - editorLines.length;

  const primary = normalizeTailLines(input.primaryLines, remaining, width);
  remaining -= primary.length;

  const secondary = normalizeTailLines(input.secondaryLines, remaining, width);
  remaining -= secondary.length;

  const lastPrompt = normalizeTailLines(input.lastPromptLines, remaining, width);
  remaining -= lastPrompt.length;

  const status = normalizeTailLines(input.statusLines, remaining, width);
  remaining -= status.length;

  const transcript = normalizeTailLines(input.transcriptLines, remaining, width);

  return extractCursor(input.placement === "above"
    ? [
      ...status,
      ...primary,
      ...editorLines,
      ...secondary,
      ...transcript,
      ...lastPrompt,
    ]
    : [
      ...status,
      ...editorLines,
      ...primary,
      ...secondary,
      ...transcript,
      ...lastPrompt,
    ]);
}

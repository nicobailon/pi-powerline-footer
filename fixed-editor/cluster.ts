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

/**
 * Where the editor's own lines ended up inside the rendered cluster, so
 * callers can map a screen position back to a position in the editor render.
 */
export interface FixedEditorRegion {
  /** Row in `lines` holding the first editor line. */
  startRow: number;
  /** How many leading editor lines were dropped to fit the viewport. */
  lineOffset: number;
  /** How many editor lines are present in `lines`. */
  lineCount: number;
}

export interface FixedEditorClusterRender {
  lines: string[];
  cursor: FixedEditorCursor | null;
  /** Absent when a caller assembles cluster lines without going through
   * `renderFixedEditorCluster`; editor click targeting is then unavailable. */
  editorRegion?: FixedEditorRegion;
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

function capEditorLines(lines: string[], count: number): { lines: string[]; offset: number } {
  if (count <= 0) return { lines: [], offset: 0 };
  if (lines.length <= count) return { lines, offset: 0 };

  const cursorRow = lines.findIndex((line) => line.includes(CURSOR_MARKER));
  if (cursorRow !== -1) {
    const start = Math.max(0, Math.min(cursorRow - count + 1, lines.length - count));
    return { lines: lines.slice(start, start + count), offset: start };
  }

  const selectedRow = lines.findIndex((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trimStart().startsWith("→ "));
  if (selectedRow === -1) {
    return { lines: lines.slice(0, count), offset: 0 };
  }

  const start = Math.max(0, Math.min(selectedRow - Math.floor(count / 2), lines.length - count));
  return { lines: lines.slice(start, start + count), offset: start };
}

function extractCursor(lines: string[], editorRegion: FixedEditorRegion): FixedEditorClusterRender {
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

  return { lines: cleaned, cursor, editorRegion };
}

export function renderFixedEditorCluster(input: FixedEditorClusterInput): FixedEditorClusterRender {
  const width = Math.max(1, input.width);
  const maxRows = Math.max(1, input.terminalRows - 1);

  const statusLines = normalizeLines(input.statusLines, width);
  const primaryLines = normalizeLines(input.primaryLines, width);
  const editorSource = normalizeLines(input.editorLines, width);
  const secondaryLines = normalizeLines(input.secondaryLines, width);
  const transcriptLines = normalizeLines(input.transcriptLines, width);
  const lastPromptLines = normalizeLines(input.lastPromptLines, width);

  const { lines: editorLines, offset: editorLineOffset } = capEditorLines(editorSource, maxRows);
  let remaining = maxRows - editorLines.length;

  const primary = takeTail(primaryLines, remaining);
  remaining -= primary.length;

  const secondary = takeTail(secondaryLines, remaining);
  remaining -= secondary.length;

  const lastPrompt = takeTail(lastPromptLines, remaining);
  remaining -= lastPrompt.length;

  const status = takeTail(statusLines, remaining);
  remaining -= status.length;

  const transcript = takeTail(transcriptLines, remaining);

  const editorRegion: FixedEditorRegion = {
    startRow: input.placement === "above"
      ? status.length + primary.length
      : status.length,
    lineOffset: editorLineOffset,
    lineCount: editorLines.length,
  };

  return extractCursor(
    input.placement === "above"
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
      ],
    editorRegion,
  );
}

import { deleteAllKittyImages, isKeyRelease, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { matchesConfiguredShortcut } from "../shortcuts.ts";
import type { FixedEditorClusterRender } from "./cluster.ts";

export interface TerminalLike {
  columns: number;
  rows: number;
  kittyProtocolActive?: boolean;
  write(data: string): void;
}

interface KeyboardScrollShortcuts {
  up: string;
  down: string;
}

export type ScrollAwayNavigationShortcutId = "bottom" | "previousUser" | "nextUser" | "previousAssistant" | "nextAssistant";

export interface ScrollAwayNavigationShortcut {
  id: ScrollAwayNavigationShortcutId;
  shortcutLabel: string;
}

export interface ScrollAwayNavigationCardOptions {
  shortcuts: ScrollAwayNavigationShortcut[];
  onClickBottom?: () => boolean;
}

interface TerminalSplitCompositorOptions {
  tui: any;
  terminal: TerminalLike;
  renderCluster: (width: number, terminalRows: number) => FixedEditorClusterRender;
  getShowHardwareCursor?: () => boolean;
  mouseScroll?: boolean;
  keyboardScrollShortcuts?: KeyboardScrollShortcuts;
  scrollAwayNavigationCard?: ScrollAwayNavigationCardOptions;
  onCopySelection?: (text: string) => void;
  scrollRepaintThrottleMs?: number;
}

interface PatchedRenderable {
  render(width: number): string[];
}

interface RenderPatch {
  target: PatchedRenderable;
  originalRender: (width: number) => string[];
}

interface RenderPassCluster {
  width: number;
  terminalRows: number;
  cluster: FixedEditorClusterRender;
}

type CompositeLineAt = (
  baseLine: string,
  overlayLine: string,
  startCol: number,
  overlayWidth: number,
  totalWidth: number,
) => string;

interface SgrMousePacket {
  code: number;
  col: number;
  row: number;
  final: "M" | "m";
}

interface SelectionPoint {
  line: number;
  col: number;
}

type SelectionArea = "root" | "cluster";

interface SelectionLocation {
  area: SelectionArea;
  point: SelectionPoint;
}

interface ScrollAwayCardBounds {
  row: number;
  startCol: number;
  endCol: number;
}

interface ScrollAwayCardCandidate {
  lines: string[];
}

interface ScrollAwayCardLayout extends ScrollAwayCardCandidate {
  width: number;
  startCol: number;
  bounds: ScrollAwayCardBounds[];
}

interface ScrollAwayCardContentRow {
  kind: "content";
  left: string;
  right?: string;
}

interface ScrollAwayCardDividerRow {
  kind: "divider";
}

type ScrollAwayCardRow = ScrollAwayCardContentRow | ScrollAwayCardDividerRow;

interface DisposeOptions {
  resetExtendedKeyboardModes?: boolean;
}

type ExtendedKeyboardMode = "kitty" | "modifyOtherKeys";

const CONTEXT_MENU_MOUSE_REPORTING_PAUSE_MS = 1200;
const CONTEXT_MENU_SELECTION_RESTORE_WINDOW_MS = 5000;
const CONTEXT_MENU_CLIPBOARD_RESTORE_INTERVAL_MS = 100;
export const DEFAULT_SCROLL_REPAINT_THROTTLE_MS = 16;
const SCROLL_SETTLED_RENDER_MS = 80;
const DOUBLE_CLICK_MS = 500;
const DEFAULT_KEYBOARD_SCROLL_SHORTCUTS: KeyboardScrollShortcuts = {
  up: "super+up",
  down: "super+down",
};

export function beginSynchronizedOutput(): string {
  return "\x1b[?2026h";
}

export function endSynchronizedOutput(): string {
  return "\x1b[?2026l";
}

export function setScrollRegion(top: number, bottom: number): string {
  return `\x1b[${top};${bottom}r`;
}

export function resetScrollRegion(): string {
  return "\x1b[r";
}

export function moveCursor(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

function clearLine(): string {
  return "\x1b[2K";
}

function hideCursor(): string {
  return "\x1b[?25l";
}

function showCursor(): string {
  return "\x1b[?25h";
}

function enterAlternateScreen(): string {
  return "\x1b[?1049h";
}

function exitAlternateScreen(): string {
  return "\x1b[?1049l";
}

function enableAlternateScrollMode(): string {
  return "\x1b[?1007h";
}

function disableAlternateScrollMode(): string {
  return "\x1b[?1007l";
}

function disableAutoWrap(): string {
  return "\x1b[?7l";
}

function enableAutoWrap(): string {
  return "\x1b[?7h";
}

function enableMouseReporting(): string {
  return "\x1b[?1002h\x1b[?1006h";
}

function disableMouseReporting(): string {
  return "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
}

function enableExtendedKeyboardMode(mode: ExtendedKeyboardMode): string {
  return mode === "kitty" ? "\x1b[>7u" : "\x1b[>4;2m";
}

function disableExtendedKeyboardMode(mode: ExtendedKeyboardMode): string {
  return mode === "kitty" ? "\x1b[<u" : "\x1b[>4;0m";
}

function resetExtendedKeyboardModes(): string {
  return "\x1b[<999u\x1b[>4;0m";
}

export function emergencyTerminalModeReset(): string {
  return beginSynchronizedOutput()
    + resetScrollRegion()
    + disableMouseReporting()
    + enableAlternateScrollMode()
    + exitAlternateScreen()
    + resetExtendedKeyboardModes()
    + endSynchronizedOutput();
}

function parseKeyboardScrollDelta(data: string, shortcuts: KeyboardScrollShortcuts = DEFAULT_KEYBOARD_SCROLL_SHORTCUTS): number {
  if (isKeyRelease(data)) return 0;

  if (
    matchesConfiguredShortcut(data, shortcuts.up)
    || matchesKey(data, "pageUp")
    || matchesKey(data, "ctrl+shift+up")
    || /^\x1b\[(?:5;9(?::[12])?~|1;6(?::[12])?A|57421;9(?::[12])?u|57419;6(?::[12])?u)$/.test(data)
  ) return 10;
  if (
    matchesConfiguredShortcut(data, shortcuts.down)
    || matchesKey(data, "pageDown")
    || matchesKey(data, "ctrl+shift+down")
    || /^\x1b\[(?:6;9(?::[12])?~|1;6(?::[12])?B|57422;9(?::[12])?u|57420;6(?::[12])?u)$/.test(data)
  ) return -10;
  return 0;
}

function parseSgrMousePackets(data: string): SgrMousePacket[] | null {
  const pattern = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  const packets: SgrMousePacket[] = [];
  let offset = 0;

  for (const match of data.matchAll(pattern)) {
    if (match.index !== offset) return null;
    offset = match.index + match[0].length;
    packets.push({
      code: Number(match[1]),
      col: Number(match[2]),
      row: Number(match[3]),
      final: match[4] as "M" | "m",
    });
  }

  return packets.length > 0 && offset === data.length ? packets : null;
}

function mouseBaseButton(code: number): number {
  return code & ~(4 | 8 | 16 | 32);
}

function mouseScrollDelta(packet: SgrMousePacket): number {
  if (packet.final !== "M") return 0;
  const baseButton = mouseBaseButton(packet.code);
  if (baseButton === 64) return 3;
  if (baseButton === 65) return -3;
  return 0;
}

function isLeftPress(packet: SgrMousePacket): boolean {
  return packet.final === "M" && mouseBaseButton(packet.code) === 0 && (packet.code & 32) === 0;
}

function isLeftDrag(packet: SgrMousePacket): boolean {
  return packet.final === "M" && mouseBaseButton(packet.code) === 0 && (packet.code & 32) !== 0;
}

function isRightPress(packet: SgrMousePacket): boolean {
  return packet.final === "M" && mouseBaseButton(packet.code) === 2 && (packet.code & 32) === 0;
}

function isMouseRelease(packet: SgrMousePacket): boolean {
  return packet.final === "m";
}

function stripOscSequences(line: string): string {
  return line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function stripAnsi(line: string): string {
  return stripOscSequences(line).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function sliceColumns(text: string, startCol: number, endCol: number): string {
  let col = 0;
  let result = "";
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const width = Math.max(0, visibleWidth(segment));
    if (col >= startCol && col < endCol) {
      result += segment;
    }
    col += width;
  }
  return result;
}

function compareSelectionPoints(a: SelectionPoint, b: SelectionPoint): number {
  return a.line === b.line ? a.col - b.col : a.line - b.line;
}

function descriptorForRows(terminal: TerminalLike): PropertyDescriptor | undefined {
  let target: object | null = terminal;
  while (target) {
    const descriptor = Object.getOwnPropertyDescriptor(target, "rows");
    if (descriptor) return descriptor;
    target = Object.getPrototypeOf(target);
  }

  return undefined;
}

function readRows(terminal: TerminalLike, descriptor: PropertyDescriptor | undefined): number {
  if (descriptor?.get) {
    const value = descriptor.get.call(terminal);
    return typeof value === "number" && Number.isFinite(value) ? value : 24;
  }

  const value = Reflect.get(terminal, "rows");
  return typeof value === "number" && Number.isFinite(value) ? value : 24;
}

function sanitizeLine(line: string, width: number): string {
  return visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line;
}

function sanitizeOverlayBaseLine(line: string, width: number): string {
  return sanitizeLine(stripOscSequences(line), width);
}

function normalizeOverlayCompositionLine(line: string): string {
  return line.includes("\t") ? line.replace(/\t/g, "   ") : line;
}

function padVisibleEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function cardRowContentWidth(row: ScrollAwayCardContentRow): number {
  return row.right === undefined
    ? visibleWidth(row.left)
    : visibleWidth(row.left) + 2 + visibleWidth(row.right);
}

function alignCardRow(row: ScrollAwayCardContentRow, contentWidth: number): string {
  if (row.right === undefined) return padVisibleEnd(row.left, contentWidth);

  const gap = Math.max(2, contentWidth - visibleWidth(row.left) - visibleWidth(row.right));
  return `${row.left}${" ".repeat(gap)}${row.right}`;
}

function buildBoxedScrollAwayCard(rows: ScrollAwayCardRow[]): ScrollAwayCardCandidate {
  const contentRows = rows.filter((row): row is ScrollAwayCardContentRow => row.kind === "content");
  const contentWidth = Math.max(1, ...contentRows.map(cardRowContentWidth));
  const lines = [`┌${"─".repeat(contentWidth)}┐`];

  for (const row of rows) {
    if (row.kind === "divider") {
      lines.push(`├${"─".repeat(contentWidth)}┤`);
      continue;
    }

    lines.push(`│${alignCardRow(row, contentWidth)}│`);
  }

  lines.push(`└${"─".repeat(contentWidth)}┘`);
  return { lines };
}

function splitShortcutLabel(label: string): { modifiers: string[]; key: string } {
  const parts = label.split("+").filter((part) => part.length > 0);
  if (parts.length === 0) return { modifiers: [], key: "" };
  return { modifiers: parts.slice(0, -1), key: parts[parts.length - 1] ?? "" };
}

function compactShortcutModifiers(modifiers: string[]): string {
  return modifiers.map((modifier) => {
    switch (modifier.toLowerCase()) {
      case "ctrl":
      case "control":
        return "⌃";
      case "shift":
        return "⇧";
      case "alt":
      case "option":
        return "⌥";
      case "cmd":
      case "command":
      case "super":
        return "⌘";
      default:
        return `${modifier}+`;
    }
  }).join("");
}

function compactShortcutKey(key: string): string {
  switch (key.toLowerCase()) {
    case "up":
      return "↑";
    case "down":
      return "↓";
    case "left":
      return "←";
    case "right":
      return "→";
    default:
      return /^[a-z]$/i.test(key) ? key.toUpperCase() : key;
  }
}

function compactShortcutLabel(label: string): string {
  const shortcut = splitShortcutLabel(label);
  return `${compactShortcutModifiers(shortcut.modifiers)}${compactShortcutKey(shortcut.key)}`;
}

function compactShortcutPair(previous: string, next: string): string {
  const previousShortcut = splitShortcutLabel(previous);
  const nextShortcut = splitShortcutLabel(next);
  const sameModifiers = previousShortcut.modifiers.length === nextShortcut.modifiers.length
    && previousShortcut.modifiers.every((modifier, index) => modifier.toLowerCase() === nextShortcut.modifiers[index]?.toLowerCase());

  if (sameModifiers) {
    return `${compactShortcutModifiers(previousShortcut.modifiers)}${compactShortcutKey(previousShortcut.key)}/${compactShortcutKey(nextShortcut.key)}`;
  }

  return `${compactShortcutLabel(previous)}/${compactShortcutLabel(next)}`;
}

function buildScrollAwayCardCandidates(
  bottom: ScrollAwayNavigationShortcut,
  previousUser: ScrollAwayNavigationShortcut,
  nextUser: ScrollAwayNavigationShortcut,
  previousAssistant: ScrollAwayNavigationShortcut,
  nextAssistant: ScrollAwayNavigationShortcut,
): ScrollAwayCardCandidate[] {
  const bottomShortcut = `${bottom.shortcutLabel} ↓`;
  const userShortcut = compactShortcutPair(previousUser.shortcutLabel, nextUser.shortcutLabel);
  const assistantShortcut = compactShortcutPair(previousAssistant.shortcutLabel, nextAssistant.shortcutLabel);

  return [
    buildBoxedScrollAwayCard([
      { kind: "content", left: "Jump to bottom", right: bottomShortcut },
      { kind: "divider" },
      { kind: "content", left: "User messages", right: `prev ${previousUser.shortcutLabel} · next ${nextUser.shortcutLabel}` },
      { kind: "content", left: "Assistant responses", right: `prev ${previousAssistant.shortcutLabel} · next ${nextAssistant.shortcutLabel}` },
    ]),
    buildBoxedScrollAwayCard([
      { kind: "content", left: "Bottom", right: bottomShortcut },
      { kind: "divider" },
      { kind: "content", left: "User", right: `prev ${previousUser.shortcutLabel} · next ${nextUser.shortcutLabel}` },
      { kind: "content", left: "Assistant", right: `prev ${previousAssistant.shortcutLabel} · next ${nextAssistant.shortcutLabel}` },
    ]),
    buildBoxedScrollAwayCard([
      { kind: "content", left: "Bottom", right: bottomShortcut },
      { kind: "divider" },
      { kind: "content", left: "User prev/next", right: userShortcut },
      { kind: "content", left: "Asst prev/next", right: assistantShortcut },
    ]),
    { lines: [`Bottom ${bottomShortcut}`] },
    { lines: ["Bottom ↓"] },
  ];
}

export function buildFixedClusterPaint(
  cluster: FixedEditorClusterRender,
  terminalRows: number,
  width: number,
  showHardwareCursor: boolean,
): string {
  if (cluster.lines.length === 0) return "";

  const startRow = Math.max(1, terminalRows - cluster.lines.length + 1);
  let buffer = resetScrollRegion();

  for (let i = 0; i < cluster.lines.length; i++) {
    buffer += moveCursor(startRow + i, 1);
    buffer += clearLine();
    buffer += sanitizeLine(cluster.lines[i] ?? "", width);
  }

  if (cluster.cursor) {
    // Keep the real terminal cursor parked at the logical editor cursor even
    // when it is visually hidden. macOS IME candidate windows anchor to the
    // terminal cursor position, so skipping the move when PI_HARDWARE_CURSOR is
    // off leaves the candidate window at a stale/offset location.
    buffer += moveCursor(startRow + cluster.cursor.row, Math.max(1, cluster.cursor.col + 1));
    buffer += showHardwareCursor ? showCursor() : hideCursor();
  } else {
    buffer += hideCursor();
  }

  return buffer;
}

export class TerminalSplitCompositor {
  private readonly tui: any;
  private readonly terminal: TerminalLike;
  private readonly renderCluster: (width: number, terminalRows: number) => FixedEditorClusterRender;
  private readonly getShowHardwareCursor: () => boolean;
  private readonly mouseScroll: boolean;
  private readonly keyboardScrollShortcuts: KeyboardScrollShortcuts;
  private readonly scrollAwayNavigationCard: ScrollAwayNavigationCardOptions | null;
  private readonly onCopySelection: ((text: string) => void) | null;
  private readonly scrollRepaintThrottleMs: number;
  private extendedKeyboardMode: ExtendedKeyboardMode | null = null;
  private readonly rowsDescriptor: PropertyDescriptor | undefined;
  private readonly originalWrite: (data: string) => void;
  private readonly originalDoRender: (() => void) | null;
  private readonly originalRender: ((width: number) => string[]) | null;
  private originalCompositeLineAt: CompositeLineAt | null = null;
  private readonly patchedRenders: RenderPatch[] = [];
  private removeInputListener: (() => void) | null = null;
  private emergencyCleanup: (() => void) | null = null;
  private mouseReportingResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private clipboardRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollRepaintTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollSettledRenderTimer: ReturnType<typeof setTimeout> | null = null;
  private installed = false;
  private disposed = false;
  private writing = false;
  private renderPassActive = false;
  private renderPassCluster: RenderPassCluster | null = null;
  private renderingCluster = false;
  private renderingScrollableRoot = false;
  private checkingOverlay = false;
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  private lastRootLineCount = 0;
  private rootLines: string[] = [];
  private visibleRootStart = 0;
  private visibleScrollableRows = 0;
  private visibleRootLines: string[] = [];
  private visibleClusterLines: string[] = [];
  private selectionArea: SelectionArea | null = null;
  private selectionAnchor: SelectionPoint | null = null;
  private selectionFocus: SelectionPoint | null = null;
  private selectionDragging = false;
  private preserveSelectionFocusOnRelease = false;
  private lastLeftPress: { area: SelectionArea; line: number; at: number } | null = null;
  private pendingImageCleanup = false;
  private pendingScrollDeltas: number[] = [];

  constructor(options: TerminalSplitCompositorOptions) {
    this.tui = options.tui;
    this.terminal = options.terminal;
    this.renderCluster = options.renderCluster;
    this.getShowHardwareCursor = options.getShowHardwareCursor ?? (() => false);
    this.mouseScroll = options.mouseScroll !== false;
    this.keyboardScrollShortcuts = options.keyboardScrollShortcuts ?? DEFAULT_KEYBOARD_SCROLL_SHORTCUTS;
    this.scrollAwayNavigationCard = options.scrollAwayNavigationCard ?? null;
    this.onCopySelection = options.onCopySelection ?? null;
    this.scrollRepaintThrottleMs = Math.max(0, options.scrollRepaintThrottleMs ?? 0);
    this.rowsDescriptor = descriptorForRows(options.terminal);
    this.originalWrite = options.terminal.write.bind(options.terminal);
    this.originalDoRender = typeof options.tui.doRender === "function" ? options.tui.doRender.bind(options.tui) : null;
    this.originalRender = typeof options.tui.render === "function" ? options.tui.render.bind(options.tui) : null;
  }

  install(): void {
    if (this.installed) return;
    if (typeof this.terminal.write !== "function") {
      throw new Error("[powerline-footer] Fixed editor compositor expected terminal.write(data) to exist");
    }

    this.originalWrite(
      beginSynchronizedOutput()
      + enterAlternateScreen()
      + this.enableAlternateScreenKeyboardMode()
      + disableAlternateScrollMode()
      + this.mouseReportingStateGuard()
      + endSynchronizedOutput(),
    );
    this.emergencyCleanup = () => {
      if (!this.disposed) {
        this.restoreTerminalStateForExit();
      }
    };
    process.once("exit", this.emergencyCleanup);

    Object.defineProperty(this.terminal, "rows", {
      configurable: true,
      get: () => this.getScrollableRows(),
    });

    if (this.originalRender) {
      this.tui.render = (width: number) => this.renderScrollableRoot(width);
    }

    if (typeof this.tui.addInputListener === "function") {
      this.removeInputListener = this.tui.addInputListener((data: string) => this.handleInput(data));
    }

    this.terminal.write = (data: string) => this.write(data);
    if (this.originalDoRender) {
      this.tui.doRender = () => {
        this.renderPassActive = true;
        this.renderPassCluster = null;
        try {
          this.originalDoRender?.();
          this.requestRepaint();
        } finally {
          this.renderPassActive = false;
          this.renderPassCluster = null;
        }
      };
    }
    if (typeof this.tui.compositeLineAt === "function") {
      this.originalCompositeLineAt = this.tui.compositeLineAt.bind(this.tui) as CompositeLineAt;
      this.tui.compositeLineAt = (
        baseLine: string,
        overlayLine: string,
        startCol: number,
        overlayWidth: number,
        totalWidth: number,
      ) => this.originalCompositeLineAt?.(
        normalizeOverlayCompositionLine(baseLine),
        normalizeOverlayCompositionLine(overlayLine),
        startCol,
        overlayWidth,
        totalWidth,
      ) ?? "";
    }
    this.installed = true;
  }

  hideRenderable(target: PatchedRenderable): void {
    if (this.patchedRenders.some((patch) => patch.target === target)) return;
    const originalRender = target.render.bind(target);
    this.patchedRenders.push({ target, originalRender });
    target.render = () => [];
  }

  renderHidden(target: PatchedRenderable, width: number): string[] {
    const patch = this.patchedRenders.find((candidate) => candidate.target === target);
    const render = patch?.originalRender ?? target.render.bind(target);
    return render(width);
  }

  jumpToPreviousRootTarget(targetLines: readonly number[]): boolean {
    return this.jumpToRootTarget(targetLines, "previous");
  }

  jumpToNextRootTarget(targetLines: readonly number[]): boolean {
    return this.jumpToRootTarget(targetLines, "next");
  }

  jumpToRootBottom(): boolean {
    if (this.disposed || this.hasVisibleOverlay()) return false;

    this.cancelQueuedScroll();
    if (this.scrollOffset === 0) return false;

    this.clearSelection();
    this.lastLeftPress = null;
    this.scrollOffset = 0;
    this.pendingImageCleanup = true;
    this.requestRender();
    return true;
  }

  private jumpToRootTarget(targetLines: readonly number[], direction: "previous" | "next"): boolean {
    if (this.disposed || targetLines.length === 0 || this.hasVisibleOverlay()) return false;

    this.cancelQueuedScroll();
    const start = this.visibleRootStart;
    const candidates = direction === "previous"
      ? targetLines.filter((line) => line < start).sort((a, b) => b - a)
      : targetLines.filter((line) => line > start).sort((a, b) => a - b);

    for (const target of candidates) {
      const nextOffset = Math.max(0, Math.min(
        this.lastRootLineCount - Math.max(1, this.visibleScrollableRows) - target,
        this.maxScrollOffset,
      ));
      if (nextOffset === this.scrollOffset) continue;

      this.clearSelection();
      this.lastLeftPress = null;
      this.scrollOffset = nextOffset;
      this.pendingImageCleanup = true;
      this.requestRender();
      return true;
    }

    return false;
  }

  requestRepaint(): void {
    if (this.disposed || this.hasVisibleOverlay()) return;
    const rawRows = this.getRawRows();
    const width = Math.max(1, this.terminal.columns || 80);
    const cluster = this.getCluster(width, rawRows);
    if (cluster.lines.length === 0) return;

    this.originalWrite(
      beginSynchronizedOutput()
      + disableAutoWrap()
      + buildFixedClusterPaint(this.decorateCluster(cluster), rawRows, width, this.getShowHardwareCursor())
      + enableAutoWrap()
      + this.mouseReportingStateGuard()
      + endSynchronizedOutput(),
    );
  }

  dispose(options: DisposeOptions = {}): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const patch of this.patchedRenders.splice(0)) {
      patch.target.render = patch.originalRender;
    }

    this.removeInputListener?.();
    this.removeInputListener = null;
    if (this.emergencyCleanup) {
      process.removeListener("exit", this.emergencyCleanup);
      this.emergencyCleanup = null;
    }
    if (this.mouseReportingResumeTimer) {
      clearTimeout(this.mouseReportingResumeTimer);
      this.mouseReportingResumeTimer = null;
    }
    if (this.clipboardRestoreTimer) {
      clearTimeout(this.clipboardRestoreTimer);
      this.clipboardRestoreTimer = null;
    }
    if (this.scrollRepaintTimer) {
      clearTimeout(this.scrollRepaintTimer);
      this.scrollRepaintTimer = null;
    }
    if (this.scrollSettledRenderTimer) {
      clearTimeout(this.scrollSettledRenderTimer);
      this.scrollSettledRenderTimer = null;
    }
    this.pendingScrollDeltas = [];

    this.terminal.write = this.originalWrite;
    if (this.originalDoRender) {
      this.tui.doRender = this.originalDoRender;
    }
    if (this.originalRender) {
      this.tui.render = this.originalRender;
    }
    if (this.originalCompositeLineAt) {
      this.tui.compositeLineAt = this.originalCompositeLineAt;
      this.originalCompositeLineAt = null;
    }
    if (this.rowsDescriptor) {
      Object.defineProperty(this.terminal, "rows", this.rowsDescriptor);
    } else {
      Reflect.deleteProperty(this.terminal, "rows");
    }

    this.restoreTerminalState(options);
  }

  private getRawRows(): number {
    return Math.max(2, readRows(this.terminal, this.rowsDescriptor));
  }

  private getScrollableRows(): number {
    if (this.disposed || this.writing || this.renderingCluster || this.checkingOverlay || this.hasVisibleOverlay()) {
      return this.getRawRows();
    }

    const rawRows = this.getRawRows();
    const width = Math.max(1, this.terminal.columns || 80);
    const cluster = this.getCluster(width, rawRows);
    return Math.max(1, rawRows - cluster.lines.length);
  }

  private renderScrollableRoot(width: number): string[] {
    if (!this.originalRender || this.disposed || this.renderingScrollableRoot) {
      return this.originalRender?.(width) ?? [];
    }

    if (this.hasVisibleOverlay()) {
      return this.originalRender(width).map((line) => sanitizeOverlayBaseLine(line, Math.max(1, width)));
    }

    this.renderingScrollableRoot = true;
    try {
      const renderWidth = Math.max(1, Number.isFinite(width) ? width : this.terminal.columns || 80);
      const start = this.refreshRootWindow(renderWidth);
      return this.renderVisibleRootLines(start, renderWidth, this.visibleScrollableRows);
    } finally {
      this.renderingScrollableRoot = false;
    }
  }

  private refreshRootWindow(width: number): number {
    if (!this.originalRender) return this.updateVisibleRootWindow();

    const rawRows = this.getRawRows();
    const renderWidth = Math.max(1, Number.isFinite(width) ? width : this.terminal.columns || 80);
    const cluster = this.getCluster(renderWidth, rawRows);
    const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
    const lines = this.originalRender(renderWidth);
    this.rootLines = lines;
    if (this.scrollOffset > 0 && this.lastRootLineCount > 0 && lines.length > this.lastRootLineCount) {
      this.scrollOffset += lines.length - this.lastRootLineCount;
    }
    this.lastRootLineCount = lines.length;
    const previousMaxScrollOffset = this.maxScrollOffset;
    this.maxScrollOffset = Math.max(0, lines.length - scrollableRows);
    const nextScrollOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScrollOffset));
    if (nextScrollOffset !== this.scrollOffset || this.maxScrollOffset !== previousMaxScrollOffset) {
      this.pendingImageCleanup = true;
    }
    this.scrollOffset = nextScrollOffset;

    return this.updateVisibleRootWindow(scrollableRows);
  }

  private handleInput(data: string): { consume?: boolean; data?: string } | undefined {
    if (this.disposed || this.hasVisibleOverlay()) return undefined;

    const mousePackets = this.mouseScroll ? parseSgrMousePackets(data) : null;
    if (mousePackets) {
      let wheelDeltas: number[] = [];
      for (const packet of mousePackets) {
        const delta = mouseScrollDelta(packet);
        if (delta !== 0) {
          wheelDeltas.push(delta);
          continue;
        }
        if (wheelDeltas.length > 0) {
          this.queueScrollDeltas(wheelDeltas);
          wheelDeltas = [];
        }
        const width = Math.max(1, this.terminal.columns || 80);
        const hadQueuedScroll = this.pendingScrollDeltas.length > 0;
        if (this.handleScrollAwayCardClick(packet, width)) continue;
        const flushedQueuedScroll = this.flushQueuedScroll();
        this.handleMousePacket(packet, { skipScrollAwayCard: hadQueuedScroll || flushedQueuedScroll });
      }
      if (wheelDeltas.length > 0) {
        this.queueScrollDeltas(wheelDeltas);
      }
      return { consume: true };
    }

    const keyboardDelta = parseKeyboardScrollDelta(data, this.keyboardScrollShortcuts);
    if (keyboardDelta === 0) return undefined;

    this.flushQueuedScroll();
    this.scrollBy(keyboardDelta);
    return { consume: true };
  }

  private handleMousePacket(packet: SgrMousePacket, options: { skipScrollAwayCard?: boolean } = {}): void {
    const delta = mouseScrollDelta(packet);
    if (delta !== 0) {
      this.queueScrollBy(delta);
      return;
    }

    const width = Math.max(1, this.terminal.columns || 80);
    this.refreshRootWindow(width);
    if (!options.skipScrollAwayCard && this.handleScrollAwayCardClick(packet, width)) return;
    const location = this.selectionLocationForPacket(packet);

    if (isRightPress(packet)) {
      this.selectionDragging = false;
      this.preserveSelectionFocusOnRelease = false;
      const selectedText = this.isLocationInsideSelection(location) ? this.getSelectedText() : "";
      if (selectedText) {
        this.onCopySelection?.(selectedText);
        this.lastLeftPress = null;
        this.pauseMouseReportingForContextMenu(selectedText);
        return;
      }

      this.clearSelection();
      this.lastLeftPress = null;
      this.pauseMouseReportingForContextMenu();
      return;
    }

    if (this.scrollSelectionAtViewportEdge(packet)) return;
    if (this.selectionDragging && isMouseRelease(packet)) {
      this.finishSelection(packet, location);
      return;
    }

    if (!location) return;

    if (isLeftPress(packet)) {
      this.startSelection(location);
      return;
    }

    if (this.selectionDragging && isLeftDrag(packet) && location.area === this.selectionArea) {
      this.lastLeftPress = null;
      this.preserveSelectionFocusOnRelease = false;
      this.selectionFocus = location.point;
      this.requestRender();
      return;
    }
  }

  private updateVisibleRootWindow(scrollableRows = this.visibleScrollableRows): number {
    const rows = Math.max(1, scrollableRows);
    const start = Math.max(0, this.rootLines.length - rows - this.scrollOffset);
    const visibleLines = this.rootLines.slice(start, start + rows);
    while (visibleLines.length < rows) {
      visibleLines.push("");
    }

    this.visibleRootStart = start;
    this.visibleScrollableRows = rows;
    this.visibleRootLines = visibleLines;
    return start;
  }

  private renderVisibleRootLines(start: number, width: number, scrollableRows: number): string[] {
    const renderedLines = this.visibleRootLines.map((line, index) => {
      return this.renderSelectionHighlight(line, start + index, "root");
    });
    const card = this.computeScrollAwayNavigationCard(width, scrollableRows);
    if (!card) return renderedLines;

    const firstCardRow = scrollableRows - card.lines.length;
    for (let index = 0; index < card.lines.length; index++) {
      const row = firstCardRow + index;
      if (row < 0 || row >= renderedLines.length) continue;
      renderedLines[row] = this.composeScrollAwayCardLine(renderedLines[row] ?? "", card.lines[index] ?? "", card.startCol, card.width, width);
    }

    return renderedLines;
  }

  private composeScrollAwayCardLine(baseLine: string, overlayLine: string, startCol: number, overlayWidth: number, totalWidth: number): string {
    const base = sanitizeOverlayBaseLine(baseLine, totalWidth);
    if (typeof this.tui.compositeLineAt === "function") {
      return sanitizeLine(this.tui.compositeLineAt(base, overlayLine, startCol, overlayWidth, totalWidth), totalWidth);
    }

    const plainBase = stripAnsi(base);
    const before = padVisibleEnd(sliceColumns(plainBase, 0, startCol), startCol);
    const after = sliceColumns(plainBase, startCol + overlayWidth, Number.POSITIVE_INFINITY);
    return sanitizeLine(`${before}${overlayLine}${after}`, totalWidth);
  }

  private handleScrollAwayCardClick(packet: SgrMousePacket, width: number): boolean {
    if (!isLeftPress(packet) || this.selectionDragging) return false;
    if (!this.isScrollAwayCardClick(packet, width) || !this.scrollAwayNavigationCard?.onClickBottom?.()) return false;

    this.lastLeftPress = null;
    return true;
  }

  private isScrollAwayCardClick(packet: SgrMousePacket, width: number): boolean {
    const card = this.computeScrollAwayNavigationCard(width, this.visibleScrollableRows);
    if (!card) return false;

    const col = Math.max(0, packet.col - 1);
    return card.bounds.some((bound) => {
      return packet.row === bound.row && col >= bound.startCol && col < bound.endCol;
    });
  }

  private computeScrollAwayNavigationCard(width: number, scrollableRows: number): ScrollAwayCardLayout | null {
    if (!this.scrollAwayNavigationCard || this.scrollOffset <= 0 || scrollableRows < 1 || width < visibleWidth("Bottom ↓")) {
      return null;
    }

    const shortcutById = new Map(this.scrollAwayNavigationCard.shortcuts.map((shortcut) => [shortcut.id, shortcut]));
    const bottom = shortcutById.get("bottom");
    const previousUser = shortcutById.get("previousUser");
    const nextUser = shortcutById.get("nextUser");
    const previousAssistant = shortcutById.get("previousAssistant");
    const nextAssistant = shortcutById.get("nextAssistant");
    if (!bottom || !previousUser || !nextUser || !previousAssistant || !nextAssistant) return null;

    for (const candidate of buildScrollAwayCardCandidates(bottom, previousUser, nextUser, previousAssistant, nextAssistant)) {
      const candidateWidth = Math.max(...candidate.lines.map((line) => visibleWidth(line)));
      if (candidateWidth > width || candidate.lines.length > scrollableRows) continue;

      const startCol = Math.max(0, Math.floor((width - candidateWidth) / 2));
      const firstRow = scrollableRows - candidate.lines.length + 1;
      const bounds: ScrollAwayCardBounds[] = candidate.lines.map((_, index) => ({
        row: firstRow + index,
        startCol,
        endCol: startCol + candidateWidth,
      }));

      return { ...candidate, width: candidateWidth, startCol, bounds };
    }

    return null;
  }

  private finishSelection(packet: SgrMousePacket, location: SelectionLocation | null): void {
    if (!this.preserveSelectionFocusOnRelease) {
      this.selectionFocus = location?.area === this.selectionArea
        ? location.point
        : this.clampedSelectionPointForPacket(packet, this.selectionArea);
    }

    this.preserveSelectionFocusOnRelease = false;
    this.selectionDragging = false;
    const selectedText = this.getSelectedText();
    if (selectedText) {
      this.lastLeftPress = null;
      this.onCopySelection?.(selectedText);
    } else {
      this.clearSelection();
    }
    this.requestRender();
  }

  private startSelection(location: SelectionLocation): void {
    const now = Date.now();
    const line = location.point.line;
    if (
      this.lastLeftPress
      && this.lastLeftPress.area === location.area
      && this.lastLeftPress.line === line
      && now - this.lastLeftPress.at <= DOUBLE_CLICK_MS
    ) {
      this.selectionArea = location.area;
      this.selectionAnchor = { line, col: 0 };
      this.selectionFocus = { line, col: this.selectionLineWidth(location.area, line) };
      this.selectionDragging = true;
      this.preserveSelectionFocusOnRelease = true;
      this.lastLeftPress = null;
      this.requestRender();
      return;
    }

    this.selectionArea = location.area;
    this.selectionAnchor = location.point;
    this.selectionFocus = location.point;
    this.selectionDragging = true;
    this.preserveSelectionFocusOnRelease = false;
    this.lastLeftPress = { area: location.area, line, at: now };
    this.requestRender();
  }

  private selectionLocationForPacket(packet: SgrMousePacket): SelectionLocation | null {
    if (packet.row < 1) return null;

    const col = Math.max(0, packet.col - 1);
    if (packet.row <= this.visibleScrollableRows) {
      return {
        area: "root",
        point: { line: this.visibleRootStart + packet.row - 1, col },
      };
    }

    const clusterLine = packet.row - this.visibleScrollableRows - 1;
    if (clusterLine >= this.visibleClusterLines.length) return null;

    return {
      area: "cluster",
      point: { line: clusterLine, col },
    };
  }

  private scrollSelectionAtViewportEdge(packet: SgrMousePacket): boolean {
    if (!this.selectionDragging || this.selectionArea !== "root" || !isLeftDrag(packet)) return false;

    const delta = packet.row <= 1 ? 1 : packet.row >= this.visibleScrollableRows ? -1 : 0;
    if (delta === 0) return false;

    const nextOffset = Math.max(0, Math.min(this.scrollOffset + delta, this.maxScrollOffset));
    if (nextOffset === this.scrollOffset) return false;

    this.lastLeftPress = null;
    this.preserveSelectionFocusOnRelease = true;
    this.scrollOffset = nextOffset;
    this.pendingImageCleanup = true;
    const start = this.updateVisibleRootWindow();
    const edgeLine = delta > 0 ? start : start + Math.max(0, this.visibleScrollableRows - 1);
    this.selectionFocus = {
      line: edgeLine,
      col: Math.max(0, packet.col - 1),
    };
    this.requestRender();
    return true;
  }

  private clampedSelectionPointForPacket(packet: SgrMousePacket, area: SelectionArea | null): SelectionPoint {
    if (area === "cluster") {
      return {
        line: Math.max(0, Math.min(packet.row - this.visibleScrollableRows - 1, this.visibleClusterLines.length - 1)),
        col: Math.max(0, packet.col - 1),
      };
    }

    const row = Math.max(1, Math.min(packet.row, this.visibleScrollableRows));
    return {
      line: this.visibleRootStart + row - 1,
      col: Math.max(0, packet.col - 1),
    };
  }

  private renderSelectionHighlight(line: string, lineIndex: number, area: SelectionArea): string {
    const range = this.getSelectionRangeForLine(lineIndex, area);
    if (!range) return line;

    const plain = stripAnsi(line);
    const startCol = Math.max(0, Math.min(range.startCol, visibleWidth(plain)));
    const endCol = Math.max(startCol, Math.min(range.endCol, visibleWidth(plain)));
    if (startCol === endCol) return line;

    const before = sliceColumns(plain, 0, startCol);
    const selected = sliceColumns(plain, startCol, endCol);
    const after = sliceColumns(plain, endCol, Number.POSITIVE_INFINITY);
    return `${before}\x1b[7m${selected}\x1b[27m${after}`;
  }

  private selectionLineWidth(area: SelectionArea, lineIndex: number): number {
    const lines = area === "root" ? this.visibleRootLines : this.visibleClusterLines;
    const firstLine = area === "root" ? this.visibleRootStart : 0;
    return visibleWidth(stripAnsi(lines[lineIndex - firstLine] ?? ""));
  }

  private getSelectedText(): string {
    if (!this.selectionArea || !this.selectionAnchor || !this.selectionFocus) return "";

    const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0
      ? this.selectionAnchor
      : this.selectionFocus;
    const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
    if (start.line === end.line && start.col === end.col) return "";

    const lines = this.selectionArea === "root" ? this.rootLines : this.visibleClusterLines;
    const selected: string[] = [];
    for (let lineIndex = start.line; lineIndex <= end.line; lineIndex++) {
      const line = stripAnsi(lines[lineIndex] ?? "");
      const startCol = lineIndex === start.line ? start.col : 0;
      const endCol = lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY;
      selected.push(sliceColumns(line, startCol, endCol));
    }

    return selected.join("\n").replace(/[ \t]+$/gm, "").trimEnd();
  }

  private getSelectionRangeForLine(lineIndex: number, area: SelectionArea): { startCol: number; endCol: number } | null {
    if (this.selectionArea !== area || !this.selectionAnchor || !this.selectionFocus) return null;

    const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0
      ? this.selectionAnchor
      : this.selectionFocus;
    const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
    if (lineIndex < start.line || lineIndex > end.line) return null;

    return {
      startCol: lineIndex === start.line ? start.col : 0,
      endCol: lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY,
    };
  }

  private isLocationInsideSelection(location: SelectionLocation | null): boolean {
    if (!location || location.area !== this.selectionArea) return false;
    const range = this.getSelectionRangeForLine(location.point.line, location.area);
    return Boolean(range && location.point.col >= range.startCol && location.point.col < range.endCol);
  }

  private queueScrollBy(delta: number): void {
    this.queueScrollDeltas([delta]);
  }

  private queueScrollDeltas(deltas: number[]): void {
    const nonZeroDeltas = deltas.filter((delta) => delta !== 0);
    if (nonZeroDeltas.length === 0) return;

    this.selectionDragging = false;
    if (this.scrollRepaintThrottleMs <= 0) {
      this.scrollByDeltas(nonZeroDeltas, { deferRender: false });
      return;
    }

    this.pendingScrollDeltas.push(...nonZeroDeltas);
    if (this.scrollRepaintTimer) return;

    this.scrollRepaintTimer = setTimeout(() => {
      this.scrollRepaintTimer = null;
      if (!this.disposed) {
        this.flushQueuedScroll();
      }
    }, this.scrollRepaintThrottleMs);

    if (typeof this.scrollRepaintTimer === "object" && "unref" in this.scrollRepaintTimer) {
      this.scrollRepaintTimer.unref();
    }
  }

  private cancelQueuedScroll(): void {
    if (this.scrollRepaintTimer) {
      clearTimeout(this.scrollRepaintTimer);
      this.scrollRepaintTimer = null;
    }
    this.pendingScrollDeltas = [];
  }

  private flushQueuedScroll(): boolean {
    if (this.scrollRepaintTimer) {
      clearTimeout(this.scrollRepaintTimer);
      this.scrollRepaintTimer = null;
    }

    const deltas = this.pendingScrollDeltas;
    this.pendingScrollDeltas = [];
    if (deltas.length > 0 && !this.disposed && !this.hasVisibleOverlay()) {
      this.scrollByDeltas(deltas, { deferRender: true });
      return true;
    }
    return false;
  }

  private scrollBy(delta: number, options: { deferRender?: boolean } = {}): void {
    this.scrollByDeltas([delta], options);
  }

  private scrollByDeltas(deltas: number[], options: { deferRender?: boolean } = {}): void {
    const width = Math.max(1, this.terminal.columns || 80);
    this.refreshRootWindow(width);

    let nextOffset = this.scrollOffset;
    for (const delta of deltas) {
      nextOffset = Math.max(0, Math.min(nextOffset + delta, this.maxScrollOffset));
    }
    if (nextOffset === this.scrollOffset) return;

    this.clearSelection();
    this.lastLeftPress = null;
    this.scrollOffset = nextOffset;
    this.pendingImageCleanup = true;
    this.repaintScrollableViewport(width);
    if (options.deferRender) {
      this.scheduleScrollSettledRender();
    } else {
      this.requestRender();
    }
  }

  private requestRender(): void {
    if (typeof this.tui.requestRender === "function") {
      this.tui.requestRender();
    }
  }

  private scheduleScrollSettledRender(): void {
    if (this.scrollSettledRenderTimer) {
      clearTimeout(this.scrollSettledRenderTimer);
    }

    this.scrollSettledRenderTimer = setTimeout(() => {
      this.scrollSettledRenderTimer = null;
      if (!this.disposed) {
        this.requestRender();
      }
    }, SCROLL_SETTLED_RENDER_MS);

    if (typeof this.scrollSettledRenderTimer === "object" && "unref" in this.scrollSettledRenderTimer) {
      this.scrollSettledRenderTimer.unref();
    }
  }

  private repaintScrollableViewport(width: number): void {
    if (this.disposed || this.writing || this.hasVisibleOverlay()) return;

    const rawRows = this.getRawRows();
    const cluster = this.getCluster(width, rawRows);
    const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
    const start = this.updateVisibleRootWindow(scrollableRows);
    const visibleLines = this.renderVisibleRootLines(start, width, scrollableRows);
    let buffer = beginSynchronizedOutput()
      + this.consumePendingImageCleanup()
      + disableAutoWrap()
      + setScrollRegion(1, scrollableRows)
      + moveCursor(1, 1);

    for (let row = 0; row < scrollableRows; row++) {
      if (row > 0) buffer += "\r\n";
      buffer += clearLine();
      buffer += sanitizeLine(visibleLines[row] ?? "", width);
    }

    buffer += buildFixedClusterPaint(this.decorateCluster(cluster), rawRows, width, this.getShowHardwareCursor());
    buffer += enableAutoWrap();
    buffer += this.mouseReportingStateGuard();
    buffer += endSynchronizedOutput();
    this.originalWrite(buffer);
  }

  private pauseMouseReportingForContextMenu(textToRestoreToClipboard: string | null = null): void {
    if (this.mouseReportingResumeTimer) {
      clearTimeout(this.mouseReportingResumeTimer);
    }
    if (this.clipboardRestoreTimer) {
      clearTimeout(this.clipboardRestoreTimer);
      this.clipboardRestoreTimer = null;
    }

    this.originalWrite(beginSynchronizedOutput() + disableMouseReporting() + endSynchronizedOutput());
    this.mouseReportingResumeTimer = setTimeout(() => {
      this.mouseReportingResumeTimer = null;
      if (!this.disposed) {
        this.originalWrite(beginSynchronizedOutput() + enableMouseReporting() + endSynchronizedOutput());
      }
    }, CONTEXT_MENU_MOUSE_REPORTING_PAUSE_MS);

    if (typeof this.mouseReportingResumeTimer === "object" && "unref" in this.mouseReportingResumeTimer) {
      this.mouseReportingResumeTimer.unref();
    }

    const restoreClipboard = this.onCopySelection;
    if (!textToRestoreToClipboard || !restoreClipboard) return;

    let remainingRestores = Math.ceil(CONTEXT_MENU_SELECTION_RESTORE_WINDOW_MS / CONTEXT_MENU_CLIPBOARD_RESTORE_INTERVAL_MS);
    const scheduleClipboardRestore = () => {
      this.clipboardRestoreTimer = setTimeout(() => {
        this.clipboardRestoreTimer = null;
        if (this.disposed) return;

        remainingRestores -= 1;
        if (this.getSelectedText() !== textToRestoreToClipboard) return;

        restoreClipboard(textToRestoreToClipboard);
        if (remainingRestores > 0) {
          scheduleClipboardRestore();
        }
      }, CONTEXT_MENU_CLIPBOARD_RESTORE_INTERVAL_MS);

      if (typeof this.clipboardRestoreTimer === "object" && "unref" in this.clipboardRestoreTimer) {
        this.clipboardRestoreTimer.unref();
      }
    };

    scheduleClipboardRestore();
  }

  private clearSelection(): void {
    this.selectionArea = null;
    this.selectionAnchor = null;
    this.selectionFocus = null;
    this.selectionDragging = false;
    this.preserveSelectionFocusOnRelease = false;
  }

  private activeExtendedKeyboardMode(): ExtendedKeyboardMode | null {
    if (this.terminal.kittyProtocolActive === true) return "kitty";
    if (Reflect.get(this.terminal, "_modifyOtherKeysActive") === true) return "modifyOtherKeys";
    return null;
  }

  private enableAlternateScreenKeyboardMode(): string {
    this.extendedKeyboardMode = this.activeExtendedKeyboardMode();
    return this.extendedKeyboardMode ? enableExtendedKeyboardMode(this.extendedKeyboardMode) : "";
  }

  private restoreTerminalState(options: DisposeOptions = {}): void {
    const activeMode = this.extendedKeyboardMode ?? this.activeExtendedKeyboardMode();
    const restoreMainScreenMode = !options.resetExtendedKeyboardModes && this.extendedKeyboardMode === null && activeMode !== null;

    this.originalWrite(
      beginSynchronizedOutput()
      + resetScrollRegion()
      + (this.mouseScroll ? disableMouseReporting() : "")
      + (activeMode ? disableExtendedKeyboardMode(activeMode) : "")
      + enableAlternateScrollMode()
      + exitAlternateScreen()
      + (restoreMainScreenMode && activeMode ? enableExtendedKeyboardMode(activeMode) : "")
      + (options.resetExtendedKeyboardModes ? resetExtendedKeyboardModes() : "")
      + endSynchronizedOutput(),
    );
  }

  private restoreTerminalStateForExit(): void {
    try {
      this.restoreTerminalState({ resetExtendedKeyboardModes: true });
    } catch {
      // Process-exit cleanup cannot report useful errors and must not throw.
    }
  }

  private write(data: string): void {
    if (this.disposed || this.writing || this.hasVisibleOverlay()) {
      this.originalWrite(data);
      return;
    }

    this.writing = true;
    try {
      const rawRows = this.getRawRows();
      const width = Math.max(1, this.terminal.columns || 80);
      const cluster = this.getCluster(width, rawRows);
      const reservedRows = cluster.lines.length;

      if (reservedRows === 0 || rawRows <= 2) {
        this.originalWrite(data);
        return;
      }

      const scrollBottom = Math.max(1, rawRows - reservedRows);
      const hardwareCursorRow = typeof this.tui.hardwareCursorRow === "number"
        ? this.tui.hardwareCursorRow
        : typeof this.tui.cursorRow === "number"
          ? this.tui.cursorRow
          : 0;
      const viewportTop = typeof this.tui.previousViewportTop === "number" ? this.tui.previousViewportTop : 0;
      const screenRow = Math.max(1, Math.min(scrollBottom, hardwareCursorRow - viewportTop + 1));
      const buffer = beginSynchronizedOutput()
        + this.consumePendingImageCleanup()
        + disableAutoWrap()
        + setScrollRegion(1, scrollBottom)
        + moveCursor(screenRow, 1)
        + data
        + buildFixedClusterPaint(this.decorateCluster(cluster), rawRows, width, this.getShowHardwareCursor())
        + enableAutoWrap()
        + this.mouseReportingStateGuard()
        + endSynchronizedOutput();

      this.originalWrite(buffer);
    } finally {
      this.writing = false;
    }
  }

  private consumePendingImageCleanup(): string {
    if (!this.pendingImageCleanup) return "";
    this.pendingImageCleanup = false;
    return deleteAllKittyImages();
  }

  private mouseReportingStateGuard(): string {
    return this.mouseScroll && !this.mouseReportingResumeTimer ? enableMouseReporting() : "";
  }

  private getCluster(width: number, terminalRows: number): FixedEditorClusterRender {
    if (
      this.renderPassActive &&
      this.renderPassCluster?.width === width &&
      this.renderPassCluster.terminalRows === terminalRows
    ) {
      return this.renderPassCluster.cluster;
    }

    const cluster = this.withClusterRender(() => this.renderCluster(width, terminalRows));
    this.visibleClusterLines = cluster.lines;
    if (this.renderPassActive) {
      this.renderPassCluster = { width, terminalRows, cluster };
    }
    return cluster;
  }

  private decorateCluster(cluster: FixedEditorClusterRender): FixedEditorClusterRender {
    if (this.selectionArea !== "cluster") return cluster;

    return {
      ...cluster,
      lines: cluster.lines.map((line, index) => this.renderSelectionHighlight(line, index, "cluster")),
    };
  }

  private withClusterRender<T>(render: () => T): T {
    const wasRenderingCluster = this.renderingCluster;
    this.renderingCluster = true;
    try {
      return render();
    } finally {
      this.renderingCluster = wasRenderingCluster;
    }
  }

  private hasVisibleOverlay(): boolean {
    if (this.checkingOverlay) return false;

    this.checkingOverlay = true;
    try {
      if (typeof this.tui.hasOverlay === "function" && this.tui.hasOverlay()) {
        return true;
      }

      const overlayStack = Reflect.get(this.tui, "overlayStack");
      if (!Array.isArray(overlayStack)) {
        return false;
      }

      return overlayStack.some((entry) => entry && entry.hidden !== true);
    } finally {
      this.checkingOverlay = false;
    }
  }
}

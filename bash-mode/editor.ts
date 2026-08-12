import { fileURLToPath } from "node:url";
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { matchesConfiguredShortcut } from "../shortcuts.ts";
import type { GhostSuggestion } from "./types.ts";

interface EditorBoundaryShortcuts {
  start: string | null;
  end: string | null;
}

interface BashModeEditorOptions {
  keybindings: KeybindingsManager;
  isBashModeActive: () => boolean;
  isShellRunning: () => boolean;
  onExitBashMode: () => void;
  onSubmitCommand: (command: string) => void;
  onEditorSubmit?: () => void;
  editorBoundaryShortcuts?: EditorBoundaryShortcuts;
  onInterrupt: () => void;
  onNotify: (message: string, level?: "info" | "warning" | "error") => void;
  getHistoryEntries: (prefix: string) => string[];
  areCompletionsEnabled?: () => boolean;
  resolveGhostSuggestion: (text: string, signal: AbortSignal) => Promise<GhostSuggestion | null>;
}

const DEFAULT_EDITOR_BOUNDARY_SHORTCUTS: EditorBoundaryShortcuts = {
  start: "super+shift+up",
  end: "super+shift+down",
};

const GHOST_UPDATE_DEBOUNCE_MS = 50;
const FAST_ASCII_LINE_COLUMN_THRESHOLD = 1200;

export function isPrintableInput(data: string): boolean {
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    return code >= 0x20 && (code < 0x7f || code > 0x9f) && (code < 0xd800 || code > 0xdfff);
  }
  if (data.length !== 2) return false;
  const first = data.charCodeAt(0);
  const second = data.charCodeAt(1);
  return first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff;
}

function isCommandUndoShortcut(data: string): boolean {
  return data === "\x1b[122;9u"
    || data === "\x1b[122;9:1u"
    || data === "\x1b[122;9:2u"
    || data === "\x1b[27;9;122~";
}

function bracketedPasteContent(data: string): string | null {
  const startMarker = "\x1b[200~";
  const endMarker = "\x1b[201~";
  const start = data.indexOf(startMarker);
  if (start !== 0) return null;

  const end = data.indexOf(endMarker, startMarker.length);
  if (end === -1 || end + endMarker.length !== data.length) return null;

  return data.slice(startMarker.length, end);
}

function decodeFileUriList(text: string): string | null {
  const entries = text
    .split(/\r?\n|\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"));

  if (entries.length === 0 || entries.some((entry) => !entry.startsWith("file://"))) {
    return null;
  }

  try {
    return entries.map((entry) => fileURLToPath(entry)).join(" ");
  } catch {
    return null;
  }
}

function droppedPathTextFromInput(data: string): string | null {
  const pasteContent = bracketedPasteContent(data);
  const text = pasteContent ?? data;
  const uriList = decodeFileUriList(text);
  if (uriList) return uriList;

  const trimmed = text.replace(/^[\r\n]+|[\r\n]+$/g, "");
  if (trimmed.length <= 1 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(trimmed)) {
    return null;
  }

  if (/^(?:\/|~\/|\.\.?\/)/.test(trimmed) && !/[\r\n]/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function resetShellHistoryBrowse(state: object): void {
  Reflect.set(state, "shellHistoryIndex", -1);
  Reflect.set(state, "shellHistoryItems", []);
  Reflect.set(state, "shellHistoryDraft", "");
}

export class BashModeEditor extends CustomEditor {
  private readonly keybindingsRef: KeybindingsManager;
  private readonly optionsRef: BashModeEditorOptions;
  private wrappedProviderInstalled = false;
  private shellHistoryIndex = -1;
  private shellHistoryItems: string[] = [];
  private shellHistoryDraft = "";
  private promptHistoryDraft: string | null = null;
  private ghost: GhostSuggestion | null = null;
  private ghostAbort: AbortController | null = null;
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;
  private ghostToken = 0;
  private plainBoundInputs: Set<string> | null = null;
  private readonly backspaceBindingConflicts = new Map<string, boolean>();
  private readonly forwardDeleteBindingConflicts = new Map<string, boolean>();
  private readonly horizontalMoveBindingConflicts = new Map<string, boolean>();

  constructor(tui: any, theme: any, keybindings: KeybindingsManager, options: BashModeEditorOptions) {
    super(tui, theme, keybindings);
    this.keybindingsRef = keybindings;
    this.optionsRef = options;
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    super.setAutocompleteProvider(provider);
    this.wrappedProviderInstalled = false;
  }

  installAutocompleteProvider(provider: AutocompleteProvider): void {
    this.setAutocompleteProvider(provider);
    this.wrappedProviderInstalled = true;
  }

  hasWrappedProvider(): boolean {
    return this.wrappedProviderInstalled;
  }

  getGhostSuggestion(): GhostSuggestion | null {
    return this.isShellCompletionContext() ? this.ghost : null;
  }

  refreshGhostSuggestion(): void {
    if (this.areCompletionsEnabled()) {
      this.scheduleGhostUpdate();
    } else {
      this.clearGhostSuggestion();
    }
  }

  clearGhostSuggestion(): void {
    if (this.ghostTimer) clearTimeout(this.ghostTimer);
    this.ghostTimer = null;
    this.ghostAbort?.abort();
    this.ghostAbort = null;
    this.ghostToken += 1;
    this.ghost = null;
  }

  dismissBashModeUi(): void {
    resetShellHistoryBrowse(this);
    this.clearGhostSuggestion();

    const cancelAutocomplete = Reflect.get(this, "cancelAutocomplete");
    if (typeof cancelAutocomplete === "function") {
      cancelAutocomplete.call(this);
    }
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (BashModeEditor.prototype.tryFastPrintableInput.call(this, data)) return;
    if (BashModeEditor.prototype.tryFastAsciiBackspace.call(this, data)) return;
    if (BashModeEditor.prototype.tryFastAsciiForwardDelete.call(this, data)) return;
    if (BashModeEditor.prototype.tryFastAsciiHorizontalMove.call(this, data)) return;

    const droppedPathText = droppedPathTextFromInput(data);
    if (droppedPathText !== null) {
      this.insertTextAtCursor(droppedPathText);
      resetShellHistoryBrowse(this);
      if (this.isShellCompletionContext()) {
        this.scheduleGhostUpdate();
      } else {
        this.clearGhostSuggestion();
      }
      return;
    }

    const pasteInProgress = data.includes("\x1b[200~") || Reflect.get(this, "isInPaste") === true;
    if (pasteInProgress) {
      super.handleInput(data);
      if (Reflect.get(this, "isInPaste") === true) {
        return;
      }
    } else {
      const bashMode = this.optionsRef.isBashModeActive();
      const oneOffBashCommand = !bashMode && this.isOneOffBashCommandContext();

      if (isCommandUndoShortcut(data)) {
        const undo = Reflect.get(this, "undo");
        if (typeof undo === "function") {
          undo.call(this);
        }
        resetShellHistoryBrowse(this);
        if (this.isShellCompletionContext()) {
          this.scheduleGhostUpdate();
        } else {
          this.clearGhostSuggestion();
        }
        return;
      }

      if (bashMode && this.keybindingsRef.matches(data, "app.interrupt")) {
        this.optionsRef.onExitBashMode();
        return;
      }

      if (bashMode && this.keybindingsRef.matches(data, "app.clear") && this.optionsRef.isShellRunning()) {
        this.optionsRef.onInterrupt();
        return;
      }

      if (bashMode && this.keybindingsRef.matches(data, "tui.editor.cursorUp")) {
        this.navigateShellHistory(-1);
        return;
      }

      if (bashMode && this.keybindingsRef.matches(data, "tui.editor.cursorDown")) {
        this.navigateShellHistory(1);
        return;
      }

      const editorBoundaryShortcuts = this.optionsRef.editorBoundaryShortcuts ?? DEFAULT_EDITOR_BOUNDARY_SHORTCUTS;
      if (!isKeyRelease(data) && matchesConfiguredShortcut(data, editorBoundaryShortcuts.start)) {
        this.moveCursorToEditorBoundary("start");
        return;
      }

      if (!isKeyRelease(data) && matchesConfiguredShortcut(data, editorBoundaryShortcuts.end)) {
        this.moveCursorToEditorBoundary("end");
        return;
      }

      if ((bashMode || oneOffBashCommand) && this.keybindingsRef.matches(data, "tui.input.tab")) {
        this.acceptGhostSuggestion();
        return;
      }

      if (
        (bashMode || oneOffBashCommand)
        && this.keybindingsRef.matches(data, "tui.editor.cursorRight")
        && this.acceptGhostSuggestion()
      ) {
        return;
      }

      if (!bashMode && matchesKey(data, "up") && this.isPromptHistoryRecallPosition()) {
        const navigateHistory = Reflect.get(this, "navigateHistory");
        if (typeof navigateHistory === "function") {
          if (Reflect.get(this, "historyIndex") === -1) {
            this.promptHistoryDraft = this.getText();
          }
          navigateHistory.call(this, -1);
          return;
        }
      }

      if (!bashMode && matchesKey(data, "down") && Reflect.get(this, "historyIndex") > -1) {
        const isOnLastVisualLine = Reflect.get(this, "isOnLastVisualLine");
        if (typeof isOnLastVisualLine !== "function" || isOnLastVisualLine.call(this)) {
          const navigateHistory = Reflect.get(this, "navigateHistory");
          if (typeof navigateHistory === "function") {
            navigateHistory.call(this, 1);
            if (Reflect.get(this, "historyIndex") === -1 && this.promptHistoryDraft !== null) {
              const draft = this.promptHistoryDraft;
              this.promptHistoryDraft = null;
              const setTextInternal = Reflect.get(this, "setTextInternal");
              if (typeof setTextInternal === "function") {
                setTextInternal.call(this, draft);
              } else {
                this.setText(draft);
              }
            }
            return;
          }
        }
      }

      if (bashMode && this.keybindingsRef.matches(data, "tui.input.submit") && !this.keybindingsRef.matches(data, "tui.input.newLine")) {
        if (this.optionsRef.isShellRunning()) {
          this.optionsRef.onNotify("Shell command already running", "warning");
          return;
        }

        const command = this.getExpandedText().trim();
        if (!command) return;
        this.clearGhostSuggestion();
        resetShellHistoryBrowse(this);
        this.optionsRef.onEditorSubmit?.();
        this.optionsRef.onSubmitCommand(command);
        this.setText("");
        this.refreshGhostSuggestion();
        return;
      }

      super.handleInput(data);
    }

    if (!this.isShellCompletionContext()) {
      resetShellHistoryBrowse(this);
      this.clearGhostSuggestion();
      return;
    }

    if (
      pasteInProgress
      ||
      isPrintableInput(data)
      || this.keybindingsRef.matches(data, "tui.editor.deleteCharBackward")
      || this.keybindingsRef.matches(data, "tui.editor.deleteCharForward")
      || this.keybindingsRef.matches(data, "tui.editor.deleteWordBackward")
      || this.keybindingsRef.matches(data, "tui.editor.deleteWordForward")
      || this.keybindingsRef.matches(data, "tui.editor.deleteToLineStart")
      || this.keybindingsRef.matches(data, "tui.editor.deleteToLineEnd")
      || this.keybindingsRef.matches(data, "tui.input.newLine")
      || this.keybindingsRef.matches(data, "tui.editor.cursorLeft")
      || this.keybindingsRef.matches(data, "tui.editor.cursorRight")
    ) {
      resetShellHistoryBrowse(this);
      this.scheduleGhostUpdate();
    }
  }

  private tryFastPrintableInput(data: string): boolean {
    if (!isPrintableInput(data)) return false;
    if (Reflect.get(this, "isInPaste") === true || Reflect.get(this, "jumpMode") !== null) return false;

    if (!this.plainBoundInputs) {
      this.plainBoundInputs = new Set<string>();
      for (const binding of Object.values(this.keybindingsRef.getEffectiveConfig())) {
        if (!binding) continue;
        for (const key of Array.isArray(binding) ? binding : [binding]) {
          if (isPrintableInput(key)) this.plainBoundInputs.add(key);
          if (key === "space") this.plainBoundInputs.add(" ");
          if (/^shift\+[a-z]$/.test(key)) this.plainBoundInputs.add(key.slice(-1).toUpperCase());
        }
      }
    }
    if (this.plainBoundInputs.has(data)) return false;
    if (this.onExtensionShortcut?.(data)) return true;

    const insertCharacter = Reflect.get(this, "insertCharacter");
    if (typeof insertCharacter !== "function") return false;
    insertCharacter.call(this, data);

    resetShellHistoryBrowse(this);
    if (this.isShellCompletionContext()) {
      this.scheduleGhostUpdate();
    } else {
      this.clearGhostSuggestion();
    }
    return true;
  }

  private hasBindingConflict(data: string, editorAction: string, cache: Map<string, boolean> | undefined): boolean {
    const getEffectiveConfig = this.keybindingsRef.getEffectiveConfig;
    if (!(cache instanceof Map) || typeof getEffectiveConfig !== "function") return true;

    let hasConflict = cache.get(data);
    if (hasConflict === undefined) {
      hasConflict = Object.entries(getEffectiveConfig.call(this.keybindingsRef)).some(([id, binding]) => {
        if (id === editorAction || !binding) return false;
        return (Array.isArray(binding) ? binding : [binding]).some((key) => matchesKey(data, key));
      });
      cache.set(data, hasConflict);
    }
    return hasConflict;
  }

  private tryFastAsciiBackspace(data: string): boolean {
    if (!this.keybindingsRef.matches(data, "tui.editor.deleteCharBackward")) return false;
    if (BashModeEditor.prototype.hasBindingConflict.call(this, data, "tui.editor.deleteCharBackward", this.backspaceBindingConflicts)) return false;
    if (Reflect.get(this, "isInPaste") === true || Reflect.get(this, "jumpMode") !== null) return false;
    if (Reflect.get(this, "autocompleteState") !== null) return false;

    const state = Reflect.get(this, "state");
    const lines = state && typeof state === "object" ? Reflect.get(state, "lines") : null;
    const cursorLine = state && typeof state === "object" ? Reflect.get(state, "cursorLine") : null;
    const cursorCol = state && typeof state === "object" ? Reflect.get(state, "cursorCol") : null;
    if (!Array.isArray(lines) || lines.length !== 1 || cursorLine !== 0 || typeof cursorCol !== "number") return false;

    const line = lines[0];
    if (typeof line !== "string" || cursorCol < FAST_ASCII_LINE_COLUMN_THRESHOLD || cursorCol !== line.length) return false;
    const previousCode = line.charCodeAt(cursorCol - 2);
    const deletedCode = line.charCodeAt(cursorCol - 1);
    if (previousCode < 0x20 || previousCode > 0x7e || deletedCode < 0x20 || deletedCode > 0x7e) return false;

    if (BashModeEditor.prototype.hasActivePastes.call(this)) return false;

    const nextLine = line.slice(0, -1);
    const isInSlashCommandContext = Reflect.get(this, "isInSlashCommandContext");
    if (typeof isInSlashCommandContext === "function" && isInSlashCommandContext.call(this, nextLine)) return false;
    const autocompleteTriggerPattern = Reflect.get(this as object, "autocompleteTriggerPattern");
    if (autocompleteTriggerPattern instanceof RegExp && autocompleteTriggerPattern.test(nextLine)) return false;

    const exitHistoryBrowsing = Reflect.get(this, "exitHistoryBrowsing");
    const pushUndoSnapshot = Reflect.get(this, "pushUndoSnapshot");
    const setCursorCol = Reflect.get(this, "setCursorCol");
    if (typeof exitHistoryBrowsing !== "function" || typeof pushUndoSnapshot !== "function" || typeof setCursorCol !== "function") {
      return false;
    }
    if (this.onExtensionShortcut?.(data)) return true;

    exitHistoryBrowsing.call(this);
    pushUndoSnapshot.call(this);
    Reflect.set(this, "lastAction", null);
    lines[0] = nextLine;
    setCursorCol.call(this, cursorCol - 1);
    this.onChange?.(nextLine);

    resetShellHistoryBrowse(this);
    if (this.isShellCompletionContext()) {
      this.scheduleGhostUpdate();
    } else {
      this.clearGhostSuggestion();
    }
    return true;
  }

  private tryFastAsciiForwardDelete(data: string): boolean {
    if (!this.keybindingsRef.matches(data, "tui.editor.deleteCharForward")) return false;
    if (BashModeEditor.prototype.hasBindingConflict.call(this, data, "tui.editor.deleteCharForward", this.forwardDeleteBindingConflicts)) return false;
    if (Reflect.get(this, "isInPaste") === true || Reflect.get(this, "jumpMode") !== null) return false;
    if (Reflect.get(this, "autocompleteState") !== null) return false;

    const state = Reflect.get(this, "state");
    const lines = state && typeof state === "object" ? Reflect.get(state, "lines") : null;
    const cursorLine = state && typeof state === "object" ? Reflect.get(state, "cursorLine") : null;
    const cursorCol = state && typeof state === "object" ? Reflect.get(state, "cursorCol") : null;
    if (!Array.isArray(lines) || lines.length !== 1 || cursorLine !== 0 || typeof cursorCol !== "number") return false;

    const line = lines[0];
    if (typeof line !== "string" || cursorCol >= line.length || line.length < FAST_ASCII_LINE_COLUMN_THRESHOLD) return false;
    if (!BashModeEditor.prototype.isPlainAsciiCursorMove.call(this, line, cursorCol)) return false;

    if (BashModeEditor.prototype.hasActivePastes.call(this)) return false;

    const nextBeforeCursor = line.slice(0, cursorCol);
    const nextLine = nextBeforeCursor + line.slice(cursorCol + 1);
    const isInSlashCommandContext = Reflect.get(this, "isInSlashCommandContext");
    if (typeof isInSlashCommandContext === "function" && isInSlashCommandContext.call(this, nextBeforeCursor)) return false;
    const autocompleteTriggerPattern = Reflect.get(this as object, "autocompleteTriggerPattern");
    if (autocompleteTriggerPattern instanceof RegExp && autocompleteTriggerPattern.test(nextBeforeCursor)) return false;

    const exitHistoryBrowsing = Reflect.get(this, "exitHistoryBrowsing");
    const pushUndoSnapshot = Reflect.get(this, "pushUndoSnapshot");
    if (typeof exitHistoryBrowsing !== "function" || typeof pushUndoSnapshot !== "function") return false;
    if (this.onExtensionShortcut?.(data)) return true;

    exitHistoryBrowsing.call(this);
    pushUndoSnapshot.call(this);
    Reflect.set(this, "lastAction", null);
    lines[0] = nextLine;
    this.onChange?.(nextLine);

    resetShellHistoryBrowse(this);
    if (this.isShellCompletionContext()) {
      this.scheduleGhostUpdate();
    } else {
      this.clearGhostSuggestion();
    }
    return true;
  }

  private tryFastAsciiHorizontalMove(data: string): boolean {
    const direction = this.keybindingsRef.matches(data, "tui.editor.cursorLeft")
      ? -1
      : this.keybindingsRef.matches(data, "tui.editor.cursorRight") ? 1 : 0;
    if (direction === 0) return false;
    if (BashModeEditor.prototype.hasBindingConflict.call(this, data, direction < 0 ? "tui.editor.cursorLeft" : "tui.editor.cursorRight", this.horizontalMoveBindingConflicts)) return false;
    if (Reflect.get(this, "isInPaste") === true || Reflect.get(this, "jumpMode") !== null) return false;
    if (Reflect.get(this, "autocompleteState") !== null) return false;
    if (BashModeEditor.prototype.isShellCompletionContext.call(this)) return false;
    if (BashModeEditor.prototype.hasActivePastes.call(this)) return false;

    const state = Reflect.get(this, "state");
    const lines = state && typeof state === "object" ? Reflect.get(state, "lines") : null;
    const cursorLine = state && typeof state === "object" ? Reflect.get(state, "cursorLine") : null;
    const cursorCol = state && typeof state === "object" ? Reflect.get(state, "cursorCol") : null;
    if (!Array.isArray(lines) || lines.length !== 1 || cursorLine !== 0 || typeof cursorCol !== "number") return false;

    const line = lines[0];
    if (typeof line !== "string" || line.length < FAST_ASCII_LINE_COLUMN_THRESHOLD) return false;
    if (direction < 0) {
      if (cursorCol <= 0 || !BashModeEditor.prototype.isPlainAsciiCursorMove.call(this, line, cursorCol - 1)) return false;
    } else if (cursorCol >= line.length || !BashModeEditor.prototype.isPlainAsciiCursorMove.call(this, line, cursorCol)) {
      return false;
    }

    const setCursorCol = Reflect.get(this, "setCursorCol");
    if (typeof setCursorCol !== "function") return false;
    if (this.onExtensionShortcut?.(data)) return true;

    Reflect.set(this, "lastAction", null);
    setCursorCol.call(this, cursorCol + direction);
    resetShellHistoryBrowse(this);
    return true;
  }

  private hasActivePastes(): boolean {
    const pastes = Reflect.get(this as object, "pastes");
    return !(pastes instanceof Map) || pastes.size > 0;
  }

  private isPlainAsciiCursorMove(line: string, index: number): boolean {
    return BashModeEditor.prototype.isPlainAsciiAt.call(this, line, index)
      && BashModeEditor.prototype.isPlainAsciiOrEdge.call(this, line, index - 1)
      && BashModeEditor.prototype.isPlainAsciiOrEdge.call(this, line, index + 1);
  }

  private isPlainAsciiOrEdge(line: string, index: number): boolean {
    return index < 0 || index >= line.length || BashModeEditor.prototype.isPlainAsciiAt.call(this, line, index);
  }

  private isPlainAsciiAt(line: string, index: number): boolean {
    const code = line.charCodeAt(index);
    return code >= 0x20 && code <= 0x7e;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (!this.isShellCompletionContext()) return lines;
    if (!this.ghost) return lines;

    const text = this.getText();
    if (text.includes("\n")) return lines;
    const cursor = this.getCursor();
    if (cursor.line !== 0 || cursor.col !== text.length) return lines;
    if (!this.ghost.value.startsWith(text) || this.ghost.value === text) return lines;
    if (lines.length < 3) return lines;

    const suffix = this.ghost.value.slice(text.length);
    const contentLine = 1;
    const cursorBlock = "\x1b[7m \x1b[0m";
    const availableWidth = Math.max(0, width - visibleWidth(text) - 1);
    if (availableWidth === 0) return lines;

    const shownSuffix = truncateToWidth(suffix, availableWidth, "", true);
    if (!shownSuffix) return lines;

    const padding = " ".repeat(Math.max(0, width - visibleWidth(text) - 1 - visibleWidth(shownSuffix)));
    const ghost = `\x1b[38;5;244m${shownSuffix}\x1b[0m`;
    lines[contentLine] = `${text}${cursorBlock}${ghost}${padding}`;
    return lines;
  }

  private isShellCompletionContext(): boolean {
    return this.areCompletionsEnabled()
      && (this.optionsRef.isBashModeActive() || this.isOneOffBashCommandContext());
  }

  private areCompletionsEnabled(): boolean {
    return this.optionsRef.areCompletionsEnabled?.() ?? true;
  }

  private isOneOffBashCommandContext(): boolean {
    const state = Reflect.get(this, "state");
    const lines = state && typeof state === "object" ? Reflect.get(state, "lines") : null;
    return Array.isArray(lines) && typeof lines[0] === "string" && lines[0].startsWith("!");
  }

  private moveCursorToEditorBoundary(position: "start" | "end"): void {
    const state = Reflect.get(this, "state");
    const lines = state && typeof state === "object" ? Reflect.get(state, "lines") : null;
    if (!Array.isArray(lines)) {
      throw new Error("Editor cursor state is unavailable");
    }

    if (position === "start") {
      Reflect.set(state, "cursorLine", 0);
      Reflect.set(state, "cursorCol", 0);
    } else {
      const lastLine = Math.max(0, lines.length - 1);
      Reflect.set(state, "cursorLine", lastLine);
      Reflect.set(state, "cursorCol", typeof lines[lastLine] === "string" ? lines[lastLine].length : 0);
    }

    Reflect.set(this, "lastAction", null);
    Reflect.set(this, "preferredVisualCol", null);
    Reflect.set(this, "snappedFromCursorCol", null);
    this.tui.requestRender();
  }

  private acceptGhostSuggestion(): boolean {
    if (!this.ghost) return false;
    const text = this.getText();
    if (text.includes("\n")) return false;

    const cursor = this.getCursor();
    if (cursor.line !== 0 || cursor.col !== text.length) return false;

    if (!this.ghost.value.startsWith(text) || this.ghost.value === text) return false;
    this.setText(this.ghost.value);
    this.clearGhostSuggestion();
    return true;
  }

  private isPromptHistoryRecallPosition(): boolean {
    if (this.isShowingAutocomplete()) return false;

    const history = Reflect.get(this, "history");
    if (!Array.isArray(history) || history.length === 0) return false;

    const lines = this.getLines();
    const cursor = this.getCursor();
    if (lines.length === 1) {
      return cursor.line === 0 && cursor.col === (lines[0]?.length ?? 0);
    }

    const isOnFirstVisualLine = Reflect.get(this, "isOnFirstVisualLine");
    if (typeof isOnFirstVisualLine === "function" && !isOnFirstVisualLine.call(this)) {
      return false;
    }

    return cursor.line === 0;
  }

  private navigateShellHistory(direction: -1 | 1): void {
    const prefix = this.shellHistoryDraft || this.getExpandedText();
    if (this.shellHistoryIndex === -1) {
      this.shellHistoryDraft = prefix;
      this.shellHistoryItems = this.optionsRef.getHistoryEntries(prefix);
    }

    if (this.shellHistoryItems.length === 0) {
      this.optionsRef.onNotify("No shell history matches", "info");
      return;
    }

    if (direction < 0) {
      this.shellHistoryIndex = Math.min(this.shellHistoryItems.length - 1, this.shellHistoryIndex + 1);
      this.setText(this.shellHistoryItems[this.shellHistoryIndex] ?? this.shellHistoryDraft);
      this.clearGhostSuggestion();
      return;
    }

    this.shellHistoryIndex -= 1;
    if (this.shellHistoryIndex < 0) {
      this.shellHistoryIndex = -1;
      this.setText(this.shellHistoryDraft);
      this.scheduleGhostUpdate();
      return;
    }

    this.setText(this.shellHistoryItems[this.shellHistoryIndex] ?? this.shellHistoryDraft);
    this.clearGhostSuggestion();
  }

  private scheduleGhostUpdate(): void {
    if (!this.areCompletionsEnabled()) {
      this.clearGhostSuggestion();
      return;
    }

    const text = this.getText();
    const currentToken = ++this.ghostToken;
    if (this.ghostTimer) clearTimeout(this.ghostTimer);
    this.ghostAbort?.abort();

    const controller = new AbortController();
    this.ghostAbort = controller;
    this.ghostTimer = setTimeout(() => {
      this.ghostTimer = null;
      if (controller.signal.aborted || currentToken !== this.ghostToken) return;

      this.optionsRef.resolveGhostSuggestion(text, controller.signal)
        .then((ghost) => {
          if (controller.signal.aborted || currentToken !== this.ghostToken) return;
          this.ghost = ghost;
          this.tui.requestRender();
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.debug("[powerline-footer] Failed to resolve bash ghost suggestion:", error);
        });
    }, GHOST_UPDATE_DEBOUNCE_MS);
  }
}

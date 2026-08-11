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
  resolveGhostSuggestion: (text: string, signal: AbortSignal) => Promise<GhostSuggestion | null>;
}

const DEFAULT_EDITOR_BOUNDARY_SHORTCUTS: EditorBoundaryShortcuts = {
  start: "super+shift+up",
  end: "super+shift+down",
};

const GHOST_UPDATE_DEBOUNCE_MS = 50;

function isPrintableInput(data: string): boolean {
  return data.length === 1 && data.charCodeAt(0) >= 32;
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
    this.scheduleGhostUpdate();
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
    if (!/^[a-z0-9 ]$/.test(data)) return false;
    if (Reflect.get(this, "isInPaste") === true || Reflect.get(this, "jumpMode") !== null) return false;

    if (!this.plainBoundInputs) {
      this.plainBoundInputs = new Set<string>();
      for (const binding of Object.values(this.keybindingsRef.getEffectiveConfig())) {
        if (!binding) continue;
        for (const key of Array.isArray(binding) ? binding : [binding]) {
          if (key.length === 1) this.plainBoundInputs.add(key);
          if (key === "space") this.plainBoundInputs.add(" ");
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
    return this.optionsRef.isBashModeActive() || this.isOneOffBashCommandContext();
  }

  private isOneOffBashCommandContext(): boolean {
    const state = Reflect.get(this, "state");
    const lines = state && typeof state === "object" ? Reflect.get(state, "lines") : null;
    return Array.isArray(lines) && typeof lines[0] === "string" && lines[0].startsWith("!");
  }

  hasLeadingSigil(sigil: string): boolean {
    const state = Reflect.get(this, "state");
    const lines = state && typeof state === "object" ? Reflect.get(state, "lines") : null;
    if (!Array.isArray(lines)) return false;

    for (let index = 0; index < lines.length; index += 1) {
      const line = typeof lines[index] === "string" ? lines[index] : "";
      const trimmed = line.trimStart();
      if (!trimmed) continue;
      if (!trimmed.startsWith(sigil)) return false;

      const nextCharacter = trimmed.slice(sigil.length, sigil.length + 1);
      return nextCharacter ? /^\s$/.test(nextCharacter) : index < lines.length - 1;
    }

    return false;
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

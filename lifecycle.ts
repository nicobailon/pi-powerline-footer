export function shouldShowStartupWelcome(reason: unknown, welcomeEnabled: boolean): boolean {
  return reason === "startup" && welcomeEnabled;
}

export function shouldResetExtendedKeyboardModesOnShutdown(hasUI: boolean, reason: unknown): boolean {
  return hasUI && reason === "quit";
}

export function shouldRestoreInlineEditorCursorOnShutdown(
  hasUI: boolean,
  reason: unknown,
  fixedEditorEnabled: boolean,
  hadFixedEditorCompositor: boolean,
): boolean {
  return hasUI && reason === "quit" && !fixedEditorEnabled && !hadFixedEditorCompositor;
}

export function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("This extension instance is stale")
    || error.message.includes("This extension ctx is stale")
  );
}

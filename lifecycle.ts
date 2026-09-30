// The welcome is terminal art. RPC hosts such as VS Code and Pi Desktop render
// custom UI as dialogs, so only the terminal UI shows it.
export function shouldShowStartupWelcome(reason: unknown, welcomeEnabled: boolean, mode: unknown): boolean {
  return reason === "startup" && welcomeEnabled && mode === "tui";
}

export function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("This extension instance is stale")
    || error.message.includes("This extension ctx is stale")
  );
}

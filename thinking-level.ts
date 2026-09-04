export function resolveThinkingLevelSelection(
  eventLevel: unknown,
  contextLevel: string | null | undefined,
): string | null {
  return typeof eventLevel === "string" ? eventLevel : contextLevel ?? null;
}

import { visibleWidth } from "@earendil-works/pi-tui";
import { BUILTIN_STATUS_LINE_SEGMENT_IDS } from "./types.ts";
import type { ColorValue, CustomItemPosition, CustomStatusItem, PowerlinePlacement, PresetDef, StatusLineLayout, StatusLinePreset, StatusLineSegmentId, StatusLineSegmentOptions } from "./types.ts";

export interface PowerlineConfig {
  preset: StatusLinePreset;
  customItems: CustomStatusItem[];
  disabledSegments: StatusLineSegmentId[];
  invalidDisabledSegments: string[];
  layout: StatusLineLayout | null;
  invalidLayoutSegments: string[];
  segmentOptions: StatusLineSegmentOptions;
  mouseScroll: boolean;
  fixedEditor: boolean;
  scrollAwayCard: boolean;
  /** Whether mouse text selection copies to clipboard. Default true. */
  copyOnSelect: boolean;
  placement: PowerlinePlacement;
  invalidPlacement: string | null;
  welcome: boolean;
  stashSharpSShortcut: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePreset(value: unknown, presets: readonly StatusLinePreset[]): StatusLinePreset | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (presets as readonly string[]).includes(normalized) ? (normalized as StatusLinePreset) : null;
}

function normalizePlacement(value: unknown): { placement: PowerlinePlacement; invalidPlacement: string | null } {
  if (value === undefined) return { placement: "above", invalidPlacement: null };

  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "above" || normalized === "below") {
    return { placement: normalized, invalidPlacement: null };
  }

  return {
    placement: "above",
    invalidPlacement: typeof value === "string" ? value.trim() : String(value),
  };
}

function normalizeCustomItemId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : null;
}

function normalizeCustomItemPosition(value: unknown): CustomItemPosition {
  if (value === "left" || value === "right" || value === "secondary") return value;
  return "right";
}

function normalizeCustomColor(value: unknown): ColorValue | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? (normalized as ColorValue) : undefined;
}

function normalizeCustomPrefix(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeCustomStatusItem(raw: unknown, idOverride?: string): CustomStatusItem | null {
  if (!isRecord(raw)) return null;
  const id = normalizeCustomItemId(idOverride ?? raw.id);
  if (!id) return null;

  const statusKey = typeof raw.statusKey === "string" && raw.statusKey.trim() ? raw.statusKey.trim() : id;

  return {
    id,
    statusKey,
    position: normalizeCustomItemPosition(raw.position),
    color: normalizeCustomColor(raw.color),
    prefix: normalizeCustomPrefix(raw.prefix),
    hideWhenMissing: raw.hideWhenMissing !== false,
    excludeFromExtensionStatuses: raw.excludeFromExtensionStatuses !== false,
  };
}

function normalizeCustomItems(raw: unknown): CustomStatusItem[] {
  const normalized: CustomStatusItem[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const item = normalizeCustomStatusItem(entry);
      if (item) normalized.push(item);
    }
  } else if (isRecord(raw)) {
    for (const [id, entry] of Object.entries(raw)) {
      const item = normalizeCustomStatusItem(entry, id);
      if (item) normalized.push(item);
    }
  }

  const deduped = new Map<string, CustomStatusItem>();
  for (const item of normalized) {
    deduped.set(item.id, item);
  }

  return [...deduped.values()];
}

const BUILTIN_STATUS_LINE_SEGMENT_ID_SET = new Set<string>(BUILTIN_STATUS_LINE_SEGMENT_IDS);

function normalizeStatusLineSegmentId(value: unknown, customItemIds: ReadonlySet<string>): StatusLineSegmentId | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (BUILTIN_STATUS_LINE_SEGMENT_ID_SET.has(normalized)) {
    return normalized as StatusLineSegmentId;
  }

  const customId = normalized.startsWith("custom:")
    ? normalizeCustomItemId(normalized.slice("custom:".length))
    : null;
  return customId && customItemIds.has(customId) ? `custom:${customId}` : null;
}

function normalizeDisabledSegments(
  raw: unknown,
  customItems: readonly CustomStatusItem[],
): { disabledSegments: StatusLineSegmentId[]; invalidDisabledSegments: string[] } {
  if (!Array.isArray(raw)) return { disabledSegments: [], invalidDisabledSegments: [] };

  const disabledSegments: StatusLineSegmentId[] = [];
  const invalidDisabledSegments: string[] = [];
  const customItemIds = new Set(customItems.map((item) => item.id));
  const seen = new Set<StatusLineSegmentId>();

  for (const entry of raw) {
    const segmentId = normalizeStatusLineSegmentId(entry, customItemIds);
    if (!segmentId) {
      invalidDisabledSegments.push(typeof entry === "string" ? entry.trim() : String(entry));
    } else if (!seen.has(segmentId)) {
      seen.add(segmentId);
      disabledSegments.push(segmentId);
    }
  }

  return { disabledSegments, invalidDisabledSegments };
}

function normalizeLayout(
  raw: unknown,
  customItems: readonly CustomStatusItem[],
): { layout: StatusLineLayout | null; invalidLayoutSegments: string[] } {
  if (!isRecord(raw)) return { layout: null, invalidLayoutSegments: [] };

  const layout: StatusLineLayout = {};
  const invalidLayoutSegments: string[] = [];
  const customItemIds = new Set(customItems.map((item) => item.id));
  const globallyPlaced = new Set<StatusLineSegmentId>();

  for (const row of ["left", "right", "secondary"] as const) {
    const entries = raw[row];
    if (!Array.isArray(entries)) continue;

    const segments: StatusLineSegmentId[] = [];
    const seen = new Set<StatusLineSegmentId>();
    for (const entry of entries) {
      const segmentId = normalizeStatusLineSegmentId(entry, customItemIds);
      if (!segmentId) {
        invalidLayoutSegments.push(`${row}:${typeof entry === "string" ? entry.trim() : String(entry)}`);
      } else if (!seen.has(segmentId)) {
        seen.add(segmentId);
        if (globallyPlaced.has(segmentId)) {
          invalidLayoutSegments.push(`${row}:${segmentId}`);
        } else {
          globallyPlaced.add(segmentId);
          segments.push(segmentId);
        }
      }
    }
    layout[row] = segments;
  }

  return Object.keys(layout).length > 0
    ? { layout, invalidLayoutSegments }
    : { layout: null, invalidLayoutSegments };
}

function normalizeSegmentOptions(raw: Record<string, unknown>): StatusLineSegmentOptions {
  const options: StatusLineSegmentOptions = {};

  if (isRecord(raw.model)) {
    options.model = {
      ...(typeof raw.model.showThinkingLevel === "boolean" ? { showThinkingLevel: raw.model.showThinkingLevel } : {}),
      ...(raw.model.display === "name" || raw.model.display === "qualified" ? { display: raw.model.display } : {}),
    };
  }

  if (isRecord(raw.path)) {
    options.path = {
      ...(raw.path.mode === "basename" || raw.path.mode === "abbreviated" || raw.path.mode === "full" ? { mode: raw.path.mode } : {}),
      ...(typeof raw.path.maxLength === "number" && Number.isFinite(raw.path.maxLength) && raw.path.maxLength > 0
        ? { maxLength: Math.floor(raw.path.maxLength) }
        : {}),
    };
  }

  if (isRecord(raw.git)) {
    options.git = {
      ...(typeof raw.git.showBranch === "boolean" ? { showBranch: raw.git.showBranch } : {}),
      ...(typeof raw.git.showStaged === "boolean" ? { showStaged: raw.git.showStaged } : {}),
      ...(typeof raw.git.showUnstaged === "boolean" ? { showUnstaged: raw.git.showUnstaged } : {}),
      ...(typeof raw.git.showUntracked === "boolean" ? { showUntracked: raw.git.showUntracked } : {}),
      ...(raw.git.polling === "full" || raw.git.polling === "branch" || raw.git.polling === "off" ? { polling: raw.git.polling } : {}),
    };
  }

  if (isRecord(raw.time)) {
    options.time = {
      ...(raw.time.format === "12h" || raw.time.format === "24h" ? { format: raw.time.format } : {}),
      ...(typeof raw.time.showSeconds === "boolean" ? { showSeconds: raw.time.showSeconds } : {}),
    };
  }

  if (isRecord(raw.cost)) {
    options.cost = {
      ...(raw.cost.subscriptionDisplay === "subscription"
        || raw.cost.subscriptionDisplay === "reported-cost"
        || raw.cost.subscriptionDisplay === "both"
        ? { subscriptionDisplay: raw.cost.subscriptionDisplay }
        : {}),
    };
  }

  return options;
}

export function mergeSegmentOptions(
  defaults: StatusLineSegmentOptions = {},
  overrides: StatusLineSegmentOptions = {},
): StatusLineSegmentOptions {
  return {
    ...defaults,
    ...overrides,
    model: { ...defaults.model, ...overrides.model },
    path: { ...defaults.path, ...overrides.path },
    git: { ...defaults.git, ...overrides.git },
    time: { ...defaults.time, ...overrides.time },
    cost: { ...defaults.cost, ...overrides.cost },
  };
}

export function parsePowerlineConfig(value: unknown, presets: readonly StatusLinePreset[]): PowerlineConfig {
  const defaultConfig: PowerlineConfig = {
    preset: "default",
    customItems: [],
    disabledSegments: [],
    invalidDisabledSegments: [],
    layout: null,
    invalidLayoutSegments: [],
    segmentOptions: {},
    mouseScroll: true,
    fixedEditor: true,
    scrollAwayCard: true,
    copyOnSelect: true,
    placement: "above",
    invalidPlacement: null,
    welcome: true,
    stashSharpSShortcut: false,
  };

  const directPreset = normalizePreset(value, presets);
  if (directPreset) return { ...defaultConfig, preset: directPreset };

  if (!isRecord(value)) return defaultConfig;

  const customItems = normalizeCustomItems(value.customItems);
  const { disabledSegments, invalidDisabledSegments } = normalizeDisabledSegments(value.disabledSegments, customItems);
  const { layout, invalidLayoutSegments } = normalizeLayout(value.layout, customItems);
  const { placement, invalidPlacement } = normalizePlacement(value.placement);

  return {
    preset: normalizePreset(value.preset, presets) ?? defaultConfig.preset,
    customItems,
    disabledSegments,
    invalidDisabledSegments,
    layout,
    invalidLayoutSegments,
    segmentOptions: normalizeSegmentOptions(value),
    mouseScroll: value.mouseScroll !== false,
    fixedEditor: value.fixedEditor !== false,
    scrollAwayCard: value.scrollAwayCard !== false,
    copyOnSelect: value.copyOnSelect !== false,
    placement,
    invalidPlacement,
    welcome: value.welcome !== false,
    stashSharpSShortcut: value.stashSharpSShortcut === true,
  };
}

export function mergeSegmentsWithCustomItems(
  presetDef: PresetDef,
  customItems: readonly CustomStatusItem[],
  options: {
    layout?: StatusLineLayout | null;
    disabledSegments?: readonly StatusLineSegmentId[];
  } = {},
): {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  secondarySegments: StatusLineSegmentId[];
} {
  const layout = options.layout ?? null;
  const explicitlyPlaced = new Set([
    ...(layout?.left ?? []),
    ...(layout?.right ?? []),
    ...(layout?.secondary ?? []),
  ]);
  const disabled = new Set(options.disabledSegments ?? []);

  const buildRow = (
    position: CustomItemPosition,
    configured: StatusLineSegmentId[] | undefined,
    presetSegments: readonly StatusLineSegmentId[],
  ): StatusLineSegmentId[] => {
    const segments = configured !== undefined
      ? [...configured]
      : presetSegments.filter((id) => !explicitlyPlaced.has(id));

    if (configured === undefined) {
      for (const item of customItems) {
        const segmentId: StatusLineSegmentId = `custom:${item.id}`;
        if (item.position === position && !explicitlyPlaced.has(segmentId)) {
          segments.push(segmentId);
        }
      }
    }

    return segments.filter((id) => !disabled.has(id));
  };

  return {
    leftSegments: buildRow("left", layout?.left, presetDef.leftSegments),
    rightSegments: buildRow("right", layout?.right, presetDef.rightSegments),
    secondarySegments: buildRow("secondary", layout?.secondary, presetDef.secondarySegments ?? []),
  };
}

export function nextPowerlineSettingWithPreset(existingPowerlineSetting: unknown, preset: StatusLinePreset): unknown {
  if (!isRecord(existingPowerlineSetting)) {
    return preset;
  }
  return { ...existingPowerlineSetting, preset };
}

export function nextPowerlineSettingWithOptions(
  existingPowerlineSetting: unknown,
  updates: Partial<Pick<PowerlineConfig, "mouseScroll" | "fixedEditor" | "scrollAwayCard" | "copyOnSelect" | "welcome" | "stashSharpSShortcut" | "placement">>,
  currentPreset: StatusLinePreset,
): unknown {
  if (!isRecord(existingPowerlineSetting)) {
    return { preset: currentPreset, ...updates };
  }
  return { ...existingPowerlineSetting, ...updates };
}

export function collectHiddenExtensionStatusKeys(customItems: readonly CustomStatusItem[]): Set<string> {
  const hidden = new Set<string>();
  for (const item of customItems) {
    if (item.excludeFromExtensionStatuses) hidden.add(item.statusKey);
  }
  return hidden;
}

export function isNotificationExtensionStatus(value: string): boolean {
  return value.trimStart().startsWith("[");
}

export function getNotificationExtensionStatuses(
  statuses: ReadonlyMap<string, string>,
  hiddenKeys: ReadonlySet<string>,
): string[] {
  const notifications: string[] = [];
  for (const [statusKey, value] of statuses.entries()) {
    if (hiddenKeys.has(statusKey) || !value || !isNotificationExtensionStatus(value)) {
      continue;
    }
    notifications.push(value);
  }
  return notifications;
}

export function normalizeExtensionStatusValue(value: string): string | null {
  if (!value || visibleWidth(value) <= 0) {
    return null;
  }

  const stripped = value.replace(/(\x1b\[[0-9;]*m|\s|·|[|])+$/, "");
  return visibleWidth(stripped) > 0 ? stripped : null;
}

export function normalizeCompactExtensionStatus(value: string): string | null {
  if (isNotificationExtensionStatus(value)) {
    return null;
  }

  return normalizeExtensionStatusValue(value);
}

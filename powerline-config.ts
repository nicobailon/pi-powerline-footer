import { visibleWidth } from "@earendil-works/pi-tui";
import type { ColorValue, CustomItemPosition, CustomStatusItem, PresetDef, StatusLinePreset, StatusLineSegmentId, StatusLineSegmentOptions } from "./types.ts";

export interface PowerlineConfig {
  preset: StatusLinePreset;
  customItems: CustomStatusItem[];
  segmentOptions: StatusLineSegmentOptions;
  mouseScroll: boolean;
  fixedEditor: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePreset(value: unknown, presets: readonly StatusLinePreset[]): StatusLinePreset | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (presets as readonly string[]).includes(normalized) ? (normalized as StatusLinePreset) : null;
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

function normalizeSegmentOptions(raw: Record<string, unknown>): StatusLineSegmentOptions {
  const options: StatusLineSegmentOptions = {};

  if (isRecord(raw.model)) {
    options.model = {
      ...(typeof raw.model.showThinkingLevel === "boolean" ? { showThinkingLevel: raw.model.showThinkingLevel } : {}),
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
  };
}

export function parsePowerlineConfig(value: unknown, presets: readonly StatusLinePreset[]): PowerlineConfig {
  const defaultConfig: PowerlineConfig = { preset: "default", customItems: [], segmentOptions: {}, mouseScroll: true, fixedEditor: true };

  const directPreset = normalizePreset(value, presets);
  if (directPreset) return { ...defaultConfig, preset: directPreset };

  if (!isRecord(value)) return defaultConfig;

  return {
    preset: normalizePreset(value.preset, presets) ?? defaultConfig.preset,
    customItems: normalizeCustomItems(value.customItems),
    segmentOptions: normalizeSegmentOptions(value),
    mouseScroll: value.mouseScroll !== false,
    fixedEditor: value.fixedEditor !== false,
  };
}

export function mergeSegmentsWithCustomItems(presetDef: PresetDef, customItems: readonly CustomStatusItem[]): {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  secondarySegments: StatusLineSegmentId[];
} {
  const left: StatusLineSegmentId[] = [...presetDef.leftSegments];
  const right: StatusLineSegmentId[] = [...presetDef.rightSegments];
  const secondary: StatusLineSegmentId[] = [...(presetDef.secondarySegments ?? [])];

  for (const item of customItems) {
    const segmentId: StatusLineSegmentId = `custom:${item.id}`;
    if (item.position === "left") left.push(segmentId);
    else if (item.position === "secondary") secondary.push(segmentId);
    else right.push(segmentId);
  }

  return { leftSegments: left, rightSegments: right, secondarySegments: secondary };
}

export function nextPowerlineSettingWithPreset(existingPowerlineSetting: unknown, preset: StatusLinePreset): unknown {
  if (!isRecord(existingPowerlineSetting)) {
    return preset;
  }
  return { ...existingPowerlineSetting, preset };
}

export function nextPowerlineSettingWithOptions(
  existingPowerlineSetting: unknown,
  updates: Partial<Pick<PowerlineConfig, "mouseScroll" | "fixedEditor">>,
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

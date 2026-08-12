export interface EditorPerfOptions {
  enabled: boolean;
  fastRender: boolean;
  editorChrome: boolean;
  widgets: boolean;
  bashWidgets: boolean;
  lastPrompt: boolean;
}

interface EditorPerfMetric {
  count: number;
  totalMs: number;
  maxMs: number;
}

export function readEditorPerfOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EditorPerfOptions {
  const enabled = env.POWERLINE_DEBUG_PERF === "1";
  return {
    enabled,
    fastRender: !enabled || env.POWERLINE_PERF_FAST_RENDER !== "0",
    editorChrome: !enabled || env.POWERLINE_PERF_EDITOR_CHROME !== "0",
    widgets: !enabled || env.POWERLINE_PERF_WIDGETS !== "0",
    bashWidgets: !enabled || env.POWERLINE_PERF_BASH_WIDGETS !== "0",
    lastPrompt: !enabled || env.POWERLINE_PERF_LAST_PROMPT !== "0",
  };
}

export class EditorPerfProfiler {
  readonly options: EditorPerfOptions;
  private readonly metrics = new Map<string, EditorPerfMetric>();
  private startedAt = Date.now();
  private maxDraftChars = 0;
  private draftObservationCount = 0;

  constructor(options: EditorPerfOptions) {
    this.options = options;
  }

  measure<T>(name: string, operation: () => T): T {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      this.record(name, performance.now() - startedAt);
    }
  }

  count(name: string): void {
    const metric = this.metrics.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    metric.count += 1;
    this.metrics.set(name, metric);
  }

  observeDraft(lines: readonly unknown[]): void {
    this.draftObservationCount += 1;
    if (lines.length > 1 && this.draftObservationCount % 32 !== 1) return;

    let chars = Math.max(0, lines.length - 1);
    for (const line of lines) {
      if (typeof line === "string") chars += line.length;
    }
    this.maxDraftChars = Math.max(this.maxDraftChars, chars);
  }

  reset(): void {
    this.metrics.clear();
    this.startedAt = Date.now();
    this.maxDraftChars = 0;
    this.draftObservationCount = 0;
  }

  report(): string {
    const inputCount = this.metrics.get("input.total")?.count ?? 0;
    const renderCount = this.metrics.get("editor.render.total")?.count ?? 0;
    const lines = [
      `Powerline editor perf (${((Date.now() - this.startedAt) / 1000).toFixed(1)}s)`,
      `A/B: fast-render=${this.options.fastRender ? "on" : "off"}, editor-chrome=${this.options.editorChrome ? "on" : "off"}, widgets=${this.options.widgets ? "on" : "off"}, bash-widgets=${this.options.bashWidgets ? "on" : "off"}, last-prompt=${this.options.lastPrompt ? "on" : "off"}`,
      `inputs=${inputCount}, editor-renders=${renderCount}, renders/input=${inputCount > 0 ? (renderCount / inputCount).toFixed(2) : "0.00"}, max-draft=${this.maxDraftChars}`,
    ];

    for (const [name, metric] of [...this.metrics].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(metric.totalMs === 0 && metric.maxMs === 0
        ? `${name}: n=${metric.count}`
        : `${name}: n=${metric.count}, avg=${(metric.totalMs / metric.count).toFixed(3)}ms, max=${metric.maxMs.toFixed(3)}ms, total=${metric.totalMs.toFixed(1)}ms`);
    }

    return lines.join("\n");
  }

  private record(name: string, durationMs: number): void {
    const metric = this.metrics.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    metric.count += 1;
    metric.totalMs += durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
    this.metrics.set(name, metric);
  }
}

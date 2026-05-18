export interface RenderScheduler {
  schedule(delayMs?: number): void;
  cancel(): void;
}

export function createRenderScheduler(render: () => void, defaultDelayMs: number): RenderScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(delayMs = defaultDelayMs) {
      if (timer) return;

      timer = setTimeout(() => {
        timer = null;
        try {
          render();
        } catch {
          // Extension ctx may be stale after session replacement (e.g. compaction).
          // Silently ignore to prevent crashing the process.
        }
      }, delayMs);
    },
    cancel() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}

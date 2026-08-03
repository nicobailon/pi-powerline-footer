export interface RenderScheduler {
  schedule(delayMs?: number): void;
  cancel(): void;
}

export function createRenderScheduler(render: () => void, defaultDelayMs: number): RenderScheduler {
  let pending: { timer: ReturnType<typeof setTimeout>; deadline: number } | null = null;

  return {
    schedule(delayMs = defaultDelayMs) {
      const deadline = Date.now() + delayMs;
      if (pending) {
        if (deadline >= pending.deadline) return;
        clearTimeout(pending.timer);
      }

      const timer = setTimeout(() => {
        pending = null;
        render();
      }, delayMs);
      pending = { timer, deadline };
    },
    cancel() {
      if (!pending) return;
      clearTimeout(pending.timer);
      pending = null;
    },
  };
}

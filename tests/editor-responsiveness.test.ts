import test from "node:test";
import assert from "node:assert/strict";
import { createRenderScheduler } from "../render-scheduler.ts";

test("render scheduler coalesces pending status renders", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  let renderCount = 0;

  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    callbacks.push(callback);
    delays.push(delay ?? 0);
    return { id: callbacks.length } as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  try {
    const scheduler = createRenderScheduler(() => { renderCount += 1; }, 33);

    scheduler.schedule();
    scheduler.schedule(150);
    scheduler.schedule();

    assert.equal(callbacks.length, 1);
    assert.equal(delays[0], 33);
    callbacks[0]?.();
    assert.equal(renderCount, 1);

    scheduler.schedule(150);
    assert.equal(callbacks.length, 2);
    assert.equal(delays[1], 150);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("render scheduler pulls pending work forward for an earlier deadline", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  const cleared = new Set<object>();
  let renderCount = 0;

  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const handle = { id: callbacks.length + 1 };
    callbacks.push(callback);
    delays.push(delay ?? 0);
    return handle as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (handle && typeof handle === "object") cleared.add(handle);
  }) as typeof clearTimeout;

  try {
    const scheduler = createRenderScheduler(() => { renderCount += 1; }, 33);

    scheduler.schedule(250);
    scheduler.schedule(33);

    assert.deepEqual(delays, [250, 33]);
    assert.equal(cleared.size, 1);
    callbacks[1]?.();
    assert.equal(renderCount, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("render scheduler allows callbacks to schedule follow-up renders", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  let renderCount = 0;
  let scheduler: ReturnType<typeof createRenderScheduler>;

  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    callbacks.push(callback);
    delays.push(delay ?? 0);
    return { id: callbacks.length } as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  try {
    scheduler = createRenderScheduler(() => {
      renderCount += 1;
      if (renderCount === 1) {
        scheduler.schedule(150);
      }
    }, 33);

    scheduler.schedule();
    callbacks[0]?.();

    assert.equal(renderCount, 1);
    assert.equal(callbacks.length, 2);
    assert.equal(delays[1], 150);

    callbacks[1]?.();
    assert.equal(renderCount, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("render scheduler cancels pending status renders", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const callbacks: Array<() => void> = [];
  const cleared = new Set<object>();
  let renderCount = 0;

  globalThis.setTimeout = ((callback: () => void) => {
    const handle = { id: callbacks.length + 1 };
    callbacks.push(callback);
    return handle as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (handle && typeof handle === "object") {
      cleared.add(handle);
    }
  }) as typeof clearTimeout;

  try {
    const scheduler = createRenderScheduler(() => { renderCount += 1; }, 33);

    scheduler.schedule();
    scheduler.cancel();

    assert.equal(cleared.size, 1);
    assert.equal(renderCount, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

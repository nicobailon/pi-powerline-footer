import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSessionTokenStats, SessionTokenStatsCache } from "../token-stats.ts";

function makeUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0, costPerToken = 0.001) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    cost: { total: (input + output + cacheRead + cacheWrite) * costPerToken },
  };
}

function assistantEvent(usage: ReturnType<typeof makeUsage>, stopReason: string = "stop") {
  return {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      usage,
      stopReason,
    },
  };
}

function userEvent() {
  return {
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  };
}

test("computeSessionTokenStats aggregates usage and tracks thinking level", () => {
  const events = [
    userEvent(),
    { type: "thinking_level_change", thinkingLevel: "high" },
    assistantEvent(makeUsage(10, 5)),
    assistantEvent(makeUsage(20, 7, 3, 2), "error"), // skipped: error
    assistantEvent(makeUsage(30, 9, 4, 1), "aborted"), // skipped: aborted
    assistantEvent(makeUsage(40, 11, 6, 2)),
  ];

  const stats = computeSessionTokenStats(events);

  assert.equal(stats.input, 50);
  assert.equal(stats.output, 16);
  assert.equal(stats.cacheRead, 6);
  assert.equal(stats.cacheWrite, 2);
  assert.ok(Math.abs(stats.cost - 0.074) < 1e-12);
  assert.equal(stats.lastAssistant, (events[5] as any).message);
  assert.equal(stats.thinkingLevelFromSession, "high");
});

test("computeSessionTokenStats ignores assistant messages without tokens for lastAssistant", () => {
  const events = [
    assistantEvent(makeUsage(10, 5)),
    assistantEvent(makeUsage(0, 0)),
  ];

  const stats = computeSessionTokenStats(events);
  assert.equal(stats.lastAssistant, (events[0] as any).message);
});

test("cache reuses stats object while session is unchanged", () => {
  const cache = new SessionTokenStatsCache();
  const events = [userEvent(), assistantEvent(makeUsage(10, 5))];

  const first = cache.get(events);
  const second = cache.get(events);

  assert.equal(second, first);
});

test("cache recomputes when events are appended", () => {
  const cache = new SessionTokenStatsCache();
  const events = [assistantEvent(makeUsage(10, 5))];

  const first = cache.get(events);
  events.push(assistantEvent(makeUsage(20, 7)));
  const second = cache.get(events);

  assert.notEqual(second, first);
  assert.equal(second.input, 30);
  assert.equal(second.output, 12);
});

test("cache recomputes when the last event is updated in place (streaming)", () => {
  const cache = new SessionTokenStatsCache();
  const tail = assistantEvent(makeUsage(10, 5), "streaming");
  const events = [userEvent(), tail];

  const first = cache.get(events);
  assert.equal(first.output, 5);

  // Streaming updates the trailing assistant message in place: same event
  // count, same object references, fresh usage numbers.
  tail.message.usage = makeUsage(10, 42);
  tail.message.stopReason = "stop";

  const second = cache.get(events);
  assert.notEqual(second, first);
  assert.equal(second.output, 42);
  assert.equal(second.lastAssistant, tail.message);
});

test("cache recomputes when the last event turns into an error in place", () => {
  const cache = new SessionTokenStatsCache();
  const tail = assistantEvent(makeUsage(10, 5));
  const events = [assistantEvent(makeUsage(1, 1)), tail];

  const first = cache.get(events);
  assert.equal(first.input, 11);

  tail.message.stopReason = "error";

  const second = cache.get(events);
  assert.notEqual(second, first);
  assert.equal(second.input, 1);
});

test("cache recomputes when the last event is replaced with a same-sized list", () => {
  const cache = new SessionTokenStatsCache();
  const events = [userEvent(), assistantEvent(makeUsage(10, 5))];

  const first = cache.get(events);
  events[1] = assistantEvent(makeUsage(10, 5));
  const second = cache.get(events);

  assert.notEqual(second, first);
  assert.deepEqual(
    { input: second.input, output: second.output },
    { input: first.input, output: first.output },
  );
});

test("cache does not rescan for in-place changes to non-trailing events", () => {
  const cache = new SessionTokenStatsCache();
  const head = assistantEvent(makeUsage(10, 5));
  const events = [head, assistantEvent(makeUsage(20, 7))];

  const first = cache.get(events);

  // Historical events are treated as immutable; only the trailing event is
  // re-validated. This documents the cache's correctness boundary.
  head.message.usage = makeUsage(999, 999);
  const second = cache.get(events);

  assert.equal(second, first);
  assert.equal(second.input, 30);
});

test("reset forces recomputation", () => {
  const cache = new SessionTokenStatsCache();
  const events = [assistantEvent(makeUsage(10, 5))];

  const first = cache.get(events);
  cache.reset();
  const second = cache.get(events);

  assert.notEqual(second, first);
  assert.equal(second.input, first.input);
});

test("index.ts wires the token stats cache into buildSegmentContext", () => {
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
  assert.match(source, /import \{ SessionTokenStatsCache \} from "\.\/token-stats\.ts";/);
  assert.match(source, /tokenStatsCache\.get\(sessionEvents\)/);
  assert.match(source, /tokenStatsCache\.reset\(\)/);
});

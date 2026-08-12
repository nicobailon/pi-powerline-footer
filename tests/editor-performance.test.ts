import test from "node:test";
import assert from "node:assert/strict";
import { EditorPerfProfiler, readEditorPerfOptions } from "../editor-performance.ts";

test("editor profiling and A/B switches are opt-in", () => {
  assert.deepEqual(readEditorPerfOptions({}), {
    enabled: false,
    fastRender: true,
    editorChrome: true,
    widgets: true,
    bashWidgets: true,
    lastPrompt: true,
  });

  assert.deepEqual(readEditorPerfOptions({
    POWERLINE_DEBUG_PERF: "1",
    POWERLINE_PERF_FAST_RENDER: "0",
    POWERLINE_PERF_EDITOR_CHROME: "0",
    POWERLINE_PERF_WIDGETS: "0",
    POWERLINE_PERF_BASH_WIDGETS: "0",
    POWERLINE_PERF_LAST_PROMPT: "0",
  }), {
    enabled: true,
    fastRender: false,
    editorChrome: false,
    widgets: false,
    bashWidgets: false,
    lastPrompt: false,
  });
});

test("editor profiler reports timings, counts, and draft size", () => {
  const profiler = new EditorPerfProfiler(readEditorPerfOptions({ POWERLINE_DEBUG_PERF: "1" }));

  profiler.measure("input.total", () => 42);
  profiler.count("editor.render.fast-hit");
  profiler.observeDraft(["hello", "world"]);

  const report = profiler.report();
  assert.match(report, /inputs=1, editor-renders=0, renders\/input=0\.00, max-draft=11/);
  assert.match(report, /editor\.render\.fast-hit: n=1/);
  assert.match(report, /input\.total: n=1, avg=/);
});

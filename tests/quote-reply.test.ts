import test from "node:test";
import assert from "node:assert/strict";
import { reply } from "../quote-reply.ts";

function contextFor(entries: unknown[], editorText = "draft") {
  let text = editorText;
  const notifications: string[] = [];
  return {
    context: {
      mode: "rpc",
      sessionManager: { getBranch: () => entries },
      ui: {
        getEditorText: () => text,
        setEditorText: (next: string) => { text = next; },
        notify: (message: string) => { notifications.push(message); },
        select: async () => undefined,
      },
    } as any,
    get text() { return text; },
    notifications,
  };
}

test("reply quotes a matching message and preserves the current draft", async () => {
  const harness = contextFor([
    { type: "message", id: "old", timestamp: "2026-08-23T00:00:00.000Z", message: { role: "toolResult", content: [{ type: "text", text: "ignore" }] } },
    { type: "message", id: "abc123", timestamp: "2026-08-23T00:01:00.000Z", message: { role: "user", content: [{ type: "text", text: "Please inspect this." }] } },
  ]);

  await reply("abc", harness.context);

  assert.equal(harness.text, "Quoted previous user message abc123 for reference only:\n\n> Please inspect this.\n\nMy reply:\ndraft");
  assert.deepEqual(harness.notifications, ["Inserted quote from user message abc123."]);
});

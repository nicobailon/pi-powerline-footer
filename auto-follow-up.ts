const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
// Warm calls take ~100-400ms; the margin covers a cold connection. Steering only lands at the agent's next step anyway.
const JEV_TIMEOUT_MS = 1500;
// A wrong follow-up lets the agent keep working without a correction, so only clear calls leave the steer path.
const MIN_FOLLOW_UP_CONFIDENCE = 0.8;

export interface FollowUpRouteState {
  currentTask: string;
  agentLatestText: string;
  newMessage: string;
}

/** Asks Jev whether a message sent while the agent is busy can wait until the current task finishes. */
export async function canWaitAsFollowUp(state: FollowUpRouteState, apiKey: string): Promise<boolean> {
  const response = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    body: JSON.stringify({
      model: "jev-latest",
      state: {
        current_task: state.currentTask || "Unknown",
        agent_latest_text: state.agentLatestText || "None yet",
        new_message: state.newMessage,
      },
      questions: {
        route: {
          type: "choice",
          instructions: "A coding agent is busy with `current_task`. Should `new_message` be delivered now as steering for that task, or queued until the task finishes?",
          criteria: {
            steer: "The message changes, constrains, corrects, adds scope to, or gives information about the task the agent is doing right now, so the agent should see it before its next step. Includes messages that mix a change to the current task with a later request.",
            follow_up: "The message is a separate request or question that does not change how the current task should be done, so it can wait until the current task finishes.",
          },
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Jev returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const body = await response.json() as { answers?: { route?: { choice?: unknown; confidence?: unknown } } };
  const route = body.answers?.route;
  if ((route?.choice !== "steer" && route?.choice !== "follow_up") || typeof route.confidence !== "number") {
    throw new Error("Jev returned an unexpected route answer");
  }
  return route.choice === "follow_up" && route.confidence >= MIN_FOLLOW_UP_CONFIDENCE;
}

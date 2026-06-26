import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the Pi agent configuration directory.
 * Respects PI_CODING_AGENT_DIR when set; falls back to ~/.pi/agent/.
 */
export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

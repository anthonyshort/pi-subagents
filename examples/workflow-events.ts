import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Record this session's workflow events as JSON lines for a local observer.
 */
export default function workflowEvents(pi: ExtensionAPI) {
  let unsubscribe: (() => void)[] = [];

  pi.on("session_start", (_event, ctx) => {
    for (const off of unsubscribe) off();
    const sessionId = ctx.sessionManager.getSessionId();
    const directory = join(ctx.cwd, ".pi");
    const filename = join(directory, "workflow-events.jsonl");
    const channels = [
      "subagents:workflow:started",
      "subagents:workflow:progress",
      "subagents:workflow:completed",
      "subagents:workflow:failed",
    ];
    unsubscribe = channels.map(channel => pi.events.on(channel, payload => {
      if (payload === null || typeof payload !== "object" || !("sessionId" in payload)) return;
      if (payload.sessionId !== sessionId) return;
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      appendFileSync(filename, `${JSON.stringify({ event: channel, recordedAt: Date.now(), payload })}\n`, { mode: 0o600 });
    }));
  });

  pi.on("session_shutdown", () => {
    for (const off of unsubscribe) off();
    unsubscribe = [];
  });
}

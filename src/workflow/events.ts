import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorkflowEntry } from "./progress.js";
import type { WorkflowTask } from "./task.js";

/**
 * Identity shared by the workflow's cross-extension events.
 */
export interface WorkflowEventIdentity {
  id: string;
  name: string;
  sessionId: string;
  cwd: string;
}

export interface WorkflowStartedEvent extends WorkflowEventIdentity {
  startedAt: number;
  args?: unknown;
  scriptPath?: string;
  toolCallId?: string;
  resumedFrom?: string;
}

export interface WorkflowProgressEvent extends WorkflowEventIdentity {
  entries: readonly WorkflowEntry[];
}

export interface WorkflowCompletedEvent extends WorkflowEventIdentity {
  status: "completed";
  completedAt: number;
  result?: unknown;
}

export interface WorkflowFailedEvent extends WorkflowEventIdentity {
  status: "failed" | "killed";
  completedAt: number;
  error?: string;
}

/**
 * Payloads emitted on pi.events. Progress preserves the runtime's batch order.
 */
export interface WorkflowEventMap {
  "subagents:workflow:started": WorkflowStartedEvent;
  "subagents:workflow:progress": WorkflowProgressEvent;
  "subagents:workflow:completed": WorkflowCompletedEvent;
  "subagents:workflow:failed": WorkflowFailedEvent;
}

/**
 * Observe one task without giving listeners references to its mutable state.
 * Pi's bus isolates listener exceptions and rejected promises; the catch also
 * protects execution when cloning or a host-provided emitter fails.
 */
export function createWorkflowEvents(
  events: ExtensionAPI["events"],
  task: WorkflowTask,
  context: { sessionId: string; cwd: string },
) {
  const identity: WorkflowEventIdentity = {
    id: task.id,
    name: task.workflowName ?? task.id,
    sessionId: context.sessionId,
    cwd: context.cwd,
  };

  function emit<Name extends keyof WorkflowEventMap>(name: Name, payload: WorkflowEventMap[Name]): void {
    try {
      events.emit(name, structuredClone(payload));
    } catch (error) {
      console.warn(`[pi-subagents] could not emit ${name} for ${task.id}:`, error);
    }
  }

  return {
    started(): void {
      emit("subagents:workflow:started", {
        ...identity,
        startedAt: task.startTime,
        ...(task.args !== undefined ? { args: task.args } : {}),
        ...(task.scriptPath !== undefined ? { scriptPath: task.scriptPath } : {}),
        ...(task.toolCallId !== undefined ? { toolCallId: task.toolCallId } : {}),
        ...(task.resumedFrom !== undefined ? { resumedFrom: task.resumedFrom } : {}),
      });
    },
    progress(entries: readonly WorkflowEntry[]): void {
      if (entries.length > 0) emit("subagents:workflow:progress", { ...identity, entries });
    },
    finished(): void {
      const completedAt = task.endTime ?? Date.now();
      if (task.status === "completed") {
        emit("subagents:workflow:completed", {
          ...identity,
          status: task.status,
          completedAt,
          ...(task.value !== undefined ? { result: task.value } : {}),
        });
      } else if (task.status === "failed" || task.status === "killed") {
        emit("subagents:workflow:failed", {
          ...identity,
          status: task.status,
          completedAt,
          ...(task.error !== undefined ? { error: task.error } : {}),
        });
      }
    },
  };
}

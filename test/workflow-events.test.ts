import { createEventBus } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowEvents } from "../src/workflow/events.js";
import type { WorkflowEntry } from "../src/workflow/progress.js";
import { createWorkflowTask } from "../src/workflow/task.js";

function setup() {
  const task = createWorkflowTask({
    id: "wf_abc123",
    script: "return 1;",
    meta: { name: "review", description: "Review a change" },
    startTime: 100,
  });
  const events = { emit: vi.fn(), on: () => () => {} };
  const observer = createWorkflowEvents(events, task, { sessionId: "session-1", cwd: "/project" });
  return { task, events, observer };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("workflow event payloads", () => {
  it("omits unavailable launch fields and preserves an untruncated result", () => {
    const { task, events, observer } = setup();
    observer.started();
    expect(events.emit).toHaveBeenLastCalledWith("subagents:workflow:started", {
      id: "wf_abc123", name: "review", sessionId: "session-1", cwd: "/project", startedAt: 100,
    });

    task.status = "completed";
    task.endTime = 200;
    task.value = { report: "finding ".repeat(1000) };
    observer.finished();
    expect(events.emit).toHaveBeenLastCalledWith("subagents:workflow:completed", {
      id: "wf_abc123", name: "review", sessionId: "session-1", cwd: "/project",
      status: "completed", completedAt: 200, result: task.value,
    });
  });

  it("snapshots arguments, progress and results without sharing task references", () => {
    const { task, events, observer } = setup();
    const args = { review: { head: "original" } };
    task.args = args;
    task.scriptPath = "/project/review.js";
    task.toolCallId = "tool-1";
    task.resumedFrom = "wf_prior1";
    observer.started();
    args.review.head = "changed";
    expect(events.emit).toHaveBeenLastCalledWith("subagents:workflow:started", expect.objectContaining({
      args: { review: { head: "original" } }, scriptPath: "/project/review.js",
      toolCallId: "tool-1", resumedFrom: "wf_prior1",
    }));

    const agentEntry = { type: "workflow_agent", index: 0, label: "research", state: "start" } satisfies WorkflowEntry;
    const entries: WorkflowEntry[] = [
      { type: "workflow_log", message: "inspecting" },
      agentEntry,
    ];
    observer.progress(entries);
    entries[0] = { type: "workflow_log", message: "overwritten" };
    agentEntry.label = "changed";
    expect(events.emit).toHaveBeenLastCalledWith("subagents:workflow:progress", expect.objectContaining({
      entries: [
        { type: "workflow_log", message: "inspecting" },
        { type: "workflow_agent", index: 0, label: "research", state: "start" },
      ],
    }));

    const result = { finding: { text: "original" } };
    task.status = "completed";
    task.value = result;
    task.endTime = 200;
    observer.finished();
    result.finding.text = "changed";
    expect(events.emit).toHaveBeenLastCalledWith("subagents:workflow:completed", expect.objectContaining({
      result: { finding: { text: "original" } },
    }));
  });

  it("does not emit empty progress batches or treat a running task as finished", () => {
    const { events, observer } = setup();
    observer.progress([]);
    observer.finished();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it.each(["failed", "killed"] as const)("preserves the %s terminal status", status => {
    const { task, events, observer } = setup();
    task.status = status;
    task.error = "stopped here";
    task.endTime = 200;
    observer.finished();
    expect(events.emit).toHaveBeenCalledExactlyOnceWith("subagents:workflow:failed", {
      id: "wf_abc123", name: "review", sessionId: "session-1", cwd: "/project",
      status, completedAt: 200, error: "stopped here",
    });
  });

  it("reports an emitter failure without throwing into the workflow", () => {
    const { events, observer } = setup();
    events.emit.mockImplementation(() => { throw new Error("recorder unavailable"); });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => observer.started()).not.toThrow();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("subagents:workflow:started for wf_abc123"),
      expect.objectContaining({ message: "recorder unavailable" }),
    );
  });

  it("uses Pi's bus isolation for throwing and rejecting listeners", async () => {
    const { task } = setup();
    const bus = createEventBus();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const received = vi.fn();
    bus.on("subagents:workflow:started", () => { throw new Error("sync listener"); });
    bus.on("subagents:workflow:started", async () => { throw new Error("async listener"); });
    bus.on("subagents:workflow:started", received);
    const observer = createWorkflowEvents(bus, task, { sessionId: "session-1", cwd: "/project" });
    observer.started();
    expect(received).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: task.id }));
    await vi.waitFor(() => { expect(error).toHaveBeenCalledTimes(2); });
    bus.clear();
  });
});

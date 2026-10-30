import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorder from "../examples/workflow-events.js";
import subagentsExtension, { WORKFLOW_FILE_FLAG } from "../src/index.js";
import { ctx, type Hermetic, hermeticDir, makePi } from "./helpers/boot-extension.js";

describe("workflow event recorder example", () => {
  let hermetic: Hermetic;

  beforeEach(() => { hermetic = hermeticDir({ settings: { workflowsEnabled: true } }); });
  afterEach(() => { hermetic.restore(); vi.restoreAllMocks(); });

  it("records a CLI workflow from start through its full result", async () => {
    const scriptPath = join(hermetic.dir, "preview.js");
    writeFileSync(scriptPath, [
      'export const meta = { name: "preview", description: "no model needed" };',
      'phase("Research"); log("inspecting"); return { report: "full report" };',
    ].join("\n"));
    const { pi, lifecycle } = makePi({ [WORKFLOW_FILE_FLAG]: scriptPath });
    const bus = createEventBus();
    pi.events = bus;
    recorder(pi);
    const startRecorder = lifecycle.get("session_start");
    const stopRecorder = lifecycle.get("session_shutdown");
    subagentsExtension(pi);
    const context = ctx({ cwd: hermetic.dir });
    await startRecorder({}, context);
    await lifecycle.get("session_start")({}, context);
    const filename = join(hermetic.dir, ".pi", "workflow-events.jsonl");

    try {
      await vi.waitFor(() => {
        expect(readFileSync(filename, "utf8")).toContain("subagents:workflow:completed");
      }, { timeout: 10_000 });
      const records: unknown[] = readFileSync(filename, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(records[0]).toMatchObject({
        event: "subagents:workflow:started",
        payload: { name: "preview", sessionId: "s1", cwd: hermetic.dir, scriptPath },
      });
      expect(records).toContainEqual(expect.objectContaining({
        event: "subagents:workflow:progress",
        payload: expect.objectContaining({ entries: expect.arrayContaining([
          { type: "workflow_phase", index: 0, title: "Research" },
          { type: "workflow_log", message: "inspecting" },
        ]) }),
      }));
      expect(records.at(-1)).toMatchObject({
        event: "subagents:workflow:completed",
        payload: { status: "completed", result: { report: "full report" } },
      });
      expect(statSync(filename).mode & 0o777).toBe(0o600);

      const before = readFileSync(filename, "utf8");
      bus.emit("subagents:workflow:started", { sessionId: "another-session" });
      expect(readFileSync(filename, "utf8")).toBe(before);
      await stopRecorder({}, context);
      bus.emit("subagents:workflow:started", { sessionId: "s1" });
      expect(readFileSync(filename, "utf8")).toBe(before);
    } finally {
      await lifecycle.get("session_shutdown")({}, context);
      bus.clear();
    }
  });
});

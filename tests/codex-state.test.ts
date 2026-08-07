import assert from "node:assert/strict";
import { test } from "node:test";

import type { AppAction } from "../src/codex-state.ts";
import {
  classifyNotification,
  createInitialState,
  findEntry,
  formatRateLimitWindow,
  formatThreadUsage,
  formatTokens,
  parseProjects,
  serializeProjects,
  stateReducer,
  threadStatusText,
  visibleActionFailure,
} from "../src/codex-state.ts";
import {
  imageGenerationDataUrl,
  itemPayload,
  mcpImageContent,
  patchChangeKindLabel,
  type Thread,
  type ThreadItem,
  type ThreadTokenUsage,
  type Model,
} from "../src/codex-types.ts";

test("image generation results become displayable PNG data URLs", () => {
  assert.equal(imageGenerationDataUrl(""), null);
  assert.equal(imageGenerationDataUrl("  cG5n  "), "data:image/png;base64,cG5n");
  assert.equal(
    imageGenerationDataUrl("data:image/webp;base64,d2VicA=="),
    "data:image/webp;base64,d2VicA==",
  );
});

test("MCP image content becomes safe displayable data URLs", () => {
  assert.deepEqual(
    mcpImageContent({
      content: [
        { type: "text", text: "screenshot" },
        { type: "image", data: "cG5n", mimeType: "image/png" },
        { type: "image", data: "PHN2Zz4=", mimeType: "image/svg+xml" },
        { type: "image", data: "not base64!", mimeType: "image/png" },
      ],
    }),
    [{ dataUrl: "data:image/png;base64,cG5n", mimeType: "image/png" }],
  );
  assert.deepEqual(mcpImageContent(null), []);
});

function thread(id: string, cwd = "/home/test/project-a"): Thread {
  return {
    id,
    sessionId: `session-${id}`,
    preview: "preview",
    ephemeral: false,
    isPinned: false,
    modelProvider: "sudhir_gateway",
    createdAt: 1754400000,
    updatedAt: 1754400000,
    recencyAt: 1754400000,
    status: "idle",
    path: null,
    cwd,
    cliVersion: "0.1.0",
    source: "vscode",
    name: null,
    turns: [],
  };
}

function agentItem(id: string, text = ""): ThreadItem {
  return { type: "agentMessage", id, text, phase: null };
}

function model(
  id: string,
  serviceTierIds: string[] = [],
  effortIds: string[] = ["low", "medium", "high"],
  defaultReasoningEffort = "medium",
): Model {
  return {
    id,
    model: id,
    displayName: id,
    description: id,
    hidden: false,
    supportedReasoningEfforts: effortIds.map((reasoningEffort) => ({
      reasoningEffort,
      description: `${reasoningEffort} reasoning`,
    })),
    defaultReasoningEffort,
    isDefault: id === "gpt-5.6-sol",
    serviceTiers: serviceTierIds.map((tier) => ({
      id: tier,
      name: tier === "priority" ? "Fast" : tier,
      description: "",
    })),
  };
}

test("project persistence round-trips and rejects malformed input", () => {
  const state = {
    version: 1 as const,
    projects: [
      {
        name: "My Project",
        pickerPath: "/Users/me/project",
        backendPath: "/Users/me/project",
      },
    ],
    lastProjectId: "/Users/me/project",
  };
  const parsed = parseProjects(serializeProjects(state));
  assert.deepEqual(parsed, state);

  assert.deepEqual(parseProjects(null), { version: 1, projects: [], lastProjectId: null });
  assert.deepEqual(parseProjects("not json"), { version: 1, projects: [], lastProjectId: null });
  assert.deepEqual(parseProjects('{"version": 2, "projects": []}'), {
    version: 1,
    projects: [],
    lastProjectId: null,
  });
  assert.deepEqual(parseProjects('{"version": 1, "projects": [{"name": "x"}]}'), {
    version: 1,
    projects: [],
    lastProjectId: null,
  });
});

test("project add/remove/select reducer behavior", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "project/add",
    project: {
      name: "A",
      pickerPath: "/a",
      backendPath: "/a",
    },
  });
  state = stateReducer(state, {
    type: "project/add",
    project: {
      name: "A again",
      pickerPath: "/a",
      backendPath: "/a",
    },
  });
  assert.equal(state.projects.length, 1);
  assert.equal(state.selectedProjectBackendPath, "/a");

  state = stateReducer(state, {
    type: "threads/replace",
    threads: [thread("t1")],
    cursor: null,
    append: false,
  });
  assert.equal(state.threads.length, 1);

  state = stateReducer(state, { type: "project/remove", backendPath: "/a" });
  assert.equal(state.projects.length, 0);
  assert.equal(state.selectedProjectBackendPath, null);
  assert.equal(state.threads.length, 0);
});

test("action failures become visible connection diagnostics without disconnecting", () => {
  const action = visibleActionFailure(
    "failed to steer turn",
    new Error("ExpectedTurnMismatch"),
  );
  assert.deepEqual(action, {
    type: "connection/status",
    connected: true,
    diagnostic: "failed to steer turn: Error: ExpectedTurnMismatch",
  });

  const state = stateReducer(createInitialState(), action);
  assert.equal(state.connected, true);
  assert.equal(state.diagnostic, "failed to steer turn: Error: ExpectedTurnMismatch");
});

test("effort defaults per model and resets only when the next model cannot use it", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "models/replace",
    models: [
      model("gpt-5.6-sol", ["priority"], ["low", "medium", "high", "xhigh"], "medium"),
      model("pi-xai/grok-4.5", [], ["low", "high"], "high"),
      model("pi-zai/glm-5.2", [], ["high", "max"], "high"),
    ],
  });
  assert.equal(state.selectedReasoningEffort, "medium");

  state = stateReducer(state, { type: "reasoningEffort/select", effort: "xhigh" });
  state = stateReducer(state, { type: "model/select", model: "pi-xai/grok-4.5" });
  assert.equal(state.selectedReasoningEffort, "high");

  state = stateReducer(state, { type: "model/select", model: "pi-zai/glm-5.2" });
  assert.equal(state.selectedReasoningEffort, "high");
});

test("speed tier collapses to no-opinion for a non-GPT model even if a tier is present", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "models/replace",
    models: [model("gpt-5.6-sol", ["priority"]), model("pi-xai/grok-4.5", ["priority"])],
  });
  state = stateReducer(state, { type: "serviceTier/select", serviceTier: "priority" });
  assert.equal(state.selectedServiceTier, "priority");

  // speedTiersForModel returns [] for non-GPT models, so the tier concept does
  // not exist there: the selection becomes undefined (omit), never an explicit clear.
  state = stateReducer(state, { type: "model/select", model: "pi-xai/grok-4.5" });
  assert.equal(state.selectedServiceTier, undefined);
});

test("explicit Standard survives switches between tiered models", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "models/replace",
    models: [
      model("gpt-5.6-sol", ["priority"]),
      model("gpt-5.5", ["priority"]),
      model("pi-xai/grok-4.5", []),
    ],
  });
  state = stateReducer(state, { type: "serviceTier/select", serviceTier: null });
  assert.equal(state.selectedServiceTier, null);

  state = stateReducer(state, { type: "model/select", model: "gpt-5.5" });
  assert.equal(state.selectedServiceTier, null, "Standard persists across tiered models");

  state = stateReducer(state, { type: "model/select", model: "pi-xai/grok-4.5" });
  assert.equal(state.selectedServiceTier, undefined, "no tier concept → no opinion");
});

test("config defaults seed effort and speed when models arrive second", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "configDefaults/loaded",
    effort: "max",
    serviceTier: "priority",
  });
  assert.deepEqual(state.pendingConfigDefaults, { effort: "max", serviceTier: "priority" });

  state = stateReducer(state, {
    type: "models/replace",
    models: [model("gpt-5.6-sol", ["priority"], ["low", "medium", "high", "max"], "low")],
  });
  assert.equal(state.selectedReasoningEffort, "max");
  assert.equal(state.selectedServiceTier, "priority");
  assert.equal(state.pendingConfigDefaults, null);
});

test("config defaults seed effort and speed when models arrive first", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "models/replace",
    models: [model("gpt-5.6-sol", ["priority"], ["low", "medium", "high", "max"], "low")],
  });
  assert.equal(state.selectedReasoningEffort, "low");

  state = stateReducer(state, {
    type: "configDefaults/loaded",
    effort: "max",
    serviceTier: "priority",
  });
  assert.equal(state.selectedReasoningEffort, "max");
  assert.equal(state.selectedServiceTier, "priority");
  assert.equal(state.pendingConfigDefaults, null);
});

test("an unsupported config effort falls through to the model default", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "configDefaults/loaded",
    effort: "ultra",
    serviceTier: "turbo",
  });
  state = stateReducer(state, {
    type: "models/replace",
    models: [model("gpt-5.6-sol", ["priority"], ["low", "medium", "high"], "medium")],
  });
  assert.equal(state.selectedReasoningEffort, "medium");
  assert.equal(state.selectedServiceTier, undefined);
});

test("the config seed is one-shot and applies even after a user selection", () => {
  // Documents the no-touched-flags decision: the startup seed applies on
  // arrival unconditionally (validated), even if a selection landed first.
  let state = createInitialState();
  state = stateReducer(state, {
    type: "models/replace",
    models: [model("gpt-5.6-sol", ["priority"], ["low", "medium", "high", "max"], "low")],
  });
  state = stateReducer(state, { type: "reasoningEffort/select", effort: "high" });

  state = stateReducer(state, {
    type: "configDefaults/loaded",
    effort: "max",
    serviceTier: null,
  });
  assert.equal(state.selectedReasoningEffort, "max");
  assert.equal(state.selectedServiceTier, undefined, "null config tier is not a seed");
});

test("thread hydration keeps persisted items in order", () => {
  let state = createInitialState();
  const persisted = {
    ...thread("t1"),
    turns: [
      {
        id: "turn-1",
        items: [
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [{ type: "text", text: "hi" }],
          },
          agentItem("a1", "persisted reply"),
        ],
        itemsView: "full",
        status: "completed" as const,
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
      },
    ],
  } satisfies Thread;
  state = stateReducer(state, { type: "thread/hydrate", thread: persisted });
  const threadState = state.threadsBy["t1"]!;
  assert.equal(threadState.entries.length, 2);
  assert.equal(threadState.entries[0]!.kind, "item");
  assert.equal(threadState.entries[0]!.turnId, "turn-1");
  assert.equal(itemPayload(findEntry(threadState, "a1")!.item, "agentMessage")?.text, "persisted reply");
});

test("streamed agent deltas and completion update the item in place", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "item/started",
    payload: {
      item: agentItem("a1"),
      threadId: "t1",
      turnId: "turn-1",
      startedAtMs: 1,
    },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "item/agentMessage/delta",
    payload: { threadId: "t1", turnId: "turn-1", itemId: "a1", delta: "Hello " },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "item/agentMessage/delta",
    payload: { threadId: "t1", turnId: "turn-1", itemId: "a1", delta: "world" },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "item/completed",
    payload: {
      item: agentItem("a1", "Hello world"),
      threadId: "t1",
      turnId: "turn-1",
      completedAtMs: 2,
    },
  });
  const entry = findEntry(state.threadsBy["t1"]!, "a1")!;
  assert.equal(entry.completed, true);
  assert.equal(entry.turnId, "turn-1");
  assert.equal(itemPayload(entry.item, "agentMessage")?.text, "Hello world");
});

test("interleaved thread ids route notifications independently", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "turn/started",
    payload: {
      threadId: "t1",
      turn: {
        id: "turn-1",
        items: [],
        itemsView: "notLoaded",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t2",
    turnId: "turn-2",
    method: "turn/started",
    payload: {
      threadId: "t2",
      turn: {
        id: "turn-2",
        items: [],
        itemsView: "notLoaded",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t2",
    turnId: "turn-2",
    method: "turn/completed",
    payload: {
      threadId: "t2",
      turn: {
        id: "turn-2",
        items: [],
        itemsView: "notLoaded",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
      },
    },
  });
  assert.equal(state.threadsBy["t1"]!.turnStatus, "inProgress");
  assert.equal(state.threadsBy["t2"]!.turnStatus, "completed");
});

test("command output deltas append to aggregated output", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "item/started",
    payload: {
      item: {
        type: "commandExecution",
        id: "c1",
        command: "ls",
        cwd: "/home/test",
        processId: null,
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null,
      },
      threadId: "t1",
      turnId: "turn-1",
      startedAtMs: 1,
    },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "item/commandExecution/outputDelta",
    payload: { threadId: "t1", turnId: "turn-1", itemId: "c1", delta: "file-a\n" },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "item/commandExecution/outputDelta",
    payload: { threadId: "t1", turnId: "turn-1", itemId: "c1", delta: "file-b\n" },
  });
  assert.equal(
    itemPayload(findEntry(state.threadsBy["t1"]!, "c1")!.item, "commandExecution")?.aggregatedOutput,
    "file-a\nfile-b\n",
  );
});

test("unknown item kinds are classified into a fallback entry without crashing", () => {
  let state = createInitialState();
  const unknownItem = {
    type: "newHarmlessItem",
    id: "x1",
    note: "something new",
  } as unknown as ThreadItem;
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "item/started",
    payload: { item: unknownItem, threadId: "t1", turnId: "turn-1", startedAtMs: 1 },
  });
  const entry = findEntry(state.threadsBy["t1"]!, "x1");
  assert.ok(entry);
  assert.deepEqual(entry.item, unknownItem);
});

test("unsupported server request adds a fallback transcript entry", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "thread/select",
    threadId: "t1",
  });
  state = stateReducer(state, {
    type: "unsupportedRequest",
    method: "mcpServer/elicitation/request",
    threadId: null,
    requestId: 42,
  });
  const entry = state.threadsBy["t1"]!.entries[0]!;
  assert.equal(entry.kind, "unsupportedRequest");
  assert.equal(entry.method, "mcpServer/elicitation/request");
});

test("classifyNotification routes known methods and ignores unknown ones", () => {
  const action = classifyNotification("turn/completed", {
    threadId: "t1",
    turn: { id: "turn-1" },
  });
  assert.ok(action);
  assert.equal(action.method, "turn/completed");
  assert.equal(action.threadId, "t1");
  assert.equal(action.turnId, "turn-1");
  const started = classifyNotification("turn/started", {
    threadId: "t1",
    turn: { id: "turn-9" },
  });
  assert.equal(started?.turnId, "turn-9");
  assert.equal(classifyNotification("item/newFancy/delta", {}), null);
  assert.equal(classifyNotification("turn/completed", {}), null);
});

test("thread name notifications update the hydrated thread", () => {
  let state = createInitialState();
  state = stateReducer(state, { type: "thread/hydrate", thread: thread("t1") });
  const action = classifyNotification("thread/name/updated", {
    threadId: "t1",
    threadName: "Grok gateway debugging",
  });
  assert.ok(action);
  state = stateReducer(state, action);
  assert.equal(state.threadsBy.t1?.thread?.name, "Grok gateway debugging");
});

test("error notification marks the turn failed with a visible message", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "turn/started",
    payload: {
      threadId: "t1",
      turn: {
        id: "turn-1",
        items: [],
        itemsView: "notLoaded",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "error",
    payload: {
      error: { message: "model routing failed", codexErrorInfo: null, additionalDetails: null },
      willRetry: false,
      threadId: "t1",
      turnId: "turn-1",
    },
  });
  assert.equal(state.threadsBy["t1"]!.turnStatus, "failed");
  assert.equal(state.threadsBy["t1"]!.turnError?.message, "model routing failed");
});

test("transient error notification does not fail the turn", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "turn/started",
    payload: {
      threadId: "t1",
      turn: {
        id: "turn-1",
        items: [],
        itemsView: "notLoaded",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    },
  });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "error",
    payload: {
      error: { message: "transient hiccup", codexErrorInfo: null, additionalDetails: null },
      willRetry: true,
      threadId: "t1",
      turnId: "turn-1",
    },
  });
  assert.equal(state.threadsBy["t1"]!.turnStatus, "inProgress");
  assert.equal(state.threadsBy["t1"]!.turnError?.message, "transient hiccup");
});

test("failing turn completion carries the error through turn.error", () => {
  let state = createInitialState();
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "turn/completed",
    payload: {
      threadId: "t1",
      turn: {
        id: "turn-1",
        items: [],
        itemsView: "notLoaded",
        status: "failed",
        error: { message: "tool failed", codexErrorInfo: null, additionalDetails: null },
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
      },
    },
  });
  assert.equal(state.threadsBy["t1"]!.turnStatus, "failed");
  assert.equal(state.threadsBy["t1"]!.turnError?.message, "tool failed");
});

test("token usage notification updates thread usage", () => {
  let state = createInitialState();
  const usage: ThreadTokenUsage = {
    total: {
      totalTokens: 100,
      inputTokens: 60,
      cachedInputTokens: 10,
      cacheWriteInputTokens: 0,
      outputTokens: 40,
      reasoningOutputTokens: 5,
    },
    last: {
      totalTokens: 100,
      inputTokens: 60,
      cachedInputTokens: 10,
      cacheWriteInputTokens: 0,
      outputTokens: 40,
      reasoningOutputTokens: 5,
    },
    modelContextWindow: 200000,
  };
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "thread/tokenUsage/updated",
    payload: { threadId: "t1", turnId: "turn-1", tokenUsage: usage },
  });
  assert.equal(state.threadsBy["t1"]!.tokenUsage?.total.totalTokens, 100);
  assert.equal(formatThreadUsage(state.threadsBy["t1"]!.tokenUsage), "100 / 200,000 context · 100 cumulative");
  assert.equal(formatThreadUsage(null), "no token data yet");
});

test("usage formatting helpers", () => {
  assert.equal(formatTokens(1234567), "1,234,567");
  assert.equal(formatTokens(null), "—");
  assert.equal(
    formatRateLimitWindow({ usedPercent: 12, windowDurationMins: 300, resetsAt: 1754410000 }),
    "88% left · resets " + new Date(1754410000 * 1000).toLocaleString(),
  );
  assert.equal(formatRateLimitWindow(null), "unavailable");
  assert.equal(threadStatusText({ active: { activeFlags: ["waitingOnUserInput"] } }), "active (waitingOnUserInput)");
  assert.equal(threadStatusText("idle"), "idle");
});

test("file change kind formatting handles real tagged wire objects", () => {
  assert.equal(patchChangeKindLabel({ type: "add" }), "add");
  assert.equal(
    patchChangeKindLabel({ type: "update", move_path: "renamed.txt" }),
    "update → renamed.txt",
  );
});

test("appends thread status changes onto hydrated threads", () => {
  let state = createInitialState();
  state = stateReducer(state, { type: "thread/hydrate", thread: thread("t1") });
  state = stateReducer(state, {
    type: "notification",
    threadId: "t1",
    turnId: "turn-1",
    method: "thread/status/changed",
    payload: { threadId: "t1", status: { active: { activeFlags: [] } } },
  });
  const status = state.threadsBy["t1"]!.thread!.status;
  assert.deepEqual(status, { active: { activeFlags: [] } });
});

test("unsupported request entries never crash findEntry", () => {
  let state = createInitialState();
  state = stateReducer(state, { type: "thread/select", threadId: "t1" });
  state = stateReducer(state, {
    type: "unsupportedRequest",
    method: "attestation/generate",
    threadId: null,
    requestId: 7,
  });
  const threadState = state.threadsBy["t1"]!;
  assert.equal(findEntry(threadState, "anything"), undefined);
  assert.equal(threadState.entries.length, 1);
});

test("reducer accepts empty action list shape without crashing", () => {
  const action = { type: "thread/select", threadId: null } satisfies AppAction;
  const state = stateReducer(createInitialState(), action);
  assert.equal(state.selectedThreadId, null);
});

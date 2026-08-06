// Fake sudhir-codex app-server for integration tests.
//
// Speaks the same newline-delimited JSON-RPC protocol over stdio. stdout is
// protocol JSONL only; all test-visible logging goes to stderr as lines that
// begin with "LOG " followed by JSON.

import { createInterface } from "node:readline/promises";
import process from "node:process";

function log(payload) {
  process.stderr.write(`LOG ${JSON.stringify(payload)}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function makeThread(id, preview, cwd, extra = {}) {
  return {
    id,
    sessionId: `session-${id}`,
    preview,
    ephemeral: false,
    isPinned: false,
    modelProvider: "sudhir_gateway",
    createdAt: 1754400000,
    updatedAt: 1754400000,
    recencyAt: 1754400000,
    status: "idle",
    path: null,
    cwd,
    cliVersion: "0.1.0-test",
    source: "vscode",
    name: null,
    turns: [],
    ...extra,
  };
}

const threads = new Map([
  ["thread-1", makeThread("thread-1", "Existing test thread", "/home/test/project-a")],
  ["thread-2", makeThread("thread-2", "Second existing thread", "/home/test/project-a")],
  ["thread-3", makeThread("thread-3", "Other project thread", "/home/test/project-b")],
]);

const models = [
  {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    upgrade: null,
    displayName: "GPT-5.6 Sol",
    description: "Default model",
    hidden: false,
    supportedReasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
    isDefault: true,
    serviceTiers: [],
  },
  {
    id: "gpt-5.6-luna",
    model: "gpt-5.6-luna",
    upgrade: null,
    displayName: "GPT-5.6 Luna",
    description: "Fast model",
    hidden: false,
    supportedReasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
    isDefault: false,
    serviceTiers: [],
  },
];

const state = {
  clientInfo: null,
  turnCounter: 0,
  activeTurns: new Map(),
  outstandingServerRequests: new Map(),
  startedThreadIds: new Set(),
};

function rateLimitsResponse() {
  return {
    rateLimits: {
      limitId: "codex",
      limitName: "Codex",
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1754410000 },
      secondary: { usedPercent: 4, windowDurationMins: 1440, resetsAt: 1754490000 },
      planType: "chatgpt",
      rateLimitReachedType: null,
    },
    rateLimitsByLimitId: null,
    rateLimitResetCredits: null,
  };
}

function usageResponse() {
  return {
    summary: {
      lifetimeTokens: 1234567,
      peakDailyTokens: 89012,
      longestRunningTurnSec: 3600,
      currentStreakDays: 12,
      longestStreakDays: 30,
    },
    dailyUsageBuckets: [
      { date: "2026-08-04", tokens: 41000 },
      { date: "2026-08-05", tokens: 89012 },
    ],
  };
}

function tokenUsage() {
  return {
    total: {
      totalTokens: 1520,
      inputTokens: 900,
      cachedInputTokens: 300,
      cacheWriteInputTokens: 0,
      outputTokens: 620,
      reasoningOutputTokens: 200,
    },
    last: {
      totalTokens: 1520,
      inputTokens: 900,
      cachedInputTokens: 300,
      cacheWriteInputTokens: 0,
      outputTokens: 620,
      reasoningOutputTokens: 200,
    },
    modelContextWindow: 200000,
  };
}

function resumeThread(threadId) {
  const base = threads.get(threadId);
  if (!base) {
    return null;
  }
  return {
    ...base,
    turns: [
      {
        id: "turn-history-1",
        items: [
          {
            type: "userMessage",
            id: "item-history-1",
            clientId: null,
            content: [{ type: "text", text: "hello from history" }],
          },
          {
            type: "agentMessage",
            id: "item-history-2",
            text: "A persisted response.",
            phase: null,
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1754400000,
        completedAt: 1754400010,
        durationMs: 10000,
      },
    ],
  };
}

async function handleRequest(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize": {
      state.clientInfo = params?.clientInfo ?? null;
      return {
        userAgent: "codex/0.1.0 (fake app-server)",
        codexHome: "/home/test/.sudhir-codex",
        platformFamily: "unix",
        platformOs: "linux",
      };
    }
    case "thread/list": {
      const cwd = params?.cwd;
      const data = cwd
        ? [...threads.values()].filter((t) => t.cwd === cwd)
        : [...threads.values()];
      return { data, nextCursor: null, backwardsCursor: null };
    }
    case "thread/start": {
      const threadId = `thread-new-${state.turnCounter}`;
      const thread = makeThread(threadId, "New thread", params?.cwd ?? "/home/test/project-a");
      threads.set(threadId, thread);
      state.startedThreadIds.add(threadId);
      return {
        thread,
        model: params?.model ?? "gpt-5.6-sol",
        modelProvider: "sudhir_gateway",
        cwd: params?.cwd ?? "/home/test/project-a",
      };
    }
    case "thread/resume": {
      const thread = resumeThread(params?.threadId);
      if (!thread) {
        return { error: { code: -32000, message: `unknown thread ${params?.threadId}` } };
      }
      return {
        thread,
        model: "gpt-5.6-sol",
        modelProvider: "sudhir_gateway",
        cwd: thread.cwd,
      };
    }
    case "thread/read": {
      const thread = resumeThread(params?.threadId);
      if (!thread) {
        return { error: { code: -32000, message: `unknown thread ${params?.threadId}` } };
      }
      return { thread };
    }
    case "model/list":
      return { data: models, nextCursor: null };
    case "account/rateLimits/read":
      return rateLimitsResponse();
    case "account/usage/read":
      return usageResponse();
    case "turn/start": {
      const inputs = params?.input ?? [];
      if (
        !Array.isArray(inputs) ||
        inputs.some((input) => !input || typeof input.type !== "string")
      ) {
        return {
          error: { code: -32600, message: "Invalid request: missing field `type` in input" },
        };
      }
      state.turnCounter += 1;
      const turnId = `turn-${state.turnCounter}`;
      const threadId = params?.threadId;
      state.activeTurns.set(threadId, turnId);
      scheduleStream(threadId, turnId);
      return {
        turn: {
          id: turnId,
          items: [],
          itemsView: "notLoaded",
          status: "inProgress",
          error: null,
          startedAt: Date.now(),
          completedAt: null,
          durationMs: null,
        },
      };
    }
    case "turn/steer": {
      const inputs = params?.input ?? [];
      const activeTurnId = state.activeTurns.get(params?.threadId);
      if (
        !Array.isArray(inputs) ||
        inputs.some((input) => !input || typeof input.type !== "string") ||
        typeof params?.expectedTurnId !== "string" ||
        params.expectedTurnId !== activeTurnId
      ) {
        return {
          error: { code: -32600, message: "Invalid request: active turn does not match" },
        };
      }
      log({ steeredTurnId: activeTurnId, input: inputs });
      return { turnId: activeTurnId };
    }
    case "turn/interrupt":
      return { ok: true };
    default:
      return {
        error: { code: -32601, message: `unknown method: ${method}` },
      };
  }
}

function scheduleStream(threadId, turnId) {
  setTimeout(() => {
    send({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId,
        turn: {
          id: turnId,
          items: [],
          itemsView: "notLoaded",
          status: "inProgress",
          error: null,
          startedAt: Date.now(),
          completedAt: null,
          durationMs: null,
        },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "item/started",
      params: {
        item: { type: "agentMessage", id: `item-${turnId}`, text: "", phase: null },
        threadId,
        turnId,
        startedAtMs: Date.now(),
      },
    });
  }, 10);
  setTimeout(() => {
    send({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId: `item-${turnId}`, delta: "Hello " },
    });
  }, 30);
  setTimeout(() => {
    send({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId: `item-${turnId}`, delta: "from the fake server." },
    });
  }, 50);
  setTimeout(() => {
    if (state.activeTurns.get(threadId) === turnId) {
      state.activeTurns.delete(threadId);
    }
    send({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        item: {
          type: "agentMessage",
          id: `item-${turnId}`,
          text: "Hello from the fake server.",
          phase: null,
        },
        threadId,
        turnId,
        completedAtMs: Date.now(),
      },
    });
    send({
      jsonrpc: "2.0",
      method: "thread/tokenUsage/updated",
      params: { threadId, turnId, tokenUsage: tokenUsage() },
    });
    send({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: turnId,
          items: [],
          itemsView: "notLoaded",
          status: "completed",
          error: null,
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 80,
        },
      },
    });
  }, 80);
}

async function handleControl(message) {
  const { __control, ...payload } = message;
  if (__control === "sendServerRequest") {
    const { id, method, params } = payload;
    state.outstandingServerRequests.set(String(id), method);
    send({ jsonrpc: "2.0", id, method, params });
    log({ control: "serverRequestSent", id, method });
    return;
  }
  if (__control === "sendNotification") {
    const { method, params } = payload;
    send({ jsonrpc: "2.0", method, params });
    return;
  }
  if (__control === "clientInfo") {
    log({ clientInfo: state.clientInfo });
    return;
  }
  log({ control: "unknownControl", __control });
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    log({ error: "non-json stdin" });
    return;
  }

  if (message.__control) {
    await handleControl(message);
    return;
  }

  if (message.id !== undefined) {
    const outstanding = state.outstandingServerRequests.get(String(message.id));
    if (outstanding !== undefined) {
      state.outstandingServerRequests.delete(String(message.id));
      log({ responseForRequest: outstanding, id: message.id, message });
      return;
    }
    const outcome = await handleRequest(message);
    if (outcome?.error !== undefined) {
      send({ jsonrpc: "2.0", id: message.id, error: outcome.error });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result: outcome });
    return;
  }

  if (message.method === "initialized") {
    log({ initialized: true });
    return;
  }
  log({ notification: message.method });
});

rl.on("close", () => {
  process.exit(0);
});

log({ started: true });

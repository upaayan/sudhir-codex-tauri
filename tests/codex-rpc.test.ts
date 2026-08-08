import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  buildTurnSubmission,
  createRpcClient,
  type RpcClient,
  type RpcTransport,
  RpcError,
} from "../src/codex-rpc.ts";
import {
  createInitialState,
  classifyNotification,
  stateReducer,
  type AppState,
} from "../src/codex-state.ts";
import {
  CLIENT_NAME,
  CLIENT_TITLE,
  CLIENT_VERSION,
  itemPayload,
  type ServerRequestHandlerResult,
} from "../src/codex-types.ts";

// ---------------------------------------------------------------------------
// In-memory transport for unit tests
// ---------------------------------------------------------------------------

class MemoryTransport implements RpcTransport {
  sent: string[] = [];
  private handlers = new Set<(value: string) => void>();

  send(value: string): void {
    this.sent.push(value);
  }

  onMessage(handler: (value: string) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  deliver(line: string): void {
    for (const handler of this.handlers) {
      handler(line);
    }
  }

  lastSent(): unknown {
    return JSON.parse(this.sent[this.sent.length - 1]!);
  }
}

async function initClient(transport: MemoryTransport, client: RpcClient): Promise<void> {
  const init = client.initialize();
  transport.deliver(
    JSON.stringify({
      jsonrpc: "2.0",
      id: JSON.parse(transport.sent[0]!).id,
      result: {
        userAgent: "codex/0.1.0",
        codexHome: "/home/test",
        platformFamily: "unix",
        platformOs: "macos",
      },
    }),
  );
  await init;
}

// ---------------------------------------------------------------------------
// Unit tests: correlation, errors, server requests, timeout, close
// ---------------------------------------------------------------------------

test("buildTurnSubmission starts an idle turn with its selected settings", () => {
  assert.deepEqual(buildTurnSubmission({
    threadId: "thread-1",
    input: [{ type: "text", text: "Start here" }],
    model: "gpt-5.6-sol",
    effort: "xhigh",
    serviceTier: "priority",
  }), {
    method: "turn/start",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "Start here" }],
      model: "gpt-5.6-sol",
      effort: "xhigh",
      serviceTier: "priority",
    },
  });
});

test("buildTurnSubmission omits unset settings instead of sending nulls", () => {
  assert.deepEqual(buildTurnSubmission({
    threadId: "thread-1",
    input: [{ type: "text", text: "Start here" }],
    model: null,
    effort: null,
    serviceTier: undefined,
  }), {
    method: "turn/start",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "Start here" }],
    },
  });
});

test("buildTurnSubmission includes a chosen permissions profile and omits it when unset", () => {
  const chosen = buildTurnSubmission({
    threadId: "thread-1",
    input: [{ type: "text", text: "Start here" }],
    permissions: ":read-only",
  });
  assert.equal(chosen.method, "turn/start");
  assert.equal((chosen.params as { permissions?: string }).permissions, ":read-only");

  const unset = buildTurnSubmission({
    threadId: "thread-1",
    input: [{ type: "text", text: "Start here" }],
    permissions: null,
  });
  assert.ok(
    !("permissions" in (unset.params as unknown as Record<string, unknown>)),
    "unset permissions must omit the key",
  );
});

test("buildTurnSubmission sends an explicit null serviceTier when the user chose Standard", () => {
  const submission = buildTurnSubmission({
    threadId: "thread-1",
    input: [{ type: "text", text: "Start here" }],
    model: "gpt-5.6-sol",
    effort: "max",
    serviceTier: null,
  });
  assert.equal(submission.method, "turn/start");
  const params = submission.params as unknown as Record<string, unknown>;
  assert.ok("serviceTier" in params, "explicit Standard must serialize the key");
  assert.equal(params.serviceTier, null);
});

test("buildTurnSubmission steers an active turn without settings overrides", () => {
  assert.deepEqual(buildTurnSubmission({
    threadId: "thread-1",
    input: [{ type: "text", text: "Focus on the failing test" }],
    activeTurnId: "turn-7",
    model: "gpt-5.6-sol",
    effort: "xhigh",
    serviceTier: "priority",
  }), {
    method: "turn/steer",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "Focus on the failing test" }],
      expectedTurnId: "turn-7",
    },
  });
});

test("correlates responses with requests out of order", async () => {
  const transport = new MemoryTransport();
  const client = createRpcClient({ transport });
  await initClient(transport, client);
  const first = client.request("first", { n: 1 });
  const second = client.request("second", { n: 2 });

  const secondSent = transport.sent[3]!;
  transport.deliver(
    JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(secondSent).id, result: "second-result" }),
  );
  assert.equal(await second, "second-result");

  const firstSent = transport.sent[2]!;
  transport.deliver(
    JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(firstSent).id, result: "first-result" }),
  );
  assert.equal(await first, "first-result");
  client.close();
});

test("rejects with RpcError when the server returns an error", async () => {
  const transport = new MemoryTransport();
  const client = createRpcClient({ transport });
  await initClient(transport, client);
  const request = client.request("thread/list", {});
  const sent = JSON.parse(transport.sent[2]!);
  transport.deliver(
    JSON.stringify({
      jsonrpc: "2.0",
      id: sent.id,
      error: { code: -32000, message: "boom", data: { detail: 1 } },
    }),
  );
  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof RpcError);
    assert.equal(error.code, -32000);
    assert.equal(error.message, "boom");
    return true;
  });
  client.close();
});

test("forwards notifications to the notification callback", async () => {
  const transport = new MemoryTransport();
  const received: Array<[string, unknown]> = [];
  const client = createRpcClient({
    transport,
    onNotification: (method, params) => {
      received.push([method, params]);
    },
  });
  transport.deliver(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { threadId: "t1", itemId: "a1", delta: "x" },
    }),
  );
  assert.equal(received.length, 1);
  assert.equal(received[0]![0], "item/agentMessage/delta");
  client.close();
});

test("server request with a handler receives a typed response", async () => {
  const transport = new MemoryTransport();
  const client = createRpcClient({
    transport,
    serverRequestHandlers: {
      "item/tool/requestUserInput": (params): ServerRequestHandlerResult => {
        const record = params as { questions?: Array<{ id: string }> };
        return {
          result: {
            answers: {
              [record.questions?.[0]?.id ?? "q1"]: { answers: ["yes"] },
            },
          },
        };
      },
    },
  });
  transport.deliver(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 501,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "t1",
        turnId: "turn-1",
        itemId: "i1",
        questions: [{ id: "q1", header: "H", question: "Q", isOther: false, isSecret: false, options: null }],
      },
    }),
  );
  // The handler runs asynchronously; give it a microtask turn.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const response = transport.lastSent() as {
    id: number;
    result?: { answers: Record<string, { answers: string[] }> };
  };
  assert.equal(response.id, 501);
  assert.equal(response.result?.answers["q1"]?.answers[0], "yes");
  client.close();
});

test("unsupported server request gets an error response and an event", async () => {
  const transport = new MemoryTransport();
  const unsupported: Array<[string, string | number]> = [];
  const client = createRpcClient({
    transport,
    onUnsupportedRequest: (method, id) => {
      unsupported.push([method, id]);
    },
  });
  transport.deliver(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 601,
      method: "future/serverRequest",
      params: { threadId: "t1" },
    }),
  );
  const response = transport.lastSent() as {
    id: number;
    error?: { code: number; message: string };
  };
  assert.equal(response.id, 601);
  assert.equal(response.error?.code, -32601);
  assert.deepEqual(unsupported, [["future/serverRequest", 601]]);
  client.close();
});

test("rejects pending requests on timeout", async () => {
  const transport = new MemoryTransport();
  const client = createRpcClient({ transport, timeoutMs: 25 });
  await initClient(transport, client);
  const request = client.request("thread/list", {});
  await assert.rejects(request, /timed out/);
  client.close();
});

test("close rejects pending requests and refuses new ones", async () => {
  const transport = new MemoryTransport();
  const client = createRpcClient({ transport });
  await initClient(transport, client);
  const request = client.request("thread/list", {});
  client.close();
  await assert.rejects(request, /closed/);
  await assert.rejects(client.request("thread/list", {}), /closed/);
});

test("initialize sends the fixed client identity then initialized", async () => {
  const transport = new MemoryTransport();
  const client = createRpcClient({ transport });
  const init = client.initialize();
  const sent = JSON.parse(transport.sent[0]!) as {
    method: string;
    params: {
      clientInfo: { name: string; title: string; version: string };
      capabilities: { mcpServerOpenaiFormElicitation: boolean; experimentalApi: boolean };
    };
  };
  assert.equal(sent.method, "initialize");
  assert.deepEqual(sent.params.clientInfo, {
    name: CLIENT_NAME,
    title: CLIENT_TITLE,
    version: CLIENT_VERSION,
  });
  assert.deepEqual(sent.params.capabilities, {
    mcpServerOpenaiFormElicitation: true,
    experimentalApi: true,
  });
  transport.deliver(
    JSON.stringify({
      jsonrpc: "2.0",
      id: JSON.parse(transport.sent[0]!).id,
      result: {
        userAgent: "codex/0.1.0",
        codexHome: "/home/test",
        platformFamily: "unix",
        platformOs: "macos",
      },
    }),
  );
  const response = await init;
  assert.equal(response.platformOs, "macos");
  assert.equal(JSON.parse(transport.sent[1]!).method, "initialized");
  client.close();
});

// ---------------------------------------------------------------------------
// Integration tests against the fake app-server over real JSONL pipes
// ---------------------------------------------------------------------------

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fake-app-server.mjs",
);

let child: ChildProcess;
let transport: RpcTransport;
let client: RpcClient;
let logs: Array<Record<string, unknown>> = [];
let state: AppState;
let unsupportedRequests: Array<{ method: string; id: string | number }> = [];

function pipeTransport(childProcess: ChildProcess): RpcTransport {
  let buffer = "";
  const handlers = new Set<(value: string) => void>();
  childProcess.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim().length > 0) {
        for (const handler of handlers) {
          handler(line);
        }
      }
    }
  });
  return {
    send(value: string) {
      childProcess.stdin?.write(`${value}\n`);
    },
    onMessage(handler: (value: string) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}

function collectLogs(childProcess: ChildProcess): void {
  let buffer = "";
  childProcess.stderr?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.startsWith("LOG ")) {
        try {
          logs.push(JSON.parse(line.slice(4)));
        } catch {
          // ignore malformed log lines
        }
      }
    }
  });
}

function waitForLog(predicate: (entry: Record<string, unknown>) => boolean, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const found = logs.find(predicate);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timed out waiting for log entry; logs: ${JSON.stringify(logs)}`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

function dispatchNotification(method: string, params: unknown): void {
  const action = classifyForTest(method, params);
  if (action) {
    state = stateReducer(state, action);
  }
}

function classifyForTest(method: string, params: unknown) {
  return classifyNotification(method, params);
}

function waitForState(predicate: (s: AppState) => boolean, timeoutMs = 5000): Promise<AppState> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      if (predicate(state)) {
        resolve(state);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("timed out waiting for state condition"));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

function sendControl(control: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.stdin?.write(`${JSON.stringify({ __control: "x", ...control })}\n`, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

before(async () => {
  child = spawn(process.execPath, [FIXTURE], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  transport = pipeTransport(child);
  collectLogs(child);
  state = createInitialState();
  client = createRpcClient({
    transport,
    onNotification: dispatchNotification,
    onUnsupportedRequest: (method, id, params) => {
      unsupportedRequests.push({ method, id });
      const requestParams = (params ?? {}) as { threadId?: string };
      state = stateReducer(state, {
        type: "unsupportedRequest",
        method,
        threadId: requestParams.threadId ?? null,
        requestId: id,
      });
    },
    serverRequestHandlers: {
      "item/commandExecution/requestApproval": (): ServerRequestHandlerResult => ({
        result: { decision: "accept" },
      }),
      "item/fileChange/requestApproval": (): ServerRequestHandlerResult => ({
        result: { decision: "accept" },
      }),
      "item/permissions/requestApproval": (): ServerRequestHandlerResult => ({
        result: { permissions: {}, scope: "session" },
      }),
      "item/tool/requestUserInput": (params): ServerRequestHandlerResult => {
        const record = params as { questions?: Array<{ id: string }> };
        const answers: Record<string, { answers: string[] }> = {};
        for (const question of record.questions ?? []) {
          answers[question.id] = { answers: ["owner answer"] };
        }
        return { result: { answers } };
      },
      "mcpServer/elicitation/request": (): ServerRequestHandlerResult => ({
        result: { action: "accept", content: {}, _meta: null },
      }),
    },
  });
  await client.initialize();
});

after(() => {
  client.close();
  child.kill("SIGTERM");
});

test("integration: initialize handshake carries the fixed identity", async () => {
  const entry = await waitForLog((log) => log.initialized === true);
  assert.ok(entry);
  await sendControl({ __control: "clientInfo" });
  const clientInfo = await waitForLog((log) => log.clientInfo !== undefined);
  assert.deepEqual(clientInfo.clientInfo, {
    name: CLIENT_NAME,
    title: CLIENT_TITLE,
    version: CLIENT_VERSION,
  });
});

test("integration: thread list filters by exact cwd", async () => {
  const result = await client.request("thread/list", {
    cwd: "/home/test/project-a",
  }) as { data: Array<{ id: string }>; nextCursor: string | null };
  assert.equal(result.data.length, 2);
  assert.deepEqual(
    result.data.map((t) => t.id).sort(),
    ["thread-1", "thread-2"],
  );
});

test("integration: thread resume hydrates persisted turns", async () => {
  const result = await client.request("thread/resume", {
    threadId: "thread-1",
  }) as { thread: { id: string; turns: Array<{ items: unknown[] }> } };
  assert.equal(result.thread.id, "thread-1");
  assert.equal(result.thread.turns.length, 1);
  state = stateReducer(state, {
    type: "thread/hydrate",
    thread: result.thread as never,
  });
  assert.equal(state.threadsBy["thread-1"]!.entries.length, 2);
});

test("integration: model list and account reads return data", async () => {
  const models = await client.request("model/list", {}) as {
    data: Array<{ id: string }>;
  };
  assert.equal(models.data.length, 2);

  const rateLimits = await client.request("account/rateLimits/read") as {
    rateLimits: { primary: { usedPercent: number } };
  };
  assert.equal(rateLimits.rateLimits.primary.usedPercent, 12);

  const usage = await client.request("account/usage/read") as {
    summary: { lifetimeTokens: number };
  };
  assert.equal(usage.summary.lifetimeTokens, 1234567);
});

test("integration: a turn streams deltas to completion", async () => {
  const response = await client.request("turn/start", {
    threadId: "thread-1",
    input: [{ type: "text", text: "hi" }],
    model: "gpt-5.6-sol",
  }) as { turn: { id: string } };
  assert.ok(response.turn.id);

  await waitForState((s) => {
    const thread = s.threadsBy["thread-1"];
    if (!thread) {
      return false;
    }
    let completed = false;
    for (const entry of thread.entries) {
      if (entry.kind === "unsupportedRequest") {
        continue;
      }
      const agent = itemPayload(entry.item, "agentMessage");
      if (agent && agent.id === `item-${response.turn.id}`) {
        completed = agent.text === "Hello from the fake server.";
      }
    }
    return thread.turnStatus === "completed" && completed && thread.turnId === response.turn.id;
  });
  assert.equal(state.threadsBy["thread-1"]!.tokenUsage?.total.totalTokens, 1520);
});

test("integration: an active turn accepts steering with its expected turn id", async () => {
  const started = await client.request("turn/start", {
    threadId: "thread-1",
    input: [{ type: "text", text: "Begin the task" }],
  }) as { turn: { id: string } };

  const steered = await client.request("turn/steer", {
    threadId: "thread-1",
    input: [{ type: "text", text: "Focus on the failing test" }],
    expectedTurnId: started.turn.id,
  });
  assert.deepEqual(steered, { turnId: started.turn.id });

  const entry = await waitForLog((log) => log.steeredTurnId === started.turn.id);
  assert.deepEqual(entry.input, [{ type: "text", text: "Focus on the failing test" }]);
  await waitForState(
    (current) => current.threadsBy["thread-1"]?.turnId === started.turn.id &&
      current.threadsBy["thread-1"]?.turnStatus === "completed",
  );
});

test("integration: error notification with the real shape marks the turn failed", async () => {
  await sendControl({
    __control: "sendNotification",
    method: "error",
    params: {
      error: {
        message: "rate limit reached",
        codexErrorInfo: null,
        additionalDetails: null,
      },
      willRetry: false,
      threadId: "thread-1",
      turnId: "turn-error-1",
    },
  });
  await waitForState((s) => s.threadsBy["thread-1"]?.turnStatus === "failed");
  assert.equal(state.threadsBy["thread-1"]!.turnError?.message, "rate limit reached");
});

test("integration: failing turn completion surfaces turn.error", async () => {
  await sendControl({
    __control: "sendNotification",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-failed-1",
        items: [],
        itemsView: "notLoaded",
        status: "failed",
        error: { message: "tool execution failed", codexErrorInfo: null, additionalDetails: null },
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
      },
    },
  });
  await waitForState(
    (s) => s.threadsBy["thread-1"]?.turnStatus === "failed" &&
      s.threadsBy["thread-1"]?.turnError?.message === "tool execution failed",
  );
});

test("integration: turn interrupt round-trips", async () => {
  const result = await client.request("turn/interrupt", {
    threadId: "thread-1",
    turnId: "turn-1",
  });
  assert.deepEqual(result, { ok: true });
});

test("integration: command approval flow completes", async () => {
  await sendControl({
    __control: "sendServerRequest",
    id: 1001,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "c1",
      startedAtMs: 1,
      command: "ls",
      cwd: "/home/test",
    },
  });
  const entry = await waitForLog((log) => log.responseForRequest === "item/commandExecution/requestApproval");
  const message = entry.message as { result?: { decision: string } };
  assert.equal(message.result?.decision, "accept");
});

test("integration: file and permission approval flows complete", async () => {
  await sendControl({
    __control: "sendServerRequest",
    id: 1002,
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "f1",
      startedAtMs: 1,
      reason: "write files",
    },
  });
  await waitForLog((log) => log.responseForRequest === "item/fileChange/requestApproval");

  await sendControl({
    __control: "sendServerRequest",
    id: 1003,
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "p1",
      startedAtMs: 1,
      cwd: "/home/test",
      permissions: {},
    },
  });
  const entry = await waitForLog((log) => log.responseForRequest === "item/permissions/requestApproval");
  const message = entry.message as { result?: { scope: string } };
  assert.equal(message.result?.scope, "session");
});

test("integration: requestUserInput flow completes a turn", async () => {
  await sendControl({
    __control: "sendServerRequest",
    id: 1004,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "i1",
      questions: [
        {
          id: "q-owner",
          header: "Choice",
          question: "Pick one",
          isOther: false,
          isSecret: false,
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    },
  });
  const entry = await waitForLog((log) => log.responseForRequest === "item/tool/requestUserInput");
  const message = entry.message as { result?: { answers: Record<string, { answers: string[] }> } };
  assert.deepEqual(message.result?.answers["q-owner"]?.answers, ["owner answer"]);
});

test("integration: MCP elicitation completes with the required action response", async () => {
  await sendControl({
    __control: "sendServerRequest",
    id: 1005,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "node_repl",
      mode: "form",
      message: "Allow Chrome access?",
      requestedSchema: { type: "object", properties: {} },
    },
  });
  const entry = await waitForLog((log) => log.responseForRequest === "mcpServer/elicitation/request");
  const message = entry.message as { result?: { action: string; content: unknown } };
  assert.deepEqual(message.result, { action: "accept", content: {}, _meta: null });
});

test("integration: an unknown server request still errors and shows a fallback card", async () => {
  await sendControl({
    __control: "sendServerRequest",
    id: 1006,
    method: "future/serverRequest",
    params: { threadId: "thread-1" },
  });
  const entry = await waitForLog((log) => log.responseForRequest === "future/serverRequest");
  const message = entry.message as { error?: { code: number } };
  assert.equal(message.error?.code, -32601);
  assert.ok(unsupportedRequests.some((u) => u.method === "future/serverRequest" && u.id === 1006));
  const card = state.threadsBy["thread-1"]!.entries.find(
    (e) => e.kind === "unsupportedRequest" && e.requestId === 1006,
  );
  assert.ok(card);
});

test("integration: unknown item notification lands in a fallback entry without crashing", async () => {
  await sendControl({
    __control: "sendNotification",
    method: "item/started",
    params: {
      item: { type: "newHarmlessItem", id: "new-1", note: "future" },
      threadId: "thread-1",
      turnId: "turn-9",
      startedAtMs: 1,
    },
  });
  await waitForState((s) =>
    s.threadsBy["thread-1"]?.entries.some(
      (e) => e.kind !== "unsupportedRequest" &&
        (e.item as { type?: string }).type === "newHarmlessItem" &&
        e.item.id === "new-1",
    ) === true,
  );
});

test("integration: turn/start rejects input missing the type discriminator", async () => {
  await assert.rejects(
    client.request("turn/start", {
      threadId: "thread-1",
      input: [{ text: "hi" }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof RpcError);
      assert.equal(error.code, -32600);
      assert.match(error.message, /missing field `type`/);
      return true;
    },
  );
});

test("integration: shutdown closes cleanly without errors", async () => {
  client.close();
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    setTimeout(() => resolve(null), 3000);
  });
  assert.ok(exitCode === 0 || exitCode === null, `unexpected exit code ${exitCode}`);
});

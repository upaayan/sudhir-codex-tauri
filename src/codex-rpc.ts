// JSON-RPC 2.0 client for the sudhir-codex app-server stdio protocol.
//
// The client takes its transport as a parameter: the Tauri app supplies a
// send/subscribe binding over Tauri commands/events, while the integration
// test supplies a binding over real child-process pipes. This module is
// Node-tested, so it uses only erasable TypeScript syntax and imports no .tsx
// modules.

import {
  CLIENT_NAME,
  CLIENT_TITLE,
  CLIENT_VERSION,
  type InitializeResponse,
  type JsonRpcError,
  type ServerRequestHandlerResult,
  type TurnStartParams,
  type TurnSteerParams,
  type UserInput,
} from "./codex-types.ts";

export interface RpcTransport {
  send(value: string): void;
  onMessage(handler: (value: string) => void): () => void;
}

export interface RpcClientOptions {
  transport: RpcTransport;
  timeoutMs?: number;
  serverRequestHandlers?: Record<
    string,
    (
      params: unknown,
      requestId: string | number,
    ) => ServerRequestHandlerResult | Promise<ServerRequestHandlerResult>
  >;
  onNotification?: (method: string, params: unknown) => void;
  onUnsupportedRequest?: (method: string, id: string | number, params: unknown) => void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedRequest {
  method: string;
  params?: unknown;
  timeoutMs?: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class RpcError extends Error {
  code: number;
  data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export interface BuildTurnSubmissionOptions {
  threadId: string;
  input: UserInput[];
  activeTurnId?: string | null;
  model?: string | null;
  effort?: string | null;
  // serviceTier is a double option on the wire: an omitted key means "leave the
  // backend's configured tier unchanged" while an explicit null means "clear it"
  // (the user picked Standard). undefined = omit, null = send null.
  serviceTier?: string | null;
  // Named permission-profile id (e.g. ":read-only"); omitted when unset so the
  // backend default applies.
  permissions?: string | null;
}

export type TurnSubmission =
  | { method: "turn/start"; params: TurnStartParams }
  | { method: "turn/steer"; params: TurnSteerParams };

export function buildTurnSubmission({
  threadId,
  input,
  activeTurnId,
  model,
  effort,
  serviceTier,
  permissions,
}: BuildTurnSubmissionOptions): TurnSubmission {
  if (activeTurnId) {
    return {
      method: "turn/steer",
      params: {
        threadId,
        input,
        expectedTurnId: activeTurnId,
      },
    };
  }
  const params: TurnStartParams = { threadId, input };
  if (model != null) {
    params.model = model;
  }
  if (effort != null) {
    params.effort = effort;
  }
  if (serviceTier !== undefined) {
    params.serviceTier = serviceTier;
  }
  if (permissions != null) {
    params.permissions = permissions;
  }
  return { method: "turn/start", params };
}

// Thread creation and resume can wait on plugin/MCP startup, and a turn can
// legitimately run for minutes; 180s keeps the client out of the way.
const DEFAULT_TIMEOUT_MS = 180_000;

export class RpcClient {
  private readonly transport: RpcTransport;
  private readonly timeoutMs: number;
  private readonly serverRequestHandlers: Record<
    string,
    (
      params: unknown,
      requestId: string | number,
    ) => ServerRequestHandlerResult | Promise<ServerRequestHandlerResult>
  >;
  private readonly onNotification?: (method: string, params: unknown) => void;
  private readonly onUnsupportedRequest?: (method: string, id: string | number, params: unknown) => void;
  private readonly unsubscribe: () => void;
  private nextId = 1;
  private readonly pending = new Map<string | number, PendingRequest>();
  private readonly preInitQueue: QueuedRequest[] = [];
  private closed = false;
  private initialized = false;

  constructor(options: RpcClientOptions) {
    this.transport = options.transport;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.serverRequestHandlers = options.serverRequestHandlers ?? {};
    this.onNotification = options.onNotification;
    this.onUnsupportedRequest = options.onUnsupportedRequest;
    this.unsubscribe = this.transport.onMessage((value) => {
      this.handleLine(value);
    });
  }

  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("RPC client is closed"));
    }
    if (!this.initialized && method !== "initialize") {
      // The app-server rejects every request that arrives before
      // `initialize` completes. Queue them and flush after the handshake.
      return new Promise((resolve, reject) => {
        this.preInitQueue.push({ method, params, timeoutMs, resolve, reject });
      });
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC request timed out: ${method}`));
      }, timeoutMs ?? this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.sendLine({
        jsonrpc: "2.0",
        id,
        method,
        params: params === undefined ? undefined : params,
      });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) {
      return;
    }
    this.sendLine({
      jsonrpc: "2.0",
      method,
      params: params === undefined ? undefined : params,
    });
  }

  async initialize(): Promise<InitializeResponse> {
    const response = await this.request(
      "initialize",
      {
        clientInfo: {
          name: CLIENT_NAME,
          title: CLIENT_TITLE,
          version: CLIENT_VERSION,
        },
        capabilities: {
          mcpServerOpenaiFormElicitation: true,
        },
      },
    );
    this.notify("initialized");
    this.initialized = true;
    const queued = this.preInitQueue.splice(0);
    for (const entry of queued) {
      this.request(entry.method, entry.params, entry.timeoutMs).then(
        entry.resolve,
        entry.reject,
      );
    }
    return response as InitializeResponse;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.unsubscribe();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("RPC client closed"));
      this.pending.delete(id);
    }
    for (const entry of this.preInitQueue) {
      entry.reject(new Error("RPC client closed"));
    }
    this.preInitQueue.length = 0;
  }

  private sendLine(message: unknown): void {
    this.transport.send(JSON.stringify(message));
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // Non-JSON lines never reach the RPC layer; Rust routes them to the
      // diagnostic buffer. Defensive parse failure is ignored here.
      return;
    }
    if (!message || typeof message !== "object") {
      return;
    }
    const value = message as {
      jsonrpc?: unknown;
      id?: unknown;
      method?: unknown;
      result?: unknown;
      error?: unknown;
      params?: unknown;
    };

    if (typeof value.id === "string" || typeof value.id === "number") {
      if ("result" in value || "error" in value) {
        this.handleResponse(value.id, value);
        return;
      }
      if (typeof value.method === "string") {
        this.handleServerRequest(value.id, value.method, value.params);
        return;
      }
      return;
    }

    if (typeof value.method === "string") {
      this.onNotification?.(value.method, value.params);
    }
  }

  private handleResponse(id: string | number, message: {
    result?: unknown;
    error?: unknown;
  }): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      const error = message.error as Partial<JsonRpcError>;
      pending.reject(
        new RpcError(
          error.code ?? -1,
          error.message ?? "JSON-RPC error",
          error.data,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private handleServerRequest(
    id: string | number,
    method: string,
    params: unknown,
  ): void {
    const handler = this.serverRequestHandlers[method];
    const respond = (outcome: ServerRequestHandlerResult) => {
      if (this.closed) {
        return;
      }
      if (outcome.error !== undefined) {
        this.sendLine({
          jsonrpc: "2.0",
          id,
          error: outcome.error,
        });
        return;
      }
      this.sendLine({
        jsonrpc: "2.0",
        id,
        result: outcome.result ?? null,
      });
    };

    if (!handler) {
      // Never leave a turn hanging: answer immediately with an error and let
      // the UI show one plain unsupported-request card.
      respond({
        error: {
          code: -32601,
          message: `method not supported: ${method}`,
        },
      });
      this.onUnsupportedRequest?.(method, id, params);
      return;
    }

    Promise.resolve()
      .then(() => handler(params, id))
      .then(respond)
      .catch((error: unknown) => {
        respond({
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      });
  }
}

export function createRpcClient(options: RpcClientOptions): RpcClient {
  return new RpcClient(options);
}

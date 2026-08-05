import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { createRpcClient, type RpcClient, type RpcTransport } from "./codex-rpc.ts";
import {
  classifyNotification,
  createInitialState,
  parseProjects,
  serializeProjects,
  stateReducer,
  storageKey,
} from "./codex-state.ts";
import type {
  AccountRateLimitsResponse,
  AccountUsageResponse,
  CommandExecutionRequestApprovalParams,
  FileChangeRequestApprovalParams,
  Model,
  PermissionsRequestApprovalParams,
  ServerRequestHandlerResult,
  Thread,
  ToolRequestUserInputParams,
} from "./codex-types.ts";
import { ChatComposer } from "./components/chat-composer.tsx";
import { ChatTranscript } from "./components/chat-transcript.tsx";
import { InteractionRequest, type PendingRequest } from "./components/interaction-request.tsx";
import { ModelPicker } from "./components/model-picker.tsx";
import { ProjectThreadSidebar } from "./components/project-thread-sidebar.tsx";
import { UsagePanel } from "./components/usage-panel.tsx";

const MESSAGE_EVENT = "app-server://message";
const DIAGNOSTIC_EVENT = "app-server://diagnostic";
const EXIT_EVENT = "app-server://exit";

export function App() {
  const [state, dispatch] = useReducer(stateReducer, undefined, createInitialState);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const rpcRef = useRef<RpcClient | null>(null);
  const pendingResolvers = useRef(
    new Map<string | number, (outcome: ServerRequestHandlerResult) => void>(),
  );

  const loadModels = useCallback(
    async (client: RpcClient) => {
      const result = (await client.request("model/list", {})) as { data: Model[] };
      dispatch({ type: "models/replace", models: result.data });
    },
    [dispatch],
  );

  const loadUsage = useCallback(async (client: RpcClient) => {
    try {
      const rateLimits = (await client.request("account/rateLimits/read")) as AccountRateLimitsResponse;
      dispatch({ type: "usage/rateLimits", rateLimits, error: null });
    } catch (error) {
      dispatch({ type: "usage/rateLimits", rateLimits: null, error: String(error) });
    }
    try {
      const usage = (await client.request("account/usage/read")) as AccountUsageResponse;
      dispatch({ type: "usage/account", usage, error: null });
    } catch (error) {
      dispatch({ type: "usage/account", usage: null, error: String(error) });
    }
  }, [dispatch]);

  const loadThreads = useCallback(
    async (backendPath: string, append: boolean) => {
      const client = rpcRef.current;
      if (!client) {
        return;
      }
      const result = (await client.request("thread/list", {
        cwd: backendPath,
        limit: 50,
      })) as { data: Thread[]; nextCursor: string | null };
      dispatch({
        type: "threads/replace",
        threads: result.data,
        cursor: result.nextCursor,
        append,
      });
    },
    [dispatch],
  );

  useEffect(() => {
    let unlistenMessage: UnlistenFn | undefined;
    let unlistenDiagnostic: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    let disposed = false;

    const transport: RpcTransport = {
      send(value: string) {
        void invoke("write_app_server_line", { line: value }).catch((error: unknown) => {
          dispatch({
            type: "connection/status",
            connected: false,
            diagnostic: String(error),
          });
        });
      },
      onMessage(handler: (value: string) => void): () => void {
        void listen<unknown>(MESSAGE_EVENT, (event) => {
          handler(JSON.stringify(event.payload));
        }).then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlistenMessage = unlisten;
          }
        });
        return () => {
          unlistenMessage?.();
          unlistenMessage = undefined;
        };
      },
    };

    const client = createRpcClient({
      transport,
      serverRequestHandlers: {
        "item/commandExecution/requestApproval": makeRequestHandler(
          "item/commandExecution/requestApproval",
        ),
        "item/fileChange/requestApproval": makeRequestHandler("item/fileChange/requestApproval"),
        "item/permissions/requestApproval": makeRequestHandler(
          "item/permissions/requestApproval",
        ),
        "item/tool/requestUserInput": makeRequestHandler("item/tool/requestUserInput"),
      },
      onNotification(method, params) {
        const action = classifyNotification(method, params);
        if (action) {
          dispatch(action);
        }
      },
      onUnsupportedRequest(method, requestId, params) {
        const record = (params ?? {}) as Record<string, unknown>;
        dispatch({
          type: "unsupportedRequest",
          method,
          threadId: typeof record.threadId === "string" ? record.threadId : null,
          requestId,
        });
      },
    });
    rpcRef.current = client;

    function makeRequestHandler(method: string) {
      return (
        params: unknown,
        requestId: string | number,
      ): Promise<ServerRequestHandlerResult> =>
        new Promise((resolve) => {
          pendingResolvers.current.set(requestId, resolve);
          setPendingRequests((current) => [
            ...current.filter((request) => request.requestId !== requestId),
            { requestId, method, label: requestLabel(method, params), params },
          ]);
        });
    }

    async function start() {
      unlistenDiagnostic = await listen<string>(DIAGNOSTIC_EVENT, (event) => {
        dispatch({
          type: "connection/status",
          connected: true,
          diagnostic: event.payload,
        });
      });
      unlistenExit = await listen<number>(EXIT_EVENT, async (event) => {
        const diagnostic = await invoke<string>("app_server_diagnostic").catch(() => "");
        dispatch({
          type: "connection/status",
          connected: false,
          diagnostic: `app-server exited with code ${event.payload}${diagnostic ? `\n${diagnostic}` : ""}`,
        });
      });

      try {
        await invoke("spawn_app_server");
        await client.initialize();
        dispatch({ type: "initialize/ok" });
        dispatch({ type: "connection/status", connected: true, diagnostic: null });
        void loadModels(client).catch((error: unknown) => {
          dispatch({
            type: "connection/status",
            connected: true,
            diagnostic: `failed to load models: ${String(error)}`,
          });
        });
        void loadUsage(client);
      } catch (error) {
        const diagnostic = await invoke<string>("app_server_diagnostic").catch(() => "");
        dispatch({
          type: "connection/status",
          connected: false,
          diagnostic: `${String(error)}${diagnostic ? `\n${diagnostic}` : ""}`,
        });
      }
    }

    const persisted = parseProjects(localStorage.getItem(storageKey()));
    dispatch({
      type: "projects/load",
      projects: persisted.projects,
      lastProjectId: persisted.lastProjectId,
    });
    if (persisted.lastProjectId) {
      dispatch({ type: "project/select", backendPath: persisted.lastProjectId });
      void loadThreads(persisted.lastProjectId, false);
    }

    void start();

    return () => {
      disposed = true;
      unlistenMessage?.();
      unlistenDiagnostic?.();
      unlistenExit?.();
      rpcRef.current?.close();
      rpcRef.current = null;
      void invoke("shutdown_app_server").catch(() => undefined);
    };
  }, [dispatch, loadModels, loadThreads, loadUsage]);

  useEffect(() => {
    localStorage.setItem(
      storageKey(),
      serializeProjects({
        version: 1,
        projects: state.projects,
        lastProjectId: state.lastProjectId,
      }),
    );
  }, [state.projects, state.lastProjectId]);

  const selectedThread = state.selectedThreadId
    ? (state.threadsBy[state.selectedThreadId] ?? null)
    : null;

  const handleAddProject = useCallback(async () => {
    const folder = await invoke<{ displayPath: string; backendPath: string } | null>(
      "pick_project_folder",
    );
    if (!folder) {
      return;
    }
    const name =
      folder.displayPath.split(/[\\/]/).filter(Boolean).pop() ?? folder.displayPath;
    dispatch({
      type: "project/add",
      project: { name, pickerPath: folder.displayPath, backendPath: folder.backendPath },
    });
    void loadThreads(folder.backendPath, false);
  }, [dispatch, loadThreads]);

  const handleSelectProject = useCallback(
    (backendPath: string) => {
      dispatch({ type: "project/select", backendPath });
      void loadThreads(backendPath, false);
    },
    [dispatch, loadThreads],
  );

  const handleNewThread = useCallback(async () => {
    const client = rpcRef.current;
    if (!client || !state.selectedProjectBackendPath) {
      return;
    }
    const result = (await client.request("thread/start", {
      model: state.selectedModel,
      cwd: state.selectedProjectBackendPath,
    })) as { thread: Thread };
    dispatch({ type: "thread/hydrate", thread: result.thread });
    dispatch({ type: "thread/select", threadId: result.thread.id });
  }, [state.selectedProjectBackendPath, state.selectedModel, dispatch]);

  const handleSelectThread = useCallback(
    async (threadId: string) => {
      dispatch({ type: "thread/select", threadId });
      const client = rpcRef.current;
      if (!client) {
        return;
      }
      try {
        const result = (await client.request("thread/resume", {
          threadId,
        })) as { thread: Thread };
        dispatch({ type: "thread/hydrate", thread: result.thread });
      } catch (error) {
        dispatch({
          type: "connection/status",
          connected: true,
          diagnostic: `failed to resume thread: ${String(error)}`,
        });
      }
    },
    [dispatch],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const client = rpcRef.current;
      if (!client || !state.selectedThreadId) {
        return;
      }
      const threadId = state.selectedThreadId;
      const result = (await client.request("turn/start", {
        threadId: state.selectedThreadId,
        input: [{ type: "text", text }],
        model: state.selectedModel,
      })) as { turn: { id: string } };
      dispatch({
        type: "notification",
        method: "turn/started",
        threadId,
        turnId: result.turn.id,
        payload: {
          threadId,
          turn: {
            id: result.turn.id,
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
    },
    [state.selectedThreadId, state.selectedModel, dispatch],
  );

  const handleInterrupt = useCallback(async () => {
    const client = rpcRef.current;
    const thread = state.selectedThreadId ? state.threadsBy[state.selectedThreadId] : null;
    if (!client || !thread?.turnId) {
      return;
    }
    await client.request("turn/interrupt", {
      threadId: thread.threadId,
      turnId: thread.turnId,
    });
  }, [state.selectedThreadId, state.threadsBy]);

  const handleLoadMore = useCallback(() => {
    if (state.selectedProjectBackendPath && state.threadsCursor) {
      void loadThreads(state.selectedProjectBackendPath, true);
    }
  }, [state.selectedProjectBackendPath, state.threadsCursor, loadThreads]);

  const resolveRequest = useCallback(
    (requestId: string | number, outcome: ServerRequestHandlerResult) => {
      pendingResolvers.current.get(requestId)?.(outcome);
      pendingResolvers.current.delete(requestId);
      setPendingRequests((current) =>
        current.filter((request) => request.requestId !== requestId),
      );
    },
    [],
  );

  const busy = selectedThread?.turnStatus === "inProgress";

  return (
    <div className="app-shell">
      <ProjectThreadSidebar
        state={state}
        onAddProject={handleAddProject}
        onSelectProject={handleSelectProject}
        onNewThread={handleNewThread}
        onSelectThread={handleSelectThread}
        onLoadMore={handleLoadMore}
      />
      <main className="main-area">
        {state.diagnostic && (
          <div className="diagnostic-banner" role="alert">
            <pre>{state.diagnostic}</pre>
          </div>
        )}
        {!state.connected && !state.diagnostic && (
          <div className="diagnostic-banner" role="status">
            Starting sudhir-codex…
          </div>
        )}
        <ChatTranscript thread={selectedThread} />
        {pendingRequests.map((request) => (
          <InteractionRequest
            key={String(request.requestId)}
            request={request}
            onResolve={(outcome) => resolveRequest(request.requestId, outcome)}
          />
        ))}
        <ChatComposer
          disabled={!state.connected || busy}
          busy={busy}
          onSend={handleSend}
          onInterrupt={handleInterrupt}
        />
      </main>
      <aside className="side-panel">
        <ModelPicker
          models={state.models}
          value={state.selectedModel}
          disabled={!state.connected}
          onChange={(model) => dispatch({ type: "model/select", model })}
        />
        <UsagePanel
          rateLimits={state.rateLimits}
          rateLimitsError={state.rateLimitsError}
          usage={state.usage}
          usageError={state.usageError}
          threadUsage={selectedThread?.tokenUsage ?? null}
        />
      </aside>
    </div>
  );
}

function requestLabel(method: string, params: unknown): string {
  switch (method) {
    case "item/commandExecution/requestApproval": {
      const record = params as CommandExecutionRequestApprovalParams;
      return `Approve command: ${record.command ?? "(unknown)"}`;
    }
    case "item/fileChange/requestApproval": {
      const record = params as FileChangeRequestApprovalParams;
      return record.reason ?? "Approve file changes";
    }
    case "item/permissions/requestApproval": {
      const record = params as PermissionsRequestApprovalParams;
      return record.reason ?? "Approve additional permissions";
    }
    case "item/tool/requestUserInput": {
      const record = params as ToolRequestUserInputParams;
      return record.questions[0]?.question ?? "Answer requested";
    }
    default:
      return `Request: ${method}`;
  }
}

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  buildTurnInput,
  deriveThreadTitle,
  type Attachment,
} from "./attachments.ts";
import {
  buildTurnSubmission,
  createRpcClient,
  type RpcClient,
  type RpcTransport,
} from "./codex-rpc.ts";
import {
  classifyNotification,
  createInitialState,
  parseProjects,
  serializeProjects,
  stateReducer,
  storageKey,
  visibleActionFailure,
} from "./codex-state.ts";
import type {
  AccountRateLimitsResponse,
  AccountUsageResponse,
  CommandExecutionRequestApprovalParams,
  FileChangeRequestApprovalParams,
  McpServerElicitationRequestParams,
  Model,
  PermissionsRequestApprovalParams,
  ServerRequestHandlerResult,
  Thread,
  ToolRequestUserInputParams,
} from "./codex-types.ts";
import { ChatComposer } from "./components/chat-composer.tsx";
import { ChatTranscript } from "./components/chat-transcript.tsx";
import {
  ComposerSettings,
  type PermissionProfileOption,
} from "./components/composer-settings.tsx";
import { summarizeActivityEntries } from "./activity-summary.ts";
import { InteractionRequest, type PendingRequest } from "./components/interaction-request.tsx";
import { ProjectThreadSidebar } from "./components/project-thread-sidebar.tsx";
import {
  PanelRightIcon,
  shortcutLabel,
  SidebarToggleIcon,
  TopbarToggle,
} from "./components/topbar.tsx";
import { ThemePicker } from "./components/theme-picker.tsx";
import { UsagePanel } from "./components/usage-panel.tsx";
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme.ts";

const MESSAGE_EVENT = "app-server://message";
const EXIT_EVENT = "app-server://exit";
const SIDEBAR_HIDDEN_KEY = "sudhir-codex.layout.sidebarHidden";
const SIDE_PANEL_HIDDEN_KEY = "sudhir-codex.layout.sidePanelHidden";

export function App() {
  const [state, dispatch] = useReducer(stateReducer, undefined, createInitialState);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [projectThreads, setProjectThreads] = useState<Record<string, Thread[]>>({});
  const [recentThreads, setRecentThreads] = useState<Thread[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<PermissionProfileOption[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<string | null>(null);
  // Threads whose turn finished while the user was looking elsewhere.
  const [unseenThreads, setUnseenThreads] = useState<ReadonlySet<string>>(() => new Set());
  const selectedThreadIdRef = useRef<string | null>(null);
  selectedThreadIdRef.current = state.selectedThreadId;
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)));
  const [sidebarHidden, setSidebarHidden] = useState(
    () => localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1",
  );
  const [sidePanelHidden, setSidePanelHidden] = useState(
    () => localStorage.getItem(SIDE_PANEL_HIDDEN_KEY) === "1",
  );
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

  const loadProjectThreads = useCallback(
    async (backendPath: string) => {
      const client = rpcRef.current;
      if (!client) {
        return;
      }
      const result = (await client.request("thread/list", {
        cwd: backendPath,
        limit: 50,
        sortKey: "recency_at",
        sortDirection: "desc",
      })) as { data: Thread[] };
      setProjectThreads((current) => ({ ...current, [backendPath]: result.data }));
    },
    [],
  );

  const loadRecentThreads = useCallback(async () => {
    const client = rpcRef.current;
    if (!client) {
      return;
    }
    const result = (await client.request("thread/list", {
      limit: 50,
      sortKey: "recency_at",
      sortDirection: "desc",
    })) as { data: Thread[] };
    setRecentThreads(result.data);
  }, []);

  useEffect(() => {
    let unlistenMessage: UnlistenFn | undefined;
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
        "mcpServer/elicitation/request": makeRequestHandler("mcpServer/elicitation/request"),
      },
      onNotification(method, params) {
        const action = classifyNotification(method, params);
        if (action) {
          dispatch(action);
        }
        if (method === "turn/completed" || method === "turn/failed") {
          const notification = (params ?? {}) as { threadId?: string };
          const threadId = notification.threadId;
          if (threadId && threadId !== selectedThreadIdRef.current) {
            setUnseenThreads((current) => {
              const next = new Set(current);
              next.add(threadId);
              return next;
            });
          }
        }
        if (method === "thread/name/updated") {
          const notification = (params ?? {}) as Record<string, unknown>;
          const threadId = typeof notification.threadId === "string" ? notification.threadId : null;
          const threadName = typeof notification.threadName === "string" ? notification.threadName : null;
          if (threadId) {
            setRecentThreads((current) => renameThread(current, threadId, threadName));
            setProjectThreads((current) => renameProjectThreads(current, threadId, threadName));
          }
        }
      },
      onUnsupportedRequest(method, requestId, params) {
        const record = (params ?? {}) as Record<string, unknown>;
        dispatch({
          type: "unsupportedRequest",
          method,
          threadId: typeof record.threadId === "string" ? record.threadId : null,
          turnId: typeof record.turnId === "string" ? record.turnId : null,
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
        void client.request("permissionProfile/list", {})
          .then((r) => {
            const data = (r as { data?: PermissionProfileOption[] } | null)?.data;
            if (Array.isArray(data)) {
              setPermissionProfiles(data);
            }
          })
          .catch(() => undefined); // pill simply stays hidden
        void client.request("config/read", { includeLayers: false })
          .then((r) => {
            // The live app-server serializes config keys in snake_case
            // (verified empirically against sudhir-codex on 2026-08-07);
            // the protocol types declare camelCase. Accept both, wire first.
            const config = (r as {
              config?: {
                model_reasoning_effort?: string | null;
                modelReasoningEffort?: string | null;
                service_tier?: string | null;
                serviceTier?: string | null;
              } | null;
            } | null)?.config;
            dispatch({
              type: "configDefaults/loaded",
              effort: config?.model_reasoning_effort ?? config?.modelReasoningEffort ?? null,
              serviceTier: config?.service_tier ?? config?.serviceTier ?? null,
            });
          })
          .catch(() => undefined); // graceful fallback: preset-default behavior
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
    }

    void start();

    return () => {
      disposed = true;
      unlistenMessage?.();
      unlistenExit?.();
      rpcRef.current?.close();
      rpcRef.current = null;
      void invoke("shutdown_app_server").catch(() => undefined);
    };
  }, [dispatch, loadModels, loadUsage]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, sidebarHidden ? "1" : "0");
  }, [sidebarHidden]);

  useEffect(() => {
    localStorage.setItem(SIDE_PANEL_HIDDEN_KEY, sidePanelHidden ? "1" : "0");
  }, [sidePanelHidden]);

  // ⌘B / Ctrl+B toggles the sidebar, ⌘U / Ctrl+U the usage panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        setSidebarHidden((hidden) => !hidden);
      } else if (key === "u") {
        event.preventDefault();
        setSidePanelHidden((hidden) => !hidden);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = resolveTheme(themePreference, systemTheme.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };

    localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    applyTheme();
    systemTheme.addEventListener("change", applyTheme);
    if (runningInTauri()) {
      void getCurrentWindow().setTheme(themePreference === "system" ? null : themePreference)
        .catch(() => undefined);
    }

    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [themePreference]);

  useEffect(() => {
    if (!state.connected) {
      return;
    }
    void Promise.allSettled([
      ...state.projects.map((project) => loadProjectThreads(project.backendPath)),
      loadRecentThreads(),
    ]);
  }, [state.connected, state.projects, loadProjectThreads, loadRecentThreads]);

  const selectedThread = state.selectedThreadId
    ? (state.threadsBy[state.selectedThreadId] ?? null)
    : null;

  const handleAddProject = useCallback(async () => {
    let folder: { displayPath: string; backendPath: string } | null;
    try {
      folder = await invoke<{ displayPath: string; backendPath: string } | null>(
        "pick_project_folder",
      );
    } catch (error) {
      dispatch(visibleActionFailure("failed to pick project folder", error));
      return;
    }
    if (!folder) {
      return;
    }
    const name =
      folder.displayPath.split(/[\\/]/).filter(Boolean).pop() ?? folder.displayPath;
    dispatch({
      type: "project/add",
      project: { name, pickerPath: folder.displayPath, backendPath: folder.backendPath },
    });
  }, [dispatch]);

  const handleSelectProject = useCallback(
    (backendPath: string) => {
      dispatch({ type: "project/select", backendPath });
    },
    [dispatch],
  );

  const handleNewThread = useCallback(async (backendPath: string) => {
    const client = rpcRef.current;
    if (!client) {
      return;
    }
    dispatch({ type: "project/select", backendPath });
    let result: { thread: Thread };
    try {
      result = (await client.request("thread/start", {
        model: state.selectedModel,
        cwd: backendPath,
      })) as { thread: Thread };
    } catch (error) {
      dispatch(visibleActionFailure("failed to start thread", error));
      return;
    }
    setProjectThreads((current) => ({
      ...current,
      [backendPath]: upsertNewestThread(current[backendPath] ?? [], result.thread),
    }));
    setRecentThreads((current) => upsertNewestThread(current, result.thread));
    dispatch({ type: "thread/hydrate", thread: result.thread });
    dispatch({ type: "thread/select", threadId: result.thread.id });
  }, [state.selectedModel, dispatch]);

  const handleSelectThread = useCallback(
    async (threadId: string, backendPath: string) => {
      dispatch({ type: "project/select", backendPath });
      dispatch({ type: "thread/select", threadId });
      setUnseenThreads((current) => {
        if (!current.has(threadId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
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
    async (text: string, attachments: Attachment[]) => {
      const client = rpcRef.current;
      if (!client || !state.selectedThreadId) {
        return;
      }
      const threadId = state.selectedThreadId;
      const backendPath = state.selectedProjectBackendPath;
      const input = buildTurnInput(text, attachments);
      if (input.length === 0) {
        return;
      }

      const threadState = state.threadsBy[threadId];
      const submission = buildTurnSubmission({
        threadId,
        input,
        activeTurnId: threadState?.turnStatus === "inProgress" ? threadState.turnId : null,
        model: state.selectedModel,
        effort: state.selectedReasoningEffort,
        serviceTier: state.selectedServiceTier,
        permissions: selectedPermissions,
      });

      if (submission.method === "turn/start" && shouldAutoNameThread(threadState)) {
        const name = deriveThreadTitle(text, attachments);
        setRecentThreads((current) => renameThread(current, threadId, name));
        setProjectThreads((current) => renameProjectThreads(current, threadId, name));
        void client.request("thread/name/set", { threadId, name }).catch((error: unknown) => {
          dispatch({
            type: "connection/status",
            connected: true,
            diagnostic: `failed to name thread: ${String(error)}`,
          });
        });
      }

      let result: unknown;
      try {
        result = await client.request(submission.method, submission.params);
      } catch (error) {
        dispatch(visibleActionFailure(
          submission.method === "turn/steer"
            ? "failed to steer turn"
            : "failed to start turn",
          error,
        ));
        throw error;
      }
      if (backendPath) {
        setProjectThreads((current) => ({
          ...current,
          [backendPath]: promoteThread(current[backendPath] ?? [], threadId),
        }));
      }
      setRecentThreads((current) => promoteThread(current, threadId));
      if (submission.method === "turn/steer") {
        return;
      }
      const started = result as { turn: { id: string } };
      dispatch({
        type: "notification",
        method: "turn/started",
        threadId,
        turnId: started.turn.id,
        payload: {
          threadId,
          turn: {
            id: started.turn.id,
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
    [
      state.selectedThreadId,
      state.selectedModel,
      state.selectedReasoningEffort,
      state.selectedServiceTier,
      state.selectedProjectBackendPath,
      state.threadsBy,
      selectedPermissions,
      dispatch,
    ],
  );

  const handleInterrupt = useCallback(async () => {
    const client = rpcRef.current;
    const thread = state.selectedThreadId ? state.threadsBy[state.selectedThreadId] : null;
    if (!client || !thread?.turnId) {
      return;
    }
    try {
      await client.request("turn/interrupt", {
        threadId: thread.threadId,
        turnId: thread.turnId,
      });
    } catch (error) {
      dispatch(visibleActionFailure("failed to interrupt turn", error));
    }
  }, [state.selectedThreadId, state.threadsBy, dispatch]);

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
  const selectedThreadSummary = state.selectedThreadId
    ? (recentThreads.find((thread) => thread.id === state.selectedThreadId) ??
       Object.values(projectThreads).flat().find((thread) => thread.id === state.selectedThreadId))
    : undefined;
  const selectedThreadTitle =
    selectedThreadSummary?.name ??
    selectedThread?.thread?.name ??
    selectedThreadSummary?.preview ??
    null;
  const selectedProjectName = state.selectedProjectBackendPath
    ? state.selectedProjectBackendPath.split(/[\\/]/).filter(Boolean).pop() ?? null
    : null;
  // The composer's live status line: the latest activity row label of the
  // running turn (same source as the collapsed Activity ticker).
  let workingStatus: string | null = null;
  if (busy && selectedThread) {
    const currentTurnEntries = selectedThread.entries.filter(
      (entry) => entry.turnId === selectedThread.turnId,
    );
    const rows = summarizeActivityEntries(currentTurnEntries);
    workingStatus = rows[rows.length - 1]?.row.label ?? "Working…";
  }

  const shellClassName = [
    "app-shell",
    sidebarHidden ? "app-shell-no-sidebar" : "",
    sidePanelHidden ? "app-shell-no-panel" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClassName}>
      <ProjectThreadSidebar
        state={state}
        projectThreads={projectThreads}
        recentThreads={recentThreads}
        unseenThreads={unseenThreads}
        onAddProject={handleAddProject}
        onSelectProject={handleSelectProject}
        onNewThread={handleNewThread}
        onSelectThread={handleSelectThread}
      />
      <main className="main-area">
        <header className="main-header">
          <span className="main-header-title">
            {selectedThread ? (selectedThreadTitle ?? "Untitled thread") : "Sudhir Codex"}
          </span>
          {selectedThread && selectedProjectName ? (
            <span className="main-header-project">{selectedProjectName}</span>
          ) : null}
          <div className="main-header-actions">
            <TopbarToggle
              label="Toggle sidebar"
              shortcut={shortcutLabel("B")}
              onClick={() => setSidebarHidden((hidden) => !hidden)}
            >
              <SidebarToggleIcon />
            </TopbarToggle>
            <TopbarToggle
              label="Toggle usage panel"
              shortcut={shortcutLabel("U")}
              active={!sidePanelHidden}
              onClick={() => setSidePanelHidden((hidden) => !hidden)}
            >
              <PanelRightIcon />
            </TopbarToggle>
          </div>
        </header>
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
        {busy && workingStatus ? (
          <div className="turn-status" role="status">{workingStatus}</div>
        ) : null}
        {pendingRequests.map((request) => (
          <InteractionRequest
            key={String(request.requestId)}
            request={request}
            onResolve={(outcome) => resolveRequest(request.requestId, outcome)}
          />
        ))}
        <ChatComposer
          key={state.selectedThreadId ?? "no-thread"}
          disabled={!state.connected || !state.selectedThreadId}
          busy={busy}
          onSend={handleSend}
          onInterrupt={handleInterrupt}
          settings={
            <ComposerSettings
              models={state.models}
              selectedModel={state.selectedModel}
              reasoningEffort={state.selectedReasoningEffort}
              serviceTier={state.selectedServiceTier}
              permissionProfiles={permissionProfiles}
              selectedPermissions={selectedPermissions}
              disabled={!state.connected}
              busy={busy}
              onModelChange={(model) => dispatch({ type: "model/select", model })}
              onReasoningEffortChange={(effort) =>
                dispatch({ type: "reasoningEffort/select", effort })}
              onServiceTierChange={(serviceTier) =>
                dispatch({ type: "serviceTier/select", serviceTier })}
              onPermissionsChange={setSelectedPermissions}
            />
          }
        />
      </main>
      <aside className="side-panel">
        <UsagePanel
          rateLimits={state.rateLimits}
          rateLimitsError={state.rateLimitsError}
          usage={state.usage}
          usageError={state.usageError}
          threadUsage={selectedThread?.tokenUsage ?? null}
        />
        <ThemePicker value={themePreference} onChange={setThemePreference} />
      </aside>
    </div>
  );
}

function upsertNewestThread(threads: Thread[], thread: Thread): Thread[] {
  return [thread, ...threads.filter((candidate) => candidate.id !== thread.id)];
}

function promoteThread(threads: Thread[], threadId: string): Thread[] {
  const thread = threads.find((candidate) => candidate.id === threadId);
  return thread ? upsertNewestThread(threads, thread) : threads;
}

function renameThread(threads: Thread[], threadId: string, name: string | null): Thread[] {
  return threads.map((thread) => thread.id === threadId ? { ...thread, name } : thread);
}

function renameProjectThreads(
  projectThreads: Record<string, Thread[]>,
  threadId: string,
  name: string | null,
): Record<string, Thread[]> {
  return Object.fromEntries(Object.entries(projectThreads).map(([backendPath, threads]) => [
    backendPath,
    renameThread(threads, threadId, name),
  ]));
}

function shouldAutoNameThread(thread: ReturnType<typeof createInitialState>["threadsBy"][string] | undefined): boolean {
  if (!thread) {
    return false;
  }
  const name = thread.thread?.name?.trim() ?? "";
  const hasUserMessage = thread.entries.some(
    (entry) => entry.kind === "item" && entry.item.type === "userMessage",
  );
  return !hasUserMessage && (!name || /^untitled (thread|task)$/i.test(name));
}

function runningInTauri(): boolean {
  return Boolean((globalThis as typeof globalThis & { isTauri?: boolean }).isTauri);
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
    case "mcpServer/elicitation/request": {
      const record = params as McpServerElicitationRequestParams;
      return record.message || `Request from ${record.serverName}`;
    }
    default:
      return `Request: ${method}`;
  }
}

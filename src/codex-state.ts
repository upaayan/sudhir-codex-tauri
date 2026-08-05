// Pure application state for the Sudhir-Codex Tauri frontend.
//
// This module is Node-tested, so it uses only erasable TypeScript syntax,
// imports no .tsx modules, and never touches browser-only globals like
// localStorage (persistence parsing is a pure function over strings).

import type {
  AccountRateLimitsResponse,
  AccountUsageResponse,
  AgentMessageDeltaNotification,
  CommandExecutionOutputDeltaNotification,
  ErrorNotification,
  FileChangePatchUpdatedNotification,
  FileUpdateChange,
  ItemCompletedNotification,
  ItemStartedNotification,
  Model,
  RateLimitWindow,
  ReasoningItem,
  ReasoningSummaryPartAddedNotification,
  ReasoningSummaryTextDeltaNotification,
  Thread,
  ThreadItem,
  ThreadStatus,
  ThreadStatusChangedNotification,
  ThreadTokenUsage,
  ThreadTokenUsageUpdatedNotification,
  TurnCompletedNotification,
  TurnError,
  TurnStatus,
} from "./codex-types.ts";

// ---------------------------------------------------------------------------
// Project persistence
// ---------------------------------------------------------------------------

export interface ProjectFavorite {
  name: string;
  pickerPath: string;
  backendPath: string;
}

export interface PersistedProjectState {
  version: 1;
  projects: ProjectFavorite[];
  lastProjectId: string | null;
}

const STORAGE_KEY = "sudhir-codex-tauri.projects.v1";

export function serializeProjects(state: PersistedProjectState): string {
  return JSON.stringify(state);
}

export function parseProjects(raw: string | null): PersistedProjectState {
  if (!raw) {
    return { version: 1, projects: [], lastProjectId: null };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedProjectState>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.projects)) {
      return { version: 1, projects: [], lastProjectId: null };
    }
    const projects = parsed.projects.filter(isProjectFavorite);
    return {
      version: 1,
      projects,
      lastProjectId: typeof parsed.lastProjectId === "string" ? parsed.lastProjectId : null,
    };
  } catch {
    return { version: 1, projects: [], lastProjectId: null };
  }
}

function isProjectFavorite(value: unknown): value is ProjectFavorite {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.pickerPath === "string" &&
    typeof record.backendPath === "string"
  );
}

export function storageKey(): string {
  return STORAGE_KEY;
}

// ---------------------------------------------------------------------------
// Transcript state
// ---------------------------------------------------------------------------

export interface ItemEntry {
  kind: "item";
  key: string;
  item: ThreadItem;
  completed: boolean;
}

export interface UnsupportedRequestEntry {
  key: string;
  kind: "unsupportedRequest";
  method: string;
  requestId: string | number;
}

export type TranscriptEntry = ItemEntry | UnsupportedRequestEntry;

export interface ThreadState {
  threadId: string;
  thread: Thread | null;
  entries: TranscriptEntry[];
  turnStatus: TurnStatus | null;
  turnError: TurnError | null;
  tokenUsage: ThreadTokenUsage | null;
  turnId: string | null;
}

export interface AppState {
  initialized: boolean;
  connected: boolean;
  diagnostic: string | null;
  projects: ProjectFavorite[];
  lastProjectId: string | null;
  selectedProjectBackendPath: string | null;
  threads: Thread[];
  threadsCursor: string | null;
  threadsLoading: boolean;
  selectedThreadId: string | null;
  models: Model[];
  modelsLoading: boolean;
  selectedModel: string | null;
  rateLimits: AccountRateLimitsResponse | null;
  rateLimitsError: string | null;
  usage: AccountUsageResponse | null;
  usageError: string | null;
  threadsBy: Record<string, ThreadState>;
}

export function createInitialState(): AppState {
  return {
    initialized: false,
    connected: false,
    diagnostic: null,
    projects: [],
    lastProjectId: null,
    selectedProjectBackendPath: null,
    threads: [],
    threadsCursor: null,
    threadsLoading: false,
    selectedThreadId: null,
    models: [],
    modelsLoading: false,
    selectedModel: null,
    rateLimits: null,
    rateLimitsError: null,
    usage: null,
    usageError: null,
    threadsBy: {},
  };
}

function emptyThreadState(threadId: string): ThreadState {
  return {
    threadId,
    thread: null,
    entries: [],
    turnStatus: null,
    turnError: null,
    tokenUsage: null,
    turnId: null,
  };
}

function withThread(state: AppState, threadId: string): {
  state: AppState;
  thread: ThreadState;
} {
  const thread = state.threadsBy[threadId] ?? emptyThreadState(threadId);
  return {
    state: {
      ...state,
      threadsBy: { ...state.threadsBy, [threadId]: thread },
    },
    thread,
  };
}

export function findEntry(
  thread: ThreadState,
  itemId: string,
): ItemEntry | undefined {
  return thread.entries.find(
    (entry): entry is ItemEntry =>
      entry.kind !== "unsupportedRequest" &&
      entryKey(entry.item) === itemId,
  );
}

function entryKey(item: ThreadItem): string {
  return item.id;
}

function applyItemDelta(
  thread: ThreadState,
  itemId: string,
  apply: (item: ThreadItem) => ThreadItem,
): ThreadState {
  return {
    ...thread,
    entries: thread.entries.map((entry) => {
      if (entry.kind === "unsupportedRequest" || entryKey(entry.item) !== itemId) {
        return entry;
      }
      return { ...entry, item: apply(entry.item) };
    }),
  };
}

function appendAgentDelta(item: ThreadItem, delta: string): ThreadItem {
  if (item.type === "agentMessage") {
    return {
      ...item,
      text: item.text + delta,
    };
  }
  return item;
}

function appendCommandDelta(item: ThreadItem, delta: string): ThreadItem {
  if (item.type === "commandExecution") {
    return {
      ...item,
      aggregatedOutput: (item.aggregatedOutput ?? "") + delta,
    };
  }
  return item;
}

function appendReasoningDelta(item: ThreadItem, delta: string, summaryIndex: number): ThreadItem {
  if (item.type === "reasoning") {
    const reasoning = item as ReasoningItem;
    const summary = [...reasoning.summary];
    summary[summaryIndex] = (summary[summaryIndex] ?? "") + delta;
    return { ...item, summary };
  }
  return item;
}

function addReasoningPart(item: ThreadItem, summaryIndex: number): ThreadItem {
  if (item.type === "reasoning") {
    const reasoning = item as ReasoningItem;
    const summary = [...reasoning.summary];
    while (summary.length <= summaryIndex) {
      summary.push("");
    }
    return { ...item, summary };
  }
  return item;
}

function replaceChanges(item: ThreadItem, changes: FileUpdateChange[]): ThreadItem {
  if (item.type === "fileChange") {
    return { ...item, changes };
  }
  return item;
}

function itemKindOf(item: ThreadItem): string {
  return item.type ?? "unknown";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AppAction =
  | { type: "connection/status"; connected: boolean; diagnostic: string | null }
  | { type: "initialize/ok" }
  | { type: "projects/load"; projects: ProjectFavorite[]; lastProjectId: string | null }
  | { type: "project/add"; project: ProjectFavorite }
  | { type: "project/remove"; backendPath: string }
  | { type: "project/select"; backendPath: string | null }
  | { type: "threads/replace"; threads: Thread[]; cursor: string | null; append: boolean }
  | { type: "thread/select"; threadId: string | null }
  | { type: "thread/hydrate"; thread: Thread }
  | { type: "models/replace"; models: Model[] }
  | { type: "model/select"; model: string | null }
  | { type: "usage/rateLimits"; rateLimits: AccountRateLimitsResponse | null; error: string | null }
  | { type: "usage/account"; usage: AccountUsageResponse | null; error: string | null }
  | { type: "unsupportedRequest"; method: string; threadId: string | null; requestId: string | number }
  | {
      type: "notification";
      threadId: string;
      turnId: string;
      method:
        | "turn/started"
        | "turn/completed"
        | "item/started"
        | "item/completed"
        | "item/agentMessage/delta"
        | "item/commandExecution/outputDelta"
        | "item/fileChange/patchUpdated"
        | "item/reasoning/summaryTextDelta"
        | "item/reasoning/summaryPartAdded"
        | "thread/tokenUsage/updated"
        | "thread/status/changed"
        | "error";
      payload: unknown;
    };

export function stateReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "connection/status":
      return { ...state, connected: action.connected, diagnostic: action.diagnostic };
    case "initialize/ok":
      return { ...state, initialized: true };
    case "projects/load":
      return { ...state, projects: action.projects, lastProjectId: action.lastProjectId };
    case "project/add": {
      const projects = state.projects.some(
        (p) => p.backendPath === action.project.backendPath,
      )
        ? state.projects
        : [...state.projects, action.project];
      return {
        ...state,
        projects,
        lastProjectId: action.project.backendPath,
        selectedProjectBackendPath: action.project.backendPath,
      };
    }
    case "project/remove": {
      const projects = state.projects.filter(
        (p) => p.backendPath !== action.backendPath,
      );
      const wasSelected = state.selectedProjectBackendPath === action.backendPath;
      return {
        ...state,
        projects,
        lastProjectId: wasSelected ? null : state.lastProjectId,
        selectedProjectBackendPath: wasSelected ? null : state.selectedProjectBackendPath,
        threads: wasSelected ? [] : state.threads,
        threadsCursor: wasSelected ? null : state.threadsCursor,
        selectedThreadId: wasSelected ? null : state.selectedThreadId,
      };
    }
    case "project/select":
      return {
        ...state,
        selectedProjectBackendPath: action.backendPath,
        lastProjectId: action.backendPath ?? state.lastProjectId,
        threads: [],
        threadsCursor: null,
        selectedThreadId: null,
      };
    case "threads/replace":
      return {
        ...state,
        threads: action.append ? [...state.threads, ...action.threads] : action.threads,
        threadsCursor: action.cursor,
        threadsLoading: false,
      };
    case "thread/select":
      return { ...state, selectedThreadId: action.threadId };
    case "thread/hydrate": {
      const thread = action.thread;
      const { state: next, thread: existing } = withThread(state, thread.id);
      const entries: TranscriptEntry[] = [];
      for (const turn of thread.turns ?? []) {
        for (const item of turn.items) {
          if (entries.some((e) => e.kind !== "unsupportedRequest" && entryKey(e.item) === entryKey(item))) {
            continue;
          }
          entries.push({ kind: "item", key: entryKey(item), item, completed: true });
        }
      }
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [thread.id]: {
            ...existing,
            thread,
            entries: existing.entries.length > 0 ? existing.entries : entries,
            turnStatus: existing.turnStatus ?? "completed",
          },
        },
      };
    }
    case "models/replace":
      return {
        ...state,
        models: action.models,
        modelsLoading: false,
        selectedModel: state.selectedModel ?? defaultModelId(action.models),
      };
    case "model/select":
      return { ...state, selectedModel: action.model };
    case "usage/rateLimits":
      return {
        ...state,
        rateLimits: action.rateLimits,
        rateLimitsError: action.error,
      };
    case "usage/account":
      return {
        ...state,
        usage: action.usage,
        usageError: action.error,
      };
    case "unsupportedRequest": {
      const threadId = action.threadId ?? state.selectedThreadId;
      if (!threadId) {
        return state;
      }
      const { state: next, thread } = withThread(state, threadId);
      const entry: UnsupportedRequestEntry = {
        key: `unsupported:${String(action.requestId)}`,
        kind: "unsupportedRequest",
        method: action.method,
        requestId: action.requestId,
      };
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: { ...thread, entries: [...thread.entries, entry] },
        },
      };
    }
    case "notification":
      return applyNotification(state, action);
    default:
      return state;
  }
}

function defaultModelId(models: Model[]): string | null {
  return models.find((model) => model.isDefault)?.model ?? models[0]?.model ?? null;
}

function applyNotification(
  state: AppState,
  action: Extract<AppAction, { type: "notification" }>,
): AppState {
  const { threadId, turnId, method, payload } = action;
  const { state: next, thread } = withThread(state, threadId);

  switch (method) {
    case "turn/started":
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: { ...thread, turnId, turnStatus: "inProgress", turnError: null },
        },
      };
    case "turn/completed": {
      const notification = payload as TurnCompletedNotification;
      const failed = notification.turn?.status === "failed";
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: {
            ...thread,
            turnStatus: failed ? "failed" : "completed",
            turnError: failed ? (notification.turn.error ?? null) : thread.turnError,
          },
        },
      };
    }
    case "item/started": {
      const notification = payload as ItemStartedNotification;
      const key = entryKey(notification.item);
      const existingIndex = thread.entries.findIndex(
        (entry) => entry.kind !== "unsupportedRequest" && entryKey(entry.item) === key,
      );
      const entries = [...thread.entries];
      if (existingIndex >= 0) {
        entries[existingIndex] = { kind: "item", key, item: notification.item, completed: false };
      } else {
        entries.push({ kind: "item", key, item: notification.item, completed: false });
      }
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: { ...thread, turnId, entries },
        },
      };
    }
    case "item/completed": {
      const notification = payload as ItemCompletedNotification;
      const item = notification.item;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: {
            ...thread,
            entries: thread.entries.map((entry) => {
              if (entry.kind === "unsupportedRequest" || entryKey(entry.item) !== entryKey(item)) {
                return entry;
              }
              return { ...entry, item: mergeItem(entry.item, item), completed: true };
            }),
          },
        },
      };
    }
    case "item/agentMessage/delta": {
      const notification = payload as AgentMessageDeltaNotification;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: applyItemDelta(thread, notification.itemId, (item) =>
            appendAgentDelta(item, notification.delta)),
        },
      };
    }
    case "item/commandExecution/outputDelta": {
      const notification = payload as CommandExecutionOutputDeltaNotification;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: applyItemDelta(thread, notification.itemId, (item) =>
            appendCommandDelta(item, notification.delta)),
        },
      };
    }
    case "item/fileChange/patchUpdated": {
      const notification = payload as FileChangePatchUpdatedNotification;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: applyItemDelta(thread, notification.itemId, (item) =>
            replaceChanges(item, notification.changes)),
        },
      };
    }
    case "item/reasoning/summaryTextDelta": {
      const notification = payload as ReasoningSummaryTextDeltaNotification;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: applyItemDelta(thread, notification.itemId, (item) =>
            appendReasoningDelta(item, notification.delta, notification.summaryIndex)),
        },
      };
    }
    case "item/reasoning/summaryPartAdded": {
      const notification = payload as ReasoningSummaryPartAddedNotification;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: applyItemDelta(thread, notification.itemId, (item) =>
            addReasoningPart(item, notification.summaryIndex)),
        },
      };
    }
    case "thread/tokenUsage/updated": {
      const notification = payload as ThreadTokenUsageUpdatedNotification;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: { ...thread, tokenUsage: notification.tokenUsage },
        },
      };
    }
    case "thread/status/changed": {
      const notification = payload as ThreadStatusChangedNotification;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: { ...thread, thread: thread.thread ? { ...thread.thread, status: notification.status } : null },
        },
      };
    }
    case "error": {
      const notification = payload as ErrorNotification;
      return {
        ...next,
        threadsBy: {
          ...next.threadsBy,
          [threadId]: {
            ...thread,
            turnError: notification.error,
            turnStatus: notification.willRetry ? thread.turnStatus : "failed",
          },
        },
      };
    }
    default:
      return next;
  }
}

function mergeItem(existing: ThreadItem, completed: ThreadItem): ThreadItem {
  const kind = itemKindOf(existing);
  const completedKind = itemKindOf(completed);
  if (kind !== completedKind) {
    return completed;
  }
  // The completed item is authoritative; keep the existing item's id so the
  // entry identity (and delta accumulation) stays stable.
  return { ...completed, id: existing.id };
}

// ---------------------------------------------------------------------------
// Notification classification
// ---------------------------------------------------------------------------

const NOTIFICATION_ACTIONS: Record<string, AppAction["type"]> = {
  "turn/started": "notification",
  "turn/completed": "notification",
  "item/started": "notification",
  "item/completed": "notification",
  "item/agentMessage/delta": "notification",
  "item/commandExecution/outputDelta": "notification",
  "item/fileChange/patchUpdated": "notification",
  "item/reasoning/summaryTextDelta": "notification",
  "item/reasoning/summaryPartAdded": "notification",
  "thread/tokenUsage/updated": "notification",
  "thread/status/changed": "notification",
  "error": "notification",
};

const NOTIFICATION_THREAD_ID_FIELDS: Record<string, string> = {
  "turn/started": "threadId",
  "turn/completed": "threadId",
  "item/started": "threadId",
  "item/completed": "threadId",
  "item/agentMessage/delta": "threadId",
  "item/commandExecution/outputDelta": "threadId",
  "item/fileChange/patchUpdated": "threadId",
  "item/reasoning/summaryTextDelta": "threadId",
  "item/reasoning/summaryPartAdded": "threadId",
  "thread/tokenUsage/updated": "threadId",
  "thread/status/changed": "threadId",
  "error": "threadId",
};

const NOTIFICATION_TURN_ID_FIELDS: Record<string, string> = {
  "turn/started": "turn.id",
  "turn/completed": "turn.id",
  "item/started": "turnId",
  "item/completed": "turnId",
  "item/agentMessage/delta": "turnId",
  "item/commandExecution/outputDelta": "turnId",
  "item/fileChange/patchUpdated": "turnId",
  "item/reasoning/summaryTextDelta": "turnId",
  "item/reasoning/summaryPartAdded": "turnId",
  "thread/tokenUsage/updated": "turnId",
  "thread/status/changed": "threadId",
  "error": "threadId",
};

export function classifyNotification(
  method: string,
  params: unknown,
): Extract<AppAction, { type: "notification" }> | null {
  if (!(method in NOTIFICATION_ACTIONS)) {
    return null;
  }
  const record = (params ?? {}) as Record<string, unknown>;
  const threadIdField = NOTIFICATION_THREAD_ID_FIELDS[method] ?? "threadId";
  const turnIdField = NOTIFICATION_TURN_ID_FIELDS[method] ?? "turnId";
  const threadId = String(record[threadIdField] ?? "");
  let turnId: string;
  if (turnIdField === "turn.id") {
    const turn = record.turn as { id?: unknown } | undefined;
    turnId = String(turn?.id ?? "");
  } else {
    turnId = String(record[turnIdField] ?? "");
  }
  if (!threadId) {
    return null;
  }
  return {
    type: "notification",
    method: method as Extract<AppAction, { type: "notification" }>["method"],
    threadId,
    turnId,
    payload: params,
  };
}

// ---------------------------------------------------------------------------
// Usage formatting
// ---------------------------------------------------------------------------

export function formatTokens(count: number | null | undefined): string {
  if (count === null || count === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("en-US").format(count);
}

export function formatRateLimitWindow(window: RateLimitWindow | null | undefined): string {
  if (!window) {
    return "unavailable";
  }
  const parts = [`${window.usedPercent}% used`];
  if (typeof window.resetsAt === "number" && window.resetsAt > 0) {
    parts.push(`resets ${new Date(window.resetsAt * 1000).toLocaleString()}`);
  }
  return parts.join(" · ");
}

export function formatThreadUsage(usage: ThreadTokenUsage | null): string {
  if (!usage) {
    return "no token data yet";
  }
  const total = formatTokens(usage.total?.totalTokens);
  const context = usage.modelContextWindow
    ? ` / ${formatTokens(usage.modelContextWindow)} context`
    : "";
  return `${total} tokens${context}`;
}

export function threadStatusText(status: ThreadStatus | string | null): string {
  if (!status) {
    return "idle";
  }
  if (typeof status === "object" && "active" in status) {
    const flags = (status as { active: { activeFlags?: string[] } }).active?.activeFlags ?? [];
    return flags.length > 0 ? `active (${flags.join(", ")})` : "active";
  }
  return String(status);
}

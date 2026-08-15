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
  ThreadNameUpdatedNotification,
  ThreadStatus,
  ThreadStatusChangedNotification,
  ThreadTokenUsage,
  ThreadTokenUsageUpdatedNotification,
  TurnCompletedNotification,
  TurnError,
  TurnStatus,
} from "./codex-types.ts";
import {
  reasoningEffortOptions,
  selectedEffortForModel,
  speedTiersForModel,
} from "./model-settings.ts";

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
  turnId: string | null;
  item: ThreadItem;
  completed: boolean;
}

export interface UnsupportedRequestEntry {
  key: string;
  kind: "unsupportedRequest";
  turnId: string | null;
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
  selectedReasoningEffort: string | null;
  // Tri-state: undefined = untouched (turn/start omits the key), null = user
  // explicitly chose Standard (turn/start sends null to clear), string = tier id.
  selectedServiceTier: string | null | undefined;
  // Defaults read from config/read, waiting for model/list so they can be
  // validated against the selected model. Applied by whichever arrives second.
  pendingConfigDefaults: { effort: string | null; serviceTier: string | null } | null;
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
    selectedReasoningEffort: null,
    selectedServiceTier: undefined,
    pendingConfigDefaults: null,
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
  | { type: "reasoningEffort/select"; effort: string | null }
  | { type: "configDefaults/loaded"; effort: string | null; serviceTier: string | null }
  | { type: "serviceTier/select"; serviceTier: string | null }
  | { type: "usage/rateLimits"; rateLimits: AccountRateLimitsResponse | null; error: string | null }
  | { type: "usage/account"; usage: AccountUsageResponse | null; error: string | null }
  | { type: "unsupportedRequest"; method: string; threadId: string | null; turnId?: string | null; requestId: string | number }
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
        | "thread/name/updated"
        | "error";
      payload: unknown;
    };

export function visibleActionFailure(action: string, error: unknown): AppAction {
  return {
    type: "connection/status",
    connected: true,
    diagnostic: `${action}: ${String(error)}`,
  };
}

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
          entries.push({ kind: "item", key: entryKey(item), turnId: turn.id, item, completed: true });
        }
      }
      return {
        ...next,
        // A successful hydrate proves the connection works: clear any one-off
        // banner left by an earlier failure (e.g. "failed to resume thread"),
        // which otherwise stayed on screen until restart. A real
        // connection-loss banner (connected === false) is left alone.
        diagnostic: next.connected ? null : next.diagnostic,
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
      {
        const selectedModel = state.selectedModel ?? defaultModelId(action.models);
        const selected = action.models.find((model) => model.model === selectedModel);
        let selectedReasoningEffort = selectedEffortForModel(
          selected,
          state.selectedReasoningEffort,
        );
        let selectedServiceTier = selectedServiceTierForModel(
          selected,
          state.selectedServiceTier,
        );
        const pending = state.pendingConfigDefaults;
        if (pending) {
          selectedReasoningEffort =
            validEffortSeed(selected, pending.effort) ?? selectedReasoningEffort;
          const seededTier = validTierSeed(selected, pending.serviceTier);
          if (seededTier !== null) {
            selectedServiceTier = seededTier;
          }
        }
      return {
        ...state,
        models: action.models,
        modelsLoading: false,
        selectedModel,
        selectedReasoningEffort,
        selectedServiceTier,
        pendingConfigDefaults: null,
      };
      }
    case "model/select": {
      const selected = state.models.find((model) => model.model === action.model);
      return {
        ...state,
        selectedModel: action.model,
        selectedReasoningEffort: selectedEffortForModel(
          selected,
          state.selectedReasoningEffort,
        ),
        selectedServiceTier: selectedServiceTierForModel(
          selected,
          state.selectedServiceTier,
        ),
      };
    }
    case "reasoningEffort/select":
      return { ...state, selectedReasoningEffort: action.effort };
    case "serviceTier/select":
      return { ...state, selectedServiceTier: action.serviceTier };
    case "configDefaults/loaded": {
      // One-shot seed from the user's saved config. If the model list has not
      // arrived yet, park the values; models/replace consumes them. Otherwise
      // apply now, validated against the selected model's capabilities.
      if (state.models.length === 0) {
        return {
          ...state,
          pendingConfigDefaults: {
            effort: action.effort,
            serviceTier: action.serviceTier,
          },
        };
      }
      const selected = state.models.find((model) => model.model === state.selectedModel);
      const seededEffort = validEffortSeed(selected, action.effort);
      const seededTier = validTierSeed(selected, action.serviceTier);
      return {
        ...state,
        selectedReasoningEffort: seededEffort ?? state.selectedReasoningEffort,
        selectedServiceTier: seededTier !== null ? seededTier : state.selectedServiceTier,
        pendingConfigDefaults: null,
      };
    }
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
        turnId: action.turnId ?? null,
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

function selectedServiceTierForModel(
  model: Model | undefined,
  currentTier: string | null | undefined,
): string | null | undefined {
  const tiers = speedTiersForModel(model);
  if (tiers.length === 0) {
    // A model with no tier concept gets "no opinion" — never an explicit clear.
    return undefined;
  }
  if (currentTier === null) {
    // The user explicitly chose Standard; keep that across tiered models.
    return null;
  }
  if (currentTier && tiers.some((tier) => tier.id === currentTier)) {
    return currentTier;
  }
  return tiers.some((tier) => tier.id === model?.defaultServiceTier)
    ? (model?.defaultServiceTier ?? undefined)
    : undefined;
}

function validEffortSeed(model: Model | undefined, effort: string | null): string | null {
  if (!effort) {
    return null;
  }
  const choices = reasoningEffortOptions(model);
  return choices.some((choice) => choice.value === effort) ? effort : null;
}

function validTierSeed(model: Model | undefined, tier: string | null): string | null {
  if (!tier) {
    return null;
  }
  return speedTiersForModel(model).some((candidate) => candidate.id === tier) ? tier : null;
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
        // A turn starting also proves the connection works; clear a stale
        // one-off banner here too (same rule as thread/hydrate).
        diagnostic: next.connected ? null : next.diagnostic,
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
        entries[existingIndex] = { kind: "item", key, turnId, item: notification.item, completed: false };
      } else {
        entries.push({ kind: "item", key, turnId, item: notification.item, completed: false });
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
    case "thread/name/updated": {
      const notification = payload as ThreadNameUpdatedNotification;
      const threadName = notification.threadName ?? null;
      return {
        ...next,
        threads: next.threads.map((candidate) =>
          candidate.id === threadId ? { ...candidate, name: threadName } : candidate),
        threadsBy: {
          ...next.threadsBy,
          [threadId]: {
            ...thread,
            thread: thread.thread ? { ...thread.thread, name: threadName } : null,
          },
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
  "thread/name/updated": "notification",
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
  "thread/name/updated": "threadId",
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
  "thread/name/updated": "threadId",
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
  const remaining = Math.min(100, Math.max(0, 100 - window.usedPercent));
  const parts = [`${remaining}% left`];
  if (typeof window.resetsAt === "number" && window.resetsAt > 0) {
    parts.push(`resets ${new Date(window.resetsAt * 1000).toLocaleString()}`);
  }
  return parts.join(" · ");
}

export function formatThreadUsage(usage: ThreadTokenUsage | null): string {
  if (!usage) {
    return "no token data yet";
  }
  const activeContext = formatTokens(usage.last?.totalTokens);
  const context = usage.modelContextWindow
    ? ` / ${formatTokens(usage.modelContextWindow)} context`
    : "";
  const cumulative = formatTokens(usage.total?.totalTokens);
  return `${activeContext}${context} · ${cumulative} cumulative`;
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

// Minimal wire types for the sudhir-codex app-server JSON-RPC protocol.
//
// This module is imported by Node-tested code, so it must use only erasable
// TypeScript syntax (no enums, namespaces, or constructor parameter
// properties) and must not import any .tsx module.

export const CLIENT_NAME = "codex_cli_rs";
export const CLIENT_TITLE = "Sudhir-Codex Tauri";
export const CLIENT_VERSION = "0.1.0";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JsonRpcRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type RpcMessage =
  | ({ jsonrpc: "2.0" } & JsonRpcRequest)
  | ({ jsonrpc: "2.0" } & JsonRpcResponse)
  | ({ jsonrpc: "2.0" } & JsonRpcNotification);

export interface ClientInfo {
  name: string;
  title?: string;
  version: string;
}

export interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities?: InitializeCapabilities;
}

export interface InitializeCapabilities {
  mcpServerOpenaiFormElicitation?: boolean;
}

export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

// ---------------------------------------------------------------------------
// Requests the client sends
// ---------------------------------------------------------------------------

export interface ThreadListParams {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: "created_at" | "updated_at" | "recency_at" | null;
  sortDirection?: "asc" | "desc" | null;
  cwd?: string | string[] | null;
}

export interface Thread {
  id: string;
  sessionId: string;
  preview: string;
  ephemeral: boolean;
  isPinned: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  recencyAt?: number | null;
  status: ThreadStatus;
  path?: string | null;
  cwd: string;
  cliVersion: string;
  source: string;
  threadSource?: string | null;
  name?: string | null;
  turns?: Turn[];
}

export type ThreadStatus =
  | "notLoaded"
  | "idle"
  | "systemError"
  | { active: { activeFlags: string[] } }
  | string;

export interface ThreadListResponse {
  data: Thread[];
  nextCursor: string | null;
  backwardsCursor?: string | null;
}

export interface ThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  sessionStartSource?: string | null;
}

export interface ThreadStartResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
}

export interface ThreadResumeParams {
  threadId: string;
  model?: string | null;
  cwd?: string | null;
}

export interface ThreadResumeResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
}

export interface ThreadReadParams {
  threadId: string;
}

export interface ThreadReadResponse {
  thread: Thread;
}

export interface Turn {
  id: string;
  items: ThreadItem[];
  itemsView: string;
  status: TurnStatus;
  error?: TurnError | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export interface TurnError {
  message: string;
  codexErrorInfo?: unknown;
  additionalDetails?: string | null;
}

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  model?: string | null;
  effort?: string | null;
  serviceTier?: string | null;
}

export interface TurnStartResponse {
  turn: Turn;
}

export interface TurnSteerParams {
  threadId: string;
  input: UserInput[];
  expectedTurnId: string;
}

export interface TurnSteerResponse {
  turnId: string;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface TurnInterruptResponse {
  ok: boolean;
}

export interface ThreadNameUpdatedNotification {
  threadId: string;
  threadName?: string | null;
}

export interface ModelListParams {
  cursor?: string | null;
  limit?: number | null;
}

export interface Model {
  id: string;
  model: string;
  upgrade?: string | null;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<string | ReasoningEffortOption>;
  defaultReasoningEffort: string;
  isDefault: boolean;
  serviceTiers?: ModelServiceTier[];
  defaultServiceTier?: string | null;
}

export interface ReasoningEffortOption {
  reasoningEffort: string;
  description?: string;
}

export interface ModelServiceTier {
  id: string;
  name: string;
  description: string;
}

export interface ModelListResponse {
  data: Model[];
  nextCursor: string | null;
}

export interface AccountRateLimitsResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
  rateLimitResetCredits?: unknown;
}

export interface RateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  planType?: string | null;
  rateLimitReachedType?: string | null;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

export interface AccountUsageResponse {
  summary: AccountTokenUsageSummary;
  dailyUsageBuckets?: AccountTokenUsageDailyBucket[] | null;
}

export interface AccountTokenUsageSummary {
  lifetimeTokens?: number | null;
  peakDailyTokens?: number | null;
  longestRunningTurnSec?: number | null;
  currentStreakDays?: number | null;
  longestStreakDays?: number | null;
}

export interface AccountTokenUsageDailyBucket {
  date?: string;
  tokens?: number;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

// The backend serializes ThreadItem with `#[serde(tag = "type")]`
// (app-server-protocol/src/protocol/v2/item.rs:118), so every item is
// `{ type: "<kind>", ...fields }`. Unknown kinds are preserved verbatim and
// rendered through a compact fallback card.
export interface UserMessageItem {
  type: "userMessage";
  id: string;
  clientId?: string | null;
  content: UserInput[];
}

export interface AgentMessageItem {
  type: "agentMessage";
  id: string;
  text: string;
  phase?: string | null;
}

export interface ReasoningItem {
  type: "reasoning";
  id: string;
  summary: string[];
  content: string[];
}

export interface CommandExecutionItem {
  type: "commandExecution";
  id: string;
  command: string;
  cwd: string;
  processId?: string | null;
  source?: string;
  status: CommandExecutionStatus;
  commandActions?: unknown[];
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
}

export interface FileChangeItem {
  type: "fileChange";
  id: string;
  changes: FileUpdateChange[];
  status: PatchApplyStatus;
}

export interface WebSearchItem {
  type: "webSearch";
  id: string;
  status: string;
  query?: string | null;
  results?: unknown[];
}

export interface McpToolCallItem {
  type: "mcpToolCall";
  id: string;
  server: string;
  tool: string;
  status: string;
  arguments: JsonValue;
  result?: McpToolCallResult | null;
  error?: { message?: string } | null;
  durationMs?: number | null;
}

export interface McpToolCallResult {
  content: JsonValue[];
  structuredContent?: JsonValue | null;
  _meta?: JsonValue | null;
}

export interface McpImageContent {
  dataUrl: string;
  mimeType: string;
}

const DISPLAYABLE_MCP_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export function mcpImageContent(result: unknown): McpImageContent[] {
  if (!isJsonRecord(result) || !Array.isArray(result.content)) {
    return [];
  }
  const images: McpImageContent[] = [];
  for (const content of result.content) {
    if (!isJsonRecord(content) || content.type !== "image") {
      continue;
    }
    const mimeType = typeof content.mimeType === "string"
      ? content.mimeType.trim().toLowerCase()
      : "";
    if (!DISPLAYABLE_MCP_IMAGE_TYPES.has(mimeType) || typeof content.data !== "string") {
      continue;
    }
    const compact = content.data.replace(/\s+/g, "");
    if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      continue;
    }
    const padded = compact.padEnd(compact.length + ((4 - compact.length % 4) % 4), "=");
    images.push({ dataUrl: `data:${mimeType};base64,${padded}`, mimeType });
  }
  return images;
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ContextCompactionItem {
  type: "contextCompaction";
  id: string;
}

export interface EnteredReviewModeItem {
  type: "enteredReviewMode";
  id: string;
  review: string;
}

export interface ExitedReviewModeItem {
  type: "exitedReviewMode";
  id: string;
  review: string;
}

export interface CollabAgentToolCallItem {
  type: "collabAgentToolCall";
  id: string;
  tool: string;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt?: string | null;
  model?: string | null;
}

export interface SleepItem {
  type: "sleep";
  id: string;
  durationMs?: number | null;
  reason?: string | null;
}

export interface ImageGenerationItem {
  type: "imageGeneration";
  id: string;
  status: string;
  revisedPrompt: string | null;
  result: string;
  savedPath?: string;
}

export function imageGenerationDataUrl(result: string): string | null {
  const image = result.trim();
  if (!image) {
    return null;
  }
  return image.startsWith("data:image/") ? image : `data:image/png;base64,${image}`;
}

export type ThreadItem = UserMessageItem | AgentMessageItem | ReasoningItem |
  CommandExecutionItem | FileChangeItem | WebSearchItem | McpToolCallItem |
  ContextCompactionItem | EnteredReviewModeItem | ExitedReviewModeItem |
  CollabAgentToolCallItem | SleepItem | ImageGenerationItem | UnknownThreadItem;

// Wire items whose kind is not yet known to this client.
export type UnknownThreadItem = { type: string; id: string; [key: string]: unknown };

// The backend serializes UserInput with `#[serde(tag = "type")]`, so every
// input carries a `type` discriminator.
export type UserInput =
  | { type: "text"; text: string; textElements?: unknown[] }
  | { type: "image"; url: string; detail?: string | null }
  | { type: "localImage"; path: string; detail?: string | null }
  | { type: "audio"; url: string }
  | { type: "localAudio"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type CommandExecutionStatus =
  | "inProgress"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export interface FileUpdateChange {
  path: string;
  kind: PatchChangeKind;
  diff: string;
}

export type PatchChangeKind =
  | { type: "add" }
  | { type: "delete" }
  | { type: "update"; move_path: string | null };

export function patchChangeKindLabel(kind: PatchChangeKind): string {
  if (kind.type === "update" && kind.move_path) {
    return `update → ${kind.move_path}`;
  }
  return kind.type;
}

export type PatchApplyStatus =
  | "inProgress"
  | "applied"
  | "failed"
  | "cancelled"
  | string;

export type KnownItemKind =
  | "userMessage"
  | "agentMessage"
  | "reasoning"
  | "commandExecution"
  | "fileChange"
  | "webSearch"
  | "mcpToolCall"
  | "contextCompaction"
  | "enteredReviewMode"
  | "exitedReviewMode"
  | "collabAgentToolCall"
  | "sleep"
  | "imageGeneration";

export type ThreadItemPayload<K extends KnownItemKind> = {
  userMessage: UserMessageItem;
  agentMessage: AgentMessageItem;
  reasoning: ReasoningItem;
  commandExecution: CommandExecutionItem;
  fileChange: FileChangeItem;
  webSearch: WebSearchItem;
  mcpToolCall: McpToolCallItem;
  contextCompaction: ContextCompactionItem;
  enteredReviewMode: EnteredReviewModeItem;
  exitedReviewMode: ExitedReviewModeItem;
  collabAgentToolCall: CollabAgentToolCallItem;
  sleep: SleepItem;
  imageGeneration: ImageGenerationItem;
}[K];

export function itemKind(item: ThreadItem): string {
  return item.type ?? "unknown";
}

export function itemId(item: ThreadItem): string {
  return item.id;
}

export function itemPayload<K extends KnownItemKind>(
  item: ThreadItem,
  kind: K,
): ThreadItemPayload<K> | undefined {
  return item.type === kind ? (item as ThreadItemPayload<K>) : undefined;
}

export function isItemKind(item: ThreadItem, kind: KnownItemKind): boolean {
  return itemKind(item) === kind;
}

export function isUnknownItem(item: ThreadItem): boolean {
  return !KNOWN_ITEM_KINDS.has(itemKind(item));
}

const KNOWN_ITEM_KINDS: ReadonlySet<string> = new Set([
  "userMessage",
  "agentMessage",
  "reasoning",
  "commandExecution",
  "fileChange",
  "webSearch",
  "mcpToolCall",
  "contextCompaction",
  "enteredReviewMode",
  "exitedReviewMode",
  "collabAgentToolCall",
  "sleep",
  "imageGeneration",
]);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface ThreadStartedNotification {
  threadId: string;
  thread: Thread;
}

export interface ThreadStatusChangedNotification {
  threadId: string;
  status: ThreadStatus;
}

export interface TurnStartedNotification {
  threadId: string;
  turn: Turn;
}

export interface TurnCompletedNotification {
  threadId: string;
  turn: Turn;
}

export interface ItemStartedNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
  startedAtMs: number;
}

export interface ItemCompletedNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
  completedAtMs: number;
}

export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface CommandExecutionOutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface FileChangePatchUpdatedNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  changes: FileUpdateChange[];
}

export interface ReasoningSummaryTextDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  summaryIndex: number;
}

export interface ReasoningSummaryPartAddedNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  summaryIndex: number;
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadTokenUsage {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface ThreadTokenUsageUpdatedNotification {
  threadId: string;
  turnId: string;
  tokenUsage: ThreadTokenUsage;
}

export interface ErrorNotification {
  error: TurnError;
  willRetry: boolean;
  threadId: string;
  turnId: string;
}

export type ServerNotification =
  | { method: "thread/started"; params: ThreadStartedNotification }
  | { method: "thread/status/changed"; params: ThreadStatusChangedNotification }
  | { method: "turn/started"; params: TurnStartedNotification }
  | { method: "turn/completed"; params: TurnCompletedNotification }
  | { method: "item/started"; params: ItemStartedNotification }
  | { method: "item/completed"; params: ItemCompletedNotification }
  | { method: "item/agentMessage/delta"; params: AgentMessageDeltaNotification }
  | {
      method: "item/commandExecution/outputDelta";
      params: CommandExecutionOutputDeltaNotification;
    }
  | {
      method: "item/fileChange/patchUpdated";
      params: FileChangePatchUpdatedNotification;
    }
  | {
      method: "item/reasoning/summaryTextDelta";
      params: ReasoningSummaryTextDeltaNotification;
    }
  | {
      method: "item/reasoning/summaryPartAdded";
      params: ReasoningSummaryPartAddedNotification;
    }
  | {
      method: "thread/tokenUsage/updated";
      params: ThreadTokenUsageUpdatedNotification;
    }
  | { method: "error"; params: ErrorNotification }
  | { method: string; params: unknown };

// ---------------------------------------------------------------------------
// Server requests (server asks the client for something)
// ---------------------------------------------------------------------------

export type CommandExecutionApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | string;

export interface CommandExecutionRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  approvalId?: string | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: unknown[];
}

export interface FileChangeRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface PermissionsRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  cwd: string;
  reason?: string | null;
  permissions: JsonValue;
}

export interface ToolRequestUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options?: { label: string; description?: string }[] | null;
}

export interface ToolRequestUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: ToolRequestUserInputQuestion[];
  autoResolutionMs?: number | null;
}

export interface ToolRequestUserInputAnswer {
  answers: string[];
}

export interface McpServerElicitationRequestParams {
  threadId: string;
  turnId?: string | null;
  serverName: string;
  mode: "form" | "openai/form" | "url" | string;
  message: string;
  requestedSchema?: JsonValue;
  url?: string;
  elicitationId?: string;
  _meta?: JsonValue;
}

export type ServerRequest =
  | {
      method: "item/commandExecution/requestApproval";
      id: string | number;
      params: CommandExecutionRequestApprovalParams;
    }
  | {
      method: "item/fileChange/requestApproval";
      id: string | number;
      params: FileChangeRequestApprovalParams;
    }
  | {
      method: "item/permissions/requestApproval";
      id: string | number;
      params: PermissionsRequestApprovalParams;
    }
  | {
      method: "item/tool/requestUserInput";
      id: string | number;
      params: ToolRequestUserInputParams;
    }
  | {
      method: "mcpServer/elicitation/request";
      id: string | number;
      params: McpServerElicitationRequestParams;
    }
  | { method: string; id: string | number; params: unknown };

export interface ServerRequestHandlerResult {
  result?: unknown;
  error?: JsonRpcError;
}

import type { TranscriptEntry } from "./codex-state.ts";
import {
  isUnknownItem,
  itemPayload,
  patchChangeKindLabel,
  type ThreadItem,
} from "./codex-types.ts";

// One compact line per activity entry. The label is always single-line (CSS
// truncates); hasDetail decides whether the row can expand into the bounded
// detail box, which renders the entry's existing full card.
export interface ActivityRow {
  label: string;
  hasDetail: boolean;
}

// Commentary longer than this gets an expandable markdown detail; shorter
// commentary is fully readable from the row itself.
const COMMENTARY_DETAIL_THRESHOLD = 160;

// Returns null only for reasoning entries that completed with no content —
// those rows are dropped entirely. Every other entry yields a row: unknown
// item types fall back to their type name with the JSON card as detail, so
// the escape hatch for new wire items survives summarization.
export function summarizeActivityEntry(entry: TranscriptEntry): ActivityRow | null {
  if (entry.kind === "unsupportedRequest") {
    return { label: `Unsupported request · ${entry.method}`, hasDetail: true };
  }

  const item = entry.item;

  const reasoning = itemPayload(item, "reasoning");
  if (reasoning) {
    const hasText = [...reasoning.summary, ...reasoning.content]
      .some((part) => part.trim().length > 0);
    if (!hasText) {
      return entry.completed ? null : { label: "Thinking", hasDetail: false };
    }
    return { label: "Thinking", hasDetail: true };
  }

  const command = itemPayload(item, "commandExecution");
  if (command) {
    const status = typeof command.exitCode === "number"
      ? `exit ${command.exitCode}`
      : command.status === "inProgress" ? "running" : command.status;
    return {
      label: singleLine(`Command · ${status} · ${stripCommandWrapper(command.command)}`),
      hasDetail: true,
    };
  }

  const fileChange = itemPayload(item, "fileChange");
  if (fileChange) {
    const status = fileChange.status === "applied" ? "" : ` · ${fileChange.status}`;
    if (fileChange.changes.length === 1) {
      const change = fileChange.changes[0]!;
      return {
        label: singleLine(
          `Edited ${change.path} (${patchChangeKindLabel(change.kind)})${status}`,
        ),
        hasDetail: true,
      };
    }
    return {
      label: `Edited ${fileChange.changes.length} files${status}`,
      hasDetail: true,
    };
  }

  const agentMessage = itemPayload(item, "agentMessage");
  if (agentMessage) {
    return {
      label: singleLine(agentMessage.text),
      hasDetail: agentMessage.text.length > COMMENTARY_DETAIL_THRESHOLD,
    };
  }

  const webSearch = itemPayload(item, "webSearch");
  if (webSearch) {
    return {
      label: singleLine(
        webSearch.query
          ? `Web search · “${webSearch.query}”`
          : `Web search · ${webSearch.status}`,
      ),
      hasDetail: false,
    };
  }

  const mcp = itemPayload(item, "mcpToolCall");
  if (mcp) {
    return {
      label: singleLine(`Tool · ${mcp.server} / ${mcp.tool} · ${mcp.status}`),
      hasDetail: Boolean(mcp.error || mcp.result),
    };
  }

  const collab = itemPayload(item, "collabAgentToolCall");
  if (collab) {
    return { label: singleLine(`Agent tool · ${collab.tool} · ${collab.status}`), hasDetail: false };
  }

  const sleep = itemPayload(item, "sleep");
  if (sleep) {
    return {
      label: singleLine(`Paused${sleep.reason ? ` · ${sleep.reason}` : ""}`),
      hasDetail: false,
    };
  }

  if (itemPayload(item, "contextCompaction")) {
    return { label: "Context compacted", hasDetail: false };
  }
  if (itemPayload(item, "enteredReviewMode")) {
    return { label: "Entered review mode", hasDetail: false };
  }
  if (itemPayload(item, "exitedReviewMode")) {
    return { label: "Exited review mode", hasDetail: false };
  }

  // Total fallback: userMessage/imageGeneration (not activity entries, but the
  // function stays total) and any unknown wire item. The detail is the existing
  // JSON dump card, so new item types remain inspectable.
  return { label: `Item · ${itemType(item)}`, hasDetail: true };
}

// Long shell commands routinely arrive wrapped ("bash -lc \"...\""); the
// wrapper is boilerplate and the informative part is the tail, so strip a
// recognized wrapper before the label is truncated. Degrades to identity.
export function stripCommandWrapper(command: string): string {
  const match = command.match(/^\s*(?:bash|sh|zsh)\s+-(?:lc|c|cl|l\s+-c)\s+([\s\S]+)$/);
  if (!match) {
    return command.trim();
  }
  const rest = match[1]!.trim();
  const quote = rest.charAt(0);
  if ((quote === "'" || quote === '"') && rest.endsWith(quote) && rest.length >= 2) {
    return rest.slice(1, -1).trim() || command.trim();
  }
  return rest;
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function itemType(item: ThreadItem): string {
  if (isUnknownItem(item)) {
    return item.type || "unknown";
  }
  return item.type;
}

import type { TranscriptEntry } from "./codex-state.ts";
import { isUnknownItem, itemPayload } from "./codex-types.ts";

export type TranscriptRow =
  | { kind: "entry"; key: string; entry: TranscriptEntry }
  | { kind: "messages"; key: string; entries: TranscriptEntry[] }
  | { kind: "activity"; key: string; entries: TranscriptEntry[] };

export function groupTranscriptEntries(entries: TranscriptEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const activityRowsByTurn = new Map<string, Extract<TranscriptRow, { kind: "activity" }>>();

  for (const entry of entries) {
    if (isActivityEntry(entry)) {
      const groupKey = entry.turnId ? `turn:${entry.turnId}` : `entry:${entry.key}`;
      const existing = activityRowsByTurn.get(groupKey);
      if (existing) {
        existing.entries.push(entry);
      } else {
        const row: Extract<TranscriptRow, { kind: "activity" }> = {
          kind: "activity",
          key: `activity:${groupKey}`,
          entries: [entry],
        };
        activityRowsByTurn.set(groupKey, row);
        rows.push(row);
      }
      continue;
    }

    // Consecutive final agent messages collapse into one box with one block
    // per message (activity rows in between do not break the run, matching
    // "one box for Activity, one for the rest").
    if (isFinalAgentMessage(entry)) {
      const last = rows[rows.length - 1];
      const lastNonActivity = [...rows].reverse().find((row) => row.kind !== "activity");
      if (
        lastNonActivity?.kind === "messages" &&
        (last === lastNonActivity || last?.kind === "activity")
      ) {
        lastNonActivity.entries.push(entry);
        continue;
      }
      rows.push({ kind: "messages", key: `messages:${entry.key}`, entries: [entry] });
      continue;
    }

    rows.push({ kind: "entry", key: entry.key, entry });
  }

  return rows;
}

function isFinalAgentMessage(entry: TranscriptEntry): boolean {
  if (entry.kind === "unsupportedRequest" || isUnknownItem(entry.item)) {
    return false;
  }
  const agentMessage = itemPayload(entry.item, "agentMessage");
  return Boolean(agentMessage) && agentMessage?.phase !== "commentary";
}

function isActivityEntry(entry: TranscriptEntry): boolean {
  if (entry.kind === "unsupportedRequest") {
    return true;
  }
  if (isUnknownItem(entry.item)) {
    return true;
  }
  if (itemPayload(entry.item, "userMessage") || itemPayload(entry.item, "imageGeneration")) {
    return false;
  }
  const agentMessage = itemPayload(entry.item, "agentMessage");
  if (agentMessage) {
    return agentMessage.phase === "commentary";
  }
  return true;
}

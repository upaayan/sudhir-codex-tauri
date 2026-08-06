import type { ItemEntry, TranscriptEntry } from "./codex-state.ts";
import { itemPayload } from "./codex-types.ts";

export type TranscriptRow =
  | { kind: "entry"; key: string; entry: TranscriptEntry }
  | { kind: "reasoning"; key: string; entries: ItemEntry[] };

export function groupTranscriptEntries(entries: TranscriptEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const reasoningRowsByTurn = new Map<string, Extract<TranscriptRow, { kind: "reasoning" }>>();

  for (const entry of entries) {
    if (entry.kind === "item" && itemPayload(entry.item, "reasoning")) {
      const groupKey = entry.turnId ? `turn:${entry.turnId}` : `item:${entry.key}`;
      const existing = reasoningRowsByTurn.get(groupKey);
      if (existing) {
        existing.entries.push(entry);
      } else {
        const row: Extract<TranscriptRow, { kind: "reasoning" }> = {
          kind: "reasoning",
          key: `reasoning:${groupKey}`,
          entries: [entry],
        };
        reasoningRowsByTurn.set(groupKey, row);
        rows.push(row);
      }
      continue;
    }

    rows.push({ kind: "entry", key: entry.key, entry });
  }

  return rows;
}

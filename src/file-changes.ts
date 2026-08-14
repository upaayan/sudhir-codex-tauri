import { itemPayload, patchChangeKindLabel } from "./codex-types.ts";
import type { TranscriptEntry } from "./codex-state.ts";

export interface FileChangeEntry {
  path: string;
  kindLabel: string;
  movePath: string | null;
  diff: string;
}

export interface FileChangeItemGroup {
  key: string;
  turnId: string | null;
  status: string;
  changes: FileChangeEntry[];
}

// One group per fileChange item, in chronological entry order. A file edited
// in two turns appears twice; no cross-item merging, no latest-wins.
export function collectFileChanges(entries: TranscriptEntry[]): FileChangeItemGroup[] {
  const groups: FileChangeItemGroup[] = [];
  for (const entry of entries) {
    if (entry.kind !== "item") {
      continue;
    }
    const fileChange = itemPayload(entry.item, "fileChange");
    if (!fileChange) {
      continue;
    }
    groups.push({
      key: entry.key,
      turnId: entry.turnId,
      status: fileChange.status,
      changes: fileChange.changes.map((change) => ({
        path: change.path,
        kindLabel: patchChangeKindLabel(change.kind),
        movePath: change.kind.type === "update" ? change.kind.move_path : null,
        diff: change.diff,
      })),
    });
  }
  return groups;
}

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "meta";
  }
  if (line.startsWith("diff ") || line.startsWith("index ")) {
    return "meta";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "del";
  }
  return "context";
}

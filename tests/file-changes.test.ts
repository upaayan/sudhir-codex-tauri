import assert from "node:assert/strict";
import { test } from "node:test";

import type { TranscriptEntry } from "../src/codex-state.ts";
import type { FileChangeItem } from "../src/codex-types.ts";
import { classifyDiffLine, collectFileChanges } from "../src/file-changes.ts";

function fileChangeEntry(
  id: string,
  turnId: string | null,
  item: Omit<FileChangeItem, "type" | "id">,
): TranscriptEntry {
  return {
    kind: "item",
    key: `fileChange:${id}`,
    turnId,
    completed: item.status !== "inProgress",
    item: { type: "fileChange", id, ...item },
  };
}

test("empty entries produce no groups", () => {
  assert.deepEqual(collectFileChanges([]), []);
});

test("non-fileChange entries are skipped", () => {
  const entries: TranscriptEntry[] = [
    {
      kind: "item",
      key: "msg:1",
      turnId: "turn-1",
      completed: true,
      item: { type: "agentMessage", id: "m1", text: "hello", phase: null },
    },
    {
      kind: "unsupportedRequest",
      key: "unsupported:1",
      turnId: "turn-1",
      method: "x/y",
      requestId: 1,
    },
  ];
  assert.deepEqual(collectFileChanges(entries), []);
});

test("one group per item with add/update/delete kinds and rename move_path", () => {
  const entries = [
    fileChangeEntry("fc1", "turn-1", {
      status: "applied",
      changes: [
        { path: "src/new.ts", kind: { type: "add" }, diff: "+line" },
        {
          path: "src/old.ts",
          kind: { type: "update", move_path: "src/renamed.ts" },
          diff: "+a\n-b",
        },
        { path: "src/gone.ts", kind: { type: "delete" }, diff: "-line" },
      ],
    }),
  ];
  const groups = collectFileChanges(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "fileChange:fc1");
  assert.equal(groups[0].turnId, "turn-1");
  assert.equal(groups[0].status, "applied");
  assert.deepEqual(
    groups[0].changes.map((change) => [change.path, change.kindLabel, change.movePath]),
    [
      ["src/new.ts", "add", null],
      ["src/old.ts", "update → src/renamed.ts", "src/renamed.ts"],
      ["src/gone.ts", "delete", null],
    ],
  );
});

test("same file across two turns yields two groups in chronological order", () => {
  const entries = [
    fileChangeEntry("fc1", "turn-1", {
      status: "applied",
      changes: [{ path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "+v1" }],
    }),
    fileChangeEntry("fc2", "turn-3", {
      status: "applied",
      changes: [{ path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "+v2" }],
    }),
  ];
  const groups = collectFileChanges(entries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].turnId, "turn-1");
  assert.equal(groups[0].changes[0].diff, "+v1");
  assert.equal(groups[1].turnId, "turn-3");
  assert.equal(groups[1].changes[0].diff, "+v2");
});

test("in-progress items are included with their status", () => {
  const entries = [
    fileChangeEntry("fc1", "turn-1", {
      status: "inProgress",
      changes: [{ path: "src/wip.ts", kind: { type: "add" }, diff: "+wip" }],
    }),
  ];
  const groups = collectFileChanges(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].status, "inProgress");
});

test("classifyDiffLine covers add, del, hunk, meta, and context", () => {
  assert.equal(classifyDiffLine("+added"), "add");
  assert.equal(classifyDiffLine("-removed"), "del");
  assert.equal(classifyDiffLine("@@ -1,3 +1,4 @@"), "hunk");
  assert.equal(classifyDiffLine("+++ b/src/app.ts"), "meta");
  assert.equal(classifyDiffLine("--- a/src/app.ts"), "meta");
  assert.equal(classifyDiffLine("diff --git a/x b/x"), "meta");
  assert.equal(classifyDiffLine("index 1234567..89abcde 100644"), "meta");
  assert.equal(classifyDiffLine(" unchanged"), "context");
  assert.equal(classifyDiffLine("plain"), "context");
});

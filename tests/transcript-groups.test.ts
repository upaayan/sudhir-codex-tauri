import assert from "node:assert/strict";
import { test } from "node:test";

import type { TranscriptEntry } from "../src/codex-state.ts";
import { groupTranscriptEntries } from "../src/transcript-groups.ts";

function reasoningEntry(id: string, turnId: string | null): TranscriptEntry {
  return {
    kind: "item",
    key: `reasoning:${id}`,
    turnId,
    completed: true,
    item: { type: "reasoning", id, summary: [`summary ${id}`], content: [] },
  };
}

test("groups all reasoning items from one turn into one transcript row", () => {
  const entries: TranscriptEntry[] = [
    reasoningEntry("r1", "turn-1"),
    {
      kind: "item",
      key: "agent:a1",
      turnId: "turn-1",
      completed: true,
      item: { type: "agentMessage", id: "a1", text: "reply", phase: null },
    },
    reasoningEntry("r2", "turn-1"),
    reasoningEntry("r3", "turn-2"),
  ];

  const rows = groupTranscriptEntries(entries);
  assert.deepEqual(rows.map((row) => row.kind), ["reasoning", "entry", "reasoning"]);
  assert.equal(rows[0]?.kind === "reasoning" ? rows[0].entries.length : 0, 2);
  assert.equal(rows[2]?.kind === "reasoning" ? rows[2].entries.length : 0, 1);
});

test("does not combine reasoning entries that have no turn id", () => {
  const rows = groupTranscriptEntries([
    reasoningEntry("r1", null),
    reasoningEntry("r2", null),
  ]);

  assert.equal(rows.length, 2);
});

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

test("groups reasoning, commentary, and tool output from one turn behind one activity row", () => {
  const entries: TranscriptEntry[] = [
    reasoningEntry("r1", "turn-1"),
    {
      kind: "item",
      key: "commentary:c1",
      turnId: "turn-1",
      completed: true,
      item: { type: "agentMessage", id: "c1", text: "Working on it", phase: "commentary" },
    },
    {
      kind: "item",
      key: "command:cmd1",
      turnId: "turn-1",
      completed: true,
      item: {
        type: "commandExecution",
        id: "cmd1",
        command: "ls",
        cwd: "/tmp",
        status: "completed",
        aggregatedOutput: "lots of output",
      },
    },
    {
      kind: "item",
      key: "agent:a1",
      turnId: "turn-1",
      completed: true,
      item: { type: "agentMessage", id: "a1", text: "reply", phase: "final_answer" },
    },
    reasoningEntry("r2", "turn-1"),
    reasoningEntry("r3", "turn-2"),
  ];

  const rows = groupTranscriptEntries(entries);
  assert.deepEqual(rows.map((row) => row.kind), ["activity", "messages", "activity"]);
  assert.equal(rows[0]?.kind === "activity" ? rows[0].entries.length : 0, 4);
  assert.equal(rows[1]?.kind === "messages" ? rows[1].entries.length : 0, 1);
  assert.equal(rows[2]?.kind === "activity" ? rows[2].entries.length : 0, 1);
});

test("does not combine activity entries that have no turn id", () => {
  const rows = groupTranscriptEntries([
    reasoningEntry("r1", null),
    reasoningEntry("r2", null),
  ]);

  assert.equal(rows.length, 2);
});

test("keeps user messages, final answers, generated images, and legacy agent messages visible", () => {
  const rows = groupTranscriptEntries([
    {
      kind: "item",
      key: "user:u1",
      turnId: "turn-1",
      completed: true,
      item: {
        type: "userMessage",
        id: "u1",
        content: [{ type: "text", text: "hello" }],
      },
    },
    {
      kind: "item",
      key: "agent:a1",
      turnId: "turn-1",
      completed: true,
      item: { type: "agentMessage", id: "a1", text: "final", phase: "final_answer" },
    },
    {
      kind: "item",
      key: "agent:a2",
      turnId: "turn-2",
      completed: true,
      item: { type: "agentMessage", id: "a2", text: "legacy", phase: null },
    },
    {
      kind: "item",
      key: "image:i1",
      turnId: "turn-2",
      completed: true,
      item: {
        type: "imageGeneration",
        id: "i1",
        status: "completed",
        revisedPrompt: null,
        result: "cG5n",
      },
    },
  ]);

  // Consecutive final/legacy agent messages coalesce into one messages box
  // (one block per message); user messages and images stay separate rows.
  assert.deepEqual(rows.map((row) => row.kind), ["entry", "messages", "entry"]);
  assert.equal(rows[1]?.kind === "messages" ? rows[1].entries.length : 0, 2);
});

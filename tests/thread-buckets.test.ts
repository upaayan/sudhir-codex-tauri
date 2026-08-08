import assert from "node:assert/strict";
import { test } from "node:test";

import { createInitialState } from "../src/codex-state.ts";
import type { ThreadState } from "../src/codex-state.ts";
import type { Thread } from "../src/codex-types.ts";
import { bucketThreads, threadRecency } from "../src/thread-buckets.ts";

// A fixed reference clock: 2026-08-08 12:00:00 local time.
const NOW = new Date(2026, 7, 8, 12, 0, 0).getTime() / 1000;

function thread(id: string, recencyAt: number): Thread {
  return {
    id,
    sessionId: `session-${id}`,
    preview: id,
    ephemeral: false,
    isPinned: false,
    modelProvider: "sudhir_gateway",
    createdAt: recencyAt,
    updatedAt: recencyAt,
    recencyAt,
    status: "idle",
    path: null,
    cwd: "/home/test/project",
    cliVersion: "0.1.0",
    source: "vscode",
    name: id,
    turns: [],
  };
}

function inProgressThreadState(threadId: string): ThreadState {
  return {
    threadId,
    thread: null,
    entries: [],
    turnStatus: "inProgress",
    turnError: null,
    tokenUsage: null,
    turnId: "turn-1",
  };
}

test("buckets by priority window, day boundaries, and week, newest-first", () => {
  const threads = [
    thread("old", NOW - 30 * 86400),
    thread("this-week", NOW - 3 * 86400),
    thread("yesterday-evening", NOW - 20 * 3600),
    thread("today-morning", NOW - 5 * 3600),
    thread("just-now", NOW - 10 * 60),
  ];
  const sections = bucketThreads(threads, createInitialState(), NOW);

  assert.deepEqual(
    sections.map(({ title, items }) => [title, items.map((t) => t.id)]),
    [
      ["Priority", ["just-now"]],
      ["Today", ["today-morning"]],
      ["Yesterday", ["yesterday-evening"]],
      ["This week", ["this-week"]],
      ["Older", ["old"]],
    ],
  );
});

test("a running thread is priority regardless of how old its recency is", () => {
  const stale = thread("stale-but-running", NOW - 10 * 86400);
  const state = {
    ...createInitialState(),
    threadsBy: { "stale-but-running": inProgressThreadState("stale-but-running") },
  };
  const sections = bucketThreads([stale, thread("idle-old", NOW - 10 * 86400)], state, NOW);
  assert.deepEqual(sections[0]?.items.map((t) => t.id), ["stale-but-running"]);
  assert.deepEqual(sections[4]?.items.map((t) => t.id), ["idle-old"]);
});

test("sections are sorted newest-first within each bucket", () => {
  const sections = bucketThreads(
    [thread("earlier-today", NOW - 6 * 3600), thread("later-today", NOW - 2 * 3600)],
    createInitialState(),
    NOW,
  );
  assert.deepEqual(sections[1]?.items.map((t) => t.id), ["later-today", "earlier-today"]);
});

test("threadRecency falls back from recencyAt to updatedAt to createdAt", () => {
  const full = thread("full", 1000);
  assert.equal(threadRecency(full), 1000);
  assert.equal(threadRecency({ ...full, recencyAt: undefined } as unknown as Thread), 1000);
  assert.equal(
    threadRecency({ ...full, recencyAt: undefined, updatedAt: undefined } as unknown as Thread),
    1000,
  );
  assert.equal(threadRecency(undefined), 0);
});

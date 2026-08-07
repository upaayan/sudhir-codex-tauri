import assert from "node:assert/strict";
import { test } from "node:test";

import {
  stripCommandWrapper,
  summarizeActivityEntries,
  summarizeActivityEntry,
} from "../src/activity-summary.ts";
import type { ItemEntry, TranscriptEntry } from "../src/codex-state.ts";
import type { ThreadItem } from "../src/codex-types.ts";

function entry(item: ThreadItem, completed = true): ItemEntry {
  return { key: item.id, kind: "item", turnId: "turn-1", item, completed };
}

test("every known and unknown item type yields a non-empty label (totality)", () => {
  const fixtures: ThreadItem[] = [
    { type: "userMessage", id: "u1", content: [{ type: "text", text: "hi" }] },
    { type: "agentMessage", id: "a1", text: "Working on it.", phase: "commentary" },
    { type: "reasoning", id: "r1", summary: ["thinking hard"], content: [] },
    {
      type: "commandExecution", id: "c1", command: "ls", cwd: "/",
      status: "completed", exitCode: 0,
    },
    {
      type: "fileChange", id: "f1", status: "applied",
      changes: [{ path: "src/app.tsx", kind: { type: "update", move_path: null }, diff: "" }],
    },
    { type: "webSearch", id: "w1", status: "completed", query: "tauri css" },
    {
      type: "mcpToolCall", id: "m1", server: "agentify", tool: "query",
      status: "completed", arguments: null,
    },
    { type: "contextCompaction", id: "cc1" },
    { type: "enteredReviewMode", id: "er1", review: "r" },
    { type: "exitedReviewMode", id: "xr1", review: "r" },
    {
      type: "collabAgentToolCall", id: "co1", tool: "spawn", status: "completed",
      senderThreadId: "t1", receiverThreadIds: [],
    },
    { type: "sleep", id: "s1", reason: "waiting" },
    { type: "imageGeneration", id: "i1", status: "completed", revisedPrompt: null, result: "" },
    { type: "futureNewThing", id: "x1", payload: { nested: true } },
  ];
  for (const item of fixtures) {
    const row = summarizeActivityEntry(entry(item));
    assert.ok(row, `expected a row for ${item.type}`);
    assert.ok(row.label.trim().length > 0, `expected a non-empty label for ${item.type}`);
  }
});

test("unsupported requests keep their escape hatch as a row", () => {
  const unsupported: TranscriptEntry = {
    key: "unsupported:9",
    kind: "unsupportedRequest",
    turnId: null,
    method: "future/serverRequest",
    requestId: 9,
  };
  const row = summarizeActivityEntry(unsupported);
  assert.ok(row);
  assert.equal(row.label, "Unsupported request · future/serverRequest");
  assert.equal(row.hasDetail, true);
});

test("unknown wire items fall back to their type with an inspectable detail", () => {
  const row = summarizeActivityEntry(
    entry({ type: "futureNewThing", id: "x1", note: "?" }),
  );
  assert.ok(row);
  assert.equal(row.label, "Item · futureNewThing");
  assert.equal(row.hasDetail, true);
});

test("command labels show running state, exit code, and the unwrapped command", () => {
  const running = summarizeActivityEntry(entry({
    type: "commandExecution", id: "c1", cwd: "/",
    command: "cargo build --release", status: "inProgress",
  }, false));
  assert.equal(running?.label, "Command · running · cargo build --release");

  const done = summarizeActivityEntry(entry({
    type: "commandExecution", id: "c2", cwd: "/",
    command: 'bash -lc "cd /Users/sudhirjha/playground && cargo test -p codex-core"',
    status: "completed", exitCode: 0,
  }));
  assert.equal(
    done?.label,
    "Command · exit 0 · cd /Users/sudhirjha/playground && cargo test -p codex-core",
  );
  assert.equal(done?.hasDetail, true);

  const failed = summarizeActivityEntry(entry({
    type: "commandExecution", id: "c3", cwd: "/",
    command: "false", status: "failed", exitCode: 1,
  }));
  assert.equal(failed?.label, "Command · exit 1 · false");
});

test("stripCommandWrapper removes shell wrappers and degrades to identity", () => {
  assert.equal(stripCommandWrapper('bash -lc "ls -la"'), "ls -la");
  assert.equal(stripCommandWrapper("sh -c 'echo hi'"), "echo hi");
  assert.equal(stripCommandWrapper("bash -lc ls"), "ls");
  assert.equal(stripCommandWrapper("cargo build"), "cargo build");
  assert.equal(stripCommandWrapper("  npm test  "), "npm test");
  // Mismatched quoting degrades to the unquoted tail rather than corrupting.
  assert.equal(stripCommandWrapper("bash -lc \"unterminated"), "\"unterminated");
});

test("multi-line commands collapse to a single-line label", () => {
  const row = summarizeActivityEntry(entry({
    type: "commandExecution", id: "c4", cwd: "/",
    command: "cat <<EOF\nline one\nline two\nEOF", status: "completed", exitCode: 0,
  }));
  assert.equal(row?.label, "Command · exit 0 · cat <<EOF line one line two EOF");
});

test("file changes summarize one file by path and many files by count", () => {
  const single = summarizeActivityEntry(entry({
    type: "fileChange", id: "f1", status: "applied",
    changes: [{ path: "src/app.tsx", kind: { type: "update", move_path: null }, diff: "+x" }],
  }));
  assert.equal(single?.label, "Edited src/app.tsx (update)");
  assert.equal(single?.hasDetail, true);

  const multi = summarizeActivityEntry(entry({
    type: "fileChange", id: "f2", status: "inProgress",
    changes: [
      { path: "a.ts", kind: { type: "add" }, diff: "" },
      { path: "b.ts", kind: { type: "update", move_path: null }, diff: "" },
      { path: "c.ts", kind: { type: "delete" }, diff: "" },
    ],
  }));
  assert.equal(multi?.label, "Edited 3 files · inProgress");
});

test("reasoning rows stream, then drop only when completed and empty", () => {
  const streamingEmpty = summarizeActivityEntry(
    entry({ type: "reasoning", id: "r1", summary: [""], content: [] }, false),
  );
  assert.equal(streamingEmpty?.label, "Thinking");
  assert.equal(streamingEmpty?.hasDetail, false);

  const completedEmpty = summarizeActivityEntry(
    entry({ type: "reasoning", id: "r2", summary: ["", "  "], content: [] }, true),
  );
  assert.equal(completedEmpty, null);

  const withText = summarizeActivityEntry(
    entry({ type: "reasoning", id: "r3", summary: ["I should check the tests."], content: [] }),
  );
  assert.equal(withText?.label, "Thinking");
  assert.equal(withText?.hasDetail, true);
});

test("commentary reads as a text row and only long commentary expands", () => {
  const short = summarizeActivityEntry(entry({
    type: "agentMessage", id: "a1", phase: "commentary",
    text: "Now wiring the composer footer.",
  }));
  assert.equal(short?.label, "Now wiring the composer footer.");
  assert.equal(short?.hasDetail, false);

  const long = summarizeActivityEntry(entry({
    type: "agentMessage", id: "a2", phase: "commentary",
    text: "x".repeat(200),
  }));
  assert.equal(long?.hasDetail, true);
});

test("the rendered row list excludes dropped entries so counts stay honest", () => {
  const entries: TranscriptEntry[] = [
    entry({ type: "commandExecution", id: "c1", cwd: "/", command: "ls", status: "completed", exitCode: 0 }),
    entry({ type: "reasoning", id: "r1", summary: [""], content: [] }, true), // dropped
    entry({ type: "webSearch", id: "w1", status: "completed", query: "q" }),
    entry({ type: "reasoning", id: "r2", summary: ["thinking"], content: [] }),
  ];
  const rows = summarizeActivityEntries(entries);
  assert.equal(rows.length, 3, "completed-and-empty reasoning must not be counted");
  assert.deepEqual(rows.map(({ entry: e }) => e.key), ["c1", "w1", "r2"]);
});

test("web search and tool calls become compact one-liners", () => {
  const search = summarizeActivityEntry(entry({
    type: "webSearch", id: "w1", status: "completed", query: "tauri webview2 css",
  }));
  assert.equal(search?.label, "Web search · “tauri webview2 css”");
  assert.equal(search?.hasDetail, false);

  const toolWithImage = summarizeActivityEntry(entry({
    type: "mcpToolCall", id: "m1", server: "agentify", tool: "query",
    status: "completed", arguments: null,
    result: { content: [{ type: "image", data: "cG5n", mimeType: "image/png" }] },
  }));
  assert.equal(toolWithImage?.label, "Tool · agentify / query · completed");
  assert.equal(toolWithImage?.hasDetail, true);

  const toolWithError = summarizeActivityEntry(entry({
    type: "mcpToolCall", id: "m2", server: "agentify", tool: "query",
    status: "failed", arguments: null, error: { message: "boom" },
  }));
  assert.equal(toolWithError?.hasDetail, true);

  // A bare or empty result renders nothing beyond the label — no dead chevron.
  const bareTool = summarizeActivityEntry(entry({
    type: "mcpToolCall", id: "m3", server: "agentify", tool: "status",
    status: "completed", arguments: null, result: { content: [] },
  }));
  assert.equal(bareTool?.hasDetail, false);
});

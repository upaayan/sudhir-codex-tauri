import assert from "node:assert/strict";
import { test } from "node:test";

import { TerminalSessionRegistry } from "../src/terminal-session.ts";

test("concurrent opens share one in-flight promise", async () => {
  let calls = 0;
  let release: (id: number) => void = () => {};
  const registry = new TerminalSessionRegistry(() => {
    calls += 1;
    return new Promise<number>((resolve) => {
      release = resolve;
    });
  });

  const first = registry.open("/proj");
  const second = registry.open("/proj");
  release(7);
  assert.equal(await first, 7);
  assert.equal(await second, 7);
  assert.equal(calls, 1);
});

test("settled live session is reused without reopening", async () => {
  let calls = 0;
  const registry = new TerminalSessionRegistry(() => {
    calls += 1;
    return Promise.resolve(calls);
  });

  assert.equal(await registry.open("/proj"), 1);
  assert.equal(await registry.open("/proj"), 1);
  assert.equal(calls, 1);
});

test("distinct projects get distinct sessions", async () => {
  let next = 0;
  const registry = new TerminalSessionRegistry(() => Promise.resolve(++next));
  assert.equal(await registry.open("/a"), 1);
  assert.equal(await registry.open("/b"), 2);
});

test("exited session reopens", async () => {
  let next = 0;
  const registry = new TerminalSessionRegistry(() => Promise.resolve(++next));
  const id = await registry.open("/proj");
  registry.markExited(id);
  assert.equal(await registry.open("/proj"), 2);
});

test("opener rejection clears the slot so a retry re-opens", async () => {
  let calls = 0;
  const registry = new TerminalSessionRegistry(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.reject(new Error("wsl missing"));
    }
    return Promise.resolve(42);
  });

  await assert.rejects(() => registry.open("/proj"), /wsl missing/);
  assert.equal(await registry.open("/proj"), 42);
  assert.equal(calls, 2);
});

test("drop forgets the session", async () => {
  let next = 0;
  const registry = new TerminalSessionRegistry(() => Promise.resolve(++next));
  await registry.open("/proj");
  registry.drop("/proj");
  assert.equal(await registry.open("/proj"), 2);
});

test("a slow failing open cannot evict the session Restart put in its place", async () => {
  let calls = 0;
  let failFirst: (error: Error) => void = () => {};
  const registry = new TerminalSessionRegistry(() => {
    calls += 1;
    if (calls === 1) {
      return new Promise<number>((_, reject) => {
        failFirst = reject;
      });
    }
    return Promise.resolve(41 + calls);
  });

  const first = registry.open("/proj");
  registry.drop("/proj"); // Restart
  const secondId = await registry.open("/proj");
  failFirst(new Error("slow failure lands late"));
  await assert.rejects(() => first, /slow failure lands late/);
  // The late rejection must not have evicted the newer session.
  assert.equal(await registry.open("/proj"), secondId);
  assert.equal(calls, 2);
});

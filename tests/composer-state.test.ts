import assert from "node:assert/strict";
import { test } from "node:test";

test("composer presents request copy while idle and steering copy while active", async () => {
  const module = await import("../src/composer-state.ts").catch(() => null);
  assert.ok(module, "composer-state module should exist");

  assert.deepEqual(module.getComposerPresentation(false), {
    placeholder: "Type your request…",
    submitLabel: "Send",
  });
  assert.deepEqual(module.getComposerPresentation(true), {
    placeholder: "Thinking…",
    submitLabel: "Steer",
  });
});

test("composer textarea grows with its content and caps at the Alamelu height", async () => {
  const module = await import("../src/composer-state.ts");
  const resizeComposerTextarea = (module as {
    resizeComposerTextarea?: (textarea: unknown) => void;
  }).resizeComposerTextarea;
  assert.equal(typeof resizeComposerTextarea, "function");

  const textarea = {
    scrollHeight: 140,
    offsetHeight: 66,
    clientHeight: 64,
    style: { height: "66px", overflowY: "auto" },
  };
  resizeComposerTextarea?.(textarea);
  assert.deepEqual(textarea.style, { height: "142px", overflowY: "hidden" });

  textarea.scrollHeight = 480;
  textarea.offsetHeight = 142;
  textarea.clientHeight = 140;
  resizeComposerTextarea?.(textarea);
  assert.deepEqual(textarea.style, { height: "220px", overflowY: "auto" });
});

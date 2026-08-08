import assert from "node:assert/strict";
import { test } from "node:test";

test("composer presents request copy while idle and steering copy while active", async () => {
  const module = await import("../src/composer-state.ts").catch(() => null);
  assert.ok(module, "composer-state module should exist");

  assert.deepEqual(module.getComposerPresentation(false), {
    placeholder: "Ask anything",
    submitLabel: "Send",
  });
  assert.deepEqual(module.getComposerPresentation(true), {
    placeholder: "Ask anything",
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
    value: "hello there",
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

  // Empty composer returns to its natural rows-based height (and never
  // measures, which avoids the unsettled-first-layout inflation).
  textarea.value = "";
  resizeComposerTextarea?.(textarea);
  assert.deepEqual(textarea.style, { height: "", overflowY: "hidden" });
});

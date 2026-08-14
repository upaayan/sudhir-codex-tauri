import assert from "node:assert/strict";
import { test } from "node:test";

import { commandForShortcut, type ShortcutInput } from "../src/shortcuts.ts";

function input(overrides: Partial<ShortcutInput>): ShortcutInput {
  return { modifier: true, shift: false, alt: false, key: "", code: "", ...overrides };
}

test("all five commands resolve via key", () => {
  assert.equal(commandForShortcut(input({ key: "j" })), "terminal");
  assert.equal(commandForShortcut(input({ key: "d" })), "diff");
  assert.equal(commandForShortcut(input({ key: "o" })), "openFolder");
  assert.equal(commandForShortcut(input({ key: "b" })), "sidebar");
  assert.equal(commandForShortcut(input({ key: "u" })), "usage");
});

test("uppercase key matches (caps lock)", () => {
  assert.equal(commandForShortcut(input({ key: "J" })), "terminal");
});

test("all five commands resolve via code when key differs (non-QWERTY)", () => {
  assert.equal(commandForShortcut(input({ key: "п", code: "KeyJ" })), "terminal");
  assert.equal(commandForShortcut(input({ key: "в", code: "KeyD" })), "diff");
  assert.equal(commandForShortcut(input({ key: "щ", code: "KeyO" })), "openFolder");
  assert.equal(commandForShortcut(input({ key: "и", code: "KeyB" })), "sidebar");
  assert.equal(commandForShortcut(input({ key: "г", code: "KeyU" })), "usage");
});

test("no modifier means no command", () => {
  assert.equal(commandForShortcut(input({ modifier: false, key: "j" })), null);
});

test("shift and alt are rejected", () => {
  assert.equal(commandForShortcut(input({ shift: true, key: "j" })), null);
  assert.equal(commandForShortcut(input({ alt: true, key: "d" })), null);
});

test("unmapped keys return null", () => {
  assert.equal(commandForShortcut(input({ key: "x", code: "KeyX" })), null);
});

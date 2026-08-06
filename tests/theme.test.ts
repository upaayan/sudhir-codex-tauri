import assert from "node:assert/strict";
import { test } from "node:test";

import { parseThemePreference, resolveTheme } from "../src/theme.ts";

test("theme preference defaults to system and rejects unknown stored values", () => {
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference("system"), "system");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("sepia"), "system");
});

test("system theme follows the operating-system preference", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("desktop window enables native zoom shortcuts with the required permission", async () => {
  const tauriConfig = JSON.parse(await readFile(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  )) as { app?: { windows?: Array<{ zoomHotkeysEnabled?: boolean }> } };
  const capability = JSON.parse(await readFile(
    new URL("../src-tauri/capabilities/default.json", import.meta.url),
    "utf8",
  )) as { permissions?: string[] };

  assert.equal(tauriConfig.app?.windows?.[0]?.zoomHotkeysEnabled, true);
  assert.ok(capability.permissions?.includes("core:webview:allow-set-webview-zoom"));
});

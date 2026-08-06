import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatReasoningEffort,
  reasoningEffortOptions,
  speedTiersForModel,
} from "../src/model-settings.ts";
import type { Model } from "../src/codex-types.ts";

function model(overrides: Partial<Model> = {}): Model {
  return {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    description: "",
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Quick reasoning" },
      { reasoningEffort: "xhigh", description: "Deep reasoning" },
    ],
    defaultReasoningEffort: "low",
    isDefault: true,
    serviceTiers: [{ id: "priority", name: "Fast", description: "Faster" }],
    ...overrides,
  };
}

test("normalizes every model's effort options and descriptions", () => {
  assert.deepEqual(reasoningEffortOptions(model()), [
    { value: "low", description: "Quick reasoning" },
    { value: "xhigh", description: "Deep reasoning" },
  ]);
  assert.deepEqual(reasoningEffortOptions(model({
    supportedReasoningEfforts: ["none", "high"],
    defaultReasoningEffort: "high",
  })), [
    { value: "none", description: "" },
    { value: "high", description: "" },
  ]);
});

test("formats effort names for the compact picker", () => {
  assert.equal(formatReasoningEffort("xhigh"), "X-High");
  assert.equal(formatReasoningEffort("ultra"), "Ultra");
  assert.equal(formatReasoningEffort("minimal"), "Minimal");
});

test("exposes Speed only for direct GPT models with catalog tiers", () => {
  assert.equal(speedTiersForModel(model()).length, 1);
  assert.deepEqual(speedTiersForModel(model({
    id: "pi-xai/grok-4.5",
    model: "pi-xai/grok-4.5",
  })), []);
  assert.deepEqual(speedTiersForModel(model({
    id: "gpt-5.4-mini",
    model: "gpt-5.4-mini",
    serviceTiers: [],
  })), []);
});

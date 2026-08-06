import type { Model, ModelServiceTier } from "./codex-types.ts";

export interface ReasoningEffortChoice {
  value: string;
  description: string;
}

export function reasoningEffortOptions(model: Model | undefined): ReasoningEffortChoice[] {
  if (!model) {
    return [];
  }
  const choices = model.supportedReasoningEfforts.map((option) =>
    typeof option === "string"
      ? { value: option, description: "" }
      : { value: option.reasoningEffort, description: option.description ?? "" });
  if (
    model.defaultReasoningEffort
    && !choices.some((choice) => choice.value === model.defaultReasoningEffort)
  ) {
    choices.push({ value: model.defaultReasoningEffort, description: "" });
  }
  return choices;
}

export function selectedEffortForModel(
  model: Model | undefined,
  currentEffort: string | null,
): string | null {
  const choices = reasoningEffortOptions(model);
  if (currentEffort && choices.some((choice) => choice.value === currentEffort)) {
    return currentEffort;
  }
  if (
    model?.defaultReasoningEffort
    && choices.some((choice) => choice.value === model.defaultReasoningEffort)
  ) {
    return model.defaultReasoningEffort;
  }
  return choices[0]?.value ?? null;
}

export function formatReasoningEffort(effort: string): string {
  if (effort.toLowerCase() === "xhigh") {
    return "X-High";
  }
  return effort
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function speedTiersForModel(model: Model | undefined): ModelServiceTier[] {
  if (!model || !/^gpt(?:-|$)/i.test(model.model)) {
    return [];
  }
  return model.serviceTiers ?? [];
}

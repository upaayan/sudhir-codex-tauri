import type { Model } from "../codex-types.ts";
import {
  formatReasoningEffort,
  reasoningEffortOptions,
  speedTiersForModel,
} from "../model-settings.ts";

interface Props {
  models: Model[];
  value: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  disabled: boolean;
  onChange: (model: string | null) => void;
  onReasoningEffortChange: (effort: string | null) => void;
  onServiceTierChange: (serviceTier: string | null) => void;
}

export function ModelPicker({
  models,
  value,
  reasoningEffort,
  serviceTier,
  disabled,
  onChange,
  onReasoningEffortChange,
  onServiceTierChange,
}: Props) {
  const selectedModel = models.find((model) => model.model === value);
  const efforts = reasoningEffortOptions(selectedModel);
  const selectedEffort = efforts.find((effort) => effort.value === reasoningEffort);
  const tiers = speedTiersForModel(selectedModel);
  const selectedTier = tiers.find((tier) => tier.id === serviceTier);

  return (
    <div className="panel">
      <h2 className="panel-title">Model</h2>
      <select
        className="model-select"
        value={value ?? ""}
        disabled={disabled || models.length === 0}
        onChange={(event) => onChange(event.target.value || null)}
      >
        {models.length === 0 && <option value="">No models available</option>}
        {models.map((model) => (
          <option key={model.id} value={model.model}>
            {model.displayName}
          </option>
        ))}
      </select>
      {selectedModel ? (
        <>
          <h3 className="panel-subtitle">Effort</h3>
          <select
            className="model-select"
            value={reasoningEffort ?? ""}
            disabled={disabled || efforts.length === 0}
            onChange={(event) => onReasoningEffortChange(event.target.value || null)}
          >
            {efforts.map((effort) => (
              <option key={effort.value} value={effort.value}>
                {formatReasoningEffort(effort.value)}
              </option>
            ))}
          </select>
          <p className="panel-note">
            {selectedEffort?.description || "Controls how much reasoning the model uses."}
          </p>
        </>
      ) : null}
      {tiers.length > 0 ? (
        <>
          <h3 className="panel-subtitle">Speed</h3>
          <select
            className="model-select"
            value={serviceTier ?? ""}
            disabled={disabled}
            onChange={(event) => onServiceTierChange(event.target.value || null)}
          >
            <option value="">Standard</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>{tier.name}</option>
            ))}
          </select>
          <p className="panel-note">
            {selectedTier?.description || "Standard speed and subscription usage."}
          </p>
        </>
      ) : null}
      <p className="panel-note model-next-turn-note">Applies to the next turn.</p>
    </div>
  );
}

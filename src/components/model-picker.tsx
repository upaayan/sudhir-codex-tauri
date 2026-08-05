import type { Model } from "../codex-types.ts";

interface Props {
  models: Model[];
  value: string | null;
  disabled: boolean;
  onChange: (model: string | null) => void;
}

export function ModelPicker({ models, value, disabled, onChange }: Props) {
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
      <p className="panel-note">Applies to the next turn.</p>
    </div>
  );
}

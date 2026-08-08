import type { Model } from "../codex-types.ts";
import {
  formatReasoningEffort,
  reasoningEffortOptions,
  speedTiersForModel,
} from "../model-settings.ts";

export interface PermissionProfileOption {
  id: string;
  description?: string | null;
  allowed?: boolean;
}

interface Props {
  models: Model[];
  selectedModel: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null | undefined;
  permissionProfiles: PermissionProfileOption[];
  selectedPermissions: string | null;
  disabled: boolean;
  busy: boolean;
  onModelChange: (model: string | null) => void;
  onReasoningEffortChange: (effort: string | null) => void;
  onServiceTierChange: (serviceTier: string | null) => void;
  onPermissionsChange: (permissions: string | null) => void;
}

// Compact pill selects for the composer footer. Stays enabled while a turn is
// running — changes apply to the next turn, and the hint says so.
export function ComposerSettings({
  models,
  selectedModel,
  reasoningEffort,
  serviceTier,
  permissionProfiles,
  selectedPermissions,
  disabled,
  busy,
  onModelChange,
  onReasoningEffortChange,
  onServiceTierChange,
  onPermissionsChange,
}: Props) {
  const selected = models.find((model) => model.model === selectedModel);
  const efforts = reasoningEffortOptions(selected);
  const selectedEffort = efforts.find((effort) => effort.value === reasoningEffort);
  const tiers = speedTiersForModel(selected);
  const selectedTier = tiers.find((tier) => tier.id === serviceTier);

  return (
    <div className="composer-settings">
      <select
        className="pill-select"
        value={selectedModel ?? ""}
        disabled={disabled || models.length === 0}
        aria-label="Model"
        title="Model"
        onChange={(event) => onModelChange(event.target.value || null)}
      >
        {models.length === 0 && <option value="">No models</option>}
        {models.map((model) => (
          <option key={model.id} value={model.model}>{model.displayName}</option>
        ))}
      </select>
      {efforts.length > 0 ? (
        <select
          className="pill-select"
          value={reasoningEffort ?? ""}
          disabled={disabled}
          aria-label="Reasoning effort"
          title={selectedEffort?.description || "Controls how much reasoning the model uses."}
          onChange={(event) => onReasoningEffortChange(event.target.value || null)}
        >
          {efforts.map((effort) => (
            <option key={effort.value} value={effort.value}>
              {formatReasoningEffort(effort.value)}
            </option>
          ))}
        </select>
      ) : null}
      {tiers.length > 0 ? (
        <select
          className="pill-select"
          value={serviceTier ?? ""}
          disabled={disabled}
          aria-label="Speed"
          title={selectedTier?.description || "Standard speed and subscription usage."}
          onChange={(event) => onServiceTierChange(event.target.value || null)}
        >
          <option value="">Standard</option>
          {tiers.map((tier) => (
            <option key={tier.id} value={tier.id}>{tier.name}</option>
          ))}
        </select>
      ) : null}
      {permissionProfiles.length > 0 ? (
        <select
          className="pill-select"
          value={selectedPermissions ?? ""}
          disabled={disabled}
          aria-label="Access level"
          title="Access level for the next turn"
          onChange={(event) => onPermissionsChange(event.target.value || null)}
        >
          <option value="">Access: default</option>
          {permissionProfiles.filter((profile) => profile.allowed !== false).map((profile) => (
            <option key={profile.id} value={profile.id}>
              {permissionProfileLabel(profile.id)}
            </option>
          ))}
        </select>
      ) : null}
      {busy ? <span className="composer-hint">applies to the next turn</span> : null}
    </div>
  );
}

export function permissionProfileLabel(id: string): string {
  switch (id) {
    case ":read-only":
      return "Read only";
    case ":workspace":
      return "Workspace";
    case ":danger-full-access":
      return "Full access";
    default:
      return id.replace(/^:/, "").split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

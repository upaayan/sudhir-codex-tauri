import type { ThemePreference } from "../theme.ts";

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

interface Props {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}

export function ThemePicker({ value, onChange }: Props) {
  return (
    <div className="panel theme-panel">
      <h2 className="panel-title">Theme</h2>
      <div className="theme-toggle" role="group" aria-label="Application theme">
        {OPTIONS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={value === option.value ? "selected" : ""}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

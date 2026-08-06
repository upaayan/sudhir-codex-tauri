export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sudhir-codex-tauri.theme.v1";

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference;
}

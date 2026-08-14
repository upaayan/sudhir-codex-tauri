export type ShortcutCommand = "terminal" | "diff" | "openFolder" | "sidebar" | "usage";

export interface ShortcutInput {
  /** Cmd on macOS or Ctrl elsewhere — the caller passes metaKey || ctrlKey. */
  modifier: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
  code: string;
}

// Matches on both key and code (Alamelu's pattern) so non-QWERTY layouts keep
// working when `key` differs from the physical position.
export function commandForShortcut(input: ShortcutInput): ShortcutCommand | null {
  if (!input.modifier || input.shift || input.alt) {
    return null;
  }
  const key = input.key.toLowerCase();
  if (key === "j" || input.code === "KeyJ") {
    return "terminal";
  }
  if (key === "d" || input.code === "KeyD") {
    return "diff";
  }
  if (key === "o" || input.code === "KeyO") {
    return "openFolder";
  }
  if (key === "b" || input.code === "KeyB") {
    return "sidebar";
  }
  if (key === "u" || input.code === "KeyU") {
    return "usage";
  }
  return null;
}

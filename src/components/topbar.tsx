import type { ReactNode } from "react";

// Tiny 20x20 stroke icons in the Alamelu-Pi style: hand-rolled inline SVG,
// sized by the wrapper so every icon stays visually consistent.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20" width="16" height="16">
      {children}
    </svg>
  );
}

export function SidebarToggleIcon() {
  return (
    <Icon>
      <rect x="3.4" y="4.1" width="13.2" height="11.8" rx="2.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M7.4 4.2v11.6" stroke="currentColor" strokeWidth="1.35" />
      <path d="M11 8.1 8.9 10l2.1 1.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
    </Icon>
  );
}

export function PanelRightIcon() {
  return (
    <Icon>
      <rect x="3.4" y="4.1" width="13.2" height="11.8" rx="2.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M12.6 4.2v11.6" stroke="currentColor" strokeWidth="1.35" />
    </Icon>
  );
}

export function shortcutLabel(key: string): string {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}

interface TopbarToggleProps {
  label: string;
  shortcut: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}

// Icon button with a CSS-only tooltip (hover or keyboard focus) showing the
// action name and its shortcut.
export function TopbarToggle({ label, shortcut, active, onClick, children }: TopbarToggleProps) {
  return (
    <div className="shortcut-tooltip-wrap">
      <button
        type="button"
        aria-label={label}
        className={`topbar-icon${active ? " topbar-icon-active" : ""}`}
        onClick={onClick}
      >
        {children}
      </button>
      <span className="shortcut-tooltip" role="tooltip">
        <span>{label}</span>
        <kbd>{shortcut}</kbd>
      </span>
    </div>
  );
}

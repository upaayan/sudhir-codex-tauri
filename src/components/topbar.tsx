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

export function TerminalIcon() {
  return (
    <Icon>
      <rect x="3.3" y="4.1" width="13.4" height="11.8" rx="2" stroke="currentColor" strokeWidth="1.35" />
      <path d="m6.2 7.4 2.2 2.1-2.2 2.1M9.7 12h3.7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
    </Icon>
  );
}

export function DiffIcon() {
  return (
    <Icon>
      <path d="M7 7h6M7 10h4M7 13h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
      <rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </Icon>
  );
}

export function FolderIcon() {
  return (
    <Icon>
      <path
        d="M2.75 6.5a1.75 1.75 0 0 1 1.75-1.75h3.1l1.5 1.7h6.4a1.75 1.75 0 0 1 1.75 1.75v5.3a1.75 1.75 0 0 1-1.75 1.75H4.5a1.75 1.75 0 0 1-1.75-1.75V6.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
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
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

// Icon button with a CSS-only tooltip (hover or keyboard focus) showing the
// action name and its shortcut.
export function TopbarToggle({ label, shortcut, active, disabled, onClick, children }: TopbarToggleProps) {
  return (
    <div className="shortcut-tooltip-wrap">
      <button
        type="button"
        aria-label={label}
        className={`topbar-icon${active ? " topbar-icon-active" : ""}`}
        disabled={disabled}
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

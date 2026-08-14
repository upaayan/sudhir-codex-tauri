import { classifyDiffLine, collectFileChanges } from "../file-changes.ts";
import type { ThreadState } from "../codex-state.ts";

interface Props {
  thread: ThreadState | null;
  onClose: () => void;
}

// Right-column "Changes" panel: a pure view over the selected thread's
// fileChange items — one collapsible group per item, chronological.
export function DiffPanel({ thread, onClose }: Props) {
  const groups = thread ? collectFileChanges(thread.entries) : [];
  return (
    <aside className="diff-panel" aria-label="Changes">
      <header className="diff-panel-header">
        <span>Changes</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close changes"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="diff-panel-body">
        {groups.length === 0 ? (
          <div className="diff-panel-empty">No file changes in this thread yet.</div>
        ) : (
          groups.map((group) => (
            <details className="diff-group" open key={group.key}>
              <summary className="diff-group-summary">
                <span className="diff-group-title">
                  {group.changes.length === 1
                    ? group.changes[0].path
                    : `${group.changes.length} files`}
                </span>
                <span className="diff-group-status">{group.status}</span>
              </summary>
              {group.changes.map((change, index) => (
                <div className="diff-file" key={`${change.path}:${index}`}>
                  <div className="diff-file-path">
                    {change.path}{" "}
                    <span className="diff-file-kind">({change.kindLabel})</span>
                  </div>
                  {change.diff ? <DiffText diff={change.diff} /> : null}
                </div>
              ))}
            </details>
          ))
        )}
      </div>
    </aside>
  );
}

function DiffText({ diff }: { diff: string }) {
  return (
    <pre className="diff-text">
      {diff.split("\n").map((line, index) => (
        <span key={index} className={`diff-line diff-line-${classifyDiffLine(line)}`}>
          {line.length > 0 ? line : " "}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

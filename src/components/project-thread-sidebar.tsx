import type { AppState } from "../codex-state.ts";

interface Props {
  state: AppState;
  onAddProject: () => void;
  onSelectProject: (backendPath: string) => void;
  onNewThread: () => void;
  onSelectThread: (threadId: string) => void;
  onLoadMore: () => void;
}

export function ProjectThreadSidebar({
  state,
  onAddProject,
  onSelectProject,
  onNewThread,
  onSelectThread,
  onLoadMore,
}: Props) {
  return (
    <nav className="sidebar">
      <section className="sidebar-section">
        <div className="sidebar-heading">
          <span>Projects</span>
          <button type="button" className="icon-button" onClick={onAddProject} title="Add project">
            +
          </button>
        </div>
        <ul className="sidebar-list">
          {state.projects.map((project) => (
            <li key={project.backendPath}>
              <button
                type="button"
                className={
                  "sidebar-item" +
                  (state.selectedProjectBackendPath === project.backendPath ? " selected" : "")
                }
                onClick={() => onSelectProject(project.backendPath)}
                title={project.backendPath}
              >
                {project.name}
              </button>
            </li>
          ))}
          {state.projects.length === 0 && (
            <li className="sidebar-empty">No projects yet. Add one to begin.</li>
          )}
        </ul>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-heading">
          <span>Threads</span>
          <button
            type="button"
            className="icon-button"
            onClick={onNewThread}
            title="New thread"
            disabled={!state.selectedProjectBackendPath}
          >
            +
          </button>
        </div>
        <ul className="sidebar-list">
          {state.threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className={
                  "sidebar-item" +
                  (state.selectedThreadId === thread.id ? " selected" : "")
                }
                onClick={() => onSelectThread(thread.id)}
                title={thread.preview}
              >
                <span className="sidebar-item-title">
                  {thread.name ?? (thread.preview || "Untitled thread")}
                </span>
              </button>
            </li>
          ))}
          {!state.selectedProjectBackendPath && (
            <li className="sidebar-empty">Select a project to list its threads.</li>
          )}
          {state.selectedProjectBackendPath && state.threads.length === 0 && (
            <li className="sidebar-empty">No threads for this project yet.</li>
          )}
        </ul>
        {state.threadsCursor && (
          <button type="button" className="text-button" onClick={onLoadMore}>
            Load more
          </button>
        )}
      </section>
    </nav>
  );
}

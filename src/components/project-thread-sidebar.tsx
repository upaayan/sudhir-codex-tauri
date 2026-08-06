import { useMemo, useState } from "react";

import type { AppState, ProjectFavorite } from "../codex-state.ts";
import type { Thread } from "../codex-types.ts";

const COLLAPSED_COUNT = 4;

interface Props {
  state: AppState;
  projectThreads: Record<string, Thread[]>;
  recentThreads: Thread[];
  onAddProject: () => void;
  onSelectProject: (backendPath: string) => void;
  onNewThread: (backendPath: string) => void;
  onSelectThread: (threadId: string, backendPath: string) => void;
}

export function ProjectThreadSidebar({
  state,
  projectThreads,
  recentThreads,
  onAddProject,
  onSelectProject,
  onNewThread,
  onSelectThread,
}: Props) {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllRecents, setShowAllRecents] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(),
  );

  const orderedProjects = useMemo(
    () => orderProjects(state.projects, projectThreads, state.selectedProjectBackendPath),
    [state.projects, projectThreads, state.selectedProjectBackendPath],
  );
  const visibleProjects = showAllProjects
    ? orderedProjects
    : orderedProjects.slice(0, COLLAPSED_COUNT);
  const visibleRecents = showAllRecents
    ? recentThreads
    : recentThreads.slice(0, COLLAPSED_COUNT);

  const toggleProjectThreads = (backendPath: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(backendPath)) {
        next.delete(backendPath);
      } else {
        next.add(backendPath);
      }
      return next;
    });
  };

  return (
    <nav className="sidebar">
      <section className="sidebar-section">
        <div className="sidebar-heading">
          <span>Projects</span>
          <button type="button" className="icon-button" onClick={onAddProject} title="Add project">
            +
          </button>
        </div>

        {visibleProjects.map((project) => {
          const threads = projectThreads[project.backendPath] ?? [];
          const expanded = expandedProjects.has(project.backendPath);
          const visibleThreads = expanded ? threads : threads.slice(0, COLLAPSED_COUNT);
          const selected = state.selectedProjectBackendPath === project.backendPath;

          return (
            <section className="sidebar-project" key={project.backendPath}>
              <div className="sidebar-project-heading">
                <button
                  type="button"
                  className={`sidebar-project-name${selected ? " selected" : ""}`}
                  onClick={() => onSelectProject(project.backendPath)}
                  title={project.backendPath}
                >
                  {project.name}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onNewThread(project.backendPath)}
                  title={`New thread in ${project.name}`}
                  disabled={!state.connected}
                >
                  +
                </button>
              </div>

              <ThreadList
                threads={visibleThreads}
                selectedThreadId={state.selectedThreadId}
                onSelectThread={onSelectThread}
                emptyText="No threads yet."
              />

              {threads.length > COLLAPSED_COUNT && (
                <button
                  type="button"
                  className="text-button sidebar-show-more"
                  onClick={() => toggleProjectThreads(project.backendPath)}
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
            </section>
          );
        })}

        {orderedProjects.length === 0 && (
          <div className="sidebar-empty">No projects yet. Add one to begin.</div>
        )}

        {orderedProjects.length > COLLAPSED_COUNT && (
          <button
            type="button"
            className="text-button sidebar-projects-more"
            onClick={() => setShowAllProjects((current) => !current)}
          >
            {showAllProjects ? "Show fewer projects" : "Show more projects"}
          </button>
        )}
      </section>

      <section className="sidebar-section sidebar-recents">
        <div className="sidebar-heading">
          <span>Recents</span>
        </div>
        <ThreadList
          threads={visibleRecents}
          selectedThreadId={state.selectedThreadId}
          onSelectThread={onSelectThread}
          emptyText="No recent threads."
        />
        {recentThreads.length > COLLAPSED_COUNT && (
          <button
            type="button"
            className="text-button sidebar-show-more"
            onClick={() => setShowAllRecents((current) => !current)}
          >
            {showAllRecents ? "Show less" : "Show more"}
          </button>
        )}
      </section>
    </nav>
  );
}

function ThreadList({
  threads,
  selectedThreadId,
  onSelectThread,
  emptyText,
}: {
  threads: Thread[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string, backendPath: string) => void;
  emptyText: string;
}) {
  return (
    <ul className="sidebar-list sidebar-thread-list">
      {threads.map((thread) => (
        <li key={thread.id}>
          <button
            type="button"
            className={`sidebar-item${selectedThreadId === thread.id ? " selected" : ""}`}
            onClick={() => onSelectThread(thread.id, thread.cwd)}
            title={thread.preview}
          >
            <span className="sidebar-item-title">{threadTitle(thread)}</span>
          </button>
        </li>
      ))}
      {threads.length === 0 && <li className="sidebar-empty">{emptyText}</li>}
    </ul>
  );
}

function orderProjects(
  projects: ProjectFavorite[],
  projectThreads: Record<string, Thread[]>,
  selectedBackendPath: string | null,
): ProjectFavorite[] {
  return projects
    .map((project, index) => ({ project, index }))
    .sort((left, right) => {
      if (left.project.backendPath === selectedBackendPath) {
        return -1;
      }
      if (right.project.backendPath === selectedBackendPath) {
        return 1;
      }
      const leftRecency = threadRecency(projectThreads[left.project.backendPath]?.[0]);
      const rightRecency = threadRecency(projectThreads[right.project.backendPath]?.[0]);
      return rightRecency - leftRecency || left.index - right.index;
    })
    .map(({ project }) => project);
}

function threadRecency(thread: Thread | undefined): number {
  return thread?.recencyAt ?? thread?.updatedAt ?? thread?.createdAt ?? 0;
}

function threadTitle(thread: Thread): string {
  return thread.name ?? (thread.preview || "Untitled thread");
}

import { useMemo, useState } from "react";

import type { AppState, ProjectFavorite } from "../codex-state.ts";
import type { Thread } from "../codex-types.ts";

const COLLAPSED_COUNT = 4;
const PRIORITY_WINDOW_SECONDS = 30 * 60;

interface Props {
  state: AppState;
  projectThreads: Record<string, Thread[]>;
  recentThreads: Thread[];
  unseenThreads: ReadonlySet<string>;
  onAddProject: () => void;
  onSelectProject: (backendPath: string) => void;
  onNewThread: (backendPath: string) => void;
  onSelectThread: (threadId: string, backendPath: string) => void;
}

export function ProjectThreadSidebar({
  state,
  projectThreads,
  recentThreads,
  unseenThreads,
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
  const [timelineView, setTimelineView] = useState(false);
  const [query, setQuery] = useState("");

  const orderedProjects = useMemo(
    () => orderProjects(state.projects, projectThreads, state.selectedProjectBackendPath),
    [state.projects, projectThreads, state.selectedProjectBackendPath],
  );
  const allThreads = useMemo(
    () => dedupeThreads(recentThreads, projectThreads),
    [recentThreads, projectThreads],
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

  const trimmedQuery = query.trim().toLowerCase();
  const searchResults = trimmedQuery
    ? allThreads.filter((thread) =>
        threadTitle(thread).toLowerCase().includes(trimmedQuery) ||
        thread.cwd.toLowerCase().includes(trimmedQuery))
    : null;

  return (
    <nav className="sidebar">
      <div className="sidebar-toolbar">
        <input
          type="search"
          className="sidebar-search"
          placeholder="Search threads…"
          aria-label="Search threads"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className={`icon-button bell-button${timelineView ? " active" : ""}`}
          onClick={() => setTimelineView((current) => !current)}
          aria-label={timelineView ? "Show projects" : "Show recent activity"}
          title={timelineView ? "Back to projects" : "Recent activity"}
        >
          <BellIcon />
          {unseenThreads.size > 0 ? <span className="unseen-dot bell-dot" /> : null}
        </button>
      </div>

      {searchResults ? (
        <section className="sidebar-section">
          <div className="sidebar-heading"><span>Search</span></div>
          <ThreadList
            threads={searchResults.slice(0, 30)}
            selectedThreadId={state.selectedThreadId}
            unseenThreads={unseenThreads}
            onSelectThread={onSelectThread}
            emptyText="No matching threads."
            showLocation
          />
        </section>
      ) : timelineView ? (
        <TimelineSections
          threads={allThreads}
          state={state}
          unseenThreads={unseenThreads}
          onSelectThread={onSelectThread}
        />
      ) : (
        <>
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
                    unseenThreads={unseenThreads}
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
              unseenThreads={unseenThreads}
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
        </>
      )}
    </nav>
  );
}

// The bell view: Priority (running now, or touched in the last 30 minutes),
// then day buckets, all newest-first.
function TimelineSections({
  threads,
  state,
  unseenThreads,
  onSelectThread,
}: {
  threads: Thread[];
  state: AppState;
  unseenThreads: ReadonlySet<string>;
  onSelectThread: (threadId: string, backendPath: string) => void;
}) {
  const nowSeconds = Date.now() / 1000;
  const sections = bucketThreads(threads, state, nowSeconds);
  return (
    <section className="sidebar-section">
      {sections.map(({ title, items }) =>
        items.length > 0 ? (
          <div key={title} className="sidebar-timeline-section">
            <div className="sidebar-heading"><span>{title}</span></div>
            <ThreadList
              threads={items}
              selectedThreadId={state.selectedThreadId}
              unseenThreads={unseenThreads}
              onSelectThread={onSelectThread}
              emptyText=""
              showLocation
            />
          </div>
        ) : null,
      )}
      {threads.length === 0 && <div className="sidebar-empty">No threads yet.</div>}
    </section>
  );
}

export function bucketThreads(
  threads: Thread[],
  state: AppState,
  nowSeconds: number,
): Array<{ title: string; items: Thread[] }> {
  const sorted = [...threads].sort((a, b) => threadRecency(b) - threadRecency(a));
  const startOfToday = new Date(nowSeconds * 1000);
  startOfToday.setHours(0, 0, 0, 0);
  const todaySeconds = startOfToday.getTime() / 1000;
  const yesterdaySeconds = todaySeconds - 86400;
  const weekSeconds = todaySeconds - 6 * 86400;

  const priority: Thread[] = [];
  const today: Thread[] = [];
  const yesterday: Thread[] = [];
  const week: Thread[] = [];
  const older: Thread[] = [];

  for (const thread of sorted) {
    const recency = threadRecency(thread);
    const active = state.threadsBy[thread.id]?.turnStatus === "inProgress";
    if (active || nowSeconds - recency <= PRIORITY_WINDOW_SECONDS) {
      priority.push(thread);
    } else if (recency >= todaySeconds) {
      today.push(thread);
    } else if (recency >= yesterdaySeconds) {
      yesterday.push(thread);
    } else if (recency >= weekSeconds) {
      week.push(thread);
    } else {
      older.push(thread);
    }
  }

  return [
    { title: "Priority", items: priority },
    { title: "Today", items: today },
    { title: "Yesterday", items: yesterday },
    { title: "This week", items: week },
    { title: "Older", items: older },
  ];
}

function ThreadList({
  threads,
  selectedThreadId,
  unseenThreads,
  onSelectThread,
  emptyText,
  showLocation = false,
}: {
  threads: Thread[];
  selectedThreadId: string | null;
  unseenThreads: ReadonlySet<string>;
  onSelectThread: (threadId: string, backendPath: string) => void;
  emptyText: string;
  showLocation?: boolean;
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
            <span className="sidebar-item-row">
              <span className="sidebar-item-title">{threadTitle(thread)}</span>
              {unseenThreads.has(thread.id) ? <span className="unseen-dot" /> : null}
            </span>
            {showLocation ? (
              <span className="sidebar-item-location">{locationLabel(thread.cwd)}</span>
            ) : null}
          </button>
        </li>
      ))}
      {threads.length === 0 && emptyText && <li className="sidebar-empty">{emptyText}</li>}
    </ul>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7m-4.7 10a2 2 0 0 0 3.4 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function dedupeThreads(
  recentThreads: Thread[],
  projectThreads: Record<string, Thread[]>,
): Thread[] {
  const byId = new Map<string, Thread>();
  for (const thread of recentThreads) {
    byId.set(thread.id, thread);
  }
  for (const threads of Object.values(projectThreads)) {
    for (const thread of threads) {
      if (!byId.has(thread.id)) {
        byId.set(thread.id, thread);
      }
    }
  }
  return [...byId.values()];
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

function locationLabel(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

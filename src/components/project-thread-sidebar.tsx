import { useMemo, useState } from "react";

import type { AppState, ProjectFavorite } from "../codex-state.ts";
import type { Thread } from "../codex-types.ts";
import { bucketThreads, threadRecency } from "../thread-buckets.ts";

const COLLAPSED_COUNT = 4;

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
  const [searchOpen, setSearchOpen] = useState(false);

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

  return (
    <nav className="sidebar">
      <div className="sidebar-toolbar">
        <span className="sidebar-brand">Sudhir Codex</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => setSearchOpen(true)}
          aria-label="Search chats"
          title="Search chats"
        >
          <SearchIcon />
        </button>
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

      {searchOpen ? (
        <SearchPopup
          threads={allThreads}
          unseenThreads={unseenThreads}
          onSelectThread={(threadId, backendPath) => {
            setSearchOpen(false);
            onSelectThread(threadId, backendPath);
          }}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

      {timelineView ? (
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

// Codex-style command-palette search: an overlay with an autofocused input
// and thread results; Escape or a backdrop click closes it.
function SearchPopup({
  threads,
  unseenThreads,
  onSelectThread,
  onClose,
}: {
  threads: Thread[];
  unseenThreads: ReadonlySet<string>;
  onSelectThread: (threadId: string, backendPath: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const results = (trimmed
    ? threads.filter((thread) =>
        threadTitle(thread).toLowerCase().includes(trimmed) ||
        thread.cwd.toLowerCase().includes(trimmed))
    : [...threads].sort((a, b) => threadRecency(b) - threadRecency(a))
  ).slice(0, 9);

  return (
    <div
      className="search-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <div className="search-panel" role="dialog" aria-label="Search chats">
        <input
          type="search"
          className="search-panel-input"
          placeholder="Search chats"
          aria-label="Search chats"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="search-panel-heading">Chats</div>
        <ul className="sidebar-list search-panel-results">
          {results.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className="sidebar-item"
                onClick={() => onSelectThread(thread.id, thread.cwd)}
                title={thread.preview}
              >
                <span className="sidebar-item-row">
                  <span className="sidebar-item-title">{threadTitle(thread)}</span>
                  {unseenThreads.has(thread.id) ? <span className="unseen-dot" /> : null}
                  <span className="search-result-location">{locationLabel(thread.cwd)}</span>
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="sidebar-empty">No matching chats.</li>}
        </ul>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.5 15.5 5 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
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

function threadTitle(thread: Thread): string {
  return thread.name ?? (thread.preview || "Untitled thread");
}

function locationLabel(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

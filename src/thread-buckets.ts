import type { AppState } from "./codex-state.ts";
import type { Thread } from "./codex-types.ts";

const PRIORITY_WINDOW_SECONDS = 30 * 60;

export function threadRecency(thread: Thread | undefined): number {
  return thread?.recencyAt ?? thread?.updatedAt ?? thread?.createdAt ?? 0;
}

// The bell view's sections: Priority (running now, or touched in the last
// 30 minutes), then day buckets, all newest-first.
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

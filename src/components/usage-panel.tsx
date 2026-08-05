import {
  formatRateLimitWindow,
  formatThreadUsage,
  formatTokens,
} from "../codex-state.ts";
import type {
  AccountRateLimitsResponse,
  AccountUsageResponse,
  ThreadTokenUsage,
} from "../codex-types.ts";

interface Props {
  rateLimits: AccountRateLimitsResponse | null;
  rateLimitsError: string | null;
  usage: AccountUsageResponse | null;
  usageError: string | null;
  threadUsage: ThreadTokenUsage | null;
}

export function UsagePanel({
  rateLimits,
  rateLimitsError,
  usage,
  usageError,
  threadUsage,
}: Props) {
  return (
    <div className="panel">
      <h2 className="panel-title">Usage</h2>

      <h3 className="panel-subtitle">ChatGPT / account</h3>
      {rateLimitsError && <p className="panel-note">{rateLimitsError}</p>}
      {!rateLimitsError && rateLimits && (
        <ul className="usage-list">
          <li>
            <span>Primary</span>
            <span>{formatRateLimitWindow(rateLimits.rateLimits?.primary)}</span>
          </li>
          <li>
            <span>Secondary</span>
            <span>{formatRateLimitWindow(rateLimits.rateLimits?.secondary)}</span>
          </li>
        </ul>
      )}
      {!rateLimitsError && !rateLimits && <p className="panel-note">No rate-limit data.</p>}

      {usageError && <p className="panel-note">{usageError}</p>}
      {!usageError && usage && (
        <ul className="usage-list">
          <li>
            <span>Lifetime tokens</span>
            <span>{formatTokens(usage.summary?.lifetimeTokens)}</span>
          </li>
          <li>
            <span>Peak daily</span>
            <span>{formatTokens(usage.summary?.peakDailyTokens)}</span>
          </li>
          <li>
            <span>Streak</span>
            <span>{usage.summary?.currentStreakDays ?? "—"} days</span>
          </li>
        </ul>
      )}
      {!usageError && !usage && <p className="panel-note">No account usage data.</p>}

      <h3 className="panel-subtitle">Thread</h3>
      <p className="panel-note">{formatThreadUsage(threadUsage)}</p>
    </div>
  );
}

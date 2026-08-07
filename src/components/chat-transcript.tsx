import { useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

import { userMessagePresentation } from "../attachments.ts";
import {
  imageGenerationDataUrl,
  isUnknownItem,
  itemPayload,
  mcpImageContent,
  patchChangeKindLabel,
  type ThreadItem,
} from "../codex-types.ts";
import type { ThreadState, TranscriptEntry } from "../codex-state.ts";
import { summarizeActivityEntry, type ActivityRow } from "../activity-summary.ts";
import { groupTranscriptEntries } from "../transcript-groups.ts";

interface Props {
  thread: ThreadState | null;
}

export function ChatTranscript({ thread }: Props) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  // Auto-scroll only while the user is pinned near the bottom. The pin is
  // tracked by the scroll handler (not measured inside the layout effect,
  // which runs post-append and would always read "not near bottom").
  const pinnedRef = useRef(true);

  useLayoutEffect(() => {
    pinnedRef.current = true;
  }, [thread?.threadId]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript && pinnedRef.current) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [thread?.threadId, thread?.entries]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      return;
    }
    const scrollAfterImageSettles = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement)) {
        return;
      }
      requestAnimationFrame(() => {
        if (pinnedRef.current) {
          transcript.scrollTop = transcript.scrollHeight;
        }
      });
    };
    transcript.addEventListener("load", scrollAfterImageSettles, true);
    transcript.addEventListener("error", scrollAfterImageSettles, true);
    return () => {
      transcript.removeEventListener("load", scrollAfterImageSettles, true);
      transcript.removeEventListener("error", scrollAfterImageSettles, true);
    };
  }, [thread?.threadId]);

  const trackPin = (event: { currentTarget: HTMLDivElement }) => {
    const el = event.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (!thread) {
    return <div ref={transcriptRef} className="transcript transcript-empty">Select a thread to begin.</div>;
  }
  if (thread.entries.length === 0) {
    return <div ref={transcriptRef} className="transcript transcript-empty">No messages yet.</div>;
  }

  const rows = groupTranscriptEntries(thread.entries);

  return (
    <div ref={transcriptRef} className="transcript" onScroll={trackPin}>
      {thread.turnError && thread.turnStatus === "failed" && (
        <div className="card card-error">
          <div className="card-label">Turn failed</div>
          <div className="card-body">{thread.turnError.message}</div>
        </div>
      )}
      {rows.map((row) =>
        row.kind === "activity" ? (
          <ActivityCard key={row.key} entries={row.entries} />
        ) : (
          <TranscriptCard key={row.key} entry={row.entry} />
        ),
      )}
    </div>
  );
}

function ActivityCard({ entries }: { entries: TranscriptEntry[] }) {
  const rows: Array<{ entry: TranscriptEntry; row: ActivityRow }> = [];
  for (const entry of entries) {
    const row = summarizeActivityEntry(entry);
    if (row) {
      rows.push({ entry, row });
    }
  }
  const inProgress = entries.some(
    (entry) => entry.kind === "item" && !entry.completed,
  );
  // Live ticker: while the turn runs, the collapsed line shows what is
  // happening right now; afterwards it shows how much happened.
  const latest = rows[rows.length - 1];
  const countLabel = `${rows.length} ${rows.length === 1 ? "update" : "updates"}`;
  const preview = inProgress ? (latest?.row.label ?? "Working…") : countLabel;
  return (
    <details className="card card-activity">
      <summary className="activity-summary">
        <span className="card-label">Activity</span>
        <span className="activity-preview">{preview}</span>
      </summary>
      <div className="activity-detail">
        {rows.map(({ entry, row }) => (
          <ActivityRowView key={entry.key} entry={entry} row={row} />
        ))}
      </div>
    </details>
  );
}

function ActivityRowView({ entry, row }: { entry: TranscriptEntry; row: ActivityRow }) {
  if (!row.hasDetail) {
    return (
      <div className="activity-row">
        <span className="activity-row-label">{row.label}</span>
      </div>
    );
  }
  return (
    <details className="activity-row activity-row-expandable">
      <summary className="activity-row-summary">
        <span className="activity-row-label">{row.label}</span>
        <span className="activity-row-chevron" aria-hidden="true">▸</span>
      </summary>
      <div className="activity-row-detail">
        <TranscriptCard entry={entry} />
      </div>
    </details>
  );
}

function TranscriptCard({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === "unsupportedRequest") {
    return (
      <div className="card card-unsupported">
        <div className="card-label">Unsupported request</div>
        <div className="card-body">
          The server sent <code>{entry.method}</code>, which this client does not implement.
          An error response was returned so the turn can continue.
        </div>
      </div>
    );
  }
  if (entry.completed && isEmptyReasoning(entry.item)) {
    return null;
  }
  return <ItemCard item={entry.item} />;
}

function isEmptyReasoning(item: ThreadItem): boolean {
  const reasoning = itemPayload(item, "reasoning");
  if (!reasoning) {
    return false;
  }
  return [...reasoning.summary, ...reasoning.content]
    .every((part) => part.trim().length === 0);
}

function ItemCard({ item }: { item: ThreadItem }) {
  if (isUnknownItem(item)) {
    return (
      <div className="card card-fallback">
        <div className="card-label">New item type</div>
        <pre className="card-json">{JSON.stringify(item, null, 2)}</pre>
      </div>
    );
  }

  const userMessage = itemPayload(item, "userMessage");
  if (userMessage) {
    const presentation = userMessagePresentation(userMessage.content);
    return (
      <div className="card card-user">
        <div className="card-label">You</div>
        {presentation.text ? <MarkdownBody text={presentation.text} /> : null}
        {presentation.attachments.length > 0 ? (
          <div className="message-attachments" aria-label="Attachments">
            {presentation.attachments.map((attachment) => (
              <span
                className="attachment-chip"
                key={`${attachment.kind}:${attachment.backendPath}`}
                title={attachment.displayPath}
              >
                <span className="attachment-kind" aria-hidden="true">
                  {attachment.kind === "image" ? "IMG" : "DOC"}
                </span>
                <span className="attachment-name">{attachment.name}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const agentMessage = itemPayload(item, "agentMessage");
  if (agentMessage) {
    return (
      <div className="card card-agent">
        <div className="card-label">Sudhir-Codex</div>
        <MarkdownBody text={agentMessage.text} />
      </div>
    );
  }

  const reasoning = itemPayload(item, "reasoning");
  if (reasoning) {
    const parts = [...reasoning.summary, ...reasoning.content]
      .filter((part) => part.trim().length > 0);
    return (
      <div className="card card-reasoning-detail">
        <div className="card-label">Thinking</div>
        {parts.length > 0
          ? parts.map((part, index) => <MarkdownBody key={index} text={part} />)
          : <p className="card-body">No thinking details received.</p>}
      </div>
    );
  }

  const command = itemPayload(item, "commandExecution");
  if (command) {
    return (
      <div className="card card-command">
        <div className="card-label">
          Command · {command.status}
          {typeof command.exitCode === "number" ? ` · exit ${command.exitCode}` : ""}
        </div>
        <pre className="card-command-text">{command.command}</pre>
        {command.aggregatedOutput ? (
          <pre className="card-output">{command.aggregatedOutput}</pre>
        ) : null}
      </div>
    );
  }

  const fileChange = itemPayload(item, "fileChange");
  if (fileChange) {
    return (
      <div className="card card-file-change">
        <div className="card-label">File changes · {fileChange.status}</div>
        {fileChange.changes.map((change) => (
          <div key={change.path} className="file-change">
            <div className="file-change-path">
              {change.path}{" "}
              <span className="file-change-kind">({patchChangeKindLabel(change.kind)})</span>
            </div>
            {change.diff ? <pre className="card-output">{change.diff}</pre> : null}
          </div>
        ))}
      </div>
    );
  }

  const webSearch = itemPayload(item, "webSearch");
  if (webSearch) {
    return (
      <div className="card card-tool">
        <div className="card-label">Web search · {webSearch.status}</div>
        {webSearch.query ? <div className="card-body">“{webSearch.query}”</div> : null}
      </div>
    );
  }

  const mcp = itemPayload(item, "mcpToolCall");
  if (mcp) {
    const images = mcpImageContent(mcp.result);
    return (
      <div className="card card-tool">
        <div className="card-label">
          Tool · {mcp.server} / {mcp.tool} · {mcp.status}
        </div>
        {mcp.error?.message ? <div className="card-body">{mcp.error.message}</div> : null}
        {images.map((image, index) => (
          <figure className="generated-image-frame" key={`${image.mimeType}:${index}`}>
            <img
              className="generated-image"
              src={image.dataUrl}
              alt={`Image returned by ${mcp.tool}`}
              loading="lazy"
              decoding="async"
            />
          </figure>
        ))}
      </div>
    );
  }

  const collab = itemPayload(item, "collabAgentToolCall");
  if (collab) {
    return (
      <div className="card card-tool">
        <div className="card-label">
          Agent tool · {collab.tool} · {collab.status}
        </div>
      </div>
    );
  }

  const sleep = itemPayload(item, "sleep");
  if (sleep) {
    return <div className="card card-tool">Paused{sleep.reason ? `: ${sleep.reason}` : ""}</div>;
  }

  const imageGeneration = itemPayload(item, "imageGeneration");
  if (imageGeneration) {
    const imageUrl = imageGenerationDataUrl(imageGeneration.result);
    return (
      <div className="card card-tool card-image-generation">
        <div className="card-label">Image generation · {imageGeneration.status}</div>
        {imageUrl ? (
          <figure className="generated-image-frame">
            <img
              className="generated-image"
              src={imageUrl}
              alt={imageGeneration.revisedPrompt ?? "Generated image"}
              loading="lazy"
              decoding="async"
            />
            {imageGeneration.revisedPrompt ? (
              <figcaption className="generated-image-caption">
                {imageGeneration.revisedPrompt}
              </figcaption>
            ) : null}
          </figure>
        ) : null}
      </div>
    );
  }

  if (itemPayload(item, "contextCompaction")) {
    return <div className="card card-tool">Context compacted.</div>;
  }
  if (itemPayload(item, "enteredReviewMode")) {
    return <div className="card card-tool">Entered review mode.</div>;
  }
  if (itemPayload(item, "exitedReviewMode")) {
    return <div className="card card-tool">Exited review mode.</div>;
  }

  return (
    <div className="card card-fallback">
      <div className="card-label">Item</div>
      <pre className="card-json">{JSON.stringify(item, null, 2)}</pre>
    </div>
  );
}

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="card-body markdown">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

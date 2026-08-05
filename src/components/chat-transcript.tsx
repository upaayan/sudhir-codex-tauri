import ReactMarkdown from "react-markdown";

import {
  isUnknownItem,
  itemId,
  itemPayload,
  type ThreadItem,
} from "../codex-types.ts";
import type { ThreadState, TranscriptEntry } from "../codex-state.ts";

interface Props {
  thread: ThreadState | null;
}

export function ChatTranscript({ thread }: Props) {
  if (!thread) {
    return <div className="transcript transcript-empty">Select a thread to begin.</div>;
  }
  if (thread.entries.length === 0) {
    return <div className="transcript transcript-empty">No messages yet.</div>;
  }
  return (
    <div className="transcript">
      {thread.turnError && thread.turnStatus === "failed" && (
        <div className="card card-error">
          <div className="card-label">Turn failed</div>
          <div className="card-body">{thread.turnError.message}</div>
        </div>
      )}
      {thread.entries.map((entry) => (
        <TranscriptCard key={entry.kind === "unsupportedRequest" ? String(entry.requestId) : itemId(entry.item)} entry={entry} />
      ))}
    </div>
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
  return <ItemCard item={entry.item} />;
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
    const text = userMessage.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
    return (
      <div className="card card-user">
        <div className="card-label">You</div>
        <MarkdownBody text={text || "(attachment)"} />
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
    return (
      <details className="card card-reasoning">
        <summary className="card-label">Reasoning</summary>
        {reasoning.summary.map((part, index) => (
          <p key={index} className="card-body">
            {part}
          </p>
        ))}
      </details>
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
              {change.path} <span className="file-change-kind">({change.kind})</span>
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
    return (
      <div className="card card-tool">
        <div className="card-label">
          Tool · {mcp.server} / {mcp.tool} · {mcp.status}
        </div>
        {mcp.error?.message ? <div className="card-body">{mcp.error.message}</div> : null}
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
    return (
      <div className="card card-tool">
        <div className="card-label">Image generation · {imageGeneration.status}</div>
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

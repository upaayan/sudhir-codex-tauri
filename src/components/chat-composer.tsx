import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { mergeAttachments, type Attachment } from "../attachments.ts";
import {
  getComposerPresentation,
  resizeComposerTextarea,
} from "../composer-state.ts";

interface Props {
  disabled: boolean;
  busy: boolean;
  onSend: (text: string, attachments: Attachment[]) => Promise<void> | void;
  onInterrupt: () => void;
  // Settings pills built by the app shell; rendered into the footer row so
  // model/effort/speed live in the same line as the composer's own controls
  // while their props and disabled state stay owned by app.tsx.
  settings?: ReactNode;
}

export function ChatComposer({ disabled, busy, onSend, onInterrupt, settings }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const presentation = getComposerPresentation(busy);

  useLayoutEffect(() => {
    if (textareaRef.current) {
      resizeComposerTextarea(textareaRef.current);
    }
  }, [text]);

  const addPaths = useCallback(async (paths: string[]) => {
    if (disabled || paths.length === 0) {
      return;
    }
    try {
      const prepared = await invoke<Attachment[]>("prepare_attachment_paths", { paths });
      setAttachments((current) => mergeAttachments(current, prepared));
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(`Could not attach files: ${String(error)}`);
    }
  }, [disabled]);

  useEffect(() => {
    if (!runningInTauri()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setDragging(!disabled);
        return;
      }
      setDragging(false);
      if (event.payload.type === "drop") {
        void addPaths(event.payload.paths);
      }
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    }).catch(() => {
      // Native drag/drop is unavailable in a plain browser preview. The native
      // file picker remains available in the packaged Tauri app.
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addPaths, disabled]);

  async function pickAttachments() {
    if (disabled) {
      return;
    }
    try {
      const picked = await invoke<Attachment[]>("pick_attachment_files");
      setAttachments((current) => mergeAttachments(current, picked));
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(`Could not attach files: ${String(error)}`);
    }
  }

  async function submit() {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled) {
      return;
    }
    try {
      await onSend(trimmed, attachments);
      setText("");
      setAttachments([]);
      setAttachmentError(null);
    } catch {
      // Keep the message and attachments so the user can retry. App-level
      // send handlers surface the rejection in the diagnostic banner.
    }
  }

  return (
    <div className={`composer${dragging ? " is-dragging" : ""}`}>
      {dragging ? <div className="drop-hint">Drop images or documents to attach</div> : null}
      {attachments.length > 0 ? (
        <div className="composer-attachments" aria-label="Pending attachments">
          {attachments.map((attachment) => (
            <span className="attachment-chip removable" key={attachment.backendPath} title={attachment.displayPath}>
              <span className="attachment-kind" aria-hidden="true">
                {attachment.kind === "image" ? "IMG" : "DOC"}
              </span>
              <span className="attachment-name">{attachment.name}</span>
              <button
                type="button"
                className="attachment-remove"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => setAttachments((current) =>
                  current.filter((candidate) => candidate.backendPath !== attachment.backendPath))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={text}
        disabled={disabled}
        placeholder={presentation.placeholder}
        aria-label="Message"
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {attachmentError ? (
        <div className="composer-error" role="alert">{attachmentError}</div>
      ) : null}
      <div className="composer-actions">
        <button
          type="button"
          className="button icon-button attach-button"
          onClick={pickAttachments}
          disabled={disabled}
          aria-label="Attach images or documents"
          title="Attach images or documents"
        >
          <PaperclipIcon />
        </button>
        {settings}
        <div className="composer-turn-actions">
          <ActionButton
            busy={busy}
            hasDraft={Boolean(text.trim()) || attachments.length > 0}
            disabled={disabled}
            submitLabel={presentation.submitLabel}
            onSubmit={submit}
            onInterrupt={onInterrupt}
          />
        </div>
      </div>
    </div>
  );
}

// One button, three faces: Send (idle, needs a draft), Working/Stop (busy,
// empty draft — pulses; click interrupts), Steer (busy with a draft).
function ActionButton({
  busy,
  hasDraft,
  disabled,
  submitLabel,
  onSubmit,
  onInterrupt,
}: {
  busy: boolean;
  hasDraft: boolean;
  disabled: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onInterrupt: () => void;
}) {
  if (busy && !hasDraft) {
    return (
      <button
        type="button"
        className="send-button is-working"
        onClick={onInterrupt}
        aria-label="Working — click to stop"
        title="Working — click to stop the turn"
      >
        <StopGlyph />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="send-button"
      onClick={onSubmit}
      disabled={disabled || !hasDraft}
      aria-label={submitLabel}
      title={busy ? "Steer the running turn" : "Send message"}
    >
      <SendIcon />
    </button>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="7.5" y="7.5" width="9" height="9" rx="2" fill="currentColor" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M12 19V6m0 0-6 6m6-6 6 6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </svg>
  );
}


function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M8.5 12.5 15 6a3.5 3.5 0 0 1 5 5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8-8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function runningInTauri(): boolean {
  return Boolean((globalThis as typeof globalThis & { isTauri?: boolean }).isTauri);
}

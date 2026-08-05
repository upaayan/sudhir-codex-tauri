import { useState } from "react";

interface Props {
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export function ChatComposer({ disabled, busy, onSend, onInterrupt }: Props) {
  const [text, setText] = useState("");

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setText("");
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        disabled={disabled}
        placeholder={busy ? "Turn in progress…" : "Message sudhir-codex"}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-actions">
        {busy ? (
          <button type="button" className="button" onClick={onInterrupt}>
            Interrupt
          </button>
        ) : (
          <button type="button" className="button primary" onClick={submit} disabled={disabled || !text.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

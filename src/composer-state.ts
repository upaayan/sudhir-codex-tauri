export interface ComposerPresentation {
  placeholder: string;
  submitLabel: string;
}

export interface ComposerTextareaMetrics {
  value: string;
  scrollHeight: number;
  offsetHeight: number;
  clientHeight: number;
  style: {
    height: string;
    overflowY: string;
  };
}

export const COMPOSER_MAX_HEIGHT_PX = 220;

export function getComposerPresentation(busy: boolean): ComposerPresentation {
  // The placeholder stays constant: turn status is signalled by the working
  // dot, the Stop button, and the Send/Steer label instead of placeholder flips.
  return {
    placeholder: "Type your request…",
    submitLabel: busy ? "Steer" : "Send",
  };
}

export function resizeComposerTextarea(textarea: ComposerTextareaMetrics): void {
  // An empty composer keeps its natural rows-based height. This also avoids
  // measuring during the first mount, when the surrounding flex/grid width may
  // not have settled yet and a wrapped placeholder inflates scrollHeight.
  if (textarea.value.length === 0) {
    textarea.style.height = "";
    textarea.style.overflowY = "hidden";
    return;
  }
  const borderHeight = Math.max(0, textarea.offsetHeight - textarea.clientHeight);
  textarea.style.height = "0px";
  const contentHeight = textarea.scrollHeight + borderHeight;
  textarea.style.height = `${Math.min(contentHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  textarea.style.overflowY = contentHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
}

import type { UserInput } from "./codex-types.ts";

export type AttachmentKind = "image" | "document";

export interface Attachment {
  displayPath: string;
  backendPath: string;
  name: string;
  kind: AttachmentKind;
}

export interface UserMessagePresentation {
  text: string;
  attachments: Attachment[];
}

const DOCUMENT_CONTEXT_PREFIX = "Attached document (read this local file with available tools): ";
const TITLE_LIMIT = 64;

export function buildTurnInput(text: string, attachments: Attachment[]): UserInput[] {
  const input: UserInput[] = [];
  const message = text.trim();
  if (message) {
    input.push({ type: "text", text: message });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      input.push({ type: "localImage", path: attachment.backendPath });
      continue;
    }
    input.push({
      type: "text",
      text: `${DOCUMENT_CONTEXT_PREFIX}${JSON.stringify({
        name: attachment.name,
        path: attachment.backendPath,
      })}`,
    });
  }
  return input;
}

export function userMessagePresentation(content: UserInput[]): UserMessagePresentation {
  const textParts: string[] = [];
  const attachments: Attachment[] = [];
  for (const part of content) {
    if (part.type === "localImage") {
      attachments.push(attachmentFromPersistedPath(part.path, "image"));
      continue;
    }
    if (part.type === "image") {
      attachments.push({
        displayPath: part.url,
        backendPath: part.url,
        name: "Image",
        kind: "image",
      });
      continue;
    }
    if (part.type !== "text") {
      continue;
    }
    const document = parseDocumentContext(part.text);
    if (document) {
      attachments.push(attachmentFromPersistedPath(document.path, "document", document.name));
    } else if (part.text.trim()) {
      textParts.push(part.text.trim());
    }
  }
  return { text: textParts.join("\n"), attachments };
}

export function deriveThreadTitle(text: string, attachments: Attachment[]): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const candidate = normalized || (attachments[0] ? `Review ${attachments[0].name}` : "New thread");
  if (candidate.length <= TITLE_LIMIT) {
    return candidate;
  }
  const clipped = candidate.slice(0, TITLE_LIMIT - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > TITLE_LIMIT / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

export function mergeAttachments(
  current: Attachment[],
  incoming: Attachment[],
): Attachment[] {
  const paths = new Set(current.map((attachment) => attachment.backendPath));
  const merged = [...current];
  for (const attachment of incoming) {
    if (!paths.has(attachment.backendPath)) {
      paths.add(attachment.backendPath);
      merged.push(attachment);
    }
  }
  return merged;
}

function parseDocumentContext(text: string): { name: string; path: string } | null {
  if (!text.startsWith(DOCUMENT_CONTEXT_PREFIX)) {
    return null;
  }
  try {
    const value = JSON.parse(text.slice(DOCUMENT_CONTEXT_PREFIX.length)) as Record<string, unknown>;
    if (typeof value.name === "string" && typeof value.path === "string") {
      return { name: value.name, path: value.path };
    }
  } catch {
    // Treat malformed transport text as ordinary user-visible text.
  }
  return null;
}

function attachmentFromPersistedPath(
  path: string,
  kind: AttachmentKind,
  name = fileName(path),
): Attachment {
  return {
    displayPath: path,
    backendPath: path,
    name,
    kind,
  };
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

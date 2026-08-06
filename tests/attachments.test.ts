import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTurnInput,
  deriveThreadTitle,
  mergeAttachments,
  userMessagePresentation,
  type Attachment,
} from "../src/attachments.ts";

const image: Attachment = {
  displayPath: "/Users/me/Desktop/photo.png",
  backendPath: "/Users/me/Desktop/photo.png",
  name: "photo.png",
  kind: "image",
};

const document: Attachment = {
  displayPath: "/Users/me/Desktop/report.pdf",
  backendPath: "/Users/me/Desktop/report.pdf",
  name: "report.pdf",
  kind: "document",
};

test("buildTurnInput sends images natively and documents as readable local paths", () => {
  const input = buildTurnInput("Compare these", [image, document]);

  assert.deepEqual(input.slice(0, 2), [
    { type: "text", text: "Compare these" },
    { type: "localImage", path: image.backendPath },
  ]);
  assert.equal(input[2]?.type, "text");
  assert.match(input[2]?.type === "text" ? input[2].text : "", /report\.pdf/);
  assert.match(input[2]?.type === "text" ? input[2].text : "", /\/Users\/me\/Desktop\/report\.pdf/);
});

test("attachment-only messages still produce valid turn input", () => {
  assert.deepEqual(buildTurnInput("", [image]), [
    { type: "localImage", path: image.backendPath },
  ]);
  assert.equal(buildTurnInput("", [document]).length, 1);
});

test("user message presentation hides document transport text and shows attachment chips", () => {
  const presentation = userMessagePresentation(buildTurnInput("Review this", [image, document]));

  assert.equal(presentation.text, "Review this");
  assert.deepEqual(
    presentation.attachments.map(({ name, kind }) => ({ name, kind })),
    [
      { name: "photo.png", kind: "image" },
      { name: "report.pdf", kind: "document" },
    ],
  );
});

test("deriveThreadTitle uses the first prompt and has an attachment fallback", () => {
  assert.equal(
    deriveThreadTitle("  Review   the attached quarterly report and summarize risks.  ", [document]),
    "Review the attached quarterly report and summarize risks.",
  );
  assert.equal(deriveThreadTitle("", [document]), "Review report.pdf");
  assert.equal(
    deriveThreadTitle(
      "This is a deliberately long request whose title needs to stop cleanly before overflowing the sidebar",
      [],
    ),
    "This is a deliberately long request whose title needs to stop…",
  );
});

test("mergeAttachments removes duplicate native paths", () => {
  assert.deepEqual(mergeAttachments([image], [image, document]), [image, document]);
});

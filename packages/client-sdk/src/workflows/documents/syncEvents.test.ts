import { expect, test } from "bun:test";
import { hasDocumentUpdateEvent } from "./sync";

test("hasDocumentUpdateEvent detects matching document update events", () => {
  expect(
    hasDocumentUpdateEvent(
      [
        {
          documentId: "document-1",
          id: "event-1",
          type: "document_update_created",
          containerIds: ["container-1"],
        },
      ],
      "document-1",
    ),
  ).toBe(true);
  expect(
    hasDocumentUpdateEvent(
      [
        {
          documentId: "document-2",
          id: "event-2",
          type: "document_update_created",
          containerIds: ["container-1"],
        },
      ],
      "document-1",
    ),
  ).toBe(false);
  expect(
    hasDocumentUpdateEvent(
      [
        {
          documentId: "document-1",
          id: "event-3",
          type: "other_event",
        },
      ],
      "document-1",
    ),
  ).toBe(false);
  expect(
    hasDocumentUpdateEvent(
      [
        {
          documentId: "document-1",
          id: "event-4",
          type: "document_update_created",
          containerIds: ["container-1"],
        },
      ],
      null,
    ),
  ).toBe(false);
});

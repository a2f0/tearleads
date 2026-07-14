import { expect, test } from "bun:test";
import {
  documentInfoRefreshKey,
  subscribeDocumentSyncCompletions,
} from "./documentInfo";

test("document info refreshes only for the selected document's latest relevant event", () => {
  const events = [
    {
      documentId: "document-1",
      id: "update-1",
      type: "document_update_created",
    },
    {
      documentId: "document-2",
      id: "update-2",
      type: "document_update_created",
    },
    {
      documentId: "document-1",
      id: "attachment-1",
      type: "blob_attachment_created",
    },
    {
      documentId: "document-1",
      id: "mutation-1",
      type: "document_mutation_created",
    },
  ];

  expect(documentInfoRefreshKey(events, "document-1")).toBe("mutation-1");
  expect(documentInfoRefreshKey(events, "document-2")).toBe("update-2");
  expect(documentInfoRefreshKey(events, "document-3")).toBe("");
  expect(documentInfoRefreshKey(events, null)).toBe("");
});

test("an unrelated event appended after a relevant event keeps its request generation", () => {
  const relevant = {
    documentId: "document-1",
    id: "update-1",
    type: "document_update_created",
  };

  expect(documentInfoRefreshKey([relevant], "document-1")).toBe("update-1");
  expect(
    documentInfoRefreshKey(
      [
        relevant,
        {
          documentId: "document-2",
          id: "update-2",
          type: "document_update_created",
        },
      ],
      "document-1",
    ),
  ).toBe("update-1");
});

test("a local document projection revision advances the request generation", () => {
  const events = [
    {
      documentId: "document-1",
      id: "update-1",
      type: "document_update_created",
    },
  ];

  expect(
    documentInfoRefreshKey(events, "document-1", "2026-07-14T12:00:00.000Z"),
  ).toBe("2026-07-14T12:00:00.000Z\u0000update-1");
  expect(
    documentInfoRefreshKey([], "document-1", "2026-07-14T12:00:01.000Z"),
  ).toBe("2026-07-14T12:00:01.000Z");
  expect(documentInfoRefreshKey([], "document-1", null, 3)).toBe(
    "\u0000sync:3",
  );
});

test("document sync completion emits only on a syncing-to-idle transition", () => {
  let listener: () => void = () => undefined;
  let syncing = false;
  let completions = 0;
  const unsubscribe = subscribeDocumentSyncCompletions(
    {
      getSnapshot: () => ({ syncing }),
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => {
          listener = () => undefined;
        };
      },
    },
    () => {
      completions += 1;
    },
  );

  listener();
  syncing = true;
  listener();
  expect(completions).toBe(0);
  syncing = false;
  listener();
  listener();
  expect(completions).toBe(1);
  unsubscribe();
});

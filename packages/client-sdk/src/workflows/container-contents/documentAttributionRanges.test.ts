import { expect, test } from "bun:test";
import type { ListDocumentEditAttributionRangesResponse } from "@symcrypt/validators/response";
import { loadDocumentAttributionRanges } from "./documentAttributionRanges";

test("loadDocumentAttributionRanges forwards pagination and returns the page", async () => {
  const response: ListDocumentEditAttributionRangesResponse = {
    attributionRevision: 9,
    documentId: "document-1",
    hasMore: false,
    items: [
      {
        authorityKind: "baseline",
        endCounter: 8,
        peerId: "peer-1",
        startCounter: 2,
        updateId: "update-1",
        writerKeyFingerprint: "fingerprint-1",
        writerUserId: "user-1",
      },
    ],
    nextCursor: null,
  };
  const calls: unknown[] = [];

  await expect(
    loadDocumentAttributionRanges({
      apiClient: {
        listDocumentEditAttributionRanges: (documentId, options) => {
          calls.push({ documentId, options });
          return Promise.resolve(response);
        },
      },
      query: {
        cursor: "page-2",
        documentId: "document-1",
        expectedRevision: 9,
        limit: 50,
      },
    }),
  ).resolves.toEqual(response);
  expect(calls).toEqual([
    {
      documentId: "document-1",
      options: { cursor: "page-2", expectedRevision: 9, limit: 50 },
    },
  ]);
});

test("loadDocumentAttributionRanges surfaces unavailable pages", async () => {
  await expect(
    loadDocumentAttributionRanges({
      apiClient: {
        listDocumentEditAttributionRanges: () => Promise.resolve(null),
      },
      query: { documentId: "document-1" },
    }),
  ).rejects.toThrow(
    "Edit attribution ranges were unavailable for document document-1.",
  );
});

test("loadDocumentAttributionRanges rejects a page for another document", async () => {
  await expect(
    loadDocumentAttributionRanges({
      apiClient: {
        listDocumentEditAttributionRanges: () =>
          Promise.resolve({
            attributionRevision: 1,
            documentId: "document-2",
            hasMore: false,
            items: [],
            nextCursor: null,
          }),
      },
      query: { documentId: "document-1" },
    }),
  ).rejects.toThrow(
    "Edit attribution ranges belonged to document document-2, not document-1.",
  );
});

import { expect, test } from "bun:test";
import type {
  DocumentAttributionRangesInput,
  DocumentAttributionRangesPage,
} from "@tearleads/client-sdk";
import { loadAllDocumentAttributionRanges } from "./useDocumentAttributionRanges";

function range(
  updateId: string,
): DocumentAttributionRangesPage["items"][number] {
  return {
    authorityKind: "direct",
    createdAt: "2030-01-01T10:00:00.000Z",
    endCounter: 1,
    peerId: "7",
    signedAt: "2030-01-01T09:59:59.000Z",
    startCounter: 0,
    updateId,
    writerKeyFingerprint: "fingerprint-1",
    writerUserId: "user-1",
  };
}

/** Pages of one range each, as many as `pageCount`, at one revision. */
function pagedRanges(pageCount: number) {
  const requests: DocumentAttributionRangesInput[] = [];
  return {
    containerContents: {
      loadDocumentAttributionRanges: async (
        input: DocumentAttributionRangesInput,
      ): Promise<DocumentAttributionRangesPage> => {
        requests.push(input);
        const page = input.cursor ? Number(input.cursor) : 0;
        const hasMore = page + 1 < pageCount;
        return {
          attributionRevision: 12,
          documentId: input.documentId,
          hasMore,
          items: [range(`update-${page}`)],
          nextCursor: hasMore ? String(page + 1) : null,
        };
      },
    },
    requests,
  };
}

test("every page is read, each bound to the first page's revision", async () => {
  const api = pagedRanges(3);

  const ranges = await loadAllDocumentAttributionRanges(
    api.containerContents,
    "document-1",
  );

  expect(ranges?.map((item) => item.updateId)).toEqual([
    "update-0",
    "update-1",
    "update-2",
  ]);
  expect(api.requests).toEqual([
    {
      cursor: null,
      documentId: "document-1",
      expectedRevision: undefined,
      limit: 500,
    },
    // A document that gains an upload mid-read fails these pages rather
    // than mix two histories.
    { cursor: "1", documentId: "document-1", expectedRevision: 12, limit: 500 },
    { cursor: "2", documentId: "document-1", expectedRevision: 12, limit: 500 },
  ]);
});

test("a document with one page costs one request", async () => {
  const api = pagedRanges(1);

  expect(
    await loadAllDocumentAttributionRanges(api.containerContents, "document-1"),
  ).toHaveLength(1);
  expect(api.requests).toHaveLength(1);
});

test("a document with too many uploads is read as having none", async () => {
  const api = pagedRanges(Number.POSITIVE_INFINITY);

  // Part of the list would date or credit a change from whichever uploads
  // happened to be read.
  expect(
    await loadAllDocumentAttributionRanges(api.containerContents, "document-1"),
  ).toBeNull();
  expect(api.requests).toHaveLength(40);
});

test("a read nobody is waiting for stops before its next page", async () => {
  const api = pagedRanges(5);
  let wanted = true;

  const ranges = await loadAllDocumentAttributionRanges(
    {
      loadDocumentAttributionRanges: async (input) => {
        const page =
          await api.containerContents.loadDocumentAttributionRanges(input);
        // The request is superseded while its second page is in flight.
        if (api.requests.length === 2) wanted = false;
        return page;
      },
    },
    "document-1",
    () => wanted,
  );

  expect(ranges).toBeNull();
  expect(api.requests).toHaveLength(2);
});

test("a failed page fails the read", async () => {
  const api = pagedRanges(3);
  const containerContents = {
    loadDocumentAttributionRanges: async (
      input: DocumentAttributionRangesInput,
    ) => {
      if (input.cursor === "1") throw new Error("stale attribution revision");
      return api.containerContents.loadDocumentAttributionRanges(input);
    },
  };

  await expect(
    loadAllDocumentAttributionRanges(containerContents, "document-1"),
  ).rejects.toThrow("stale attribution revision");
});

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
          voidUpdateIds: [],
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

  expect(ranges?.ranges.map((item) => item.updateId)).toEqual([
    "update-0",
    "update-1",
    "update-2",
  ]);
  expect(ranges).toMatchObject({ revision: 12, status: "complete" });
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

  const read = await loadAllDocumentAttributionRanges(
    api.containerContents,
    "document-1",
  );
  expect(read?.ranges).toHaveLength(1);
  expect(api.requests).toHaveLength(1);
});

test("a document with too many uploads is read as having none", async () => {
  const api = pagedRanges(Number.POSITIVE_INFINITY);

  // Part of the list would date a change from whichever uploads happened to
  // be read.
  const read = await loadAllDocumentAttributionRanges(
    api.containerContents,
    "document-1",
  );
  expect(read).toEqual({ ranges: [], status: "tooMany" });
  expect(api.requests).toHaveLength(40);

  // Found once, it stands for the document and session: uploads only add
  // ranges, so it is not asked about again, whatever the revision.
  api.requests.length = 0;
  expect(
    await loadAllDocumentAttributionRanges(
      api.containerContents,
      "document-1",
      { held: read },
    ),
  ).toBe(read);
  expect(api.requests).toHaveLength(0);
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
    { isCurrent: () => wanted },
  );

  expect(ranges).toBeNull();
  expect(api.requests).toHaveLength(2);
});

test("a document nothing was uploaded to since costs one request", async () => {
  const api = pagedRanges(3);
  const held = await loadAllDocumentAttributionRanges(
    api.containerContents,
    "document-1",
  );
  if (held === null) throw new Error("the first read failed");
  api.requests.length = 0;

  const again = await loadAllDocumentAttributionRanges(
    api.containerContents,
    "document-1",
    { held },
  );

  // The same revision and first update: what is held is still everything.
  // One range is enough to tell.
  expect(again).toBe(held);
  expect(api.requests).toEqual([
    {
      cursor: null,
      documentId: "document-1",
      expectedRevision: undefined,
      limit: 1,
    },
  ]);
});

test("a document that gained an upload is read again in full", async () => {
  const api = pagedRanges(2);
  const stale = {
    firstUpdateId: "update-0",
    ranges: [range("update-0")],
    revision: 11,
    status: "complete" as const,
    voidUpdateIds: [],
  };

  const read = await loadAllDocumentAttributionRanges(
    api.containerContents,
    "document-1",
    { held: stale },
  );

  expect(read?.ranges.map((item) => item.updateId)).toEqual([
    "update-0",
    "update-1",
  ]);
  expect(read).toMatchObject({ revision: 12, status: "complete" });
  // The probe's range is kept, and the read goes on from it in full pages.
  expect(
    api.requests.map(({ cursor, expectedRevision, limit }) => ({
      cursor,
      expectedRevision,
      limit,
    })),
  ).toEqual([
    { cursor: null, expectedRevision: undefined, limit: 1 },
    { cursor: "1", expectedRevision: 12, limit: 500 },
  ]);
  // The same revision under another first update is another history.
  const other = {
    firstUpdateId: "update-x",
    ranges: [range("update-x")],
    revision: 12,
    status: "complete" as const,
    voidUpdateIds: [],
  };
  expect(
    (
      await loadAllDocumentAttributionRanges(
        api.containerContents,
        "document-1",
        { held: other },
      )
    )?.ranges,
  ).toHaveLength(2);
});

test("a read is read again once this device voids an update it showed", async () => {
  const api = pagedRanges(2);
  const held = await loadAllDocumentAttributionRanges(
    api.containerContents,
    "document-1",
  );
  if (held === null) throw new Error("the first read failed");
  // The same revision and first update, but the device has since voided
  // update-1: the held read still credits it.
  const voided = {
    loadDocumentAttributionRanges: async (
      input: DocumentAttributionRangesInput,
    ): Promise<DocumentAttributionRangesPage> => {
      const page =
        await api.containerContents.loadDocumentAttributionRanges(input);
      return {
        ...page,
        items: page.items.filter((item) => item.updateId !== "update-1"),
        voidUpdateIds: ["update-1"],
      };
    },
  };

  const read = await loadAllDocumentAttributionRanges(voided, "document-1", {
    held,
  });

  expect(read).not.toBe(held);
  expect(read).toMatchObject({
    status: "complete",
    voidUpdateIds: ["update-1"],
  });
  expect(read?.ranges.map((item) => item.updateId)).toEqual(["update-0"]);
});

/** `total` ranges served as many at a time as asked for, at one revision. */
function servedRanges(total: number) {
  return {
    loadDocumentAttributionRanges: async (
      input: DocumentAttributionRangesInput,
    ): Promise<DocumentAttributionRangesPage> => {
      const offset = input.cursor ? Number(input.cursor) : 0;
      const end = Math.min(total, offset + (input.limit ?? 100));
      const items = Array.from({ length: end - offset }, (_, index) =>
        range(`update-${offset + index}`),
      );
      return {
        attributionRevision: 12,
        documentId: input.documentId,
        hasMore: end < total,
        items,
        nextCursor: end < total ? String(end) : null,
        voidUpdateIds: [],
      };
    },
  };
}

test("a refresh gives up exactly where a first read does", async () => {
  // Something was uploaded since: the refresh probes, then reads on.
  const held = {
    firstUpdateId: "update-0",
    ranges: [range("update-0")],
    revision: 11,
    status: "complete" as const,
    voidUpdateIds: [],
  };

  for (const [total, status] of [
    [20_000, "complete"],
    [20_001, "tooMany"],
  ] as const) {
    const first = await loadAllDocumentAttributionRanges(
      servedRanges(total),
      "document-1",
    );
    const refresh = await loadAllDocumentAttributionRanges(
      servedRanges(total),
      "document-1",
      { held },
    );
    expect([first?.status, refresh?.status]).toEqual([status, status]);
    expect([first?.ranges.length, refresh?.ranges.length]).toEqual(
      status === "complete" ? [total, total] : [0, 0],
    );
  }
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

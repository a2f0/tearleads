import { expect, test } from "bun:test";
import {
  discoverContainerDocuments,
  laneLister,
  nullContainerDocumentWatermarks,
} from "./documentDiscovery.testUtils";
import type { ListContainerDocumentsResponse } from "./documentDiscoveryTypes";

const watermark = { id: "doc-a", updatedAt: "2026-01-01T00:00:00.000Z" };
function page(id: string, hasMore = false): ListContainerDocumentsResponse {
  return {
    hasMore,
    items: [
      {
        id,
        createdAt: watermark.updatedAt,
        updatedAt: watermark.updatedAt,
        currentAccessEpoch: 1,
        currentAccessStateHash: "state-hash",
        linkedContainerIds: ["container"],
        referencedPrincipals: [],
      },
    ],
    nextWatermark: { ...watermark, id },
    tombstones: [],
  };
}

for (const scenario of [
  "full",
  "incremental",
  "partial",
  "invalid-continuation",
  "persistence-failure",
] as const) {
  test(`discovery publishes absence evidence only after a complete full apply: ${scenario}`, async () => {
    const listings: ReadonlyArray<string>[] = [];
    let pageCount = 0;
    let saved = false;
    const result = discoverContainerDocuments({
      ...nullContainerDocumentWatermarks,
      containerId: "container",
      loadContainerDocumentWatermark: async () =>
        scenario === "incremental"
          ? { ...watermark, id: "before-doc-a" }
          : null,
      listContainerDocumentLanes: laneLister(async () => {
        pageCount += 1;
        if (pageCount === 1) {
          return {
            ...page("doc-a", true),
            nextWatermark:
              scenario === "invalid-continuation" ? null : watermark,
          };
        }
        return scenario === "partial" ? null : page("doc-b");
      }),
      replaceDocumentLinksBatch: async () => {},
      // Local summaries are intentionally empty: only the raw complete listing
      // can prove presence, never a filtered projection or a tombstone summary.
      upsertDiscoveredDocuments: async () => [],
      recordContainerDocumentListing: async () => {
        if (scenario === "persistence-failure")
          throw new Error("disk unavailable");
        saved = true;
      },
      onFullListing: (ids) => {
        expect(saved).toBe(true);
        listings.push(ids);
      },
    });
    if (scenario === "persistence-failure") {
      await expect(result).rejects.toThrow("disk unavailable");
    } else {
      expect(await result).toEqual(
        scenario === "partial" || scenario === "invalid-continuation"
          ? null
          : [],
      );
    }
    expect(listings).toEqual(scenario === "full" ? [["doc-a", "doc-b"]] : []);
  });
}

test("an empty full listing is usable absence evidence", async () => {
  const listings: ReadonlyArray<string>[] = [];
  await discoverContainerDocuments({
    ...nullContainerDocumentWatermarks,
    containerId: "container",
    listContainerDocumentLanes: laneLister(async () => ({
      hasMore: false,
      items: [],
      nextWatermark: null,
      tombstones: [],
    })),
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
    onFullListing: (ids) => {
      listings.push(ids);
    },
  });
  expect(listings).toEqual([[]]);
});

test.each([false, true])(
  "discovery rejects a repeated cursor across distinct rows (terminal: %s)",
  async (terminal) => {
    const cursors = ["a", "b", "a"];
    const result = discoverContainerDocuments({
      ...nullContainerDocumentWatermarks,
      containerId: "container",
      listContainerDocumentLanes: laneLister(async () => {
        const cursor = cursors.shift();
        if (!cursor) throw new Error("Continuation cycle did not terminate");
        return {
          ...page(`doc-${cursors.length}`, cursors.length > 0 || !terminal),
          nextWatermark: { ...watermark, id: cursor },
        };
      }),
      replaceDocumentLinksBatch: async () => {},
      upsertDiscoveredDocuments: async () => [],
    });
    await expect(result).rejects.toThrow(
      "Document listing for container container is unavailable",
    );
  },
);

test.each([false, true])(
  "replayed document pages with newly sealed cursors are rejected (terminal: %s)",
  async (terminal) => {
    let pages = 0;
    const result = discoverContainerDocuments({
      ...nullContainerDocumentWatermarks,
      containerId: "container",
      listContainerDocumentLanes: laneLister(async () => {
        if (++pages > 2) throw new Error("Kept replaying the same page");
        return {
          ...page("same", pages === 1 || !terminal),
          nextWatermark: { ...watermark, id: `d1/cursor-${pages}` },
        };
      }),
      replaceDocumentLinksBatch: async () => {},
      upsertDiscoveredDocuments: async () => [],
    });
    await expect(result).rejects.toThrow(
      "Document listing for container container is unavailable",
    );
  },
);

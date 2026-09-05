import { expect, test } from "bun:test";
import { discoverContainerDocuments } from "./documentDiscovery";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
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
        scenario === "incremental" ? watermark : null,
      listContainerDocuments: async () => {
        pageCount += 1;
        if (pageCount === 1) {
          return {
            ...page("doc-a", true),
            nextWatermark:
              scenario === "invalid-continuation" ? null : watermark,
          };
        }
        return scenario === "partial" ? null : page("doc-b");
      },
      replaceDocumentLinksBatch: async () => {},
      // Local summaries are intentionally empty: only the raw complete listing
      // can prove presence, never a filtered projection or a tombstone summary.
      upsertDiscoveredDocuments: async () => [],
      saveContainerDocumentWatermark: async () => {
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
    listContainerDocuments: async () => ({
      hasMore: false,
      items: [],
      nextWatermark: null,
      tombstones: [],
    }),
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
    onFullListing: (ids) => {
      listings.push(ids);
    },
  });
  expect(listings).toEqual([[]]);
});

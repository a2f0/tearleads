import { expect, mock, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
} from "./documentDiscovery";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
import { createDiscoveredDocumentVerifier } from "./documentDiscoveryEvidence";
import type { DiscoverContainerDocumentsOptions } from "./documentDiscoveryTypes";

const at = "2026-09-23T00:00:00.000Z";
const candidate = {
  documentId: "doc",
  containerId: "destination",
  listedContainerIds: ["destination", "other"],
  accessEpoch: 1,
  accessStateHash: "linked-head",
  linkedContainerIds: ["destination", "other"],
  createdAt: at,
};

for (const scope of ["single", "all"] as const) {
  test(`${scope} discovery drops only pending hints for a tombstoned listing lane`, async () => {
    const { execSql, close } = await createTestExecSql(
      `pending-removal-${scope}`,
    );
    try {
      const store = createDocumentDiscoveryEvidenceStore(execSql);
      const verify = createDiscoveredDocumentVerifier(
        async () => null,
        async () => 0,
        store,
      );
      const first = await verify(
        [candidate],
        candidate.listedContainerIds,
        await store.begin(),
      );
      expect(await first.commit()).toBe(false);
      const applyTombstones = mock(async () => []);
      const options: DiscoverContainerDocumentsOptions = {
        ...nullContainerDocumentWatermarks,
        containerId: "destination",
        beginDocumentDiscovery: () => store.begin(),
        verifyDiscoveredDocuments: verify,
        listContainerDocuments: async () => ({
          hasMore: false,
          nextWatermark: { id: "doc", updatedAt: at },
          items: [],
          tombstones: candidate.listedContainerIds.map((containerId) => ({
            containerId,
            documentId: "doc",
            updatedAt: at,
          })),
        }),
        listKnownContainerDocumentPlacements: async () => [],
        applyContainerDocumentTombstones: applyTombstones,
        upsertDiscoveredDocuments: async () => [],
        replaceDocumentLinksBatch: async () => {},
      };
      const result =
        scope === "single"
          ? await discoverContainerDocuments(options)
          : await discoverAllContainerDocuments({
              ...options,
              containerIds: ["destination"],
            });
      expect(result).toEqual([]);
      expect(await store.hasPending(["destination"])).toBe(false);
      expect(await store.hasPending(["other"])).toBe(true);
      expect(applyTombstones).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });
}

test("an older listing tombstone cannot erase a newer pending discovery", async () => {
  const { execSql, close } = await createTestExecSql("pending-removal-order");
  try {
    const store = createDocumentDiscoveryEvidenceStore(execSql);
    const older = await store.begin();
    const newer = await store.begin();
    await store.stage([candidate], newer);
    const removed = [{ containerId: "destination", documentId: "doc" }];
    await store.stage([], older, removed);
    expect(await store.hasPending(["destination"])).toBe(true);
    await store.stage([], await store.begin(), removed);
    expect(await store.hasPending(["destination"])).toBe(false);
    expect(await store.hasPending(["other"])).toBe(true);
  } finally {
    close();
  }
});

import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import { createPendingUpdateRecord } from "../../../test/helpers/documentResponseFixtures";
import { withStaleDocument } from "../../../test/helpers/syncRepairBoundary";
import { syncRemoteDocument } from "./sync";
import { buildRemoteDocumentSyncPlan } from "./syncContainerRekeys";

test("the retryable plan builder cannot commit a standalone ancestor repair", async () => {
  await withStaleDocument(17, async ({ projection, sync }) => {
    let writes = 0;
    const apiClient = createMockApiClient({
      rekeyContainer: async () => {
        writes += 1;
        return null;
      },
    });
    await expect(
      buildRemoteDocumentSyncPlan({
        pendingUpdates: [createPendingUpdateRecord()],
        projection,
        regenerateQueuedCheckpoints: false,
        sync: { ...sync, apiClient },
      }),
    ).rejects.toThrow("new ancestor preparation step");
    expect(writes).toBe(0);
  });
}, 120_000);

for (const depth of [1, 17]) {
  test(`blocked organizations abandon without writes at repair depth ${depth}`, async () => {
    await withStaleDocument(depth, async ({ projection, sync }) => {
      const abandoned: string[] = [];
      let writes = 0;
      const apiClient = createMockApiClient({
        rekeyContainer: async () => {
          writes += 1;
          return null;
        },
        syncDocument: async () => {
          writes += 1;
          return null;
        },
      });
      expect(
        await syncRemoteDocument({
          ...sync,
          apiClient,
          pendingUpdates: [createPendingUpdateRecord()],
          writerProjection: projection,
          isRemoteSyncBlocked: () => true,
          onSyncAbandoned: (reason) => abandoned.push(reason),
        }),
      ).toBeNull();
      expect(abandoned).toEqual(["blocked"]);
      expect(writes).toBe(0);
    });
  }, 120_000);
}

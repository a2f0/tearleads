import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import { createPendingUpdateRecord } from "../../../test/helpers/documentResponseFixtures";
import { withStaleDocument } from "../../../test/helpers/syncRepairBoundary";
import { syncRemoteDocument } from "./sync";
import { buildRemoteDocumentSyncPlan } from "./syncContainerRekeys";
import { DOCUMENT_SYNC_TRACE_PATTERN } from "./syncTrace";

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
      const traces: string[] = [];
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
          author: { ...sync.author, organizationId: "unrelated-author-org" },
          apiClient,
          pendingUpdates: [createPendingUpdateRecord()],
          writerProjection: projection,
          isRemoteSyncBlocked: (organizationId) =>
            organizationId === sync.author.organizationId,
          onSyncTrace: (line) => traces.push(line),
          onSyncAbandoned: (reason) => abandoned.push(reason),
        }),
      ).toBeNull();
      expect(abandoned).toEqual(["blocked"]);
      expect(writes).toBe(0);
      expect(traces).toEqual([
        `document sync blocked document=${sync.documentId}`,
      ]);
      expect(DOCUMENT_SYNC_TRACE_PATTERN.test(traces[0] ?? "")).toBe(true);
    });
  }, 120_000);
}

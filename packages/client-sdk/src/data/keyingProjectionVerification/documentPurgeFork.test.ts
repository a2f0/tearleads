import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createPurgeChainFixture } from "../../../test/helpers/documentPurgeChain";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../workflows/documents/purge";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { verifyDocumentWriterProjection } from "./documentProjectionVerification";
import { runWithSecurityIncidentReporting } from "./error";

test("complete purge history conflicting with a local pin records an incident without refetching", async () => {
  const fixture = await createPurgeChainFixture();
  const original = await createMaterializedSyncFixture({
    containerId: "original-container",
    documentId: fixture.proof.documentId,
    organizationId: fixture.author.organizationId,
    userId: "original-writer",
  });
  const resolveUserKey = async (userId: string) =>
    userId === original.author.signerUserId
      ? original.resolveProjectionUserKey(userId)
      : fixture.resolveProjectionUserKey(userId);
  const database = await createTestExecSql(
    "purge-conflicting-complete-history",
  );
  const requestedFloors: (string | undefined)[] = [];
  const incidents: unknown[] = [];
  let deletions = 0;
  try {
    await verifyDocumentWriterProjection({
      execSql: database.execSql,
      projection: original.writerProjection,
      resolveUserKey,
    });
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: {
        getDocumentPurgeProof: async (_id, options) => {
          requestedFloors.push(options?.documentCheckpointManifestHash);
          // The API rejects a floor that is absent from its retained chain;
          // ApiClient maps that HTTP failure to null.
          return options ? null : fixture.proof;
        },
      },
      execSql: database.execSql,
      expectedOrganizationId: fixture.author.organizationId,
      resolveProjectionUserKey: resolveUserKey,
      onVerifiedDeletion: () => {
        deletions += 1;
      },
    });
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        {
          operation: "document.purge",
          objectKind: "document",
          objectId: fixture.proof.documentId,
        },
        () => handler({ documentId: fixture.proof.documentId }),
      ),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    expect(requestedFloors).toEqual([undefined]);
    expect(incidents).toMatchObject([{ code: "stale_predecessor" }]);
    expect(deletions).toBe(0);
    expect(
      await loadAccessManifestCheckpoint(
        database.execSql,
        "document",
        fixture.author.organizationId,
        fixture.proof.documentId,
      ),
    ).toMatchObject({
      manifestHash: original.writerProjection.documentManifest.manifestHash,
      epoch: 1,
    });
  } finally {
    database.close();
  }
});

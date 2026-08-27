import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { verifyDocumentWriterProjection } from "../../data/keyingProjectionVerification";
import { purgeRemoteDocument } from "./purge";

test("purge does not commit its proof outside atomic local teardown", async () => {
  const { author, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const proof = await createDocumentPurgeProof(author, writerProjection);
  const { close, execSql } = await createTestExecSql(
    "document-purge-atomic-teardown",
  );

  try {
    await expect(
      purgeRemoteDocument({
        apiClient: {
          getDocumentPurgeProof: async () => {
            throw new Error("Unexpected purge proof fetch");
          },
          getDocumentWriterProjectionResult: async () => ({
            data: writerProjection,
            ok: true,
          }),
          purgeDocument: async () => ({
            ...proof,
            reclaimedBlobStorageKeys: [],
          }),
        },
        author,
        documentId: writerProjection.documentId,
        execSql,
        onVerifiedPurge: () => {
          throw new Error("Atomic local teardown failed");
        },
        resolveProjectionUserKey,
      }),
    ).rejects.toThrow("Atomic local teardown failed");

    // A committed terminal checkpoint would reject this live projection.
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection: writerProjection,
        resolveUserKey: resolveProjectionUserKey,
      }),
    ).resolves.toBeDefined();
  } finally {
    close();
  }
});

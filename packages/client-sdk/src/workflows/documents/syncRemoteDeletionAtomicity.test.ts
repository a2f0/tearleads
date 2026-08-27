import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { DOCUMENT_NOT_FOUND_ERROR_CODE } from "@symcrypt/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
} from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { verifyDocumentWriterProjection } from "../../data/keyingProjectionVerification";

test("remote deletion cannot commit its purge proof without atomic teardown", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const proof = await createDocumentPurgeProof(author, writerProjection);
  const { close, execSql } = await createTestExecSql(
    "remote-deletion-atomic-teardown",
  );

  try {
    await expect(
      syncRemoteDocument({
        apiClient: {
          getDocumentPurgeProof: async () => proof,
          getDocumentWriterProjection: async () => {
            throw new Error("Unexpected writer projection fetch");
          },
          syncDocument: async () => {
            throw new Error("Expected syncDocumentResult failure");
          },
          syncDocumentResult: async () => ({
            code: DOCUMENT_NOT_FOUND_ERROR_CODE,
            message: "Document not found",
            ok: false,
            report: () => undefined,
            status: 404,
          }),
        },
        author,
        documentId: writerProjection.documentId,
        execSql,
        localVersionVector: null,
        pendingUpdates: [createPendingUpdateRecord()],
        resolveProjectionUserKey,
        resolveWriterPublicKey: async () => null,
        targetSecretKey: secretKey,
        writerProjection,
      }),
    ).rejects.toMatchObject({
      code: "missing_dependency",
      message: "Remote document deletion requires atomic local teardown",
    });

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

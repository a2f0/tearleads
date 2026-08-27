import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { DOCUMENT_NOT_FOUND_ERROR_CODE } from "@symcrypt/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
} from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";

test("purge proof for the same document id in another organization fails closed", async () => {
  const local = await createMaterializedSyncFixture();
  const foreign = await createMaterializedSyncFixture({
    documentId: local.writerProjection.documentId,
    organizationId: "organization-2",
    userId: "foreign-user",
  });
  const foreignProof = await createDocumentPurgeProof(
    foreign.author,
    foreign.writerProjection,
  );
  const deletedDocumentIds: string[] = [];
  let proofFetches = 0;
  const { close, execSql } = await createTestExecSql(
    "cross-organization-document-purge",
  );

  try {
    await expect(
      syncRemoteDocument({
        apiClient: {
          getDocumentPurgeProof: async () => {
            proofFetches += 1;
            return foreignProof;
          },
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
        author: local.author,
        documentId: local.writerProjection.documentId,
        execSql,
        localVersionVector: null,
        onRemoteDocumentDeleted: ({ documentId }) => {
          deletedDocumentIds.push(documentId);
        },
        pendingUpdates: [createPendingUpdateRecord()],
        resolveProjectionUserKey: async (userId) =>
          (await local.resolveProjectionUserKey(userId)) ??
          foreign.resolveProjectionUserKey(userId),
        resolveWriterPublicKey: async () => null,
        targetSecretKey: local.secretKey,
        writerProjection: local.writerProjection,
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });

    expect(proofFetches).toBe(1);
    expect(deletedDocumentIds).toEqual([]);
  } finally {
    close();
  }
});

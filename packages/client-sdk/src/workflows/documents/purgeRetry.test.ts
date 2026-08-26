import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { DOCUMENT_NOT_FOUND_ERROR_CODE } from "@symcrypt/validators/response";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { verifyDocumentWriterProjection } from "../../data/keyingProjectionVerification";
import { purgeRemoteDocument } from "./purge";

test("a retry after a lost successful purge response verifies the retained proof and completes", async () => {
  const { author, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const proof = await createDocumentPurgeProof(author, writerProjection);
  const { close, execSql } = await createTestExecSql(
    "document-purge-response-loss-retry",
  );
  let proofFetches = 0;
  let proofCommits = 0;

  try {
    const response = await purgeRemoteDocument({
      apiClient: {
        getDocumentPurgeProof: async () => {
          proofFetches += 1;
          return proof;
        },
        getDocumentWriterProjectionResult: async () => ({
          code: DOCUMENT_NOT_FOUND_ERROR_CODE,
          message: "Document not found",
          ok: false,
          report: () => undefined,
          status: 404,
        }),
        purgeDocument: async () => {
          throw new Error("Purge must not be submitted twice");
        },
      },
      author,
      documentId: writerProjection.documentId,
      execSql,
      onVerifiedPurge: async ({ commitPurgeProof }) => {
        await commitPurgeProof(execSql);
        proofCommits += 1;
      },
      resolveProjectionUserKey,
    });

    expect(response).toMatchObject({
      documentId: writerProjection.documentId,
      reclaimedBlobStorageKeys: [],
    });
    expect(proofFetches).toBe(1);
    expect(proofCommits).toBe(1);
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection: writerProjection,
        resolveUserKey: resolveProjectionUserKey,
      }),
    ).rejects.toMatchObject({ code: "rollback" });
  } finally {
    close();
  }
});

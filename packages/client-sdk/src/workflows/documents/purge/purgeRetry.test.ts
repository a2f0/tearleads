import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../../test/helpers/documentPurge";
import { createRemoteDocumentServiceFixture } from "../../../../test/helpers/remoteDocumentServiceFixture";
import { verifyDocumentWriterProjection } from "../../../data/keyingProjectionVerification";
import { openPrincipalPolicyBundleReader } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import { runWithSecurityIncidentReporting } from "../../../data/shared/securityIncidents";

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
    const response = await createRemoteDocumentServiceFixture({
      api: {
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
      execSql,
    }).purgeRemoteDocument({
      author,
      documentId: writerProjection.documentId,
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
        openPrincipalPolicyBundleReader,
        projection: writerProjection,
        resolveUserKey: resolveProjectionUserKey,
      }),
    ).rejects.toMatchObject({ code: "rollback" });
  } finally {
    close();
  }
});

test("a deletion hint followed by an unavailable proof preserves local data without an incident", async () => {
  const { author, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const database = await createTestExecSql("purge-hint-then-unavailable");
  let deletions = 0;
  const incidents: unknown[] = [];
  try {
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        {
          operation: "document.purge",
          objectKind: "document",
          objectId: writerProjection.documentId,
        },
        () =>
          createRemoteDocumentServiceFixture({
            api: {
              getDocumentPurgeProof: async () => null,
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
            execSql: database.execSql,
          }).purgeRemoteDocument({
            author,
            documentId: writerProjection.documentId,
            onVerifiedPurge: () => {
              deletions += 1;
            },
            resolveProjectionUserKey,
          }),
      ),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(deletions).toBe(0);
    expect(incidents).toEqual([]);
  } finally {
    database.close();
  }
});

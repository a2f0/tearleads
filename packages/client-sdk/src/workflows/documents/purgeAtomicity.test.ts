import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
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

test("purge rejects a cross-organization projection before posting", async () => {
  const local = await createMaterializedSyncFixture();
  const foreign = await createMaterializedSyncFixture({
    documentId: local.writerProjection.documentId,
    organizationId: "foreign-organization",
    userId: "foreign-user",
  });
  const { close, execSql } = await createTestExecSql(
    "document-purge-cross-organization-preflight",
  );
  let purgeCalls = 0;

  try {
    await expect(
      purgeRemoteDocument({
        apiClient: {
          getDocumentPurgeProof: async () => {
            throw new Error("Unexpected purge proof fetch");
          },
          getDocumentWriterProjectionResult: async () => ({
            data: foreign.writerProjection,
            ok: true,
          }),
          purgeDocument: async () => {
            purgeCalls += 1;
            throw new Error("Unexpected purge post");
          },
        },
        author: local.author,
        documentId: local.writerProjection.documentId,
        execSql,
        onVerifiedPurge: () => {
          throw new Error("Unexpected local teardown");
        },
        resolveProjectionUserKey: foreign.resolveProjectionUserKey,
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });

    expect(purgeCalls).toBe(0);
  } finally {
    close();
  }
});

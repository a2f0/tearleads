import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  type AccessManifestBundleWireResponse,
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  type DocumentPurgeProofResponse,
} from "@symcrypt/validators/response";
import { createContainerRevokeManifestFixture } from "../../../test/helpers/containerFixtures";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  fixtureHash,
} from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { verifyDocumentWriterProjection } from "../../data/keyingProjectionVerification";
import { enforceAccessManifestCheckpoints } from "../../data/keyingProjectionVerification/accessManifestCheckpointEnforcement";
import { loadAccessManifestCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";

test("syncRemoteDocument notifies when submit returns coded document 404", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document not found";
  const { close, execSql } = await createTestExecSql("deleted-document-sync");
  const purgeProof = await createDocumentPurgeProof(author, writerProjection);

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentPurgeProof: async () => purgeProof,
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection fetch");
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to return the failure");
      },
      syncDocumentResult: async () => ({
        code: DOCUMENT_NOT_FOUND_ERROR_CODE,
        message,
        ok: false,
        report: () => {
          reportedErrors.push(message);
        },
        status: 404,
      }),
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: async ({ commitPurgeProof, documentId }) => {
      if (!commitPurgeProof) {
        throw new Error("Expected a verified purge-proof commit");
      }
      await commitPurgeProof(execSql);
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
    writerProjection,
  });

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([writerProjection.documentId]);
  expect(reportedErrors).toEqual([]);
  await expect(
    verifyDocumentWriterProjection({
      execSql,
      projection: writerProjection,
      resolveUserKey: resolveProjectionUserKey,
    }),
  ).rejects.toMatchObject({ code: "rollback" });
  close();
});

test("signed descendant evidence reconciles a newer container checkpoint", async () => {
  const {
    author,
    projection,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const purgeProof = await createDocumentPurgeProof(author, writerProjection);
  const purgeContainerManifest = projection.path.at(-1);
  if (!purgeContainerManifest) {
    throw new Error("Expected purge container projection");
  }
  const newerContainerManifest = await createContainerRevokeManifestFixture({
    author,
    containerId: projection.containerId,
    containerKeyEpochId: "container-key-epoch-after-purge",
    eventId: "container-revoke-after-document-purge",
    keyringHash: await fixtureHash("purge-newer-container-keyring"),
    organizationId: projection.organizationId,
    predecessorBridgeHash: await fixtureHash(
      "purge-newer-container-predecessor-bridge",
    ),
    previousManifest:
      purgeContainerManifest as unknown as VerifiedContainerAccessManifest,
    signingPublicKey,
    subjectId: author.signerUserId,
    subjectType: "user",
  });
  const proofWithOrderingEvidence = {
    ...purgeProof,
    authorizingContainerCheckpointHeads: [
      newerContainerManifest as unknown as AccessManifestBundleWireResponse,
    ],
  };
  const deletedDocumentIds: string[] = [];
  const { close, execSql } = await createTestExecSql(
    "purge-proof-newer-container-checkpoint",
  );
  const syncWithProof = (proof: DocumentPurgeProofResponse) =>
    syncRemoteDocument({
      apiClient: {
        getDocumentPurgeProof: async () => proof,
        getDocumentWriterProjection: async () => {
          throw new Error("Expected getDocumentWriterProjectionResult");
        },
        getDocumentWriterProjectionResult: async () => ({
          code: DOCUMENT_NOT_FOUND_ERROR_CODE,
          message: "Document not found",
          ok: false,
          report: () => undefined,
          status: 404,
        }),
        syncDocument: async () => {
          throw new Error("Unexpected syncDocument call");
        },
      },
      author,
      documentId: writerProjection.documentId,
      execSql,
      localVersionVector: null,
      onRemoteDocumentDeleted: ({ documentId }) => {
        deletedDocumentIds.push(documentId);
      },
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey,
      resolveWriterPublicKey: async () => null,
      targetSecretKey: secretKey,
    });

  try {
    await enforceAccessManifestCheckpoints({
      execSql,
      policies: [],
      verifiedHeads: [newerContainerManifest],
      verifiedManifests: [newerContainerManifest],
    });

    await expect(syncWithProof(purgeProof)).rejects.toMatchObject({
      code: "rollback",
    });
    expect(deletedDocumentIds).toEqual([]);

    await expect(syncWithProof(proofWithOrderingEvidence)).resolves.toBeNull();

    expect(deletedDocumentIds).toEqual([writerProjection.documentId]);
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        projection.organizationId,
        projection.containerId,
      ),
    ).resolves.toMatchObject({
      epoch: newerContainerManifest.state.epoch,
      manifestHash: newerContainerManifest.manifestHash,
    });
  } finally {
    close();
  }
});

test("syncRemoteDocument rejects a coded document 404 with an invalid purge proof", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const { close, execSql } = await createTestExecSql(
    "invalid-purge-proof-sync",
  );
  const purgeProof = await createDocumentPurgeProof(author, writerProjection);

  try {
    await expect(
      syncRemoteDocument({
        apiClient: {
          getDocumentPurgeProof: async () => ({
            ...purgeProof,
            documentId: "server-substituted-document",
          }),
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
        onRemoteDocumentDeleted: ({ documentId }) => {
          deletedDocumentIds.push(documentId);
        },
        pendingUpdates: [createPendingUpdateRecord()],
        resolveProjectionUserKey,
        resolveWriterPublicKey: async () => null,
        targetSecretKey: secretKey,
        writerProjection,
      }),
    ).rejects.toMatchObject({ name: "KeyingVerificationError" });
    expect(deletedDocumentIds).toEqual([]);
  } finally {
    close();
  }
});

test("syncRemoteDocument fails closed on a bare 404 without the deletion code", async () => {
  // The destructive local teardown must never key off a bare HTTP 404:
  // proxy/tunnel error pages, deploy-skew route misses, and container-level
  // lookups all produce one without the document being deleted.
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document not found";
  const { close, execSql } = await createTestExecSql("bare-404-sync");

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection fetch");
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to return the failure");
      },
      syncDocumentResult: async () => ({
        message,
        ok: false,
        report: () => {
          reportedErrors.push(message);
        },
        status: 404,
      }),
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
    writerProjection,
  });
  close();

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([]);
  expect(reportedErrors).toEqual([message]);
});

test("syncRemoteDocument fails closed on a 404 with an unknown code", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Not found";
  const { close, execSql } = await createTestExecSql("unknown-code-404-sync");

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection fetch");
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to return the failure");
      },
      syncDocumentResult: async () => ({
        code: "some_future_code",
        message,
        ok: false,
        report: () => {
          reportedErrors.push(message);
        },
        status: 404,
      }),
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
    writerProjection,
  });
  close();

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([]);
  expect(reportedErrors).toEqual([message]);
});

test("syncRemoteDocument notifies when writer projection returns coded document 404", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document not found";
  const { close, execSql } = await createTestExecSql(
    "deleted-document-projection-sync",
  );
  const purgeProof = await createDocumentPurgeProof(author, writerProjection);

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentPurgeProof: async () => purgeProof,
      getDocumentWriterProjection: async () => {
        throw new Error("Expected getDocumentWriterProjectionResult");
      },
      getDocumentWriterProjectionResult: async () => ({
        code: DOCUMENT_NOT_FOUND_ERROR_CODE,
        message,
        ok: false,
        report: () => {
          reportedErrors.push(message);
        },
        status: 404,
      }),
      syncDocument: async () => {
        throw new Error("Unexpected syncDocument call");
      },
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
  });

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([writerProjection.documentId]);
  expect(reportedErrors).toEqual([]);
  close();
});

test("syncRemoteDocument fails closed on a bare writer-projection 404", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document manifest head missing";
  const { close, execSql } = await createTestExecSql(
    "bare-404-projection-sync",
  );

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Expected getDocumentWriterProjectionResult");
      },
      getDocumentWriterProjectionResult: async () => ({
        message,
        ok: false,
        report: () => {
          reportedErrors.push(message);
        },
        status: 404,
      }),
      syncDocument: async () => {
        throw new Error("Unexpected syncDocument call");
      },
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
  });

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([]);
  expect(reportedErrors).toEqual([message]);
  close();
});

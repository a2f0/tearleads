import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSignedSyncResponseUpdate,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { DocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { syncRemoteDocument } from "./sync";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";

async function pendingUpdate(text: string, id: string) {
  const document = await createDocument(`response-isolation:${text}`);
  document.getText("text").update(text);
  document.commit();
  const updateData = exportAllUpdates(document);
  return createPendingUpdateRecord({
    id,
    updateData: bytesToBase64(updateData),
    ...getUpdateVersionVectors(updateData),
  });
}

test("isolated validation runs before conflict recovery mutates queued rows", async () => {
  const { close, execSql } = await createTestExecSql("sync-response-isolation");
  try {
    const {
      author,
      resolveProjectionUserKey,
      secretKey,
      signingPublicKey,
      writerProjection,
    } = await createMaterializedSyncFixture();
    const updateId = "550e8400-e29b-41d4-a716-4466554400aa";
    const localUpdate = await pendingUpdate("local", updateId);
    const remoteUpdate = await pendingUpdate("remote", updateId);
    const historicalPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [remoteUpdate],
      resolveProjectionUserKey,
      targetSecretKey: secretKey,
      writerProjection,
    });
    const historicalResponse = await createSyncResponse(historicalPlan.plan);
    const responseUpdate = historicalResponse.updates[0];
    if (!responseUpdate) throw new Error("Expected a response update");
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [],
      resolveProjectionUserKey,
      targetSecretKey: secretKey,
      writerProjection,
    });
    const response = await createSyncResponse(materializedPlan.plan, {
      updates: [responseUpdate],
    });
    const isolated = new DocumentSyncUpdateIsolationError({
      cause: new Error("invalid Loro payload"),
      responseUpdate,
      stage: "loro_import",
      updateId,
    });
    let rekeyCount = 0;
    const commonInput = {
      execSql,
      materializedPlan,
      recoveryPendingUpdatesById: new Map([[updateId, localUpdate]]),
      rekeyPendingUpdate: async () => {
        rekeyCount += 1;
        return crypto.randomUUID();
      },
      resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver({
        author,
        signingPublicKey,
      }),
      response,
      targetSecretKey: secretKey,
      validateIncomingUpdates: () => undefined,
      writerProjection,
    };

    await expect(
      syncRemoteDocumentResultFromResponse({
        ...commonInput,
        validateIncomingUpdates: () => {
          throw isolated;
        },
      }),
    ).rejects.toBe(isolated);
    expect(rekeyCount).toBe(0);

    await syncRemoteDocumentResultFromResponse(commonInput);
    expect(rekeyCount).toBe(1);
  } finally {
    close();
  }
});

test("pre-auth content-key failures quarantine the batch without naming a writer", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-content-key-isolation",
  );
  try {
    const {
      author,
      resolveProjectionUserKey,
      secretKey,
      signingPublicKey,
      writerProjection,
    } = await createMaterializedSyncFixture();
    const rotatedProjection = {
      ...writerProjection,
      contentKeyBundle: {
        ...writerProjection.contentKeyBundle,
        contentKeyEpoch: writerProjection.contentKeyBundle.contentKeyEpoch + 1,
      },
    };
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      targetSecretKey: secretKey,
      writerProjection: rotatedProjection,
    });
    const currentUpdate = await createSignedSyncResponseUpdate({
      accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
      author,
      contentKeyEpoch: materializedPlan.plan.contentKeyEpoch,
      plan: materializedPlan.plan,
      targetHash: materializedPlan.plan.expectedTargetHash,
    });
    const blockedUpdate = await createSignedSyncResponseUpdate({
      accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
      author,
      contentKeyEpoch: materializedPlan.plan.contentKeyEpoch - 1,
      plan: materializedPlan.plan,
      targetHash: materializedPlan.plan.expectedTargetHash,
    });
    const response = await createSyncResponse(materializedPlan.plan, {
      acceptedOutgoingUpdateIds: [],
      updates: [currentUpdate, blockedUpdate],
    });
    const quarantined: DocumentSyncUpdateIsolationError[] = [];

    await expect(
      syncRemoteDocument({
        apiClient: {
          getDocumentWriterProjection: async () => rotatedProjection,
          syncDocument: async () => response,
        },
        author,
        documentId: rotatedProjection.documentId,
        execSql,
        localVersionVector: null,
        onIncomingUpdateIsolationFailure: (failure) => {
          quarantined.push(failure);
        },
        pendingUpdates: [],
        resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver({
          author,
          signingPublicKey,
        }),
        signedAt: "2026-04-27T00:00:00.000Z",
        targetSecretKey: secretKey,
        validateIncomingUpdates: () => undefined,
        writerProjection: rotatedProjection,
      }),
    ).rejects.toMatchObject({
      attribution: "batch",
      batchUpdateIds: [currentUpdate.id, blockedUpdate.id],
      stage: "content_key",
      updateId: null,
      writerUserId: null,
    });
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({
      attribution: "batch",
      batchUpdateIds: [currentUpdate.id, blockedUpdate.id],
      stage: "content_key",
      updateId: null,
      writerUserId: null,
    });
    expect(quarantined[0]?.cause).toMatchObject({
      code: "invalid_shape",
      name: "KeyingVerificationError",
    });
  } finally {
    close();
  }
});

test("forged pre-auth write headers cannot frame a writer", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-content-key-forged-writer",
  );
  try {
    const {
      author,
      resolveProjectionUserKey,
      secretKey,
      signingPublicKey,
      writerProjection,
    } = await createMaterializedSyncFixture();
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      resolveProjectionUserKey,
      targetSecretKey: secretKey,
      writerProjection,
    });
    const signedUpdate = await createSignedSyncResponseUpdate({
      accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
      author,
      plan: materializedPlan.plan,
      targetHash: materializedPlan.plan.expectedTargetHash,
    });
    const forgedUpdate = {
      ...signedUpdate,
      writeHeader: {
        ...signedUpdate.writeHeader,
        contentKeyEpoch: materializedPlan.plan.contentKeyEpoch + 1,
        writerKeyFingerprint: "framed-fingerprint",
        writerUserId: "framed-writer",
      },
    } as typeof signedUpdate;
    const response = await createSyncResponse(materializedPlan.plan, {
      acceptedOutgoingUpdateIds: [],
      updates: [forgedUpdate],
    });
    const quarantined: DocumentSyncUpdateIsolationError[] = [];

    await expect(
      syncRemoteDocument({
        apiClient: {
          getDocumentWriterProjection: async () => writerProjection,
          syncDocument: async () => response,
        },
        author,
        documentId: writerProjection.documentId,
        execSql,
        localVersionVector: null,
        onIncomingUpdateIsolationFailure: (failure) => {
          quarantined.push(failure);
        },
        pendingUpdates: [],
        resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver({
          author,
          signingPublicKey,
        }),
        targetSecretKey: secretKey,
        validateIncomingUpdates: () => undefined,
        writerProjection,
      }),
    ).rejects.toMatchObject({
      attribution: "batch",
      authorFingerprint: null,
      batchUpdateIds: [forgedUpdate.id],
      stage: "content_key",
      updateId: null,
      writerUserId: null,
    });
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({
      authorFingerprint: null,
      updateId: null,
      writerUserId: null,
    });
  } finally {
    close();
  }
});

test("pre-auth content-key wording preserves writer-key integrity errors", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-content-key-writer-integrity",
  );
  try {
    const { author, resolveProjectionUserKey, secretKey, writerProjection } =
      await createMaterializedSyncFixture();
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      resolveProjectionUserKey,
      targetSecretKey: secretKey,
      writerProjection,
    });
    const update = await createSignedSyncResponseUpdate({
      accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
      author,
      plan: materializedPlan.plan,
      targetHash: materializedPlan.plan.expectedTargetHash,
    });
    const response = await createSyncResponse(materializedPlan.plan, {
      acceptedOutgoingUpdateIds: [],
      updates: [update],
    });
    const integrityError = new KeyingVerificationError(
      "equivocation",
      "content-key writer identity equivocated",
    );
    let quarantineCount = 0;

    await expect(
      syncRemoteDocument({
        apiClient: {
          getDocumentWriterProjection: async () => writerProjection,
          syncDocument: async () => response,
        },
        author,
        documentId: writerProjection.documentId,
        execSql,
        localVersionVector: null,
        onIncomingUpdateIsolationFailure: () => {
          quarantineCount += 1;
        },
        pendingUpdates: [],
        resolveProjectionUserKey,
        resolveWriterPublicKey: async () => {
          throw integrityError;
        },
        targetSecretKey: secretKey,
        validateIncomingUpdates: () => undefined,
        writerProjection,
      }),
    ).rejects.toBe(integrityError);
    expect(quarantineCount).toBe(0);
  } finally {
    close();
  }
});

test("content-key recovery preserves projection integrity errors", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-content-key-projection-integrity",
  );
  try {
    const {
      author,
      resolveProjectionUserKey,
      secretKey,
      signingPublicKey,
      writerProjection,
    } = await createMaterializedSyncFixture();
    const rotatedProjection = {
      ...writerProjection,
      contentKeyBundle: {
        ...writerProjection.contentKeyBundle,
        contentKeyEpoch: writerProjection.contentKeyBundle.contentKeyEpoch + 1,
      },
    };
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      targetSecretKey: secretKey,
      writerProjection: rotatedProjection,
    });
    const historicalUpdate = await createSignedSyncResponseUpdate({
      accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
      author,
      contentKeyEpoch: materializedPlan.plan.contentKeyEpoch - 1,
      plan: materializedPlan.plan,
      targetHash: materializedPlan.plan.expectedTargetHash,
    });
    const response = await createSyncResponse(materializedPlan.plan, {
      acceptedOutgoingUpdateIds: [],
      contentKeyBundles: [
        writerProjection.contentKeyBundle,
        rotatedProjection.contentKeyBundle,
      ],
      updates: [historicalUpdate],
    });
    const integrityError = new KeyingVerificationError(
      "invalid_shape",
      "projection verification failed during historical key recovery",
    );
    let responseSubmitted = false;
    let quarantineCount = 0;

    await expect(
      syncRemoteDocument({
        apiClient: {
          getDocumentWriterProjection: async () => rotatedProjection,
          syncDocument: async () => {
            responseSubmitted = true;
            return response;
          },
        },
        author,
        documentId: rotatedProjection.documentId,
        execSql,
        localVersionVector: null,
        onIncomingUpdateIsolationFailure: () => {
          quarantineCount += 1;
        },
        pendingUpdates: [],
        resolveProjectionUserKey: async (userId) => {
          if (responseSubmitted) throw integrityError;
          return resolveProjectionUserKey(userId);
        },
        resolveWriterPublicKey: writerKeyResolver({
          author,
          signingPublicKey,
        }),
        signedAt: "2026-04-27T00:00:00.000Z",
        targetSecretKey: secretKey,
        validateIncomingUpdates: () => undefined,
        writerProjection: rotatedProjection,
      }),
    ).rejects.toBe(integrityError);
    expect(quarantineCount).toBe(0);
  } finally {
    close();
  }
});

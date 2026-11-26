import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../test/helpers/data/documentFixtures";
import { replaceEncryptedPlaintext } from "../../../../test/helpers/data/replaceEncryptedPlaintext";
import { servedUpdateFromOutgoing } from "../../../../test/helpers/data/rotationBaselineFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { decryptDocumentSyncUpdates } from "../../../data/documents/shared/crypto";
import { authorizingContainerPathRefs } from "../../../data/documents/shared/projection";
import { openDocumentContentKey } from "../../../data/documents/shared/sync/contentKeyCommitment";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { encryptRotationBaselineGroup } from "./rotationBaselineGroup";
import { signDocumentOutgoingUpdate } from "./syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

function errorCauseTree(error: unknown): unknown[] {
  const pending = [error];
  const seen = new Set<unknown>();
  const found: unknown[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    found.push(current);
    if (current instanceof AggregateError) {
      pending.push(...current.errors);
    }
    if (current instanceof Error && current.cause !== undefined) {
      pending.push(current.cause);
    }
  }
  return found;
}

test("decryptDocumentSyncUpdates verifies and decrypts content records", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);

  const decrypted = await decryptDocumentSyncUpdates({
    contentKey,
    contentKeyEpoch: materialized.plan.contentKeyEpoch,
    documentId: materialized.plan.documentId,
    organizationId: materialized.plan.organizationId,
    updates: response.updates,
  });

  expect(decrypted).toHaveLength(1);
  expect(decrypted[0]?.id).toBe("550e8400-e29b-41d4-a716-446655440444");
  const updateData = decrypted[0]?.updateData;
  if (!updateData) {
    throw new Error("Expected decrypted update data");
  }
  const reader = await createDocument("crypto-test-reader");
  importUpdates(reader, [updateData]);
  expect(getTextValue(reader)).toBe("materialized update");
  const responseUpdate = response.updates[0];
  if (!responseUpdate) {
    throw new Error("Expected a response update");
  }

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: [
        await replaceEncryptedPlaintext({
          contentKey,
          documentId: materialized.plan.documentId,
          organizationId: materialized.plan.organizationId,
          update: responseUpdate,
        }),
      ],
    }),
  ).rejects.toThrow("Document update plaintext hash mismatch");

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: update.encryptedData.replace(
          "tearleads.document.loro-update",
          "tearleads.document.loro-update.invalid",
        ),
      })),
    }),
  ).rejects.toThrow("format is invalid");

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: JSON.stringify({
          ...(JSON.parse(update.encryptedData) as Record<string, unknown>),
          version: 2,
        }),
      })),
    }),
  ).rejects.toThrow(
    "Document encrypted update version 2 is invalid; expected 1",
  );
});

test("decryptDocumentSyncUpdates identifies a poison update within a valid batch", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const poisonId = "550e8400-e29b-41d4-a716-4466554400aa";
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord(),
      createPendingUpdateRecord({ id: poisonId }),
    ],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const poisonUpdate = response.updates[1];
  if (!poisonUpdate) throw new Error("Expected a poison response update");

  let isolated: unknown;
  try {
    await decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: [
        response.updates[0] as (typeof response.updates)[number],
        await replaceEncryptedPlaintext({
          contentKey,
          documentId: materialized.plan.documentId,
          organizationId: materialized.plan.organizationId,
          update: poisonUpdate,
        }),
      ],
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.updateId).toBe(poisonId);
  expect(isolated.stage).toBe("plaintext_integrity");
  expect(isolated.writerUserId).toBe(author.signerUserId);
});

test("decryptDocumentSyncUpdates keeps multiple poison updates anonymous", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const poisonIds = [
    "550e8400-e29b-41d4-a716-4466554400aa",
    "550e8400-e29b-41d4-a716-4466554400ab",
  ];
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: poisonIds.map((id) => createPendingUpdateRecord({ id })),
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const poisonedUpdates = await Promise.all(
    response.updates.map((update) =>
      replaceEncryptedPlaintext({
        contentKey,
        documentId: materialized.plan.documentId,
        organizationId: materialized.plan.organizationId,
        update,
      }),
    ),
  );

  let isolated: unknown;
  try {
    await decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: poisonedUpdates,
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.attribution).toBe("batch");
  expect(isolated.authorFingerprint).toBeNull();
  expect(isolated.batchUpdateIds).toEqual(poisonIds);
  expect(isolated.stage).toBe("plaintext_integrity");
  expect(isolated.updateId).toBeNull();
  expect(isolated.writerUserId).toBeNull();
  const nestedCauses = errorCauseTree(isolated.cause);
  expect(nestedCauses.some(isDocumentSyncUpdateIsolationError)).toBe(false);
  const nestedMessages = nestedCauses
    .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
    .join("\n");
  expect(nestedMessages).not.toContain(author.signerUserId);
  expect(nestedMessages).not.toContain(
    poisonedUpdates[0]?.authorFingerprint ?? "missing fingerprint",
  );
});

/** A full-history snapshot as the one payload of a pending update. */
async function snapshotPendingUpdate(name: string) {
  const document = await createDocument(name);
  document.getText("text").update("snapshot state");
  document.commit();
  const snapshot = exportFullHistorySnapshot(document);
  document.free();
  return createPendingUpdateRecord({
    updateData: bytesToBase64(snapshot),
    ...getUpdateVersionVectors(snapshot),
  });
}

// A rotation baseline is its history as update blobs. A whole-history
// snapshot signed as a baseline's one segment earns no exemption: the label
// does not change what a payload must be.
test("decryptDocumentSyncUpdates rejects a snapshot labeled as a rotation baseline segment", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const { plan } = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const baselineId = crypto.randomUUID();
  const [prepared] = await encryptRotationBaselineGroup({
    baselineId,
    contentKey: await openDocumentContentKey({
      contentKey,
      contentKeyEpoch: plan.contentKeyEpoch,
      documentId: plan.documentId,
    }),
    contentKeyEpoch: plan.contentKeyEpoch,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    segments: [await snapshotPendingUpdate("baseline-snapshot-payload")],
  });
  if (!prepared) throw new Error("Expected an encrypted baseline segment");
  expect(prepared.baselineId).toBe(baselineId);
  expect(prepared.baselineSegmentCount).toBe(1);
  const served = servedUpdateFromOutgoing({
    author,
    documentId: plan.documentId,
    update: await signDocumentOutgoingUpdate({
      author,
      authorizingContainerPathRefs:
        authorizingContainerPathRefs(writerProjection),
      contentKeyEpoch: plan.contentKeyEpoch,
      documentId: plan.documentId,
      expectedLinkSetManifestHash: plan.expectedLinkSetManifestHash,
      expectedTargetHash: plan.expectedTargetHash,
      organizationId: plan.organizationId,
      signedAt: "2026-04-27T00:00:00.000Z",
      update: prepared,
    }),
    writerProjection,
  });

  let isolated: unknown;
  try {
    await decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: plan.contentKeyEpoch,
      documentId: plan.documentId,
      organizationId: plan.organizationId,
      updates: [served],
    });
  } catch (error) {
    isolated = error;
  }
  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.stage).toBe("loro_metadata");
  expect(isolated.updateId).toBe(served.id);
  expect(isolated.baselineId).toBe(baselineId);
  expect(isolated.message).toContain(
    "Document update payload is not an update blob",
  );
});

test("decryptDocumentSyncUpdates rejects a snapshot labeled as an ordinary update", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [await snapshotPendingUpdate("ordinary-snapshot-payload")],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  let isolated: unknown;
  try {
    await decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: (await createSyncResponse(materialized.plan)).updates,
    });
  } catch (error) {
    isolated = error;
  }
  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.stage).toBe("loro_metadata");
  expect(isolated.baselineId).toBeNull();
  expect(isolated.message).toContain(
    "Document update payload is not an update blob",
  );
});

// Sync voids such an update; this strict path, which a host can still call,
// fails on it.
test("decryptDocumentSyncUpdates rejects signed outer vectors that do not match the Loro payload", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        partialEndVersionVector: "AA==",
        partialStartVersionVector: "AA==",
      }),
    ],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: (await createSyncResponse(materialized.plan)).updates,
    }),
  ).rejects.toThrow("decrypted update version-vector mismatch");
});

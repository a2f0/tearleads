import { expect, test } from "bun:test";
import { computeDocumentContentKeyTargetHash } from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSignedSyncResponseUpdate,
  createSyncResponse,
} from "../../../test/helpers/documentFixtures";
import {
  isDocumentSyncUpdateIsolationError,
  validateDocumentSyncUpdateImports,
} from "../../data/documents/shared/documentSyncUpdateIsolation";
import { targetEnvelopeReference } from "../../data/documents/shared/readers";
import {
  DocumentRawHistoryUnavailableError,
  unwrapDocumentSyncResponseContentKeys,
} from "./syncContentKeys";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import { validateDecryptableRawHistorySiblings } from "./syncResponseResult";

test("decryptable poison outranks an unavailable raw-history sibling", async () => {
  const { close, execSql } = await createTestExecSql(
    "raw-history-unavailable-with-decryptable-poison",
  );
  const scratchDocument = await createDocument("mixed-raw-page-validator");
  try {
    const fixture = await createMaterializedSyncFixture();
    const currentBundle = {
      ...fixture.writerProjection.contentKeyBundle,
      contentKeyEpoch: 3,
    };
    const currentWriterProjection = {
      ...fixture.writerProjection,
      contentKeyBundle: currentBundle,
    };
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      execSql,
      historyMode: "raw",
      localVersionVector: null,
      pendingUpdates: [],
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: currentWriterProjection,
    });
    const historicalTarget = currentBundle.targets[0];
    if (!historicalTarget) {
      throw new Error("Expected a historical content-key target");
    }
    const unavailableTarget = {
      ...historicalTarget,
      containerKeyEpochId: "550e8400-e29b-41d4-a716-446655440496",
    };
    const unavailableTargetHash = await computeDocumentContentKeyTargetHash([
      targetEnvelopeReference(unavailableTarget),
    ]);
    const unavailableBundle = {
      ...currentBundle,
      contentKeyEpoch: 1,
      targetHash: unavailableTargetHash,
      targets: [unavailableTarget],
    };
    const unavailableUpdate = {
      ...(await createSignedSyncResponseUpdate({
        accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
        author: fixture.author,
        contentKeyEpoch: 1,
        id: "550e8400-e29b-41d4-a716-446655440463",
        plan: materializedPlan.plan,
        targetHash: unavailableTargetHash,
      })),
      authorizationTargets: [targetEnvelopeReference(unavailableTarget)],
    };
    const poisonedCurrentUpdate = {
      ...(await createSignedSyncResponseUpdate({
        accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
        author: fixture.author,
        contentKeyEpoch: 3,
        id: "550e8400-e29b-41d4-a716-446655440464",
        plan: materializedPlan.plan,
        targetHash: currentBundle.targetHash,
      })),
      authorizationTargets: currentBundle.targets.map(targetEnvelopeReference),
    };
    const response = await createSyncResponse(materializedPlan.plan, {
      contentKeyBundles: [unavailableBundle, currentBundle],
      updates: [unavailableUpdate, poisonedCurrentUpdate],
    });

    const error = await unwrapDocumentSyncResponseContentKeys({
      currentContentKey: materializedPlan.contentKey,
      currentContentKeyEpoch: materializedPlan.plan.contentKeyEpoch,
      execSql,
      historyMode: "raw",
      onRawHistoryUnavailable: ({ contentKeysByEpoch, updates }) =>
        validateDecryptableRawHistorySiblings({
          contentKeysByEpoch,
          documentId: materializedPlan.plan.documentId,
          organizationId: materializedPlan.plan.organizationId,
          response,
          updates,
          validateIncomingUpdates: (result) =>
            validateDocumentSyncUpdateImports({
              currentDocument: scratchDocument,
              decryptedUpdates: result.decryptedUpdates,
              responseUpdates: result.response.updates,
            }),
        }),
      response,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: currentWriterProjection,
    }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(isDocumentSyncUpdateIsolationError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(DocumentRawHistoryUnavailableError);
    if (!isDocumentSyncUpdateIsolationError(error)) return;
    expect(error.updateId).toBe(poisonedCurrentUpdate.id);
  } finally {
    scratchDocument.free();
    close();
  }
});

test("an unrelated unresolved update outranks raw-history availability", async () => {
  const { close, execSql } = await createTestExecSql(
    "raw-history-unavailable-with-unresolved-poison",
  );
  const scratchDocument = await createDocument("unresolved-raw-page-validator");
  try {
    const fixture = await createMaterializedSyncFixture();
    const currentBundle = {
      ...fixture.writerProjection.contentKeyBundle,
      contentKeyEpoch: 3,
    };
    const currentWriterProjection = {
      ...fixture.writerProjection,
      contentKeyBundle: currentBundle,
    };
    const dependencyAuthor = await createDocument("unresolved-raw-page-author");
    dependencyAuthor.getText("text").update("omitted parent");
    dependencyAuthor.commit();
    const parentVersion = encodeVersionVector(dependencyAuthor);
    dependencyAuthor.getText("text").update("unrelated child");
    dependencyAuthor.commit();
    const childData = exportUpdatesSince(dependencyAuthor, parentVersion);
    dependencyAuthor.free();
    const childVectors = getUpdateVersionVectors(childData);
    const childId = "550e8400-e29b-41d4-a716-446655440465";
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [
        createPendingUpdateRecord({
          id: childId,
          updateData: bytesToBase64(childData),
          ...childVectors,
        }),
      ],
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: currentWriterProjection,
    });
    const currentResponse = await createSyncResponse(materializedPlan.plan);
    const childUpdate = currentResponse.updates[0];
    const historicalTarget = currentBundle.targets[0];
    if (!childUpdate || !historicalTarget) {
      throw new Error("Expected current update and historical target");
    }
    const unavailableTarget = {
      ...historicalTarget,
      containerKeyEpochId: "550e8400-e29b-41d4-a716-446655440497",
    };
    const unavailableTargetHash = await computeDocumentContentKeyTargetHash([
      targetEnvelopeReference(unavailableTarget),
    ]);
    const unavailableBundle = {
      ...currentBundle,
      contentKeyEpoch: 1,
      targetHash: unavailableTargetHash,
      targets: [unavailableTarget],
    };
    const unavailableUpdate = {
      ...(await createSignedSyncResponseUpdate({
        accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
        author: fixture.author,
        contentKeyEpoch: 1,
        id: "550e8400-e29b-41d4-a716-446655440466",
        plan: materializedPlan.plan,
        targetHash: unavailableTargetHash,
      })),
      authorizationTargets: [targetEnvelopeReference(unavailableTarget)],
    };
    const response = {
      ...currentResponse,
      contentKeyBundles: [unavailableBundle, currentBundle],
      updates: [unavailableUpdate, childUpdate],
    };

    const error = await unwrapDocumentSyncResponseContentKeys({
      currentContentKey: materializedPlan.contentKey,
      currentContentKeyEpoch: materializedPlan.plan.contentKeyEpoch,
      execSql,
      historyMode: "raw",
      onRawHistoryUnavailable: ({ contentKeysByEpoch, updates }) =>
        validateDecryptableRawHistorySiblings({
          contentKeysByEpoch,
          documentId: materializedPlan.plan.documentId,
          organizationId: materializedPlan.plan.organizationId,
          response,
          updates,
          validateIncomingUpdates: (result) =>
            validateDocumentSyncUpdateImports({
              currentDocument: scratchDocument,
              decryptedUpdates: result.decryptedUpdates,
              responseUpdates: result.response.updates,
            }),
        }),
      response,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: currentWriterProjection,
    }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(isDocumentSyncUpdateIsolationError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(DocumentRawHistoryUnavailableError);
    if (!isDocumentSyncUpdateIsolationError(error)) return;
    expect(error.stage).toBe("loro_import");
    expect(error.batchUpdateIds).toEqual([childId]);
  } finally {
    scratchDocument.free();
    close();
  }
});

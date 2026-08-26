import { expect, test } from "bun:test";
import { computeDocumentContentKeyTargetHash } from "@symcrypt/crypto";
import {
  createMaterializedSyncFixture,
  createSignedSyncResponseUpdate,
  createSyncResponse,
} from "../../../test/helpers/documentFixtures";
import { isDocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { targetEnvelopeReference } from "../../data/documents/shared/readers";
import {
  DocumentRawHistoryUnavailableError,
  unwrapDocumentSyncResponseContentKeys,
} from "./syncContentKeys";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

test("tampered unavailable targets remain poison instead of availability", async () => {
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
    historyMode: "raw",
    localVersionVector: null,
    pendingUpdates: [],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: currentWriterProjection,
  });
  const historicalTarget = currentBundle.targets[0];
  if (!historicalTarget) throw new Error("Expected historical target");
  const tamperedTarget = {
    ...historicalTarget,
    containerKeyEpochId: "550e8400-e29b-41d4-a716-446655440498",
  };
  const tamperedBundle = {
    ...currentBundle,
    contentKeyEpoch: 1,
    // Deliberately retain the signed hash while substituting the target list.
    targetHash: currentBundle.targetHash,
    targets: [tamperedTarget],
  };
  const update = {
    ...(await createSignedSyncResponseUpdate({
      accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
      author: fixture.author,
      contentKeyEpoch: 1,
      id: "550e8400-e29b-41d4-a716-446655440467",
      plan: materializedPlan.plan,
      targetHash: tamperedBundle.targetHash,
    })),
    authorizationTargets: [targetEnvelopeReference(tamperedTarget)],
  };
  const response = await createSyncResponse(materializedPlan.plan, {
    acceptedOutgoingUpdateIds: [],
    contentKeyBundles: [tamperedBundle, currentBundle],
    updates: [update],
  });

  const error = await unwrapDocumentSyncResponseContentKeys({
    currentContentKey: materializedPlan.contentKey,
    currentContentKeyEpoch: materializedPlan.plan.contentKeyEpoch,
    historyMode: "raw",
    response,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: currentWriterProjection,
  }).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  expect(isDocumentSyncUpdateIsolationError(error)).toBe(true);
  expect(error).not.toBeInstanceOf(DocumentRawHistoryUnavailableError);
  if (!isDocumentSyncUpdateIsolationError(error)) return;
  expect(error.stage).toBe("content_key");
  expect(error.batchUpdateIds).toEqual([update.id]);
});

test("rehashed unavailable targets must match the authenticated update header", async () => {
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
    historyMode: "raw",
    localVersionVector: null,
    pendingUpdates: [],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: currentWriterProjection,
  });
  const historicalTarget = currentBundle.targets[0];
  if (!historicalTarget) throw new Error("Expected historical target");
  const substitutedTarget = {
    ...historicalTarget,
    containerKeyEpochId: "550e8400-e29b-41d4-a716-446655440497",
  };
  const substitutedBundle = {
    ...currentBundle,
    contentKeyEpoch: 1,
    targetHash: await computeDocumentContentKeyTargetHash([
      targetEnvelopeReference(substitutedTarget),
    ]),
    targets: [substitutedTarget],
  };
  const update = {
    ...(await createSignedSyncResponseUpdate({
      accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
      author: fixture.author,
      contentKeyEpoch: 1,
      id: "550e8400-e29b-41d4-a716-446655440468",
      plan: materializedPlan.plan,
      // The signed header retains the genuine target commitment.
      targetHash: currentBundle.targetHash,
    })),
    authorizationTargets: [targetEnvelopeReference(historicalTarget)],
  };
  const response = await createSyncResponse(materializedPlan.plan, {
    acceptedOutgoingUpdateIds: [],
    contentKeyBundles: [substitutedBundle, currentBundle],
    updates: [update],
  });

  const error = await unwrapDocumentSyncResponseContentKeys({
    currentContentKey: materializedPlan.contentKey,
    currentContentKeyEpoch: materializedPlan.plan.contentKeyEpoch,
    historyMode: "raw",
    response,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: currentWriterProjection,
  }).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  expect(isDocumentSyncUpdateIsolationError(error)).toBe(true);
  expect(error).not.toBeInstanceOf(DocumentRawHistoryUnavailableError);
  if (!isDocumentSyncUpdateIsolationError(error)) return;
  expect(error.stage).toBe("content_key");
  expect(error.batchUpdateIds).toEqual([update.id]);
});

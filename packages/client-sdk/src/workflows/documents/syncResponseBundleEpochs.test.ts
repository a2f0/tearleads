import { expect, test } from "bun:test";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { sealNextContentKeyEpoch } from "../../../test/helpers/contentKeyBundleSealing";
import {
  createMaterializedSyncFixture,
  createSignedSyncResponseUpdate,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { isDocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { persistedDocumentSyncStateFromResponse } from "../../data/documents/shared/responses";
import { unwrapDocumentSyncResponseContentKeys } from "./syncContentKeys";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

const REPEATED_EPOCH = "Document sync response repeats a content-key epoch";

async function rotatedHistoricalPull() {
  const fixture = await createMaterializedSyncFixture();
  const rotatedProjection = {
    ...fixture.writerProjection,
    contentKeyBundle: await sealNextContentKeyEpoch(fixture),
  };
  const materializedPlan = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: rotatedProjection,
  });
  const historicalBundle = fixture.writerProjection.contentKeyBundle;
  const historicalUpdate = await createSignedSyncResponseUpdate({
    accessManifestHash: materializedPlan.plan.expectedLinkSetManifestHash,
    author: fixture.author,
    contentKeyEpoch: historicalBundle.contentKeyEpoch,
    plan: materializedPlan.plan,
    targetHash: materializedPlan.plan.expectedTargetHash,
  });
  const response = await createSyncResponse(materializedPlan.plan, {
    acceptedOutgoingUpdateIds: [],
    contentKeyBundles: [historicalBundle],
    updates: [historicalUpdate],
  });
  return {
    fixture,
    historicalBundle,
    materializedPlan,
    response,
    rotatedProjection,
  };
}

function malformedResponses(
  response: DocumentSyncResponse,
  historicalBundle: DocumentSyncResponse["contentKeyBundle"],
): readonly DocumentSyncResponse[] {
  return [
    // An identical copy of the current bundle is no longer tolerated.
    {
      ...response,
      contentKeyBundles: [historicalBundle, response.contentKeyBundle],
    },
    { ...response, contentKeyBundles: [historicalBundle, historicalBundle] },
  ];
}

test("sync response verification rejects a repeated content-key epoch", async () => {
  const { fixture, historicalBundle, materializedPlan, response } =
    await rotatedHistoricalPull();
  const options = {
    resolveWriterPublicKey: writerKeyResolver({
      author: fixture.author,
      signingPublicKey: fixture.signingPublicKey,
    }),
  };
  const emptyProbe = {
    ...response,
    contentKeyBundles: [],
    updates: [],
  };

  await expect(
    persistedDocumentSyncStateFromResponse(
      materializedPlan.plan,
      emptyProbe,
      options,
    ),
  ).resolves.toMatchObject({ documentId: materializedPlan.plan.documentId });

  for (const malformed of [
    ...malformedResponses(response, historicalBundle),
    { ...emptyProbe, contentKeyBundles: [emptyProbe.contentKeyBundle] },
  ]) {
    await expect(
      persistedDocumentSyncStateFromResponse(
        materializedPlan.plan,
        malformed,
        options,
      ),
    ).rejects.toThrow(REPEATED_EPOCH);
  }
});

test("historical key recovery rejects a repeated content-key epoch", async () => {
  const {
    fixture,
    historicalBundle,
    materializedPlan,
    response,
    rotatedProjection,
  } = await rotatedHistoricalPull();
  const unwrap = (candidate: DocumentSyncResponse) =>
    unwrapDocumentSyncResponseContentKeys({
      currentContentKey: materializedPlan.contentKey,
      currentContentKeyEpoch: materializedPlan.plan.contentKeyEpoch,
      response: candidate,
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: rotatedProjection,
    });

  const keys = await unwrap(response);
  expect([...keys.keys()].sort((left, right) => left - right)).toEqual([
    historicalBundle.contentKeyEpoch,
    materializedPlan.plan.contentKeyEpoch,
  ]);

  for (const malformed of malformedResponses(response, historicalBundle)) {
    const error = await unwrap(malformed).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(isDocumentSyncUpdateIsolationError(error)).toBe(true);
    expect(error instanceof Error ? error.cause : null).toEqual(
      new Error(REPEATED_EPOCH),
    );
  }
});

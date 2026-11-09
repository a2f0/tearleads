import { expect, test } from "bun:test";
import type {
  DocumentContentKeyBundleResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import { sealNextContentKeyEpoch } from "../../../../test/helpers/contentKeyBundleSealing";
import {
  createMaterializedSyncFixture,
  createSignedSyncResponseUpdate,
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/documentFixtures";
import { persistedDocumentSyncStateFromResponse } from "../../../data/documents/shared/responses";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { unwrapDocumentSyncResponseContentKeys } from "../syncPlan/syncContentKeys";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

const REPEATED_EPOCH = "Document sync response repeats a content-key epoch";
const EPOCH_MISMATCH =
  "Document sync response content-key bundle epoch mismatch";

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
  historicalBundle: DocumentContentKeyBundleResponse,
  currentBundle: DocumentContentKeyBundleResponse,
): readonly DocumentSyncResponse[] {
  return [
    // The current bundle is already the client's; the response may not repeat it.
    {
      ...response,
      contentKeyBundles: [historicalBundle, currentBundle],
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

  const currentBundle = materializedPlan.plan.sourceContentKeyBundle;
  for (const malformed of [
    ...malformedResponses(response, historicalBundle, currentBundle),
    { ...emptyProbe, contentKeyBundles: [currentBundle] },
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

test("sync response verification rejects a content-key bundle newer than the planned epoch", async () => {
  const { fixture, materializedPlan, response } = await rotatedHistoricalPull();
  const currentBundle = materializedPlan.plan.sourceContentKeyBundle;

  await expect(
    persistedDocumentSyncStateFromResponse(
      materializedPlan.plan,
      {
        ...response,
        contentKeyBundles: [
          {
            ...currentBundle,
            contentKeyEpoch: currentBundle.contentKeyEpoch + 1,
          },
        ],
        updates: [],
      },
      {
        resolveWriterPublicKey: writerKeyResolver({
          author: fixture.author,
          signingPublicKey: fixture.signingPublicKey,
        }),
      },
    ),
  ).rejects.toThrow(EPOCH_MISMATCH);
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
      currentContentKeyBundle: materializedPlan.plan.sourceContentKeyBundle,
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

  for (const malformed of malformedResponses(
    response,
    historicalBundle,
    materializedPlan.plan.sourceContentKeyBundle,
  )) {
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

import { expect, test } from "bun:test";
import {
  createAuthor,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createProjection,
  createResponse,
  createSignedSyncResponseUpdate,
  createSyncResponse,
  fixtureHash,
  getOnlyTarget,
  writerKeyResolver,
} from "../../../../test/helpers/documentFixtures";
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/syncPlanMaterial";
import { DatabaseUnavailableError } from "../../sync/databaseUnavailable";
import { buildDocumentCreatePlan } from "./events";
import {
  persistedDocumentCreateStateFromResponse,
  persistedDocumentSyncStateFromResponse,
} from "./responses";

test("persistedDocumentCreateStateFromResponse stores verified create bundles", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-1",
    targetEnvelopes: [
      {
        ...target,
        wrappedKey: "wrapped-document-key",
        wrappingMetadata: {},
      },
    ],
  });
  const response = createResponse(plan);
  const tamperedTargetHash = await fixtureHash("tampered-target");

  expect(persistedDocumentCreateStateFromResponse(plan, response)).toEqual({
    documentId: "document-1",
    contentKeyBundle: JSON.stringify(response.contentKeyBundle),
    documentKekTargets: JSON.stringify(response.documentKekTargets),
    documentManifestBundle: JSON.stringify(response.accessManifest),
  });

  expect(() =>
    persistedDocumentCreateStateFromResponse(plan, {
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targetHash: tamperedTargetHash,
      },
    }),
  ).toThrow("target hash mismatch");

  expect(() =>
    persistedDocumentCreateStateFromResponse(plan, {
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targets: [],
      },
    }),
  ).toThrow("content-key targets mismatch");
});

test("persistedDocumentSyncStateFromResponse verifies accepted writes and returned write headers", async () => {
  const { author, secretKey, signingPublicKey, writerProjection } =
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
  const plan = materialized.plan;
  const response = await createSyncResponse(plan);
  const resolveWriterPublicKey = writerKeyResolver({
    author,
    signingPublicKey,
  });

  await expect(
    persistedDocumentSyncStateFromResponse(plan, response, {
      resolveWriterPublicKey,
    }),
  ).resolves.toEqual({
    documentId: plan.documentId,
    contentKeyBundle: JSON.stringify(response.contentKeyBundle),
    documentKekTargets: JSON.stringify(response.documentKekTargets),
    documentManifestBundle: JSON.stringify(plan.documentManifest),
  });

  const databaseUnavailable = new DatabaseUnavailableError(
    "Writer trust store was released",
  );
  await expect(
    persistedDocumentSyncStateFromResponse(plan, response, {
      resolveWriterPublicKey: async () => {
        throw databaseUnavailable;
      },
    }),
  ).rejects.toBe(databaseUnavailable);

  const acceptedUpdate = plan.request.outgoingUpdates[0];
  if (!acceptedUpdate) {
    throw new Error("Expected outgoing update fixture.");
  }
  const staleAcceptedUpdate = await createSignedSyncResponseUpdate({
    accessManifestHash: await fixtureHash("stale-accepted-access-manifest"),
    author,
    id: acceptedUpdate.id,
    plan,
    targetHash: await fixtureHash("stale-accepted-target-hash"),
  });
  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      await createSyncResponse(plan, {
        updates: [staleAcceptedUpdate],
      }),
      {
        resolveWriterPublicKey,
      },
    ),
  ).rejects.toThrow("write header mismatch");

  const readOnlyMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const historicalUpdate = await createSignedSyncResponseUpdate({
    accessManifestHash: await fixtureHash("historical-access-manifest"),
    author,
    plan: readOnlyMaterialized.plan,
    targetHash: await fixtureHash("historical-target-hash"),
  });
  const historicalResponse = await createSyncResponse(
    readOnlyMaterialized.plan,
    {
      updates: [historicalUpdate],
    },
  );

  await expect(
    persistedDocumentSyncStateFromResponse(
      readOnlyMaterialized.plan,
      historicalResponse,
      {
        resolveWriterPublicKey,
      },
    ),
  ).rejects.toThrow("lacks verified writer-authorization material");

  const rotatedProjection = {
    ...writerProjection,
    contentKeyBundle: {
      ...writerProjection.contentKeyBundle,
      contentKeyEpoch: writerProjection.contentKeyBundle.contentKeyEpoch + 1,
    },
  };
  const rotatedMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection: rotatedProjection,
  });
  const priorContentKeyUpdate = await createSignedSyncResponseUpdate({
    accessManifestHash: await fixtureHash("prior-content-key-access-manifest"),
    author,
    contentKeyEpoch: writerProjection.contentKeyBundle.contentKeyEpoch,
    plan: rotatedMaterialized.plan,
    targetHash: await fixtureHash("prior-content-key-target-hash"),
  });
  const priorContentKeyResponse = await createSyncResponse(
    rotatedMaterialized.plan,
    {
      contentKeyBundles: [
        writerProjection.contentKeyBundle,
        rotatedProjection.contentKeyBundle,
      ],
      updates: [priorContentKeyUpdate],
    },
  );

  await expect(
    persistedDocumentSyncStateFromResponse(
      rotatedMaterialized.plan,
      priorContentKeyResponse,
      {
        resolveWriterPublicKey,
      },
    ),
  ).rejects.toThrow("lacks verified writer-authorization material");

  await expect(
    persistedDocumentSyncStateFromResponse(
      rotatedMaterialized.plan,
      {
        ...priorContentKeyResponse,
        contentKeyBundles: [rotatedProjection.contentKeyBundle],
      },
      {
        resolveWriterPublicKey,
      },
    ),
  ).rejects.toThrow("content-key bundle missing");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, response, {
      resolveWriterPublicKey: async () => null,
    }),
  ).rejects.toThrow("writer public key missing");

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        acceptedOutgoingUpdateIds: ["550e8400-e29b-41d4-a716-446655440999"],
      },
      { resolveWriterPublicKey },
    ),
  ).rejects.toThrow("accepted update mismatch");

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        updates: response.updates.map((update) => ({
          ...update,
          encryptedData: "tampered",
        })),
      },
      { resolveWriterPublicKey },
    ),
  ).rejects.toThrow("ciphertext hash mismatch");

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        updates: response.updates.map((update) => ({
          ...update,
          writeHeader: {
            ...update.writeHeader,
            contentKeyEpoch: 0,
          },
        })),
      },
      { resolveWriterPublicKey },
    ),
  ).rejects.toThrow("write header.contentKeyEpoch must be a positive integer");

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        updates: response.updates.map((update) => ({
          ...update,
          writeHeader: {
            ...update.writeHeader,
            writerUserId: "substituted-writer",
          },
        })),
      },
      { resolveWriterPublicKey },
    ),
  ).rejects.toThrow("writer public key missing");
});

test("persistedDocumentSyncStateFromResponse validates sync checkpoints", async () => {
  const { author, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    minLsn: "0/20",
    pendingUpdates: [createPendingUpdateRecord()],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const plan = materialized.plan;
  const response = await createSyncResponse(plan, { commitLsn: "0/20" });
  const resolveWriterPublicKey = writerKeyResolver({
    author,
    signingPublicKey,
  });

  await expect(
    persistedDocumentSyncStateFromResponse(plan, response, {
      resolveWriterPublicKey,
    }),
  ).resolves.toEqual({
    documentId: plan.documentId,
    contentKeyBundle: JSON.stringify(response.contentKeyBundle),
    documentKekTargets: JSON.stringify(response.documentKekTargets),
    documentManifestBundle: JSON.stringify(plan.documentManifest),
  });

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        commitLsn: "0/0",
      },
      { resolveWriterPublicKey },
    ),
  ).resolves.toEqual({
    documentId: plan.documentId,
    contentKeyBundle: JSON.stringify(response.contentKeyBundle),
    documentKekTargets: JSON.stringify(response.documentKekTargets),
    documentManifestBundle: JSON.stringify(plan.documentManifest),
  });

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        commitLsn: "0/1F",
      },
      { resolveWriterPublicKey },
    ),
  ).rejects.toThrow("commit LSN is stale");

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        commitLsn: null,
      },
      { resolveWriterPublicKey },
    ),
  ).rejects.toThrow("commit LSN is missing");

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        commitLsn: "not-a-lsn",
      },
      { resolveWriterPublicKey },
    ),
  ).rejects.toThrow("commit LSN is invalid");

  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      {
        ...response,
        updates: response.updates.map((update) => ({
          ...update,
          accessEpoch: 2,
        })),
      },
      { resolveWriterPublicKey },
    ),
  ).rejects.toThrow("future access epoch");
});

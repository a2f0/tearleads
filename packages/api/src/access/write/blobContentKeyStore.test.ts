import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  containerKeyEpochs,
} from "@tearleads/api-shared/schema";
import { computeBlobContentKeyTargetHash } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  attachBlob,
  ensureContainerHead,
  hashOf,
  setDocumentHead,
  targetEnvelopes,
} from "../../../test/helpers/blobContentKeyStoreFixtures";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import { getLatestBlobContentKeyBundle } from "../read/blobContentKeyStore";
import { resolveCurrentBlobKekTargets } from "../read/blobKekTargets";
import {
  BlobContentKeyBundleError,
  storeBlobContentKeyBundle,
} from "./blobContentKeyStore";

test("storeBlobContentKeyBundle stores exact active binding targets", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const manifestHash = await setDocumentHead({
    documentId,
    epoch: 1,
    linkedContainerIds: [crypto.randomUUID(), crypto.randomUUID()],
    organizationId,
  });
  await attachBlob({
    bindingId,
    blobId,
    documentId,
    documentManifestHash: manifestHash,
    slotId: "slot-a",
  });
  const currentTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const envelopes = targetEnvelopes(currentTargets);

  const stored = await storeBlobContentKeyBundle(
    {
      blobId,
      bindingId,
      documentId,
      contentKeyEpoch: 1,
      targetHash: currentTargets.blobKeyTargetHash,
      targets: envelopes,
    },
    db,
  );
  expect(stored.targets).toEqual(envelopes);
  expect(stored.currentTargets.blobKeyTargetHash).toBe(
    currentTargets.blobKeyTargetHash,
  );
  expect(stored.currentTargets.blobAccessManifestHash).toBe(
    currentTargets.blobAccessManifestHash,
  );

  const omittedTargets = envelopes.slice(0, 1);
  await expect(
    storeBlobContentKeyBundle(
      {
        blobId,
        bindingId,
        documentId,
        contentKeyEpoch: 1,
        targetHash: currentTargets.blobKeyTargetHash,
        targets: omittedTargets,
      },
      db,
    ),
  ).rejects.toBeInstanceOf(BlobContentKeyBundleError);

  await expect(
    storeBlobContentKeyBundle(
      {
        blobId,
        bindingId,
        documentId,
        contentKeyEpoch: 1,
        targetHash: await computeBlobContentKeyTargetHash(
          omittedTargets.map((target) => ({
            bindingId: target.bindingId,
            documentId: target.documentId,
            containerId: target.containerId,
            containerManifestHash: target.containerManifestHash,
            containerKeyEpochId: target.containerKeyEpochId,
            containerKeyEpoch: target.containerKeyEpoch,
          })),
        ),
        targets: omittedTargets,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError(
      "Blob content-key targets do not match current KEK targets",
      409,
    ),
  );
});

test("resolveCurrentBlobKekTargets uses the container manifest key epoch", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const manifestHash = await setDocumentHead({
    documentId,
    epoch: 1,
    linkedContainerIds: [containerId],
    organizationId,
  });
  await db.insert(containerKeyEpochs).values({
    id: `${containerId}:unreferenced-key-epoch-2`,
    containerId,
    keyEpoch: 2,
    accessManifestHash: await hashOf(`${containerId}:manifest`),
    parentContainerKeyEpochId: null,
    createdByEventHash: await hashOf(`${containerId}:rogue-event`),
    createdByManifestHash: await hashOf(`${containerId}:manifest`),
  });
  await attachBlob({
    bindingId,
    blobId,
    documentId,
    documentManifestHash: manifestHash,
    slotId: "slot-a",
  });

  const currentTargets = await resolveCurrentBlobKekTargets(blobId, db);

  expect(currentTargets.targets).toEqual([
    {
      bindingId,
      documentId,
      containerId,
      containerManifestHash: await hashOf(`${containerId}:manifest`),
      containerKeyEpochId: `${containerId}:key-epoch-1`,
      containerKeyEpoch: 1,
    },
  ]);
});

test("storeBlobContentKeyBundle rewrites key packages without replacing blob bytes", async () => {
  const organizationId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const firstDocumentId = crypto.randomUUID();
  const secondDocumentId = crypto.randomUUID();
  const firstBindingId = crypto.randomUUID();
  const secondBindingId = crypto.randomUUID();
  const firstContainerId = crypto.randomUUID();
  const secondContainerId = crypto.randomUUID();
  const firstManifestHash = await setDocumentHead({
    documentId: firstDocumentId,
    epoch: 1,
    linkedContainerIds: [firstContainerId],
    organizationId,
  });
  const secondManifestHash = await setDocumentHead({
    documentId: secondDocumentId,
    epoch: 1,
    linkedContainerIds: [secondContainerId],
    organizationId,
  });
  await attachBlob({
    bindingId: firstBindingId,
    blobId,
    documentId: firstDocumentId,
    documentManifestHash: firstManifestHash,
    slotId: "slot-a",
  });
  const initialTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeBlobContentKeyBundle(
    {
      blobId,
      bindingId: firstBindingId,
      documentId: firstDocumentId,
      contentKeyEpoch: 1,
      targetHash: initialTargets.blobKeyTargetHash,
      targets: initialEnvelopes,
    },
    db,
  );

  await attachBlob({
    bindingId: secondBindingId,
    blobId,
    documentId: secondDocumentId,
    documentManifestHash: secondManifestHash,
    slotId: "slot-b",
  });
  const expandedTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const expandedEnvelopes = expandedTargets.targets.map((target) => {
    const existing = initialEnvelopes.find(
      (envelope) =>
        envelope.bindingId === target.bindingId &&
        envelope.documentId === target.documentId &&
        envelope.containerId === target.containerId,
    );
    return (
      existing ?? {
        ...target,
        ...contentKeyEnvelopeFixture(
          "Blob",
          `${target.bindingId}:${target.containerId}:expanded`,
        ),
      }
    );
  });

  const secondEnvelopes = expandedEnvelopes.filter(
    (target) => target.bindingId === secondBindingId,
  );
  const secondTargetHash = await computeBlobContentKeyTargetHash(
    secondEnvelopes.map(
      ({ wrappedKey: _key, wrappingMetadata: _metadata, ...target }) => target,
    ),
  );
  const expanded = await storeBlobContentKeyBundle(
    {
      blobId,
      bindingId: secondBindingId,
      documentId: secondDocumentId,
      contentKeyEpoch: 1,
      targetHash: secondTargetHash,
      targets: secondEnvelopes,
    },
    db,
  );
  expect(expanded.contentKeyEpoch).toBe(1);
  expect(expanded.targets).toEqual(expandedEnvelopes);

  await db
    .update(attachmentBindings)
    .set({ detachedAt: new Date() })
    .where(eq(attachmentBindings.id, secondBindingId));
  const shrunkTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const shrunk = await storeBlobContentKeyBundle(
    {
      blobId,
      bindingId: firstBindingId,
      documentId: firstDocumentId,
      contentKeyEpoch: 1,
      targetHash: shrunkTargets.blobKeyTargetHash,
      targets: initialEnvelopes,
    },
    db,
  );
  expect(shrunk.contentKeyEpoch).toBe(1);
  expect(shrunk.targets).toEqual(expandedEnvelopes);

  await ensureContainerHead({
    containerId: firstContainerId,
    epoch: 2,
    keyEpoch: 2,
    organizationId,
  });
  const rekeyedTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const rekeyedEnvelopes = targetEnvelopes(rekeyedTargets, "rekeyed");
  const staleBundle = await getLatestBlobContentKeyBundle(blobId, db);
  expect(staleBundle?.targetHash).toBe(expandedTargets.blobKeyTargetHash);
  expect(staleBundle?.targets).toEqual(expandedEnvelopes);

  const rekeyed = await storeBlobContentKeyBundle(
    {
      blobId,
      bindingId: firstBindingId,
      documentId: firstDocumentId,
      contentKeyEpoch: 1,
      targetHash: rekeyedTargets.blobKeyTargetHash,
      targets: rekeyedEnvelopes,
    },
    db,
  );
  expect(rekeyed.contentKeyEpoch).toBe(1);
  expect(rekeyed.targets).toEqual(
    expect.arrayContaining([...rekeyedEnvelopes, ...secondEnvelopes]),
  );
  const retained = await db
    .select({ wrappedKey: blobContentKeyTargets.wrappedKey })
    .from(blobContentKeyTargets)
    .innerJoin(
      blobContentKeyEpochs,
      eq(blobContentKeyTargets.blobContentKeyEpochId, blobContentKeyEpochs.id),
    )
    .where(eq(blobContentKeyEpochs.blobId, blobId));
  for (const prior of initialEnvelopes) {
    expect(retained.map((row) => row.wrappedKey)).toContain(prior.wrappedKey);
  }

  await expect(
    storeBlobContentKeyBundle(
      {
        blobId,
        bindingId: firstBindingId,
        documentId: firstDocumentId,
        contentKeyEpoch: 2,
        targetHash: rekeyedTargets.blobKeyTargetHash,
        targets: targetEnvelopes(rekeyedTargets, "replacement-epoch"),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError(
      "Blob content key epoch cannot change without replacing blob bytes",
      409,
    ),
  );
});

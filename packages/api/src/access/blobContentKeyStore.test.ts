import { expect, test } from "bun:test";
import {
  computeBlobContentKeyTargetHash,
  computeKeyingV2DomainHash,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { db } from "../adapters/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  attachmentBindings,
  containerKeyEpochs,
} from "../schema";
import {
  BlobContentKeyBundleError,
  type BlobContentKeyTargetEnvelope,
  storeBlobContentKeyBundle,
} from "./blobContentKeyStore";
import { resolveCurrentBlobKekTargets } from "./blobKekTargets";

async function hashOf(label: string): Promise<string> {
  return computeKeyingV2DomainHash("tearleads.keying-v2.access-event-body.v1", {
    label,
  });
}

async function ensureContainerHead(input: {
  readonly containerId: string;
  readonly organizationId: string;
}) {
  const manifestHash = await hashOf(`${input.containerId}:manifest`);
  await db
    .insert(accessManifestHeads)
    .values({
      objectKind: "container",
      objectId: input.containerId,
      organizationId: input.organizationId,
      epoch: 1,
      manifestHash,
    })
    .onConflictDoNothing({
      target: [accessManifestHeads.objectKind, accessManifestHeads.objectId],
    });
  await db
    .insert(containerKeyEpochs)
    .values({
      id: `${input.containerId}:key-epoch-1`,
      containerId: input.containerId,
      keyEpoch: 1,
      accessManifestHash: manifestHash,
      parentContainerKeyEpochId: null,
      createdByEventHash: await hashOf(`${input.containerId}:event`),
      createdByManifestHash: manifestHash,
    })
    .onConflictDoNothing({ target: containerKeyEpochs.id });

  return manifestHash;
}

async function setDocumentHead(input: {
  readonly documentId: string;
  readonly epoch: number;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
}) {
  for (const containerId of input.linkedContainerIds) {
    await ensureContainerHead({
      containerId,
      organizationId: input.organizationId,
    });
  }

  const manifestHash = await hashOf(
    `${input.documentId}:manifest:${input.epoch}`,
  );
  await db
    .insert(accessManifestHeads)
    .values({
      objectKind: "document",
      objectId: input.documentId,
      organizationId: input.organizationId,
      epoch: input.epoch,
      manifestHash,
    })
    .onConflictDoUpdate({
      target: [accessManifestHeads.objectKind, accessManifestHeads.objectId],
      set: {
        organizationId: input.organizationId,
        epoch: input.epoch,
        manifestHash,
        updatedAt: new Date(),
      },
    });
  await db.insert(accessManifestDocumentLinkProjection).values(
    input.linkedContainerIds.map((containerId) => ({
      manifestHash,
      documentId: input.documentId,
      containerId,
    })),
  );

  return manifestHash;
}

async function attachBlob(input: {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentId: string;
  readonly documentManifestHash: string;
  readonly slotId: string;
}) {
  await db.insert(attachmentBindings).values({
    id: input.bindingId,
    documentId: input.documentId,
    slotId: input.slotId,
    blobId: input.blobId,
    previousBindingId: null,
    attachmentEventHash: await hashOf(`${input.bindingId}:attachment-event`),
    documentManifestHash: input.documentManifestHash,
  });
}

function targetEnvelopes(
  targets: Awaited<ReturnType<typeof resolveCurrentBlobKekTargets>>,
  suffix = "initial",
): BlobContentKeyTargetEnvelope[] {
  return targets.targets.map((target) => ({
    ...target,
    wrappedKey: `${target.bindingId}:${target.containerId}:${suffix}`,
    wrappingMetadata: { suite: "test-wrap" },
  }));
}

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
  const currentTargets = await resolveCurrentBlobKekTargets(blobId);
  const envelopes = targetEnvelopes(currentTargets);

  const stored = await storeBlobContentKeyBundle({
    blobId,
    contentKeyEpoch: 1,
    targetHash: currentTargets.blobKeyTargetHash,
    targets: envelopes,
  });
  expect(stored.targets).toEqual(envelopes);

  const omittedTargets = envelopes.slice(0, 1);
  await expect(
    storeBlobContentKeyBundle({
      blobId,
      contentKeyEpoch: 1,
      targetHash: currentTargets.blobKeyTargetHash,
      targets: omittedTargets,
    }),
  ).rejects.toBeInstanceOf(BlobContentKeyBundleError);

  await expect(
    storeBlobContentKeyBundle({
      blobId,
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
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob KEK targets are stale", 409),
  );
});

test("storeBlobContentKeyBundle allows additive growth but rejects shrink", async () => {
  const organizationId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const firstDocumentId = crypto.randomUUID();
  const secondDocumentId = crypto.randomUUID();
  const firstBindingId = crypto.randomUUID();
  const secondBindingId = crypto.randomUUID();
  const firstManifestHash = await setDocumentHead({
    documentId: firstDocumentId,
    epoch: 1,
    linkedContainerIds: [crypto.randomUUID()],
    organizationId,
  });
  const secondManifestHash = await setDocumentHead({
    documentId: secondDocumentId,
    epoch: 1,
    linkedContainerIds: [crypto.randomUUID()],
    organizationId,
  });
  await attachBlob({
    bindingId: firstBindingId,
    blobId,
    documentId: firstDocumentId,
    documentManifestHash: firstManifestHash,
    slotId: "slot-a",
  });
  const initialTargets = await resolveCurrentBlobKekTargets(blobId);
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeBlobContentKeyBundle({
    blobId,
    contentKeyEpoch: 1,
    targetHash: initialTargets.blobKeyTargetHash,
    targets: initialEnvelopes,
  });

  await attachBlob({
    bindingId: secondBindingId,
    blobId,
    documentId: secondDocumentId,
    documentManifestHash: secondManifestHash,
    slotId: "slot-b",
  });
  const expandedTargets = await resolveCurrentBlobKekTargets(blobId);
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
        wrappedKey: `${target.bindingId}:${target.containerId}:expanded`,
        wrappingMetadata: { suite: "test-wrap" },
      }
    );
  });

  const expanded = await storeBlobContentKeyBundle({
    blobId,
    contentKeyEpoch: 1,
    targetHash: expandedTargets.blobKeyTargetHash,
    targets: expandedEnvelopes,
  });
  expect(expanded.contentKeyEpoch).toBe(1);
  expect(expanded.targets).toEqual(expandedEnvelopes);

  await db
    .update(attachmentBindings)
    .set({ detachedAt: new Date() })
    .where(eq(attachmentBindings.id, secondBindingId));
  const shrunkTargets = await resolveCurrentBlobKekTargets(blobId);
  await expect(
    storeBlobContentKeyBundle({
      blobId,
      contentKeyEpoch: 1,
      targetHash: shrunkTargets.blobKeyTargetHash,
      targets: targetEnvelopes(shrunkTargets, "shrunk"),
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError(
      "Blob content-key targets shrank; replace the blob",
      409,
    ),
  );
});

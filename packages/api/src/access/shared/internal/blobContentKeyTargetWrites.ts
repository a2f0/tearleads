import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import {
  BlobContentKeyBundleError,
  type BlobContentKeyTargetEnvelope,
  type StoredBlobContentKeyBundle,
} from "./blobContentKeyTargets";
import { resolveRetainedBlobTargetEnvelopes } from "./retainedBlobTargetEnvelopes";

export async function insertBlobContentKeyTargets(input: {
  readonly blobContentKeyEpochId: string;
  readonly bundleTargetHash: string;
  readonly executor: DatabaseSession;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}) {
  if (input.targets.length === 0) {
    return;
  }

  await input.executor
    .insert(blobContentKeyTargets)
    .values(
      input.targets.map((target) => ({
        blobContentKeyEpochId: input.blobContentKeyEpochId,
        bundleTargetHash: input.bundleTargetHash,
        bindingId: target.bindingId,
        documentId: target.documentId,
        containerId: target.containerId,
        containerManifestHash: target.containerManifestHash,
        containerKeyEpochId: target.containerKeyEpochId,
        containerKeyEpoch: target.containerKeyEpoch,
        wrappedKey: target.wrappedKey,
        wrappingMetadata: target.wrappingMetadata,
      })),
    )
    .onConflictDoNothing({
      target: [
        blobContentKeyTargets.blobContentKeyEpochId,
        blobContentKeyTargets.bundleTargetHash,
        blobContentKeyTargets.bindingId,
        blobContentKeyTargets.documentId,
        blobContentKeyTargets.containerId,
      ],
    });
}

/** Persist under the caller's blob lock; returning consumers read targets separately. */
export async function persistBlobContentKeyTargets(input: {
  readonly existingBundle: StoredBlobContentKeyBundle;
  readonly nextBundle: StoredBlobContentKeyBundle;
  readonly executor: DatabaseSession;
}): Promise<typeof blobContentKeyEpochs.$inferSelect> {
  // The update returns the epoch row as stored. The retained-envelope read
  // and the target insert below touch only target rows, and the caller holds
  // the blob row lock, so the row needs neither a load before nor a reload
  // after; an error after the update still rolls the transaction back.
  const [epochRow] = await input.executor
    .update(blobContentKeyEpochs)
    .set({
      targetHash: input.nextBundle.targetHash,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(blobContentKeyEpochs.blobId, input.nextBundle.blobId),
        eq(
          blobContentKeyEpochs.contentKeyEpoch,
          input.nextBundle.contentKeyEpoch,
        ),
      ),
    )
    .returning();
  if (!epochRow)
    throw new BlobContentKeyBundleError(
      "Failed to load blob content-key epoch",
      409,
    );
  const targets = await resolveRetainedBlobTargetEnvelopes({
    currentTargets: input.existingBundle.targets,
    epochId: epochRow.id,
    executor: input.executor,
    targets: input.nextBundle.targets,
  });
  await insertBlobContentKeyTargets({
    blobContentKeyEpochId: epochRow.id,
    bundleTargetHash: input.nextBundle.targetHash,
    executor: input.executor,
    targets,
  });

  return epochRow;
}

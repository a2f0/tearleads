import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { computeBlobContentKeyTargetHash } from "@tearleads/crypto";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import {
  assertSubmittedTargetsMatchCurrent,
  assertTargetHashMatches,
  BlobContentKeyBundleError,
  type BlobContentKeyTargetEnvelope,
  type CurrentBlobKekTargets,
  ensurePositiveContentKeyEpoch,
  type StoredBlobContentKeyBundle,
  type StoredBlobContentKeyBundleWithTargets,
  sortTargetEnvelopes,
  targetEnvelopeEqual,
} from "./blobContentKeyTargets";
import {
  BlobKekTargetError,
  resolveCurrentBlobKekTargets,
} from "./blobKekTargets";
import { createContentKeyStore } from "./contentKeyStore";
import { resolveRetainedBlobTargetEnvelopes } from "./retainedBlobTargetEnvelopes";

export type {
  BlobContentKeyTargetEnvelope,
  StoredBlobContentKeyBundleWithTargets,
} from "./blobContentKeyTargets";
export { BlobContentKeyBundleError } from "./blobContentKeyTargets";

interface BlobContentKeyBundleInput {
  readonly blobId: string;
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}

interface StoreBlobContentKeyBundleInput extends BlobContentKeyBundleInput {
  readonly bindingId: string;
  readonly documentId: string;
}

async function loadBlobContentKeyEpochRow(
  blobId: string,
  contentKeyEpoch: number,
  executor: DatabaseSession,
) {
  const [row] = await executor
    .select()
    .from(blobContentKeyEpochs)
    .where(
      and(
        eq(blobContentKeyEpochs.blobId, blobId),
        eq(blobContentKeyEpochs.contentKeyEpoch, contentKeyEpoch),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function loadLatestBlobContentKeyEpochRow(
  blobId: string,
  executor: DatabaseSession,
) {
  const [row] = await executor
    .select()
    .from(blobContentKeyEpochs)
    .where(eq(blobContentKeyEpochs.blobId, blobId))
    .orderBy(desc(blobContentKeyEpochs.contentKeyEpoch))
    .limit(1);

  return row ?? null;
}

const blobContentKeyTargetEnvelopeColumns = {
  bindingId: blobContentKeyTargets.bindingId,
  documentId: blobContentKeyTargets.documentId,
  containerId: blobContentKeyTargets.containerId,
  containerManifestHash: blobContentKeyTargets.containerManifestHash,
  containerKeyEpochId: blobContentKeyTargets.containerKeyEpochId,
  containerKeyEpoch: blobContentKeyTargets.containerKeyEpoch,
  wrappedKey: blobContentKeyTargets.wrappedKey,
  wrappingMetadata: blobContentKeyTargets.wrappingMetadata,
};

async function listBlobContentKeyTargetRows(
  blobContentKeyEpochId: string,
  bundleTargetHash: string,
  executor: DatabaseSession,
): Promise<BlobContentKeyTargetEnvelope[]> {
  const rows = await executor
    .select(blobContentKeyTargetEnvelopeColumns)
    .from(blobContentKeyTargets)
    .where(
      and(
        eq(blobContentKeyTargets.blobContentKeyEpochId, blobContentKeyEpochId),
        eq(blobContentKeyTargets.bundleTargetHash, bundleTargetHash),
      ),
    );

  return sortTargetEnvelopes(rows);
}

async function toStoredBundle(
  row: typeof blobContentKeyEpochs.$inferSelect,
  executor: DatabaseSession,
): Promise<StoredBlobContentKeyBundle> {
  return {
    blobId: row.blobId,
    contentKeyEpoch: row.contentKeyEpoch,
    targetHash: row.targetHash,
    targets: await listBlobContentKeyTargetRows(
      row.id,
      row.targetHash,
      executor,
    ),
  };
}

/**
 * Each blob's latest bundle in two statements for any number of blobs: the
 * latest epochs through a grouped derived table, then their current targets.
 * Blobs without an epoch are absent from the map.
 */
export async function getLatestBlobContentKeyBundles(
  blobIds: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredBlobContentKeyBundle>> {
  const uniqueBlobIds = [...new Set(blobIds)];
  if (uniqueBlobIds.length === 0) return new Map();
  const latest = executor
    .select({
      blobId: blobContentKeyEpochs.blobId,
      contentKeyEpoch: max(blobContentKeyEpochs.contentKeyEpoch).as(
        "latest_content_key_epoch",
      ),
    })
    .from(blobContentKeyEpochs)
    .where(inArray(blobContentKeyEpochs.blobId, uniqueBlobIds))
    .groupBy(blobContentKeyEpochs.blobId)
    .as("latest_blob_content_key_epochs");
  const epochRows = await executor
    .select({ epoch: blobContentKeyEpochs })
    .from(blobContentKeyEpochs)
    .innerJoin(
      latest,
      and(
        eq(blobContentKeyEpochs.blobId, latest.blobId),
        eq(blobContentKeyEpochs.contentKeyEpoch, latest.contentKeyEpoch),
      ),
    );
  const targetRows =
    epochRows.length === 0
      ? []
      : await executor
          .select({
            blobContentKeyEpochId: blobContentKeyTargets.blobContentKeyEpochId,
            bundleTargetHash: blobContentKeyTargets.bundleTargetHash,
            ...blobContentKeyTargetEnvelopeColumns,
          })
          .from(blobContentKeyTargets)
          .where(
            and(
              inArray(
                blobContentKeyTargets.blobContentKeyEpochId,
                epochRows.map(({ epoch }) => epoch.id),
              ),
              inArray(
                blobContentKeyTargets.bundleTargetHash,
                epochRows.map(({ epoch }) => epoch.targetHash),
              ),
            ),
          );
  return new Map(
    epochRows.map(({ epoch }) => [
      epoch.blobId,
      {
        blobId: epoch.blobId,
        contentKeyEpoch: epoch.contentKeyEpoch,
        targetHash: epoch.targetHash,
        targets: sortTargetEnvelopes(
          targetRows
            .filter(
              (target) =>
                target.blobContentKeyEpochId === epoch.id &&
                target.bundleTargetHash === epoch.targetHash,
            )
            .map(
              ({
                blobContentKeyEpochId: _epochId,
                bundleTargetHash: _targetHash,
                ...target
              }) => target,
            ),
        ),
      },
    ]),
  );
}

export async function getLatestBlobContentKeyBundle(
  blobId: string,
  executor: DatabaseSession,
): Promise<StoredBlobContentKeyBundle | null> {
  return blobContentKeyStore.getLatestBundle(blobId, executor);
}

async function insertBlobContentKeyTargets(input: {
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

export async function replaceBlobContentKeyTargetsForExistingBundle(input: {
  readonly existingBundle: StoredBlobContentKeyBundle;
  readonly nextBundle: BlobContentKeyBundleInput;
  readonly executor: DatabaseSession;
}): Promise<StoredBlobContentKeyBundle> {
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

  return toStoredBundle(epochRow, input.executor);
}

async function validateCurrentTargetsForBundle(
  input: StoreBlobContentKeyBundleInput,
  executor: DatabaseSession,
): Promise<CurrentBlobKekTargets> {
  ensurePositiveContentKeyEpoch(input.contentKeyEpoch);
  await assertTargetHashMatches(input);
  let currentTargets: CurrentBlobKekTargets;
  try {
    currentTargets = await resolveCurrentBlobKekTargets(input.blobId, executor);
  } catch (error) {
    if (error instanceof BlobKekTargetError) {
      throw new BlobContentKeyBundleError(error.message, error.status);
    }
    throw error;
  }
  // This request owns one verified attachment binding, not the blob's union.
  const bindingTargets = currentTargets.targets.filter(
    (target) =>
      target.bindingId === input.bindingId &&
      target.documentId === input.documentId,
  );
  if (bindingTargets.length === 0) {
    throw new BlobContentKeyBundleError(
      "Blob binding has no current KEK targets",
      409,
    );
  }
  assertSubmittedTargetsMatchCurrent({
    currentTargets: { ...currentTargets, targets: bindingTargets },
    targets: input.targets,
  });
  return currentTargets;
}

function assertContentKeyEpochCanBeStored(input: {
  readonly contentKeyEpoch: number;
  readonly latestBundle: StoredBlobContentKeyBundle | null;
}): void {
  if (
    input.latestBundle &&
    input.contentKeyEpoch !== input.latestBundle.contentKeyEpoch
  ) {
    throw new BlobContentKeyBundleError(
      "Blob content key epoch cannot change without replacing blob bytes",
      409,
    );
  }
}

async function refreshExistingBundleMetadata(input: {
  readonly existingBundle: StoredBlobContentKeyBundle;
  readonly nextBundle: BlobContentKeyBundleInput;
  readonly executor: DatabaseSession;
}): Promise<StoredBlobContentKeyBundle> {
  if (input.existingBundle.targetHash !== input.nextBundle.targetHash) {
    await input.executor
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
      );
  }

  return {
    ...input.existingBundle,
    targetHash: input.nextBundle.targetHash,
  };
}

const blobContentKeyStore = createContentKeyStore<
  BlobContentKeyTargetEnvelope,
  StoreBlobContentKeyBundleInput,
  typeof blobContentKeyEpochs.$inferSelect,
  StoredBlobContentKeyBundle,
  CurrentBlobKekTargets,
  undefined
>({
  createBundleConflictError: () =>
    new BlobContentKeyBundleError("Blob content-key bundle conflict", 409),
  createMissingEpochError: () =>
    new BlobContentKeyBundleError("Failed to load blob content-key epoch", 409),
  getIdentifier: (input) => input.blobId,
  insertEpochRow: async (input, executor) => {
    const [row] = await executor
      .insert(blobContentKeyEpochs)
      .values({
        blobId: input.blobId,
        contentKeyEpoch: input.contentKeyEpoch,
        targetHash: input.targetHash,
      })
      .onConflictDoNothing({
        target: [
          blobContentKeyEpochs.blobId,
          blobContentKeyEpochs.contentKeyEpoch,
        ],
      })
      .returning();
    return row ?? null;
  },
  insertTargets: async (epochId, targets, executor) => {
    const [row] = await executor
      .select({ targetHash: blobContentKeyEpochs.targetHash })
      .from(blobContentKeyEpochs)
      .where(eq(blobContentKeyEpochs.id, epochId))
      .limit(1);
    if (!row)
      throw new BlobContentKeyBundleError(
        "Blob content-key epoch is unavailable",
        409,
      );
    await insertBlobContentKeyTargets({
      blobContentKeyEpochId: epochId,
      bundleTargetHash: row.targetHash,
      executor,
      targets,
    });
  },
  loadEpochRow: loadBlobContentKeyEpochRow,
  loadLatestEpochRow: loadLatestBlobContentKeyEpochRow,
  prepareStore: ({ input, latestBundle }) => {
    assertContentKeyEpochCanBeStored({
      contentKeyEpoch: input.contentKeyEpoch,
      latestBundle,
    });
    return undefined;
  },
  reconcileExistingBundle: async ({
    currentTargets,
    existingBundle,
    executor,
    input,
  }) => {
    // Caller holds the blob row lock. Other bindings retain their exact stored
    // envelopes, including historical epochs; only their own writer may rewrap.
    const targets = [
      ...existingBundle.targets.filter(
        (target) =>
          target.bindingId !== input.bindingId &&
          currentTargets.activeBindingIds.includes(target.bindingId),
      ),
      ...input.targets,
    ];
    const targetHash = await computeBlobContentKeyTargetHash(
      targets.map(
        ({ wrappedKey: _key, wrappingMetadata: _metadata, ...target }) =>
          target,
      ),
    );
    return replaceBlobContentKeyTargetsForExistingBundle({
      existingBundle,
      nextBundle: { ...input, targetHash, targets },
      executor,
    });
  },
  refreshExistingBundleMetadata,
  sortTargetEnvelopes,
  targetEnvelopeEqual,
  toStoredBundle,
  validateCurrentTargets: validateCurrentTargetsForBundle,
});

export async function storeBlobContentKeyBundle(
  input: StoreBlobContentKeyBundleInput,
  database: ApiDatabase,
): Promise<StoredBlobContentKeyBundleWithTargets> {
  return blobContentKeyStore.store(input, database);
}

export async function storeBlobContentKeyBundleInTransaction(
  input: StoreBlobContentKeyBundleInput,
  executor: DatabaseTransaction,
): Promise<StoredBlobContentKeyBundleWithTargets> {
  return blobContentKeyStore.storeInTransaction(input, executor);
}

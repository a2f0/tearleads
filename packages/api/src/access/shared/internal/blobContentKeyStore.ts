import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  assertTargetHashMatches,
  assertTargetsMatchCurrent,
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
  assertBlobKekTargetsCurrent,
  BlobKekTargetError,
} from "./blobKekTargets";
import { createContentKeyStore } from "./contentKeyStore";
import { resolveRetainedBlobTargetEnvelopes } from "./retainedBlobTargetEnvelopes";

export type {
  BlobContentKeyTargetEnvelope,
  StoredBlobContentKeyBundleWithTargets,
} from "./blobContentKeyTargets";
export { BlobContentKeyBundleError } from "./blobContentKeyTargets";

interface StoreBlobContentKeyBundleInput {
  readonly blobId: string;
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
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

async function listBlobContentKeyTargetRows(
  blobContentKeyEpochId: string,
  bundleTargetHash: string,
  executor: DatabaseSession,
): Promise<BlobContentKeyTargetEnvelope[]> {
  const rows = await executor
    .select({
      bindingId: blobContentKeyTargets.bindingId,
      documentId: blobContentKeyTargets.documentId,
      containerId: blobContentKeyTargets.containerId,
      containerManifestHash: blobContentKeyTargets.containerManifestHash,
      containerKeyEpochId: blobContentKeyTargets.containerKeyEpochId,
      containerKeyEpoch: blobContentKeyTargets.containerKeyEpoch,
      wrappedKey: blobContentKeyTargets.wrappedKey,
      wrappingMetadata: blobContentKeyTargets.wrappingMetadata,
    })
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
  readonly nextBundle: StoreBlobContentKeyBundleInput;
  readonly executor: DatabaseSession;
}): Promise<StoredBlobContentKeyBundle> {
  const epochRow = await loadBlobContentKeyEpochRow(
    input.nextBundle.blobId,
    input.nextBundle.contentKeyEpoch,
    input.executor,
  );
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

  await input.executor
    .update(blobContentKeyEpochs)
    .set({
      targetHash: input.nextBundle.targetHash,
      updatedAt: new Date(),
    })
    .where(eq(blobContentKeyEpochs.id, epochRow.id));
  await insertBlobContentKeyTargets({
    blobContentKeyEpochId: epochRow.id,
    bundleTargetHash: input.nextBundle.targetHash,
    executor: input.executor,
    targets,
  });

  const updatedRow = await loadBlobContentKeyEpochRow(
    input.nextBundle.blobId,
    input.nextBundle.contentKeyEpoch,
    input.executor,
  );
  if (!updatedRow) {
    throw new BlobContentKeyBundleError(
      "Failed to load blob content-key epoch",
      409,
    );
  }

  return toStoredBundle(updatedRow, input.executor);
}

async function validateCurrentTargetsForBundle(
  input: StoreBlobContentKeyBundleInput,
  executor: DatabaseSession,
): Promise<CurrentBlobKekTargets> {
  ensurePositiveContentKeyEpoch(input.contentKeyEpoch);
  await assertTargetHashMatches(input);
  let currentTargets: CurrentBlobKekTargets;
  try {
    currentTargets = await assertBlobKekTargetsCurrent(
      {
        blobId: input.blobId,
        expectedTargetHash: input.targetHash,
      },
      executor,
    );
  } catch (error) {
    if (error instanceof BlobKekTargetError) {
      throw new BlobContentKeyBundleError(error.message, error.status);
    }
    throw error;
  }
  assertTargetsMatchCurrent({
    currentTargets,
    origin: "submission",
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
  readonly nextBundle: StoreBlobContentKeyBundleInput;
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
  reconcileExistingBundle: ({ existingBundle, executor, input }) =>
    replaceBlobContentKeyTargetsForExistingBundle({
      existingBundle,
      nextBundle: input,
      executor,
    }),
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

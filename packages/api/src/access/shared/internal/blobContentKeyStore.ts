import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobContentWriteHeaders,
} from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
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
  targetEnvelopeMaterialEqual,
  targetKey,
  targetKeyMaterialEqual,
} from "./blobContentKeyTargets";
import {
  assertBlobKekTargetsCurrent,
  BlobKekTargetError,
} from "./blobKekTargets";
import {
  carryForwardContentKeyTargets,
  createContentKeyStore,
  createContentWriteHeaderStore,
  projectLatestContentKeyBundle,
} from "./contentKeyStore";

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
      eq(blobContentKeyTargets.blobContentKeyEpochId, blobContentKeyEpochId),
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
    targets: await listBlobContentKeyTargetRows(row.id, executor),
  };
}

async function getLatestBlobContentKeyBundle(
  blobId: string,
  executor: DatabaseSession,
): Promise<StoredBlobContentKeyBundle | null> {
  return blobContentKeyStore.getLatestBundle(blobId, executor);
}

function refreshedBundleForCurrentTargets(input: {
  readonly bundle: StoredBlobContentKeyBundle;
  readonly currentTargets: CurrentBlobKekTargets;
}): StoredBlobContentKeyBundle | null {
  const targets = carryForwardContentKeyTargets({
    currentTargets: input.currentTargets.targets,
    previousTargets: input.bundle.targets,
    sortTargetEnvelopes,
    targetKey,
    targetKeyMaterialEqual,
    toEnvelope: (currentTarget, previousEnvelope) => ({
      ...currentTarget,
      wrappedKey: previousEnvelope.wrappedKey,
      wrappingMetadata: previousEnvelope.wrappingMetadata,
    }),
  });
  if (!targets) {
    return null;
  }

  return {
    ...input.bundle,
    targetHash: input.currentTargets.blobKeyTargetHash,
    targets: sortTargetEnvelopes(targets),
  };
}

export async function getLatestCurrentBlobContentKeyBundle(
  input: {
    readonly blobId: string;
    readonly currentTargets: CurrentBlobKekTargets;
  },
  executor: DatabaseSession,
): Promise<StoredBlobContentKeyBundle | null> {
  const projection = await projectLatestContentKeyBundle({
    assertTargetsCurrent: (bundle) =>
      assertTargetsMatchCurrent({
        currentTargets: input.currentTargets,
        targets: bundle.targets,
      }),
    getLatestBundle: () =>
      getLatestBlobContentKeyBundle(input.blobId, executor),
    metadataIsCurrent: (bundle) =>
      bundle.targetHash === input.currentTargets.blobKeyTargetHash,
    refreshForCurrentTargets: (bundle) =>
      refreshedBundleForCurrentTargets({
        bundle,
        currentTargets: input.currentTargets,
      }),
  });
  return projection?.bundle ?? null;
}

async function insertBlobContentKeyTargets(input: {
  readonly blobContentKeyEpochId: string;
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
        blobContentKeyTargets.bindingId,
        blobContentKeyTargets.documentId,
        blobContentKeyTargets.containerId,
      ],
    });
}

async function replaceBlobContentKeyTargetsForExistingBundle(input: {
  readonly existingBundle: StoredBlobContentKeyBundle;
  readonly nextBundle: StoreBlobContentKeyBundleInput;
  readonly executor: DatabaseSession;
}): Promise<StoredBlobContentKeyBundle> {
  const nextByTargetKey = new Map(
    input.nextBundle.targets.map((target) => [targetKey(target), target]),
  );

  for (const target of input.existingBundle.targets) {
    const nextTarget = nextByTargetKey.get(targetKey(target));
    if (
      nextTarget &&
      targetKeyMaterialEqual(target, nextTarget) &&
      !targetEnvelopeMaterialEqual(target, nextTarget)
    ) {
      throw new BlobContentKeyBundleError(
        "Blob content-key bundle conflict",
        409,
      );
    }
  }

  const epochRow = await loadBlobContentKeyEpochRow(
    input.nextBundle.blobId,
    input.nextBundle.contentKeyEpoch,
    input.executor,
  );
  if (!epochRow) {
    throw new BlobContentKeyBundleError(
      "Failed to load blob content-key epoch",
      409,
    );
  }

  await input.executor
    .update(blobContentKeyEpochs)
    .set({
      targetHash: input.nextBundle.targetHash,
      updatedAt: new Date(),
    })
    .where(eq(blobContentKeyEpochs.id, epochRow.id));
  await input.executor
    .delete(blobContentKeyTargets)
    .where(eq(blobContentKeyTargets.blobContentKeyEpochId, epochRow.id));
  await insertBlobContentKeyTargets({
    blobContentKeyEpochId: epochRow.id,
    executor: input.executor,
    targets: input.nextBundle.targets,
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
  assertTargetsMatchCurrent({ currentTargets, targets: input.targets });
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
  insertTargets: (epochId, targets, executor) =>
    insertBlobContentKeyTargets({
      blobContentKeyEpochId: epochId,
      executor,
      targets,
    }),
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

interface StoreBlobContentWriteHeaderInput {
  readonly blobId: string;
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly recordId: string;
}

const blobContentWriteHeaderStore =
  createContentWriteHeaderStore<StoreBlobContentWriteHeaderInput>({
    createConflictError: () =>
      new BlobContentKeyBundleError("Blob write header conflict", 409),
    createObjectMismatchError: () =>
      new BlobContentKeyBundleError(
        "Blob write header does not match blob",
        409,
      ),
    ensureContentKeyEpoch: ensurePositiveContentKeyEpoch,
    expectedObjectKind: "blob",
    getObjectId: (input) => input.blobId,
    getRecordId: (input) => input.recordId,
    insert: async (input, executor) => {
      const [inserted] = await executor
        .insert(blobContentWriteHeaders)
        .values({
          recordId: input.recordId,
          blobId: input.blobId,
          organizationId: input.header.organizationId,
          contentKeyEpoch: input.header.contentKeyEpoch,
          accessManifestHash: input.header.accessManifestHash,
          targetHash: input.header.targetHash,
          encryptionSuite: input.header.encryptionSuite,
          contentRecordId: input.header.contentRecordId,
          nonceDomainHash: input.header.nonceDomainHash,
          headerHash: input.headerHash,
          header: input.header,
        })
        .onConflictDoNothing()
        .returning({ headerHash: blobContentWriteHeaders.headerHash });
      return inserted !== undefined;
    },
    list: (recordIds, executor) =>
      executor
        .select({
          recordId: blobContentWriteHeaders.recordId,
          header: blobContentWriteHeaders.header,
          headerHash: blobContentWriteHeaders.headerHash,
        })
        .from(blobContentWriteHeaders)
        .where(inArray(blobContentWriteHeaders.recordId, recordIds)),
    loadHeaderHash: async (recordId, executor) => {
      const [existing] = await executor
        .select({ headerHash: blobContentWriteHeaders.headerHash })
        .from(blobContentWriteHeaders)
        .where(eq(blobContentWriteHeaders.recordId, recordId))
        .limit(1);
      return existing?.headerHash ?? null;
    },
  });

export async function storeBlobContentWriteHeader(
  input: StoreBlobContentWriteHeaderInput,
  executor: DatabaseSession,
): Promise<void> {
  return blobContentWriteHeaderStore.store(input, executor);
}

export async function listBlobContentWriteHeaders(
  recordIds: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, { header: WriteHeader; headerHash: string }>> {
  return blobContentWriteHeaderStore.list(recordIds, executor);
}

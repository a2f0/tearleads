import {
  type BlobContentKeyTargetV2,
  computeBlobContentKeyTargetHash,
  type KeyingV2CanonicalJson,
  KeyingV2VerificationError,
  serializeKeyingV2CanonicalJson,
  type WriteHeaderV2,
} from "@tearleads/crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobContentWriteHeaders,
} from "../schema";
import {
  assertBlobKekTargetsCurrent,
  BlobKekTargetError,
  type resolveCurrentBlobKekTargets,
} from "./blobKekTargets";

type BlobContentKeyExecutor = DatabaseExecutor;
type CurrentBlobKekTargets = Awaited<
  ReturnType<typeof resolveCurrentBlobKekTargets>
>;

export interface BlobContentKeyTargetEnvelope extends BlobContentKeyTargetV2 {
  readonly wrappedKey: string;
  readonly wrappingMetadata: KeyingV2CanonicalJson;
}

interface StoredBlobContentKeyBundle {
  readonly blobId: string;
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}

interface StoreBlobContentKeyBundleInput {
  readonly blobId: string;
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}

export class BlobContentKeyBundleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "BlobContentKeyBundleError";
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJsonEquals(
  left: KeyingV2CanonicalJson,
  right: KeyingV2CanonicalJson,
): boolean {
  return (
    serializeKeyingV2CanonicalJson(left) ===
    serializeKeyingV2CanonicalJson(right)
  );
}

function targetKey(
  target: Pick<
    BlobContentKeyTargetV2,
    "bindingId" | "containerId" | "documentId"
  >,
) {
  return `${target.bindingId}:${target.documentId}:${target.containerId}`;
}

function toTargetFields(
  envelope: BlobContentKeyTargetEnvelope,
): BlobContentKeyTargetV2 {
  return {
    bindingId: envelope.bindingId,
    documentId: envelope.documentId,
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

function sortTargetEnvelopes(
  targets: readonly BlobContentKeyTargetEnvelope[],
): BlobContentKeyTargetEnvelope[] {
  return [...targets].sort((left, right) =>
    compareStrings(targetKey(left), targetKey(right)),
  );
}

function targetFieldsEqual(
  left: BlobContentKeyTargetV2,
  right: BlobContentKeyTargetV2,
): boolean {
  return (
    left.bindingId === right.bindingId &&
    left.documentId === right.documentId &&
    left.containerId === right.containerId &&
    left.containerManifestHash === right.containerManifestHash &&
    left.containerKeyEpochId === right.containerKeyEpochId &&
    left.containerKeyEpoch === right.containerKeyEpoch
  );
}

function targetEnvelopeEqual(
  left: BlobContentKeyTargetEnvelope,
  right: BlobContentKeyTargetEnvelope,
): boolean {
  return (
    targetFieldsEqual(left, right) &&
    left.wrappedKey === right.wrappedKey &&
    canonicalJsonEquals(left.wrappingMetadata, right.wrappingMetadata)
  );
}

function targetEnvelopeBundlesEqual(
  left: readonly BlobContentKeyTargetEnvelope[],
  right: readonly BlobContentKeyTargetEnvelope[],
): boolean {
  const sortedLeft = sortTargetEnvelopes(left);
  const sortedRight = sortTargetEnvelopes(right);

  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((leftTarget, index) => {
      const rightTarget = sortedRight[index];
      return (
        rightTarget !== undefined &&
        targetEnvelopeEqual(leftTarget, rightTarget)
      );
    })
  );
}

function ensureContentKeyEpoch(contentKeyEpoch: number): void {
  if (contentKeyEpoch !== 1) {
    throw new BlobContentKeyBundleError(
      "Blob content key epoch must be 1; replace the blob after target shrink",
      409,
    );
  }
}

function assertNoDuplicateTargets(
  targets: readonly BlobContentKeyTargetEnvelope[],
): void {
  const targetKeys = targets.map(targetKey);
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new BlobContentKeyBundleError(
      "Blob content-key targets contain duplicates",
      409,
    );
  }
}

function assertWrappedMaterialPresent(
  targets: readonly BlobContentKeyTargetEnvelope[],
): void {
  for (const target of targets) {
    if (target.wrappedKey.length === 0) {
      throw new BlobContentKeyBundleError(
        "Blob content-key target is missing wrapped key material",
        400,
      );
    }
  }
}

function expectedTargetMap(
  targets: readonly BlobContentKeyTargetV2[],
): Map<string, BlobContentKeyTargetV2> {
  return new Map(targets.map((target) => [targetKey(target), target]));
}

function currentTargetsContainPreviousBundle(input: {
  readonly currentTargets: readonly BlobContentKeyTargetV2[];
  readonly previousTargets: readonly BlobContentKeyTargetEnvelope[];
}): boolean {
  const currentTargetByKey = expectedTargetMap(input.currentTargets);

  return input.previousTargets.every((previousTarget) => {
    const currentTarget = currentTargetByKey.get(targetKey(previousTarget));
    return (
      currentTarget !== undefined &&
      targetFieldsEqual(previousTarget, currentTarget)
    );
  });
}

function assertTargetsMatchCurrent(input: {
  readonly currentTargets: CurrentBlobKekTargets;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): void {
  assertNoDuplicateTargets(input.targets);
  assertWrappedMaterialPresent(input.targets);

  const currentTargetByKey = expectedTargetMap(input.currentTargets.targets);

  if (input.targets.length !== currentTargetByKey.size) {
    throw new BlobContentKeyBundleError(
      "Blob content-key targets do not match current KEK targets",
      409,
    );
  }

  for (const target of input.targets) {
    const currentTarget = currentTargetByKey.get(targetKey(target));
    if (!currentTarget || !targetFieldsEqual(target, currentTarget)) {
      throw new BlobContentKeyBundleError(
        "Blob content-key targets do not match current KEK targets",
        409,
      );
    }
  }
}

async function assertTargetHashMatches(input: {
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): Promise<void> {
  try {
    const targetHash = await computeBlobContentKeyTargetHash(
      input.targets.map(toTargetFields),
    );

    if (targetHash !== input.targetHash) {
      throw new BlobContentKeyBundleError(
        "Blob content-key target hash mismatch",
        409,
      );
    }
  } catch (error) {
    if (error instanceof BlobContentKeyBundleError) {
      throw error;
    }
    if (error instanceof KeyingV2VerificationError) {
      throw new BlobContentKeyBundleError(error.message, 409);
    }
    throw error;
  }
}

async function loadBlobContentKeyEpochRow(
  blobId: string,
  contentKeyEpoch: number,
  executor: BlobContentKeyExecutor,
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
  executor: BlobContentKeyExecutor,
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
  executor: BlobContentKeyExecutor,
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
  executor: BlobContentKeyExecutor,
): Promise<StoredBlobContentKeyBundle> {
  return {
    blobId: row.blobId,
    contentKeyEpoch: row.contentKeyEpoch,
    targetHash: row.targetHash,
    targets: await listBlobContentKeyTargetRows(row.id, executor),
  };
}

async function getBlobContentKeyBundle(
  blobId: string,
  contentKeyEpoch: number,
  executor: BlobContentKeyExecutor = db,
): Promise<StoredBlobContentKeyBundle | null> {
  const row = await loadBlobContentKeyEpochRow(
    blobId,
    contentKeyEpoch,
    executor,
  );
  return row ? toStoredBundle(row, executor) : null;
}

async function getLatestBlobContentKeyBundle(
  blobId: string,
  executor: BlobContentKeyExecutor = db,
): Promise<StoredBlobContentKeyBundle | null> {
  const row = await loadLatestBlobContentKeyEpochRow(blobId, executor);
  return row ? toStoredBundle(row, executor) : null;
}

async function insertBlobContentKeyTargets(input: {
  readonly blobContentKeyEpochId: string;
  readonly executor: BlobContentKeyExecutor;
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

async function createBlobContentKeyBundle(
  input: StoreBlobContentKeyBundleInput,
  executor: BlobContentKeyExecutor,
): Promise<StoredBlobContentKeyBundle> {
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

  const epochRow =
    row ??
    (await loadBlobContentKeyEpochRow(
      input.blobId,
      input.contentKeyEpoch,
      executor,
    ));

  if (!epochRow) {
    throw new BlobContentKeyBundleError(
      "Failed to load blob content-key epoch",
      409,
    );
  }

  await insertBlobContentKeyTargets({
    blobContentKeyEpochId: epochRow.id,
    executor,
    targets: input.targets,
  });

  const storedBundle = await toStoredBundle(epochRow, executor);
  if (!targetEnvelopeBundlesEqual(storedBundle.targets, input.targets)) {
    throw new BlobContentKeyBundleError(
      "Blob content-key bundle conflict",
      409,
    );
  }

  return storedBundle;
}

async function addBlobContentKeyTargetsToExistingBundle(input: {
  readonly existingBundle: StoredBlobContentKeyBundle;
  readonly nextBundle: StoreBlobContentKeyBundleInput;
  readonly executor: BlobContentKeyExecutor;
}): Promise<StoredBlobContentKeyBundle> {
  const existingByTargetKey = new Map(
    input.existingBundle.targets.map((target) => [targetKey(target), target]),
  );
  const nextByTargetKey = new Map(
    input.nextBundle.targets.map((target) => [targetKey(target), target]),
  );

  for (const target of input.existingBundle.targets) {
    const nextTarget = nextByTargetKey.get(targetKey(target));
    if (!nextTarget || !targetEnvelopeEqual(target, nextTarget)) {
      throw new BlobContentKeyBundleError(
        "Blob content-key bundle conflict",
        409,
      );
    }
  }

  const newTargets = input.nextBundle.targets.filter(
    (target) => !existingByTargetKey.has(targetKey(target)),
  );
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
  await insertBlobContentKeyTargets({
    blobContentKeyEpochId: epochRow.id,
    executor: input.executor,
    targets: newTargets,
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
  executor: BlobContentKeyExecutor,
): Promise<CurrentBlobKekTargets> {
  ensureContentKeyEpoch(input.contentKeyEpoch);
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

function assertContentKeyBundleCanBeStored(input: {
  readonly latestBundle: StoredBlobContentKeyBundle | null;
  readonly latestTargetsStillCurrent: boolean;
}): void {
  if (input.latestBundle && !input.latestTargetsStillCurrent) {
    throw new BlobContentKeyBundleError(
      "Blob content-key targets shrank; replace the blob",
      409,
    );
  }
}

async function refreshExistingBundleMetadata(input: {
  readonly existingBundle: StoredBlobContentKeyBundle;
  readonly nextBundle: StoreBlobContentKeyBundleInput;
  readonly executor: BlobContentKeyExecutor;
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

export async function storeBlobContentKeyBundle(
  input: StoreBlobContentKeyBundleInput,
  executor: BlobContentKeyExecutor = db,
): Promise<StoredBlobContentKeyBundle> {
  if (executor === db) {
    return db.transaction((tx) => storeBlobContentKeyBundle(input, tx));
  }

  const currentTargets = await validateCurrentTargetsForBundle(input, executor);
  const latestBundle = await getLatestBlobContentKeyBundle(
    input.blobId,
    executor,
  );

  const latestTargetsStillCurrent =
    !latestBundle ||
    currentTargetsContainPreviousBundle({
      currentTargets: currentTargets.targets,
      previousTargets: latestBundle.targets,
    });

  assertContentKeyBundleCanBeStored({
    latestBundle,
    latestTargetsStillCurrent,
  });

  const existingBundle = await getBlobContentKeyBundle(
    input.blobId,
    input.contentKeyEpoch,
    executor,
  );

  if (!existingBundle) {
    return createBlobContentKeyBundle(input, executor);
  }

  if (targetEnvelopeBundlesEqual(existingBundle.targets, input.targets)) {
    return refreshExistingBundleMetadata({
      existingBundle,
      nextBundle: input,
      executor,
    });
  }

  return addBlobContentKeyTargetsToExistingBundle({
    existingBundle,
    nextBundle: input,
    executor,
  });
}

export async function storeBlobContentWriteHeader(
  input: {
    readonly blobId: string;
    readonly header: WriteHeaderV2;
    readonly headerHash: string;
    readonly recordId: string;
  },
  executor: BlobContentKeyExecutor = db,
): Promise<void> {
  if (
    input.header.objectKind !== "blob" ||
    input.header.objectId !== input.blobId
  ) {
    throw new BlobContentKeyBundleError(
      "Blob write header does not match blob",
      409,
    );
  }

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

  if (inserted) {
    return;
  }

  const [existing] = await executor
    .select({ headerHash: blobContentWriteHeaders.headerHash })
    .from(blobContentWriteHeaders)
    .where(eq(blobContentWriteHeaders.recordId, input.recordId))
    .limit(1);

  if (!existing || existing.headerHash !== input.headerHash) {
    throw new BlobContentKeyBundleError("Blob write header conflict", 409);
  }
}

export async function listBlobContentWriteHeaders(
  recordIds: readonly string[],
  executor: BlobContentKeyExecutor = db,
): Promise<Map<string, { header: WriteHeaderV2; headerHash: string }>> {
  const uniqueRecordIds = [...new Set(recordIds)];
  if (uniqueRecordIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      recordId: blobContentWriteHeaders.recordId,
      header: blobContentWriteHeaders.header,
      headerHash: blobContentWriteHeaders.headerHash,
    })
    .from(blobContentWriteHeaders)
    .where(inArray(blobContentWriteHeaders.recordId, uniqueRecordIds));

  return new Map(
    rows.map((row) => [
      row.recordId,
      { header: row.header, headerHash: row.headerHash },
    ]),
  );
}

import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  attachmentBindings,
  blobs,
  objectAccessEpochs,
  objectRecipientEnvelopes,
} from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import {
  extractBlobRecipientEnvelopeEntries,
  type PersistedRecipientEnvelopeEntry,
} from "../utils/recipientEnvelopes";
import { computeAccessFingerprint } from "./accessFingerprint";
import {
  resolveDocumentAccessState,
  resolveDocumentAccessStates,
} from "./documentAccess";

const BLOB_OBJECT_TYPE = "blob";

type AccessLevel = "read" | "write" | "admin";
type BlobAccessExecutor = DatabaseExecutor;
type CurrentEpochRow = { epoch: number; accessFingerprint: string };
type ResolvedDocumentAccessState = Awaited<
  ReturnType<typeof resolveDocumentAccessState>
>;

interface EffectiveBlobRecipient {
  userId: string;
  accessLevel: AccessLevel;
  encapsulationPublicKey: string;
  keyFingerprint: string;
}

interface BlobAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  effectiveRecipients: EffectiveBlobRecipient[];
}

function accessLevelRank(accessLevel: AccessLevel): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

function mergeAccessLevel(
  current: AccessLevel | undefined,
  incoming: AccessLevel,
): AccessLevel {
  if (!current) {
    return incoming;
  }

  return accessLevelRank(incoming) > accessLevelRank(current)
    ? incoming
    : current;
}

async function getCurrentEpochRow(
  blobId: string,
  executor: BlobAccessExecutor = db,
): Promise<{ epoch: number; accessFingerprint: string } | null> {
  const [row] = await executor
    .select({
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
    })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, BLOB_OBJECT_TYPE),
        eq(objectAccessEpochs.objectId, blobId),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch))
    .limit(1);

  return row ?? null;
}

async function getCurrentEpochRows(
  blobIds: string[],
  executor: BlobAccessExecutor = db,
): Promise<Map<string, CurrentEpochRow>> {
  const uniqueBlobIds = uniqueSortedStrings(blobIds);

  if (uniqueBlobIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      blobId: objectAccessEpochs.objectId,
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
    })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, BLOB_OBJECT_TYPE),
        inArray(objectAccessEpochs.objectId, uniqueBlobIds),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch));

  const currentEpochByBlobId = new Map<string, CurrentEpochRow>();

  for (const row of rows) {
    if (currentEpochByBlobId.has(row.blobId)) {
      continue;
    }

    currentEpochByBlobId.set(row.blobId, {
      epoch: row.epoch,
      accessFingerprint: row.accessFingerprint,
    });
  }

  return currentEpochByBlobId;
}

async function writeEpoch(
  blobId: string,
  epoch: number,
  accessFingerprint: string,
  executor: BlobAccessExecutor = db,
) {
  await executor.insert(objectAccessEpochs).values({
    objectType: BLOB_OBJECT_TYPE,
    objectId: blobId,
    epoch,
    accessFingerprint,
    updatedAt: new Date(),
  });
}

async function listLinkedDocumentIds(
  blobId: string,
  executor: BlobAccessExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ documentId: attachmentBindings.documentId })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.blobId, blobId),
        isNull(attachmentBindings.detachedAt),
      ),
    );

  return uniqueSortedStrings(rows.map((row) => row.documentId));
}

async function listLinkedDocumentIdsByBlobId(
  blobIds: string[],
  executor: BlobAccessExecutor = db,
): Promise<Map<string, string[]>> {
  const linkedDocumentIdsByBlobId = new Map<string, string[]>();

  for (const blobId of blobIds) {
    linkedDocumentIdsByBlobId.set(blobId, []);
  }

  if (blobIds.length === 0) {
    return linkedDocumentIdsByBlobId;
  }

  const rows = await executor
    .select({
      blobId: attachmentBindings.blobId,
      documentId: attachmentBindings.documentId,
    })
    .from(attachmentBindings)
    .where(
      and(
        inArray(attachmentBindings.blobId, blobIds),
        isNull(attachmentBindings.detachedAt),
      ),
    );

  for (const row of rows) {
    const linkedDocumentIds = linkedDocumentIdsByBlobId.get(row.blobId);
    if (!linkedDocumentIds) {
      linkedDocumentIdsByBlobId.set(row.blobId, [row.documentId]);
      continue;
    }
    linkedDocumentIds.push(row.documentId);
  }

  for (const [blobId, linkedDocumentIds] of linkedDocumentIdsByBlobId) {
    linkedDocumentIdsByBlobId.set(
      blobId,
      uniqueSortedStrings(linkedDocumentIds),
    );
  }

  return linkedDocumentIdsByBlobId;
}

async function resolveBlobAccessInputs(
  blobId: string,
  executor: BlobAccessExecutor = db,
  documentAccessStateById?: ReadonlyMap<string, ResolvedDocumentAccessState>,
  providedLinkedDocumentIds?: string[],
) {
  const linkedDocumentIds =
    providedLinkedDocumentIds ??
    (await listLinkedDocumentIds(blobId, executor));
  const linkedDocumentStates = (
    await Promise.all(
      linkedDocumentIds.map(
        (documentId) =>
          documentAccessStateById?.get(documentId) ??
          resolveDocumentAccessState(documentId, executor),
      ),
    )
  ).filter((state) => state !== null);

  const recipientsByUserId = new Map<string, EffectiveBlobRecipient>();

  for (const state of linkedDocumentStates) {
    for (const recipient of state.effectiveRecipients) {
      const existing = recipientsByUserId.get(recipient.userId);
      recipientsByUserId.set(recipient.userId, {
        userId: recipient.userId,
        accessLevel: existing
          ? mergeAccessLevel(existing.accessLevel, recipient.accessLevel)
          : recipient.accessLevel,
        encapsulationPublicKey: recipient.encapsulationPublicKey,
        keyFingerprint: recipient.keyFingerprint,
      });
    }
  }

  const effectiveRecipients = Array.from(recipientsByUserId.values()).sort(
    (left, right) => left.keyFingerprint.localeCompare(right.keyFingerprint),
  );

  return {
    linkedDocumentIds,
    linkedDocumentStates,
    effectiveRecipients,
  };
}

async function computeBlobAccessFingerprint(input: {
  blobId: string;
  linkedDocumentIds: string[];
  linkedDocumentFingerprints: string[];
  effectiveRecipients: EffectiveBlobRecipient[];
}) {
  return computeAccessFingerprint({
    objectType: BLOB_OBJECT_TYPE,
    blobId: input.blobId,
    linkedDocumentIds: input.linkedDocumentIds,
    linkedDocumentFingerprints: input.linkedDocumentFingerprints,
    recipients: input.effectiveRecipients.map((recipient) => ({
      userId: recipient.userId,
      accessLevel: recipient.accessLevel,
      keyFingerprint: recipient.keyFingerprint,
    })),
  });
}

async function replaceRecipientEnvelopes(
  blobId: string,
  epoch: number,
  recipients: ReadonlyArray<{ userId: string; keyFingerprint: string }>,
  envelopeEntries: ReadonlyArray<SerializedRecipientEnvelope>,
  executor: BlobAccessExecutor = db,
) {
  await executor
    .delete(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, BLOB_OBJECT_TYPE),
        eq(objectRecipientEnvelopes.objectId, blobId),
        eq(objectRecipientEnvelopes.epoch, epoch),
      ),
    );

  if (envelopeEntries.length === 0) {
    return;
  }

  const recipientByKeyFingerprint = new Map(
    recipients.map((recipient) => [recipient.keyFingerprint, recipient]),
  );

  await executor.insert(objectRecipientEnvelopes).values(
    envelopeEntries.map((envelopeEntry) => ({
      objectType: BLOB_OBJECT_TYPE,
      objectId: blobId,
      epoch,
      recipientUserId:
        recipientByKeyFingerprint.get(envelopeEntry.keyFingerprint)?.userId ??
        "",
      recipientKeyFingerprint: envelopeEntry.keyFingerprint,
      kemCipherText: envelopeEntry.kemCipherText,
      wrappedKey: envelopeEntry.wrappedKey,
    })),
  );
}

async function getBlobRecipientEnvelopeEntries(
  blobId: string,
  executor: BlobAccessExecutor = db,
): Promise<PersistedRecipientEnvelopeEntry[] | null> {
  const [blob] = await executor
    .select({ encryptedBytes: blobs.encryptedBytes })
    .from(blobs)
    .where(eq(blobs.id, blobId))
    .limit(1);

  if (!blob) {
    return null;
  }

  try {
    return extractBlobRecipientEnvelopeEntries(blob.encryptedBytes);
  } catch {
    return null;
  }
}

function envelopeEntriesMatchRecipients(
  envelopeEntries: ReadonlyArray<{ keyFingerprint: string }>,
  recipients: ReadonlyArray<{ keyFingerprint: string }>,
): boolean {
  const envelopeFingerprints = uniqueSortedStrings(
    envelopeEntries.map((entry) => entry.keyFingerprint),
  );
  const recipientFingerprints = uniqueSortedStrings(
    recipients.map((recipient) => recipient.keyFingerprint),
  );

  return (
    envelopeFingerprints.length === recipientFingerprints.length &&
    envelopeFingerprints.every(
      (fingerprint, index) => fingerprint === recipientFingerprints[index],
    )
  );
}

export function blobRecipientEnvelopesMatchRecipients(
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
  recipients: ReadonlyArray<{ keyFingerprint: string }>,
): boolean {
  return envelopeEntriesMatchRecipients(envelopes, recipients);
}

export async function listBlobRecipientEnvelopes(
  blobId: string,
  epoch: number,
  executor: BlobAccessExecutor = db,
): Promise<SerializedRecipientEnvelope[] | null> {
  const rows = await executor
    .select({
      keyFingerprint: objectRecipientEnvelopes.recipientKeyFingerprint,
      kemCipherText: objectRecipientEnvelopes.kemCipherText,
      wrappedKey: objectRecipientEnvelopes.wrappedKey,
    })
    .from(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, BLOB_OBJECT_TYPE),
        eq(objectRecipientEnvelopes.objectId, blobId),
        eq(objectRecipientEnvelopes.epoch, epoch),
      ),
    );

  if (rows.length === 0) {
    return null;
  }

  return rows
    .filter(
      (
        row,
      ): row is {
        keyFingerprint: string;
        kemCipherText: string;
        wrappedKey: string;
      } => !!row.kemCipherText && !!row.wrappedKey,
    )
    .sort((left, right) =>
      left.keyFingerprint.localeCompare(right.keyFingerprint),
    )
    .map((row) => ({
      keyFingerprint: row.keyFingerprint,
      kemCipherText: row.kemCipherText,
      wrappedKey: row.wrappedKey,
    }));
}

export async function replaceBlobRecipientEnvelopes(
  blobId: string,
  epoch: number,
  recipients: ReadonlyArray<{ userId: string; keyFingerprint: string }>,
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
  executor: BlobAccessExecutor = db,
): Promise<void> {
  if (!blobRecipientEnvelopesMatchRecipients(envelopes, recipients)) {
    throw new Error("Blob recipient envelopes mismatch");
  }

  await replaceRecipientEnvelopes(
    blobId,
    epoch,
    recipients,
    envelopes,
    executor,
  );
}

async function resolveMaterializedRecipientEnvelopes(
  blobId: string,
  epoch: number,
  effectiveRecipients: ReadonlyArray<EffectiveBlobRecipient>,
  executor: BlobAccessExecutor = db,
): Promise<SerializedRecipientEnvelope[]> {
  const persistedEnvelopeEntries = await listBlobRecipientEnvelopes(
    blobId,
    epoch,
    executor,
  );
  if (
    persistedEnvelopeEntries &&
    envelopeEntriesMatchRecipients(
      persistedEnvelopeEntries,
      effectiveRecipients,
    )
  ) {
    return persistedEnvelopeEntries;
  }

  const blobEnvelopeEntries = await getBlobRecipientEnvelopeEntries(
    blobId,
    executor,
  );
  return blobEnvelopeEntries &&
    envelopeEntriesMatchRecipients(blobEnvelopeEntries, effectiveRecipients)
    ? blobEnvelopeEntries
    : [];
}

async function materializeBlobAccessState(
  blobId: string,
  executor: BlobAccessExecutor = db,
  documentAccessStateById?: ReadonlyMap<string, ResolvedDocumentAccessState>,
  providedLinkedDocumentIds?: string[],
  currentEpochRow?: CurrentEpochRow | null,
): Promise<number | null> {
  const resolvedCurrentEpochRow =
    currentEpochRow ?? (await getCurrentEpochRow(blobId, executor));
  const { linkedDocumentIds, linkedDocumentStates, effectiveRecipients } =
    await resolveBlobAccessInputs(
      blobId,
      executor,
      documentAccessStateById,
      providedLinkedDocumentIds,
    );

  if (resolvedCurrentEpochRow === null && linkedDocumentStates.length === 0) {
    return null;
  }

  const accessFingerprint = await computeBlobAccessFingerprint({
    blobId,
    linkedDocumentIds,
    linkedDocumentFingerprints: linkedDocumentStates.map(
      (state) => state.accessFingerprint,
    ),
    effectiveRecipients,
  });
  const linkedEpoch = Math.max(
    1,
    ...linkedDocumentStates.map((state) => state.currentAccessEpoch),
  );
  const nextEpoch =
    resolvedCurrentEpochRow === null
      ? linkedEpoch
      : resolvedCurrentEpochRow.accessFingerprint === accessFingerprint
        ? Math.max(resolvedCurrentEpochRow.epoch, linkedEpoch)
        : Math.max(resolvedCurrentEpochRow.epoch + 1, linkedEpoch);
  const persistedEnvelopeEntries = await resolveMaterializedRecipientEnvelopes(
    blobId,
    nextEpoch,
    effectiveRecipients,
    executor,
  );

  if (
    resolvedCurrentEpochRow === null ||
    resolvedCurrentEpochRow.epoch !== nextEpoch ||
    resolvedCurrentEpochRow.accessFingerprint !== accessFingerprint
  ) {
    await writeEpoch(blobId, nextEpoch, accessFingerprint, executor);
    await replaceRecipientEnvelopes(
      blobId,
      nextEpoch,
      effectiveRecipients,
      persistedEnvelopeEntries,
      executor,
    );
  }

  return nextEpoch;
}

export async function resolveBlobAccessState(
  blobId: string,
  executor: BlobAccessExecutor = db,
): Promise<BlobAccessState | null> {
  const currentEpochRow = await getCurrentEpochRow(blobId, executor);
  const { linkedDocumentIds, linkedDocumentStates, effectiveRecipients } =
    await resolveBlobAccessInputs(blobId, executor);

  if (currentEpochRow === null && linkedDocumentStates.length === 0) {
    return null;
  }

  const accessFingerprint = await computeBlobAccessFingerprint({
    blobId,
    linkedDocumentIds,
    linkedDocumentFingerprints: linkedDocumentStates.map(
      (state) => state.accessFingerprint,
    ),
    effectiveRecipients,
  });
  const currentAccessEpoch = Math.max(
    currentEpochRow?.epoch ?? 1,
    ...linkedDocumentStates.map((state) => state.currentAccessEpoch),
  );

  return {
    currentAccessEpoch,
    accessFingerprint,
    effectiveRecipients,
  };
}

export function canReadBlobAccess(
  state: BlobAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) => recipient.userId === userId,
  );
}

export async function initializeBlobAccess(blobId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [blob] = await tx
      .select({ id: blobs.id })
      .from(blobs)
      .where(eq(blobs.id, blobId))
      .limit(1);

    if (!blob) {
      throw new Error(`Blob ${blobId} does not exist`);
    }

    const epoch = await materializeBlobAccessState(blobId, tx);
    if (epoch === null) {
      throw new Error(`Blob ${blobId} access state could not be initialized`);
    }
    return epoch;
  });
}

export async function refreshBlobAccesses(
  blobIds: string[],
  executor: BlobAccessExecutor = db,
): Promise<Map<string, number | null>> {
  const uniqueBlobIds = uniqueSortedStrings(blobIds);
  const linkedDocumentIdsByBlobId = await listLinkedDocumentIdsByBlobId(
    uniqueBlobIds,
    executor,
  );
  const documentAccessStateById = await resolveDocumentAccessStates(
    Array.from(linkedDocumentIdsByBlobId.values()).flat(),
    executor,
  );
  const currentEpochByBlobId = await getCurrentEpochRows(
    uniqueBlobIds,
    executor,
  );
  const refreshedEpochEntries = await Promise.all(
    uniqueBlobIds.map(
      async (blobId): Promise<[string, number | null]> => [
        blobId,
        await materializeBlobAccessState(
          blobId,
          executor,
          documentAccessStateById,
          linkedDocumentIdsByBlobId.get(blobId),
          currentEpochByBlobId.get(blobId) ?? null,
        ),
      ],
    ),
  );

  return new Map(refreshedEpochEntries);
}

export async function attachBlobToDocument(
  blobId: string,
  documentId: string,
  slotId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [existingBinding] = await tx
      .select({
        id: attachmentBindings.id,
      })
      .from(attachmentBindings)
      .where(
        and(
          eq(attachmentBindings.documentId, documentId),
          eq(attachmentBindings.slotId, slotId),
          isNull(attachmentBindings.detachedAt),
        ),
      )
      .limit(1);

    if (existingBinding) {
      await tx
        .update(attachmentBindings)
        .set({
          detachedAt: new Date(),
        })
        .where(eq(attachmentBindings.id, existingBinding.id));
    }

    await tx
      .insert(attachmentBindings)
      .values({
        blobId,
        documentId,
        slotId,
        previousBindingId: existingBinding?.id ?? null,
      })
      .returning({ id: attachmentBindings.id });

    const epoch = await materializeBlobAccessState(blobId, tx);
    if (epoch === null) {
      throw new Error(`Blob ${blobId} access state could not be materialized`);
    }
    return epoch;
  });
}

import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { and, desc, eq, isNull } from "drizzle-orm";
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
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "./accessFingerprint";
import { resolveDocumentAccessState } from "./documentAccess";
import {
  type EffectivePrincipalRecipient,
  isUserPrincipalRecipient,
  mergeAccessLevel,
  type PrincipalEnvelopeRecipient,
  principalRecipientKey,
  toPrincipalEnvelopeRecipient,
  toPrincipalFingerprintRecipient,
} from "./recipientPrincipals";

const BLOB_OBJECT_TYPE = "blob";

type BlobAccessExecutor = DatabaseExecutor;
type CurrentEpochRow = {
  epoch: number;
  accessFingerprint: string;
  accessStateHash: string | null;
};
type ResolvedDocumentAccessState = Awaited<
  ReturnType<typeof resolveDocumentAccessState>
>;

type EffectiveBlobRecipient = EffectivePrincipalRecipient;

interface BlobAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  accessStateHash: string;
  effectiveRecipients: EffectiveBlobRecipient[];
  cryptoRecipients: EffectiveBlobRecipient[];
}

function isResolvedDocumentAccessState(
  value: ResolvedDocumentAccessState,
): value is Exclude<ResolvedDocumentAccessState, null> {
  return value !== null;
}

async function getCurrentEpochRow(
  blobId: string,
  executor: BlobAccessExecutor = db,
): Promise<CurrentEpochRow | null> {
  const [row] = await executor
    .select({
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
      accessStateHash: objectAccessEpochs.accessStateHash,
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

async function writeEpoch(
  blobId: string,
  epoch: number,
  accessFingerprint: string,
  accessStateHash: string,
  executor: BlobAccessExecutor = db,
) {
  await executor.insert(objectAccessEpochs).values({
    objectType: BLOB_OBJECT_TYPE,
    objectId: blobId,
    epoch,
    accessFingerprint,
    accessStateHash,
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

async function resolveBlobAccessInputs(
  blobId: string,
  executor: BlobAccessExecutor = db,
  documentAccessStateById?: ReadonlyMap<string, ResolvedDocumentAccessState>,
  providedLinkedDocumentIds?: string[],
) {
  const linkedDocumentIds =
    providedLinkedDocumentIds ??
    (await listLinkedDocumentIds(blobId, executor));
  const resolvedLinkedDocumentStates = await Promise.all(
    linkedDocumentIds.map(
      (documentId) =>
        documentAccessStateById?.get(documentId) ??
        resolveDocumentAccessState(documentId, executor),
    ),
  );
  const linkedDocumentStates = resolvedLinkedDocumentStates.filter(
    isResolvedDocumentAccessState,
  );

  const recipientsByPrincipalKey = new Map<string, EffectiveBlobRecipient>();
  const cryptoRecipientsByPrincipalKey = new Map<
    string,
    EffectiveBlobRecipient
  >();

  for (const state of linkedDocumentStates) {
    for (const recipient of state.effectiveRecipients) {
      const principalKey = principalRecipientKey(recipient);
      const existing = recipientsByPrincipalKey.get(principalKey);
      recipientsByPrincipalKey.set(principalKey, {
        principalType: recipient.principalType,
        principalId: recipient.principalId,
        accessLevel: existing
          ? mergeAccessLevel(existing.accessLevel, recipient.accessLevel)
          : recipient.accessLevel,
        encapsulationPublicKey: recipient.encapsulationPublicKey,
        keyFingerprint: recipient.keyFingerprint,
      });
    }

    for (const recipient of state.cryptoRecipients) {
      const principalKey = principalRecipientKey(recipient);
      const existing = cryptoRecipientsByPrincipalKey.get(principalKey);
      cryptoRecipientsByPrincipalKey.set(principalKey, {
        principalType: recipient.principalType,
        principalId: recipient.principalId,
        accessLevel: existing
          ? mergeAccessLevel(existing.accessLevel, recipient.accessLevel)
          : recipient.accessLevel,
        encapsulationPublicKey: recipient.encapsulationPublicKey,
        keyFingerprint: recipient.keyFingerprint,
      });
    }
  }

  const effectiveRecipients = Array.from(
    recipientsByPrincipalKey.values(),
  ).sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
  const cryptoRecipients = Array.from(
    cryptoRecipientsByPrincipalKey.values(),
  ).sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );

  return {
    linkedDocumentIds,
    linkedDocumentStates,
    hasUnavailableLinkedDocuments:
      linkedDocumentStates.length !== linkedDocumentIds.length,
    effectiveRecipients,
    cryptoRecipients,
  };
}

async function computeBlobAccessFingerprint(input: {
  blobId: string;
  linkedDocumentIds: string[];
  linkedDocumentFingerprints: string[];
  cryptoRecipients: EffectiveBlobRecipient[];
}) {
  return computeAccessFingerprint({
    objectType: BLOB_OBJECT_TYPE,
    blobId: input.blobId,
    linkedDocumentIds: input.linkedDocumentIds,
    linkedDocumentFingerprints: input.linkedDocumentFingerprints,
    recipients: input.cryptoRecipients.map(toPrincipalFingerprintRecipient),
  });
}

async function computeBlobAccessStateHash(input: {
  blobId: string;
  linkedDocumentIds: string[];
  linkedDocumentStates: Exclude<ResolvedDocumentAccessState, null>[];
}) {
  return computeAccessStateHash({
    objectType: BLOB_OBJECT_TYPE,
    blobId: input.blobId,
    linkedDocuments: input.linkedDocumentIds.map((documentId, index) => {
      const linkedDocumentState = input.linkedDocumentStates[index];

      if (!linkedDocumentState) {
        throw new Error(
          `Invariant violation: linked document state missing for ${documentId}`,
        );
      }

      return {
        documentId,
        accessStateHash: linkedDocumentState.accessStateHash,
      };
    }),
  });
}

async function replaceRecipientEnvelopes(
  blobId: string,
  epoch: number,
  recipients: ReadonlyArray<PrincipalEnvelopeRecipient>,
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
    envelopeEntries.map((envelopeEntry) => {
      if (
        envelopeEntry.kemCipherText.length === 0 ||
        envelopeEntry.wrappedKey.length === 0
      ) {
        throw new Error(
          `Blob recipient envelope is missing wrapped material for ${envelopeEntry.keyFingerprint}`,
        );
      }

      const recipient = recipientByKeyFingerprint.get(
        envelopeEntry.keyFingerprint,
      );
      if (!recipient) {
        throw new Error(
          `Invariant violation: recipient not found for key fingerprint ${envelopeEntry.keyFingerprint}`,
        );
      }

      const principalRecipient = toPrincipalEnvelopeRecipient(recipient);

      return {
        objectType: BLOB_OBJECT_TYPE,
        objectId: blobId,
        epoch,
        recipientPrincipalType: principalRecipient.principalType,
        recipientPrincipalId: principalRecipient.principalId,
        recipientKeyFingerprint: envelopeEntry.keyFingerprint,
        kemCipherText: envelopeEntry.kemCipherText,
        wrappedKey: envelopeEntry.wrappedKey,
      };
    }),
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
    .sort((left, right) =>
      left.keyFingerprint.localeCompare(right.keyFingerprint),
    )
    .map((row) => ({
      keyFingerprint: row.keyFingerprint,
      kemCipherText: row.kemCipherText,
      wrappedKey: row.wrappedKey,
    }));
}

async function resolveMaterializedRecipientEnvelopes(
  blobId: string,
  epoch: number,
  cryptoRecipients: ReadonlyArray<EffectiveBlobRecipient>,
  executor: BlobAccessExecutor = db,
): Promise<SerializedRecipientEnvelope[]> {
  const persistedEnvelopeEntries = await listBlobRecipientEnvelopes(
    blobId,
    epoch,
    executor,
  );
  if (
    persistedEnvelopeEntries &&
    envelopeEntriesMatchRecipients(persistedEnvelopeEntries, cryptoRecipients)
  ) {
    return persistedEnvelopeEntries;
  }

  const blobEnvelopeEntries = await getBlobRecipientEnvelopeEntries(
    blobId,
    executor,
  );
  return blobEnvelopeEntries &&
    envelopeEntriesMatchRecipients(blobEnvelopeEntries, cryptoRecipients)
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
  const {
    linkedDocumentIds,
    linkedDocumentStates,
    hasUnavailableLinkedDocuments,
    cryptoRecipients,
  } = await resolveBlobAccessInputs(
    blobId,
    executor,
    documentAccessStateById,
    providedLinkedDocumentIds,
  );

  if (hasUnavailableLinkedDocuments) {
    return null;
  }

  if (resolvedCurrentEpochRow === null && linkedDocumentStates.length === 0) {
    return null;
  }

  const accessFingerprint = await computeBlobAccessFingerprint({
    blobId,
    linkedDocumentIds,
    linkedDocumentFingerprints: linkedDocumentStates.map(
      (state) => state.accessFingerprint,
    ),
    cryptoRecipients,
  });
  const accessStateHash = await computeBlobAccessStateHash({
    blobId,
    linkedDocumentIds,
    linkedDocumentStates,
  });
  const linkedEpoch = Math.max(
    1,
    ...linkedDocumentStates.map((state) => state.currentAccessEpoch),
  );
  const nextEpoch =
    resolvedCurrentEpochRow === null
      ? linkedEpoch
      : resolvedCurrentEpochRow.accessFingerprint === accessFingerprint &&
          resolvedCurrentEpochRow.accessStateHash === accessStateHash
        ? Math.max(resolvedCurrentEpochRow.epoch, linkedEpoch)
        : Math.max(resolvedCurrentEpochRow.epoch + 1, linkedEpoch);
  const persistedEnvelopeEntries = await resolveMaterializedRecipientEnvelopes(
    blobId,
    nextEpoch,
    cryptoRecipients,
    executor,
  );

  if (
    resolvedCurrentEpochRow === null ||
    resolvedCurrentEpochRow.epoch !== nextEpoch ||
    resolvedCurrentEpochRow.accessFingerprint !== accessFingerprint ||
    resolvedCurrentEpochRow.accessStateHash !== accessStateHash
  ) {
    await writeEpoch(
      blobId,
      nextEpoch,
      accessFingerprint,
      accessStateHash,
      executor,
    );
    await replaceRecipientEnvelopes(
      blobId,
      nextEpoch,
      cryptoRecipients,
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
  const {
    linkedDocumentIds,
    linkedDocumentStates,
    hasUnavailableLinkedDocuments,
    effectiveRecipients,
    cryptoRecipients,
  } = await resolveBlobAccessInputs(blobId, executor);

  if (hasUnavailableLinkedDocuments) {
    return null;
  }

  if (currentEpochRow === null && linkedDocumentStates.length === 0) {
    return null;
  }

  const accessFingerprint = await computeBlobAccessFingerprint({
    blobId,
    linkedDocumentIds,
    linkedDocumentFingerprints: linkedDocumentStates.map(
      (state) => state.accessFingerprint,
    ),
    cryptoRecipients,
  });
  const accessStateHash = await computeBlobAccessStateHash({
    blobId,
    linkedDocumentIds,
    linkedDocumentStates,
  });
  const currentAccessEpoch = Math.max(
    currentEpochRow?.epoch ?? 1,
    ...linkedDocumentStates.map((state) => state.currentAccessEpoch),
  );

  return {
    currentAccessEpoch,
    accessFingerprint,
    accessStateHash,
    effectiveRecipients,
    cryptoRecipients,
  };
}

export function canReadBlobAccess(
  state: BlobAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some((recipient) =>
    isUserPrincipalRecipient(recipient, userId),
  );
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

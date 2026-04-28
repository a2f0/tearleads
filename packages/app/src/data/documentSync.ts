import { type RecipientEntry, wrapDekForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  decryptLoroUpdate,
  encryptLoroUpdate,
  getUpdateVersionVectors,
  type SerializedRecipientEnvelope,
  type SyncDocumentOutgoingUpdate,
  type SyncDocumentResponse,
} from "@tearleads/loro";
import type {
  PendingUpdateFields,
  PendingUpdateRecord,
} from "./persistence/documentPersistence";
import type { ExecSql } from "./persistence/sqlSchema";
import { unwrapRecipientEnvelopesWithPrincipalPolicies } from "./principalPolicyCrypto";

interface DocumentUpdateCreatedEvent {
  type: "document_update_created";
  documentId: string;
}

interface DocumentEncryptionMaterial {
  documentKey: Uint8Array;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[];
}

interface IncomingUpdateDecryptionBatch {
  accessEpoch: number;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[];
  updates: SyncDocumentResponse["updates"];
}

function sortDocumentRecipientEnvelopes(
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
): SerializedRecipientEnvelope[] {
  return [...envelopes].sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
}

function serializeRecipientEntry(
  recipient: RecipientEntry,
): SerializedRecipientEnvelope {
  return {
    keyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
  };
}

export function getLocalRecipientPublicKeys(
  encapsulationKeyPair:
    | {
        publicKey: Uint8Array;
      }
    | null
    | undefined,
): Uint8Array[] {
  return encapsulationKeyPair ? [encapsulationKeyPair.publicKey] : [];
}

export function resolveRecipientPublicKeys(
  encodedPublicKeys: string[],
): Uint8Array[] {
  return encodedPublicKeys.map((publicKey) => base64ToBytes(publicKey));
}

export function createPendingUpdateFields(
  update: Uint8Array,
  sourceVersionVector?: string | null,
): PendingUpdateFields | null {
  if (update.byteLength === 0) {
    return null;
  }

  const { partialEndVersionVector, partialStartVersionVector } =
    getUpdateVersionVectors(update);

  return {
    updateData: bytesToBase64(update),
    partialStartVersionVector,
    partialEndVersionVector,
    sourceVersionVector: sourceVersionVector ?? null,
  };
}

export function serializeDocumentRecipientEnvelopes(
  envelopes: ReadonlyArray<SerializedRecipientEnvelope> | null,
): string | null {
  if (!envelopes || envelopes.length === 0) {
    return null;
  }

  return JSON.stringify(sortDocumentRecipientEnvelopes(envelopes));
}

export async function createDocumentEncryptionMaterial(
  recipientPublicKeys: Uint8Array[],
): Promise<DocumentEncryptionMaterial> {
  if (recipientPublicKeys.length === 0) {
    throw new Error("Cannot create a document key without recipients");
  }

  const documentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrappedRecipients = await wrapDekForRecipients(
    documentKey,
    recipientPublicKeys,
  );

  return {
    documentKey,
    documentRecipientEnvelopes: sortDocumentRecipientEnvelopes(
      wrappedRecipients.map((recipient) => serializeRecipientEntry(recipient)),
    ),
  };
}

async function unwrapDocumentKey(
  documentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope>,
  secretKey: Uint8Array,
  execSql?: ExecSql,
): Promise<Uint8Array> {
  return unwrapRecipientEnvelopesWithPrincipalPolicies({
    envelopes: sortDocumentRecipientEnvelopes(documentRecipientEnvelopes),
    execSql,
    secretKey,
  });
}

async function rewrapDocumentRecipientEnvelopes(input: {
  documentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope>;
  execSql?: ExecSql | undefined;
  recipientPublicKeys: Uint8Array[];
  secretKey: Uint8Array;
}): Promise<SerializedRecipientEnvelope[]> {
  const documentKey = await unwrapDocumentKey(
    input.documentRecipientEnvelopes,
    input.secretKey,
    input.execSql,
  );
  const wrappedRecipients = await wrapDekForRecipients(
    documentKey,
    input.recipientPublicKeys,
  );

  return sortDocumentRecipientEnvelopes(
    wrappedRecipients.map((recipient) => serializeRecipientEntry(recipient)),
  );
}

export async function maybeSeedRewrappedDocumentRecipientEnvelopes(input: {
  currentAccessEpoch: number;
  currentDocumentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope> | null;
  documentId: string;
  execSql?: ExecSql | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  recipientPublicKeys: Uint8Array[];
  secretKey: Uint8Array;
  syncDocument: (
    documentId: string,
    accessEpoch: number,
    localVersionVector: string | null,
    outgoingUpdates: SyncDocumentOutgoingUpdate[],
    documentRecipientEnvelopes?: SerializedRecipientEnvelope[],
    minLsn?: string,
    expectedAccessStateHash?: string,
  ) => Promise<SyncDocumentResponse | null>;
  synced: SyncDocumentResponse;
}): Promise<SyncDocumentResponse> {
  const {
    currentDocumentRecipientEnvelopes,
    documentId,
    execSql,
    localVersionVector,
    minLsn,
    recipientPublicKeys,
    secretKey,
    syncDocument,
    synced,
  } = input;

  if (
    synced.documentRecipientEnvelopeAction !== "rewrap" ||
    synced.documentRecipientEnvelopes !== null ||
    !currentDocumentRecipientEnvelopes
  ) {
    return synced;
  }

  const rewrapRecipientPublicKeys =
    synced.recipientEncapsulationPublicKeys.length > 0
      ? resolveRecipientPublicKeys(synced.recipientEncapsulationPublicKeys)
      : recipientPublicKeys;
  const rewrappedDocumentRecipientEnvelopes =
    await rewrapDocumentRecipientEnvelopes({
      documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
      execSql,
      recipientPublicKeys: rewrapRecipientPublicKeys,
      secretKey,
    });
  const rewrappedSync = await syncDocument(
    documentId,
    synced.currentAccessEpoch,
    localVersionVector,
    [],
    rewrappedDocumentRecipientEnvelopes,
    synced.commitLsn ?? minLsn,
    synced.currentAccessStateHash,
  );

  return rewrappedSync ?? synced;
}

function groupUpdatesByAccessEpoch(
  updates: ReadonlyArray<SyncDocumentResponse["updates"][number]>,
): Map<number, SyncDocumentResponse["updates"]> {
  const updatesByEpoch = new Map<number, SyncDocumentResponse["updates"]>();

  for (const update of updates) {
    const epochUpdates = updatesByEpoch.get(update.accessEpoch);
    if (epochUpdates) {
      epochUpdates.push(update);
      continue;
    }

    updatesByEpoch.set(update.accessEpoch, [update]);
  }

  return updatesByEpoch;
}

function resolveIncomingUpdateEnvelopesForEpoch(input: {
  accessEpoch: number;
  currentDocumentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope> | null;
  nextDocumentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope> | null;
  previousAccessEpoch: number;
  synced: SyncDocumentResponse;
}): ReadonlyArray<SerializedRecipientEnvelope> | null {
  if (input.accessEpoch === input.synced.currentAccessEpoch) {
    return (
      input.nextDocumentRecipientEnvelopes ??
      input.currentDocumentRecipientEnvelopes
    );
  }

  if (input.accessEpoch === input.previousAccessEpoch) {
    return (
      input.currentDocumentRecipientEnvelopes ??
      input.nextDocumentRecipientEnvelopes
    );
  }

  return (
    input.nextDocumentRecipientEnvelopes ??
    input.currentDocumentRecipientEnvelopes
  );
}

export function resolveIncomingUpdateDecryptionBatches(input: {
  currentDocumentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope> | null;
  nextDocumentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope> | null;
  previousAccessEpoch: number;
  synced: SyncDocumentResponse;
}): IncomingUpdateDecryptionBatch[] {
  const batches: IncomingUpdateDecryptionBatch[] = [];
  const sortedUpdatesByEpoch = Array.from(
    groupUpdatesByAccessEpoch(input.synced.updates).entries(),
  ).sort(([leftAccessEpoch], [rightAccessEpoch]) => {
    return leftAccessEpoch - rightAccessEpoch;
  });

  for (const [accessEpoch, updates] of sortedUpdatesByEpoch) {
    const documentRecipientEnvelopes = resolveIncomingUpdateEnvelopesForEpoch({
      accessEpoch,
      currentDocumentRecipientEnvelopes:
        input.currentDocumentRecipientEnvelopes,
      nextDocumentRecipientEnvelopes: input.nextDocumentRecipientEnvelopes,
      previousAccessEpoch: input.previousAccessEpoch,
      synced: input.synced,
    });

    if (
      !documentRecipientEnvelopes ||
      documentRecipientEnvelopes.length === 0
    ) {
      continue;
    }

    batches.push({
      accessEpoch,
      documentRecipientEnvelopes: sortDocumentRecipientEnvelopes(
        documentRecipientEnvelopes,
      ),
      updates,
    });
  }

  return batches;
}

export async function getOrCreateDocumentEncryptionMaterial(input: {
  documentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope> | null;
  execSql?: ExecSql;
  recipientPublicKeys: Uint8Array[];
  secretKey: Uint8Array;
}): Promise<DocumentEncryptionMaterial & { generated: boolean }> {
  if (
    input.documentRecipientEnvelopes &&
    input.documentRecipientEnvelopes.length > 0
  ) {
    return {
      documentKey: await unwrapDocumentKey(
        input.documentRecipientEnvelopes,
        input.secretKey,
        input.execSql,
      ),
      documentRecipientEnvelopes: sortDocumentRecipientEnvelopes(
        input.documentRecipientEnvelopes,
      ),
      generated: false,
    };
  }

  return {
    ...(await createDocumentEncryptionMaterial(input.recipientPublicKeys)),
    generated: true,
  };
}

export async function encryptPendingUpdates(
  pendingUpdates: ReadonlyArray<PendingUpdateRecord>,
  accessEpoch: number,
  documentKey: Uint8Array,
): Promise<SyncDocumentOutgoingUpdate[]> {
  return Promise.all(
    pendingUpdates.map(async (pendingUpdate) => {
      const updateBytes = base64ToBytes(pendingUpdate.updateData);
      const versionVectors =
        pendingUpdate.partialStartVersionVector &&
        pendingUpdate.partialEndVersionVector
          ? {
              partialStartVersionVector:
                pendingUpdate.partialStartVersionVector,
              partialEndVersionVector: pendingUpdate.partialEndVersionVector,
            }
          : getUpdateVersionVectors(updateBytes);

      return {
        id: pendingUpdate.id,
        encryptedData: await encryptLoroUpdate(
          updateBytes,
          accessEpoch,
          documentKey,
        ),
        partialStartVersionVector: versionVectors.partialStartVersionVector,
        partialEndVersionVector: versionVectors.partialEndVersionVector,
        ...(pendingUpdate.sourceVersionVector
          ? {
              checkpointKind: "rotate_baseline" as const,
              sourceVersionVector: pendingUpdate.sourceVersionVector,
            }
          : {}),
      };
    }),
  );
}

export async function decryptIncomingUpdates(
  encryptedUpdates: ReadonlyArray<{ encryptedData: string }>,
  accessEpoch: number,
  documentKey: Uint8Array,
  logSkippedUpdates?: (message: string) => void,
): Promise<Uint8Array[]> {
  const decryptedResults = await Promise.all(
    encryptedUpdates.map(async (update) => {
      try {
        return await decryptLoroUpdate(
          update.encryptedData,
          accessEpoch,
          documentKey,
        );
      } catch {
        return null;
      }
    }),
  );
  const decryptedUpdates: Uint8Array[] = [];
  let skippedUpdateCount = 0;

  for (const decryptedUpdate of decryptedResults) {
    if (decryptedUpdate) {
      decryptedUpdates.push(decryptedUpdate);
      continue;
    }

    skippedUpdateCount += 1;
  }

  if (skippedUpdateCount > 0 && logSkippedUpdates) {
    logSkippedUpdates(
      `Skipped ${skippedUpdateCount} undecryptable update(s) during document sync.`,
    );
  }

  return decryptedUpdates;
}

export function isDocumentUpdateCreatedEvent(
  event: unknown,
): event is DocumentUpdateCreatedEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "document_update_created" &&
    "documentId" in event &&
    typeof event.documentId === "string"
  );
}

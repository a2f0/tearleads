import { type RecipientEntry, wrapDekForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  decryptLoroUpdate,
  encryptLoroUpdate,
  getUpdateVersionVectors,
  type SerializedRecipientEnvelope,
  type SyncDocumentOutgoingUpdate,
} from "@tearleads/loro";
import type {
  PendingUpdateFields,
  PendingUpdateRecord,
} from "./documentPersistence";
import { unwrapRecipientEnvelopesWithPrincipalPolicies } from "./principalPolicyCrypto";
import type { ExecSql } from "./sqlSchema";

interface DocumentUpdateCreatedEvent {
  type: "document_update_created";
  documentId: string;
}

interface DocumentEncryptionMaterial {
  documentKey: Uint8Array;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[];
}

function isSerializedRecipientEnvelope(
  value: unknown,
): value is SerializedRecipientEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "keyFingerprint" in value &&
    typeof value.keyFingerprint === "string" &&
    "kemCipherText" in value &&
    typeof value.kemCipherText === "string" &&
    "wrappedKey" in value &&
    typeof value.wrappedKey === "string"
  );
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
  fallbackPublicKeys: Uint8Array[],
): Uint8Array[] {
  return encodedPublicKeys.length > 0
    ? encodedPublicKeys.map((publicKey) => base64ToBytes(publicKey))
    : fallbackPublicKeys;
}

export function createPendingUpdateFields(
  update: Uint8Array,
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

export function parseDocumentRecipientEnvelopes(
  serializedEnvelopes: string | null | undefined,
): SerializedRecipientEnvelope[] | null {
  if (!serializedEnvelopes) {
    return null;
  }

  try {
    const parsed = JSON.parse(serializedEnvelopes);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(isSerializedRecipientEnvelope)
    ) {
      return null;
    }

    return sortDocumentRecipientEnvelopes(parsed);
  } catch {
    return null;
  }
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

export async function rewrapDocumentRecipientEnvelopes(input: {
  documentRecipientEnvelopes: ReadonlyArray<SerializedRecipientEnvelope>;
  execSql?: ExecSql;
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

import { type RecipientEntry, wrapDekForRecipients } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  encryptLoroUpdate,
  getUpdateVersionVectors,
  type SerializedRecipientEnvelope,
  type SyncDocumentOutgoingUpdate,
} from "@tearleads/loro";
import type {
  PendingUpdateFields,
  PendingUpdateRecord,
} from "./persistence/documentPersistence";

interface DocumentUpdateCreatedEvent {
  type: "document_update_created";
  documentId: string;
}

interface DocumentEncryptionMaterial {
  documentKey: Uint8Array;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[];
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

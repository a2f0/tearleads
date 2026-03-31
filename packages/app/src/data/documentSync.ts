import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encryptLoroUpdate,
  getUpdateVersionVectors,
  type SyncDocumentOutgoingUpdate,
} from "@tearleads/loro";
import type {
  PendingUpdateFields,
  PendingUpdateRecord,
} from "./documentPersistence";

interface DocumentUpdateCreatedEvent {
  type: "document_update_created";
  documentId: string;
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

export async function encryptPendingUpdates(
  pendingUpdates: ReadonlyArray<PendingUpdateRecord>,
  recipientPublicKeys: Uint8Array[],
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
          recipientPublicKeys,
        ),
        partialStartVersionVector: versionVectors.partialStartVersionVector,
        partialEndVersionVector: versionVectors.partialEndVersionVector,
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

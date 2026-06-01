import { bytesToBase64 } from "@tearleads/encoding";
import { getUpdateVersionVectors } from "@tearleads/loro";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { PendingUpdateFields } from "./sqlite/documentPersistence";

interface DocumentUpdateCreatedEvent {
  type: "document_update_created";
  containerIds?: string[];
  documentId: string;
  updateIds?: string[];
}

interface DocumentUpdateCreatedEventCandidate {
  readonly containerIds?: unknown;
  readonly documentId?: unknown;
  readonly type?: unknown;
  readonly updateIds?: unknown;
}

function isDocumentUpdateCreatedEventCandidate(
  event: unknown,
): event is DocumentUpdateCreatedEventCandidate {
  return isPlainObject(event);
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

export function isDocumentUpdateCreatedEvent(
  event: unknown,
): event is DocumentUpdateCreatedEvent {
  if (!isDocumentUpdateCreatedEventCandidate(event)) {
    return false;
  }

  const containerIds = event.containerIds;
  const updateIds = event.updateIds;

  return (
    event.type === "document_update_created" &&
    typeof event.documentId === "string" &&
    (containerIds === undefined ||
      (Array.isArray(containerIds) &&
        containerIds.every(
          (containerId) => typeof containerId === "string",
        ))) &&
    (updateIds === undefined ||
      (Array.isArray(updateIds) &&
        updateIds.every((updateId) => typeof updateId === "string")))
  );
}

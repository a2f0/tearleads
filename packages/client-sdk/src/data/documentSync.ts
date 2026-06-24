import { bytesToBase64 } from "@tearleads/encoding";
import { getUpdateVersionVectors, versionVectorsEqual } from "@tearleads/loro";
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

  // A Loro delta that encodes no ops still serializes to a small non-empty blob
  // (~22 bytes) with start == end version vectors, so the byteLength guard above
  // does not catch it. Such an update produces zero spans server-side, which the
  // frontier diff treats as permanently "missing" and re-sends to every reader
  // on every sync forever. Drop it: a zero-span update carries nothing.
  if (versionVectorsEqual(partialStartVersionVector, partialEndVersionVector)) {
    return null;
  }

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

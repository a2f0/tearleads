import { bytesToBase64 } from "@tearleads/encoding";
import { getUpdateVersionVectors } from "@tearleads/loro";
import type { PendingUpdateFields } from "./sqlite/documentPersistence";

interface DocumentUpdateCreatedEvent {
  type: "document_update_created";
  containerIds?: string[];
  documentId: string;
  updateIds?: string[];
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
  if (typeof event !== "object" || event === null) {
    return false;
  }

  const candidate = event as {
    readonly containerIds?: unknown;
    readonly documentId?: unknown;
    readonly type?: unknown;
    readonly updateIds?: unknown;
  };
  const containerIds = candidate.containerIds;
  const updateIds = candidate.updateIds;

  return (
    candidate.type === "document_update_created" &&
    typeof candidate.documentId === "string" &&
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

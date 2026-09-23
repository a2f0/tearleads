import { bytesToBase64 } from "@tearleads/encoding";
import { getImportBlobMetadata, versionVectorsEqual } from "@tearleads/loro";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  WsDocumentUpdateCreatedHintSchema,
  type WsInvalidationHint,
} from "@tearleads/validators/realtime";
import type { PendingUpdateFields } from "../sqlite/documentPersistence";

type DocumentUpdateCreatedEvent = Extract<
  WsInvalidationHint,
  { type: "document_update_created" }
>;

interface DocumentMutationCreatedEvent {
  type: "document_mutation_created";
  containerIds: string[];
  documentId: string;
  eventType: "document.link" | "document.purge" | "document.unlink";
}

export function createPendingUpdateFields(
  update: Uint8Array,
  sourceVersionVector?: string | null,
): PendingUpdateFields | null {
  if (update.byteLength === 0) {
    return null;
  }

  const { mode, partialEndVersionVector, partialStartVersionVector } =
    getImportBlobMetadata(update);

  // A Loro delta that encodes no ops still serializes to a small non-empty blob
  // (~22 bytes) with start == end version vectors, so the byteLength guard above
  // does not catch it. Such an update produces zero spans server-side, which the
  // frontier diff treats as permanently "missing" and re-sends to every reader
  // on every sync forever. Drop it: a zero-span update carries nothing.
  if (versionVectorsEqual(partialStartVersionVector, partialEndVersionVector)) {
    return null;
  }

  if (sourceVersionVector != null) {
    if (mode !== "snapshot") {
      throw new Error("Rotation baseline must be a full-history Loro snapshot");
    }
    if (!versionVectorsEqual(sourceVersionVector, partialEndVersionVector)) {
      throw new Error(
        "Rotation baseline source must equal its decoded end version vector",
      );
    }
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
  return WsDocumentUpdateCreatedHintSchema.safeParse(event).success;
}

export function isDocumentMutationCreatedEvent(
  event: unknown,
): event is DocumentMutationCreatedEvent {
  if (!isPlainObject(event)) {
    return false;
  }

  const containerIds = Reflect.get(event, "containerIds");
  const documentId = Reflect.get(event, "documentId");
  const eventType = Reflect.get(event, "eventType");

  return (
    Reflect.get(event, "type") === "document_mutation_created" &&
    typeof documentId === "string" &&
    documentId.length > 0 &&
    (eventType === "document.link" ||
      eventType === "document.purge" ||
      eventType === "document.unlink") &&
    Array.isArray(containerIds) &&
    containerIds.length > 0 &&
    containerIds.every(
      (containerId) =>
        typeof containerId === "string" && containerId.length > 0,
    )
  );
}

/**
 * Realtime hints after which a cached writer projection may cite a stale
 * manifest: a container mutation (grant, rekey, recite, ...) or the gateway's
 * dependent-path notice. An eviction resync also drops the previously held
 * projection before revalidation; its later parent-only hint names no child.
 */
export function isContainerProjectionInvalidationHint(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const type = Reflect.get(event, "type");
  return (
    type === "container_mutation_created" ||
    type === "container_path_changed" ||
    type === "resync_required"
  );
}

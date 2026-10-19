import { isDocumentUpdateCreatedEvent } from "../../../data/documents/documentSync";
import type { DocumentRecord } from "../../../data/sqlite/documentPersistence";

export function hasContainerMetadataDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  metadataStates: Iterable<{ record: Pick<DocumentRecord, "documentId"> }>,
  locallyAcceptedUpdateIds?: Set<string>,
): boolean {
  // A boolean predicate must not consume self-echo ids before the real list
  // pass classifies the same events.
  return (
    listContainerMetadataDocumentUpdateIds(
      events,
      metadataStates,
      locallyAcceptedUpdateIds ? new Set(locallyAcceptedUpdateIds) : undefined,
    ).length > 0
  );
}

/** Consume local ids and report whether an event still contains a peer id. */
function metadataEventHasRemoteUpdate(
  event: { updateIds?: readonly string[] | undefined },
  locallyAcceptedUpdateIds: Set<string> | undefined,
): boolean {
  if (
    !locallyAcceptedUpdateIds ||
    !event.updateIds ||
    event.updateIds.length === 0
  ) {
    return true;
  }

  let remoteUpdateFound = false;
  for (const updateId of event.updateIds) {
    if (locallyAcceptedUpdateIds.has(updateId)) {
      locallyAcceptedUpdateIds.delete(updateId);
    } else {
      remoteUpdateFound = true;
    }
  }
  return remoteUpdateFound;
}

/**
 * `plannedDocumentIds` names the metadata documents of folders whose create is
 * in flight. A peer can edit one after the create commits but before the
 * response installs its id, and a committed seed stands in for the folder's
 * first metadata sync, so that hint must still queue a read.
 */
export function listContainerMetadataDocumentUpdateIds(
  events: ReadonlyArray<unknown>,
  metadataStates: Iterable<{ record: Pick<DocumentRecord, "documentId"> }>,
  locallyAcceptedUpdateIds?: Set<string>,
  plannedDocumentIds?: Iterable<string>,
): string[] {
  const metadataDocumentIds = new Set<string>(plannedDocumentIds);
  for (const metadataState of metadataStates) {
    if (typeof metadataState.record.documentId === "string") {
      metadataDocumentIds.add(metadataState.record.documentId);
    }
  }
  if (metadataDocumentIds.size === 0) return [];

  const eventDocumentIds = new Set<string>();
  for (const event of events) {
    if (
      !isDocumentUpdateCreatedEvent(event) ||
      !metadataDocumentIds.has(event.documentId)
    ) {
      continue;
    }
    if (!metadataEventHasRemoteUpdate(event, locallyAcceptedUpdateIds)) {
      continue;
    }
    eventDocumentIds.add(event.documentId);
  }

  return Array.from(eventDocumentIds);
}

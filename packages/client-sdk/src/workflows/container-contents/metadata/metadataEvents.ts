import {
  isDocumentPeerRestoreAllowedEvent,
  isDocumentUpdateCreatedEvent,
} from "../../../data/documents/documentSync";
import type { DocumentRecord } from "../../../data/persistence/documents/records";
import { resumeMetadataPeerRestoreOnHint } from "./metadataPeerRebase";
import type { ContainerMetadataState } from "./metadataTypes";

function isContainerMetadataState(value: {
  record: Pick<DocumentRecord, "documentId">;
}): value is ContainerMetadataState {
  return "container" in value && "doc" in value;
}

export function hasContainerMetadataDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  metadataStates: Iterable<{ record: Pick<DocumentRecord, "documentId"> }>,
  locallyAcceptedUpdateIds?: Set<string>,
): boolean {
  // A boolean predicate must not consume self-echo ids or mutate park state
  // before the real list pass classifies the same events.
  return (
    listContainerMetadataDocumentUpdateIds(
      events,
      metadataStates,
      locallyAcceptedUpdateIds ? new Set(locallyAcceptedUpdateIds) : undefined,
      undefined,
      false,
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

function collectMetadataDocumentStates(
  metadataStates: Iterable<{ record: Pick<DocumentRecord, "documentId"> }>,
  plannedDocumentIds: Iterable<string> | undefined,
): {
  readonly metadataDocumentIds: Set<string>;
  readonly statesByDocumentId: Map<string, ContainerMetadataState>;
} {
  const statesByDocumentId = new Map<string, ContainerMetadataState>();
  const metadataDocumentIds = new Set<string>(plannedDocumentIds);
  for (const metadataState of metadataStates) {
    const documentId = metadataState.record.documentId;
    if (typeof documentId !== "string") continue;
    metadataDocumentIds.add(documentId);
    if (isContainerMetadataState(metadataState)) {
      statesByDocumentId.set(documentId, metadataState);
    }
  }
  return { metadataDocumentIds, statesByDocumentId };
}

function classifyMetadataEvent(input: {
  readonly event: unknown;
  readonly locallyAcceptedUpdateIds: Set<string> | undefined;
  readonly metadataDocumentIds: ReadonlySet<string>;
  readonly resumeParkedOnHint: boolean;
  readonly statesByDocumentId: ReadonlyMap<string, ContainerMetadataState>;
}): string | null {
  const { event, metadataDocumentIds } = input;
  if (
    isDocumentPeerRestoreAllowedEvent(event) &&
    metadataDocumentIds.has(event.documentId)
  ) {
    if (input.resumeParkedOnHint) {
      const target = input.statesByDocumentId.get(event.documentId);
      if (target) resumeMetadataPeerRestoreOnHint(target);
    }
    return event.documentId;
  }
  if (
    !isDocumentUpdateCreatedEvent(event) ||
    !metadataDocumentIds.has(event.documentId) ||
    !metadataEventHasRemoteUpdate(event, input.locallyAcceptedUpdateIds)
  ) {
    return null;
  }
  return event.documentId;
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
  resumeParkedOnHint = true,
): string[] {
  const { metadataDocumentIds, statesByDocumentId } =
    collectMetadataDocumentStates(metadataStates, plannedDocumentIds);
  if (metadataDocumentIds.size === 0) return [];

  const eventDocumentIds = new Set<string>();
  for (const event of events) {
    const documentId = classifyMetadataEvent({
      event,
      locallyAcceptedUpdateIds,
      metadataDocumentIds,
      resumeParkedOnHint,
      statesByDocumentId,
    });
    if (documentId !== null) eventDocumentIds.add(documentId);
  }
  return Array.from(eventDocumentIds);
}

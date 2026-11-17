import type {
  DocumentAccessEventBody,
  DocumentLinkSetManifestState,
} from "./documentAccessTypes";
import { normalizeDocumentLinkSetManifestState } from "./documentLinkSetManifest";
import { throwVerification } from "./shared";

/** The link-set manifest a later document event advances. */
export interface DocumentLinkSetPredecessorState {
  readonly manifestHash: string;
  readonly state: DocumentLinkSetManifestState;
}

/**
 * The link-set state a document event commits to, from its signed body and
 * its predecessor's state. Nothing here authorizes the event: the verifier
 * runs its checks first and then derives through this function.
 */
export function documentLinkSetStateAfterEvent(input: {
  readonly body: DocumentAccessEventBody;
  readonly eventHash: string;
  readonly objectId: string;
  readonly organizationId: string;
  readonly previous: DocumentLinkSetPredecessorState | null;
}): DocumentLinkSetManifestState {
  const { body, previous } = input;
  if (previous === null) {
    if (body.eventType !== "document.link") {
      throwVerification(
        "missing_dependency",
        `${body.eventType} requires the previous document link-set manifest`,
      );
    }
    return normalizeDocumentLinkSetManifestState({
      version: 1,
      documentId: input.objectId,
      organizationId: input.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: input.eventHash,
      linkedContainerIds: [body.containerId],
    });
  }

  const previousState = previous.state;
  return normalizeDocumentLinkSetManifestState({
    version: 1,
    documentId: previousState.documentId,
    organizationId: previousState.organizationId,
    epoch: previousState.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: input.eventHash,
    linkedContainerIds:
      body.eventType === "document.link"
        ? [...previousState.linkedContainerIds, body.containerId]
        : previousState.linkedContainerIds.filter(
            (containerId) => containerId !== body.containerId,
          ),
  });
}

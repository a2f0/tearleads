import {
  normalizeContainerAccessManifestState,
  removeContainerDirectGrant,
  upsertContainerDirectGrant,
} from "./containerAccessState";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
} from "./containerAccessTypes";
import {
  removeReferencedPrincipalHead,
  upsertReferencedPrincipalHead,
} from "./containerPrincipalReferences";
import { throwVerification } from "./shared";

/** The manifest a non-create container event advances. */
export interface ContainerAccessPredecessorState {
  readonly manifestHash: string;
  readonly state: ContainerAccessManifestState;
}

function containerCreateState(input: {
  readonly body: ContainerCreateAccessEventBody;
  readonly eventHash: string;
  readonly objectId: string;
  readonly organizationId: string;
}): ContainerAccessManifestState {
  const { body } = input;
  return normalizeContainerAccessManifestState({
    version: 1,
    containerId: input.objectId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: input.eventHash,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    metadataDocumentId: body.metadataDocumentId,
    systemSlot: body.systemSlot,
    containerKeyEpochId: body.containerKeyEpochId,
    containerKeyPublicKey: body.containerKeyPublicKey,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  });
}

function containerSuccessorState(
  body: Exclude<ContainerAccessEventBody, ContainerCreateAccessEventBody>,
  eventHash: string,
  previous: ContainerAccessPredecessorState,
): ContainerAccessManifestState {
  const previousState = previous.state;
  const next = {
    version: 1 as const,
    containerId: previousState.containerId,
    organizationId: previousState.organizationId,
    epoch: previousState.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash,
    parentContainerId: previousState.parentContainerId,
    parentManifestHash: previousState.parentManifestHash,
    metadataDocumentId: previousState.metadataDocumentId,
    systemSlot: previousState.systemSlot,
    containerKeyEpochId: body.containerKeyEpochId,
    containerKeyPublicKey: body.containerKeyPublicKey,
    directGrants: previousState.directGrants,
    referencedPrincipalHeads: previousState.referencedPrincipalHeads,
  };

  switch (body.eventType) {
    case "container.grant":
      return normalizeContainerAccessManifestState({
        ...next,
        directGrants: upsertContainerDirectGrant(
          previousState.directGrants,
          body.grant,
        ),
        referencedPrincipalHeads: body.referencedPrincipalHead
          ? upsertReferencedPrincipalHead(
              previousState.referencedPrincipalHeads,
              body.referencedPrincipalHead,
            )
          : previousState.referencedPrincipalHeads,
      });
    case "container.recite":
      return normalizeContainerAccessManifestState(next);
    case "container.revoke":
      // A rotation re-cites its parent's current head; a root cites none.
      return normalizeContainerAccessManifestState({
        ...next,
        parentManifestHash: body.parentManifestHash,
        directGrants: removeContainerDirectGrant(
          previousState.directGrants,
          body,
        ),
        referencedPrincipalHeads: removeReferencedPrincipalHead(
          previousState.referencedPrincipalHeads,
          body,
        ),
      });
    case "container.rekey":
      return normalizeContainerAccessManifestState({
        ...next,
        parentManifestHash: body.parentManifestHash,
        referencedPrincipalHeads: body.referencedPrincipalHeads,
      });
    case "container.move":
      return normalizeContainerAccessManifestState({
        ...next,
        parentContainerId: body.parentContainerId,
        parentManifestHash: body.parentManifestHash,
      });
  }
}

/**
 * The state a container event commits to, from its signed body and its
 * predecessor's state. Nothing here authorizes the event: the verifier runs
 * its checks first and then derives through this function, so a state built
 * here from served bytes equals the verified one exactly when the event
 * verifies.
 */
export function containerAccessStateAfterEvent(input: {
  readonly body: ContainerAccessEventBody;
  readonly eventHash: string;
  readonly objectId: string;
  readonly organizationId: string;
  readonly previous: ContainerAccessPredecessorState | null;
}): ContainerAccessManifestState {
  const { body, previous } = input;
  if (body.eventType === "container.create") {
    if (previous !== null) {
      throwVerification(
        "stale_predecessor",
        "container.create must not have a previous manifest",
      );
    }
    return containerCreateState({ ...input, body });
  }
  if (previous === null) {
    throwVerification(
      "missing_dependency",
      `${body.eventType} requires the previous container manifest`,
    );
  }
  return containerSuccessorState(body, input.eventHash, previous);
}

import { MAX_CONTAINER_RECITATION_EPOCH } from "./containerAccessReciteBody";
import {
  type ContainerAccessManifestDerivationInput,
  deriveContainerCreateManifestState,
  deriveContainerSuccessorState,
  type PreviousContainerAccessTransition,
  preparePreviousContainerAccessTransition,
} from "./containerAccessTransitionBase";
import type {
  ContainerAccessManifestState,
  ContainerGrantAccessEventBody,
  ContainerMoveAccessEventBody,
  ContainerReciteAccessEventBody,
  ContainerRekeyAccessEventBody,
  ContainerRevokeAccessEventBody,
} from "./containerAccessTypes";
import { requireContainerPathCurrentParent } from "./containerParentAuthority";
import { requireContainerPathUserAccess } from "./containerPathAccess";
import { throwVerification } from "./shared";

function assertContainerAccessEventDomain(
  input: ContainerAccessManifestDerivationInput,
): void {
  const { body, event } = input;

  if (event.event.objectKind !== "container") {
    throwVerification(
      "object_mismatch",
      "container access event must target a container",
    );
  }

  if (body.eventType !== event.event.eventType) {
    throwVerification(
      "invalid_domain",
      "container access event body type does not match event type",
    );
  }
}

function deriveUnrotatedContainerManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerGrantAccessEventBody | ContainerReciteAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  if (
    body.eventType === "container.recite" &&
    previous.previousState.epoch >= MAX_CONTAINER_RECITATION_EPOCH
  ) {
    throwVerification(
      "invalid_shape",
      "Container re-citation history budget is exhausted",
    );
  }
  requireContainerPathUserAccess({
    label: body.eventType,
    minimumAccessLevel: "admin",
    membershipAt: input.authorizationMembership,
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    body.containerKeyEpochId !== previous.previousState.containerKeyEpochId ||
    body.containerKeyPublicKey !== previous.previousState.containerKeyPublicKey
  ) {
    throwVerification(
      "key_epoch_reuse",
      `${body.eventType} must keep the current container KEK epoch`,
    );
  }

  return deriveContainerSuccessorState(input, previous);
}

/** A rotation re-cites its parent's current head, signed; a root cites none. */
function assertRotationParentCitation(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerRekeyAccessEventBody | ContainerRevokeAccessEventBody,
  previous: PreviousContainerAccessTransition,
): void {
  const parentId = previous.previousState.parentContainerId;
  if (parentId === null) {
    if (body.parentManifestHash !== null)
      throwVerification(
        "object_mismatch",
        "root rotation must not cite a parent",
      );
    return;
  }
  requireContainerPathCurrentParent({
    label: body.eventType,
    organizationId: previous.previousState.organizationId,
    parentContainerId: parentId,
    parentManifestHash: body.parentManifestHash,
    path: input.previousContainerPath?.slice(0, -1),
  });
  if (
    !body.parentManifestHash ||
    !input.event.event.dependencyManifestHashes.includes(
      body.parentManifestHash,
    )
  ) {
    throwVerification(
      "missing_dependency",
      "container rotation requires its signed parent citation",
    );
  }
}

function deriveContainerRevokeManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerRevokeAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.revoke",
    minimumAccessLevel: "admin",
    membershipAt: input.authorizationMembership,
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    body.containerKeyEpochId === null ||
    body.containerKeyEpochId === previous.previousState.containerKeyEpochId ||
    body.containerKeyPublicKey === previous.previousState.containerKeyPublicKey
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container.revoke must create a new container KEK epoch",
    );
  }

  assertRotationParentCitation(input, body, previous);
  return deriveContainerSuccessorState(input, previous);
}

function deriveContainerRekeyManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerRekeyAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.rekey",
    minimumAccessLevel: "write",
    membershipAt: input.authorizationMembership,
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    body.containerKeyEpochId === previous.previousState.containerKeyEpochId ||
    body.containerKeyPublicKey === previous.previousState.containerKeyPublicKey
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container.rekey must create a new container KEK epoch",
    );
  }

  assertRotationParentCitation(input, body, previous);
  return deriveContainerSuccessorState(input, previous);
}

function deriveContainerMoveManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerMoveAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  if (
    previous.previousState.parentContainerId === null ||
    previous.previousState.systemSlot !== null
  ) {
    throwVerification(
      "invalid_shape",
      "root and system containers cannot move",
    );
  }
  requireContainerPathUserAccess({
    label: "container.move source",
    minimumAccessLevel: "admin",
    membershipAt: input.authorizationMembership,
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });
  requireContainerPathCurrentParent({
    label: "container.move destination",
    organizationId: input.event.event.organizationId,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    path: input.destinationParentContainerPath,
  });
  requireContainerPathUserAccess({
    label: "container.move destination",
    minimumAccessLevel: "write",
    membershipAt: input.authorizationMembership,
    path: input.destinationParentContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    input.destinationParentContainerPath?.some(
      (containerManifest) =>
        containerManifest.state.containerId ===
        previous.previousState.containerId,
    )
  ) {
    throwVerification(
      "object_mismatch",
      "container.move destination parent cannot be the moved container or its descendant",
    );
  }

  // Descendants wrap to the published key without holding this container's
  // material, so the epoch and its wrapping key must rotate together: reusing
  // the predecessor's key under a new epoch would leave the retired holder able
  // to open new child keys, and republishing a different key under an unchanged
  // epoch would send descendants to a key the real KEK cannot open.
  if (
    (body.containerKeyEpochId !==
      previous.previousState.containerKeyEpochId) !==
    (body.containerKeyPublicKey !==
      previous.previousState.containerKeyPublicKey)
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container.move must rotate its KEK epoch and wrapping key together",
    );
  }

  return deriveContainerSuccessorState(input, previous);
}

export function deriveContainerAccessManifestStateFromEvent(
  input: ContainerAccessManifestDerivationInput,
): ContainerAccessManifestState {
  assertContainerAccessEventDomain(input);

  if (input.body.eventType === "container.create") {
    return deriveContainerCreateManifestState(input, input.body);
  }

  const previous = preparePreviousContainerAccessTransition(input);

  if (
    input.body.eventType === "container.grant" ||
    input.body.eventType === "container.recite"
  ) {
    return deriveUnrotatedContainerManifestState(input, input.body, previous);
  }

  if (input.body.eventType === "container.revoke") {
    return deriveContainerRevokeManifestState(input, input.body, previous);
  }

  if (input.body.eventType === "container.rekey") {
    return deriveContainerRekeyManifestState(input, input.body, previous);
  }

  return deriveContainerMoveManifestState(input, input.body, previous);
}

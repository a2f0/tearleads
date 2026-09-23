import { normalizeContainerAccessManifestState } from "./containerAccessState";
import {
  requireContainerPathCurrentParent,
  requirePathLastMatchesManifest,
} from "./containerParentAuthority";
import {
  containerAccessLevelRank,
  grantAccessLevelForUser,
  mergeContainerAccessLevel,
  requireContainerPathUserAccess,
} from "./containerPathAccess";
import { throwVerification } from "./shared";
import type {
  AnyVerifiedPrincipalPolicy,
  ContainerAccessEventBody,
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "./types";

function requireRootCreateSignerAdmin(input: {
  readonly body: ContainerCreateAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly membershipAt: "current" | "referenced";
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly principalPolicies: readonly AnyVerifiedPrincipalPolicy[];
}): void {
  if (input.parentContainerPath && input.parentContainerPath.length > 0) {
    throwVerification(
      "invalid_shape",
      "root container.create must not include a parent path",
    );
  }

  const accessLevel =
    input.body.directGrants.reduce<ContainerAccessLevel | null>(
      (current, grant) => {
        const grantAccessLevel = grantAccessLevelForUser({
          grant,
          membershipAt: input.membershipAt,
          principalPolicies: input.principalPolicies,
          state: {
            referencedPrincipalHeads: input.body.referencedPrincipalHeads,
          },
          userId: input.event.event.signerUserId,
        });

        return grantAccessLevel
          ? mergeContainerAccessLevel(current, grantAccessLevel)
          : current;
      },
      null,
    );

  if (
    accessLevel === null ||
    containerAccessLevelRank(accessLevel) < containerAccessLevelRank("admin")
  ) {
    throwVerification(
      "unauthorized",
      "root container.create signer must grant themselves admin access",
    );
  }
}

export type ContainerAccessManifestDerivationInput = {
  readonly authorizationMembership: "current" | "referenced";
  readonly body: ContainerAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly previousContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly destinationParentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly principalPolicies: readonly AnyVerifiedPrincipalPolicy[];
};

type ContainerAccessManifestTransitionBase = Omit<
  ContainerAccessManifestState,
  | "containerKeyEpochId"
  | "containerKeyPublicKey"
  | "directGrants"
  | "referencedPrincipalHeads"
>;

export interface PreviousContainerAccessTransition {
  readonly nextBase: ContainerAccessManifestTransitionBase;
  readonly previousState: ContainerAccessManifestState;
}

export function deriveContainerCreateManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerCreateAccessEventBody,
): ContainerAccessManifestState {
  const { event, previousManifest } = input;

  if (previousManifest !== null || event.event.previousManifestHash !== null) {
    throwVerification(
      "stale_predecessor",
      "container.create must not have a previous manifest",
    );
  }

  if (body.parentContainerId === null && body.parentManifestHash === null) {
    requireRootCreateSignerAdmin({
      body,
      event,
      membershipAt: input.authorizationMembership,
      parentContainerPath: input.parentContainerPath,
      principalPolicies: input.principalPolicies,
    });
  } else {
    if (
      body.systemSlot !== null &&
      (input.parentContainerPath?.length !== 1 ||
        input.parentContainerPath[0]?.state.parentContainerId !== null)
    ) {
      throwVerification(
        "invalid_shape",
        "system container parent must be a root",
      );
    }
    requireContainerPathCurrentParent({
      label: "container.create",
      organizationId: event.event.organizationId,
      parentContainerId: body.parentContainerId,
      parentManifestHash: body.parentManifestHash,
      path: input.parentContainerPath,
    });
    requireContainerPathUserAccess({
      label: "container.create",
      minimumAccessLevel: body.systemSlot === null ? "write" : "admin",
      membershipAt: input.authorizationMembership,
      path: input.parentContainerPath,
      principalPolicies: input.principalPolicies,
      userId: event.event.signerUserId,
    });
  }

  return normalizeContainerAccessManifestState({
    version: 1,
    containerId: event.event.objectId,
    organizationId: event.event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
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

export function preparePreviousContainerAccessTransition(
  input: ContainerAccessManifestDerivationInput,
): PreviousContainerAccessTransition {
  const { body, event, previousManifest } = input;

  if (!previousManifest) {
    throwVerification(
      "missing_dependency",
      `${body.eventType} requires the previous container manifest`,
    );
  }

  if (event.event.previousManifestHash !== previousManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "container access event previous manifest mismatch",
    );
  }

  requirePathLastMatchesManifest({
    label: "previous container",
    manifest: previousManifest,
    path: input.previousContainerPath,
  });

  const previousState = previousManifest.state;

  return {
    previousState,
    nextBase: {
      version: 1,
      containerId: previousState.containerId,
      organizationId: previousState.organizationId,
      epoch: previousState.epoch + 1,
      previousManifestHash: previousManifest.manifestHash,
      eventHash: event.eventHash,
      parentContainerId: previousState.parentContainerId,
      parentManifestHash: previousState.parentManifestHash,
      metadataDocumentId: previousState.metadataDocumentId,
      systemSlot: previousState.systemSlot,
    },
  };
}

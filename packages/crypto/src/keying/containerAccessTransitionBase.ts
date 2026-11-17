import type { VerifiedAccessEvent } from "./accessEventTypes";
import {
  type ContainerAccessPredecessorState,
  containerAccessStateAfterEvent,
} from "./containerAccessSuccessor";
import type {
  ContainerAccessEventBody,
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
  VerifiedContainerAccessManifest,
} from "./containerAccessTypes";
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
import type { PrincipalPolicyAuthorization } from "./principalPolicyTypes";
import { throwVerification } from "./shared";

function requireRootCreateSignerAdmin(input: {
  readonly body: ContainerCreateAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly membershipAt: "current" | "referenced";
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly principalPolicies: readonly PrincipalPolicyAuthorization[];
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
  readonly principalPolicies: readonly PrincipalPolicyAuthorization[];
};

export interface PreviousContainerAccessTransition {
  readonly previous: ContainerAccessPredecessorState;
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

  return containerAccessStateAfterEvent({
    body,
    eventHash: event.eventHash,
    objectId: event.event.objectId,
    organizationId: event.event.organizationId,
    previous: null,
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

  return {
    previous: {
      manifestHash: previousManifest.manifestHash,
      state: previousManifest.state,
    },
    previousState: previousManifest.state,
  };
}

/** The state an authorized successor event commits to. */
export function deriveContainerSuccessorState(
  input: ContainerAccessManifestDerivationInput,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  return containerAccessStateAfterEvent({
    body: input.body,
    eventHash: input.event.eventHash,
    objectId: input.event.event.objectId,
    organizationId: input.event.event.organizationId,
    previous: previous.previous,
  });
}

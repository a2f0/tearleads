import type {
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerGrantPrincipalHead,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerKekResponse } from "@tearleads/validators/response";
import {
  wrapContainerKeyToManagedPrincipal,
  wrapContainerKeyToParent,
  wrapContainerKeyToRootUser,
} from "../../../data/containers/shared/projection";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";

function findPrincipalPolicy(input: {
  operationLabel: string;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  reference: ReferencedPrincipalHead;
}): VerifiedPrincipalPolicy {
  const policy = input.principalPolicies.find(
    (candidate) =>
      candidate.principalType === input.reference.principalType &&
      candidate.principalId === input.reference.principalId &&
      candidate.version === input.reference.version &&
      candidate.keyEpoch === input.reference.keyEpoch &&
      candidate.stateHash === input.reference.stateHash,
  );
  if (!policy) {
    // Invariant, not a recoverable state: the API commits a container head
    // only when every referenced group head equals the group's current state
    // (packages/api groupReferenceHeads.ts), and a group change that would
    // leave a grant stale is refused unless it rematerializes that container
    // in the same transaction (principalContainerRematerialization.ts). A
    // verified projection therefore always carries the policy its manifest
    // references; a miss means the caller resolved policies for a different
    // head than the manifest it is rotating.
    throw new Error(
      `${input.operationLabel} referenced ${input.reference.principalType} ${input.reference.principalId} at version ${input.reference.version} (key epoch ${input.reference.keyEpoch}), but no verified policy with that head was supplied; the API only commits heads whose group references are current`,
    );
  }
  return policy;
}

function referenceForManagedGrant(input: {
  grant: ContainerDirectGrant;
  operationLabel: string;
  state: ContainerAccessManifestState;
}): ContainerGrantPrincipalHead {
  const reference = input.state.referencedPrincipalHeads.find(
    (candidate) =>
      candidate.principalType === input.grant.subjectType &&
      candidate.principalId === input.grant.subjectId,
  );
  if (reference?.principalType !== "group") {
    throw new Error(
      `${input.operationLabel} referenced principal head is missing`,
    );
  }
  return { ...reference, principalType: "group" };
}

export async function buildContainerRotationWraps(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  operationLabel: string;
  parentKek: ContainerKekResponse | null;
  parentKekMaterial: Uint8Array | null;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  resolveUserKey: ProjectionUserKeyResolver;
  state: ContainerAccessManifestState;
}): Promise<{
  readonly userRecipientKeys: ContainerUserRecipientKey[];
  readonly wraps: ContainerKeyWrap[];
}> {
  const userRecipientKeys: ContainerUserRecipientKey[] = [];
  const wraps: ContainerKeyWrap[] = [];
  if (input.parentKek) {
    if (!input.parentKekMaterial) {
      throw new Error(
        `${input.operationLabel} parent KEK could not be unwrapped`,
      );
    }
    wraps.push(
      await wrapContainerKeyToParent({
        containerKey: input.containerKey,
        containerKeyEpochId: input.containerKeyEpochId,
        manifestHash: input.manifestHash,
        parentKek: input.parentKek,
        parentKekMaterial: input.parentKekMaterial,
      }),
    );
  }

  for (const grant of input.state.directGrants) {
    if (grant.subjectType === "user") {
      const userKey = await input.resolveUserKey(grant.subjectId);
      if (!userKey) {
        throw new Error(
          `${input.operationLabel} recipient key is missing for direct user grant ${grant.subjectId}`,
        );
      }
      const recipient = await wrapContainerKeyToRootUser({
        containerKey: input.containerKey,
        containerKeyEpochId: input.containerKeyEpochId,
        manifestHash: input.manifestHash,
        recipientEncapsulationPublicKey: userKey.encapsulationPublicKey,
        userId: grant.subjectId,
      });
      userRecipientKeys.push(recipient.userRecipientKey);
      wraps.push(recipient.wrap);
      continue;
    }

    const reference = referenceForManagedGrant({
      grant,
      operationLabel: input.operationLabel,
      state: input.state,
    });
    const policy = findPrincipalPolicy({
      operationLabel: input.operationLabel,
      principalPolicies: input.principalPolicies,
      reference,
    });
    const recipient = await wrapContainerKeyToManagedPrincipal({
      containerKey: input.containerKey,
      containerKeyEpochId: input.containerKeyEpochId,
      manifestHash: input.manifestHash,
      principalEncapsulationPublicKey: policy.state.encapsulationPublicKey,
      principalHead: reference,
    });
    wraps.push(recipient.wrap);
  }

  return {
    userRecipientKeys: userRecipientKeys.sort((left, right) =>
      left.userId.localeCompare(right.userId),
    ),
    wraps: wraps.sort((left, right) =>
      `${left.recipientKind}:${left.recipientId}`.localeCompare(
        `${right.recipientKind}:${right.recipientId}`,
      ),
    ),
  };
}

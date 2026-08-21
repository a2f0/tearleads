import type {
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerGrantPrincipalHead,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type { ContainerKekResponse } from "@symcrypt/validators/response";
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
    throw new Error(`${input.operationLabel} principal policy is missing`);
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
  if (!reference || reference.principalType !== "group") {
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

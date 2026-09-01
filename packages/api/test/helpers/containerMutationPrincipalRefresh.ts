import type {
  ContainerGrantPrincipalHead,
  ContainerKekRecipientTarget,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { derivePrincipalRecipientKeyEpochId } from "@tearleads/crypto";

function replacementHead(
  policy: VerifiedPrincipalPolicy,
): ContainerGrantPrincipalHead {
  if (policy.principalType !== "group") {
    throw new Error("Container grants cannot target organizations");
  }
  return {
    principalType: "group",
    principalId: policy.principalId,
    version: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash: policy.stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  };
}

function isReplacementPrincipal(
  candidate: { readonly principalId: string; readonly principalType: string },
  replacement: VerifiedPrincipalPolicy,
): boolean {
  return (
    candidate.principalType === replacement.principalType &&
    candidate.principalId === replacement.principalId
  );
}

function isReplacementRecipient(
  candidate: VerifiedContainerKekState["recipientTargets"][number],
  replacement: VerifiedPrincipalPolicy,
): boolean {
  return (
    candidate.recipientKind === replacement.principalType &&
    candidate.recipientId === replacement.principalId
  );
}

export function refreshContainerMutationPrincipal(input: {
  readonly currentPrincipalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly currentReferencedPrincipalHeads: readonly ContainerGrantPrincipalHead[];
  readonly currentRecipientTargets: VerifiedContainerKekState["recipientTargets"];
  readonly replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
}) {
  const replacement = input.replacementPrincipalPolicy;
  if (replacement?.principalType === "organization") {
    throw new Error("Container grants cannot target organizations");
  }
  const principalPolicies = replacement
    ? [
        ...input.currentPrincipalPolicies.filter(
          (policy) => !isReplacementPrincipal(policy, replacement),
        ),
        replacement,
      ]
    : [...input.currentPrincipalPolicies];
  const referencedPrincipalHeads = replacement
    ? input.currentReferencedPrincipalHeads.map((head) =>
        isReplacementPrincipal(head, replacement)
          ? replacementHead(replacement)
          : head,
      )
    : [...input.currentReferencedPrincipalHeads];
  const recipientTargets: ContainerKekRecipientTarget[] = replacement
    ? input.currentRecipientTargets.map((target) =>
        isReplacementRecipient(target, replacement)
          ? {
              recipientKind: "group" as const,
              recipientId: replacement.principalId,
              recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
                replacementHead(replacement),
              ),
              recipientKeyFingerprint: replacement.state.keyFingerprint,
            }
          : target,
      )
    : [...input.currentRecipientTargets];
  const userRecipientKeys = recipientTargets
    .filter((target) => target.recipientKind === "user")
    .map((target) => ({
      userId: target.recipientId,
      recipientKeyEpochId: target.recipientKeyEpochId,
      recipientKeyFingerprint: target.recipientKeyFingerprint,
    }));

  return {
    principalPolicies,
    recipientTargets,
    referencedPrincipalHeads,
    userRecipientKeys,
  };
}

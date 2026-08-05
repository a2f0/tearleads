import type {
  ContainerAccessManifestState,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { uniquePrincipalPolicies } from "../../../data/containers/shared/principalPolicies";

function principalReferenceKey(input: {
  readonly principalId: string;
  readonly principalType: string;
}): string {
  return `${input.principalType}:${input.principalId}`;
}

export function refreshedPrincipalReferences(input: {
  readonly previousState: ContainerAccessManifestState;
  readonly replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
}): ReferencedPrincipalHead[] {
  const replacement = input.replacementPrincipalPolicy;
  if (!replacement) {
    return [...input.previousState.referencedPrincipalHeads];
  }
  const replacementHead: ReferencedPrincipalHead = {
    principalType: replacement.principalType,
    principalId: replacement.principalId,
    version: replacement.version,
    keyEpoch: replacement.keyEpoch,
    stateHash: replacement.stateHash,
    keyFingerprint: replacement.state.keyFingerprint,
  };
  const replacementKey = principalReferenceKey(replacementHead);
  return [
    ...input.previousState.referencedPrincipalHeads.filter(
      (head) => principalReferenceKey(head) !== replacementKey,
    ),
    replacementHead,
  ].sort((left, right) =>
    principalReferenceKey(left).localeCompare(principalReferenceKey(right)),
  );
}

export function refreshedPrincipalPolicies(input: {
  readonly previousPolicies: readonly VerifiedPrincipalPolicy[];
  readonly replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
}): VerifiedPrincipalPolicy[] {
  const replacement = input.replacementPrincipalPolicy;
  if (!replacement) {
    return [...input.previousPolicies];
  }
  const replacementKey = principalReferenceKey(replacement);
  return uniquePrincipalPolicies([
    ...input.previousPolicies.filter(
      (policy) => principalReferenceKey(policy) !== replacementKey,
    ),
    replacement,
  ]);
}

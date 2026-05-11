import type {
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { DatabaseSession } from "../../../adapters/postgres";
import {
  loadPrincipalPoliciesForContainerPaths,
  PrincipalPolicyProjectionError,
} from "../../../documents/principalPolicyProjection";
import { ContainerWriterProjectionError } from "./types";

export function principalPolicyReferenceCacheKey(
  principalHead: ReferencedPrincipalHead,
): string {
  return [
    principalHead.principalType,
    principalHead.principalId,
    principalHead.version,
    principalHead.keyEpoch,
    principalHead.stateHash,
    principalHead.keyFingerprint,
  ].join(":");
}

export function verifiedPrincipalPolicyReferenceCacheKey(
  policy: VerifiedPrincipalPolicy,
): string {
  return [
    policy.principalType,
    policy.principalId,
    policy.version,
    policy.keyEpoch,
    policy.stateHash,
    policy.state.keyFingerprint,
  ].join(":");
}

export function principalPolicyCacheKey(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): string {
  const policyKeys = new Set(
    input.principalPolicies.map(verifiedPrincipalPolicyReferenceCacheKey),
  );

  return input.manifest.state.referencedPrincipalHeads
    .map((principalHead) => {
      const referenceKey = principalPolicyReferenceCacheKey(principalHead);

      return policyKeys.has(referenceKey)
        ? referenceKey
        : `missing:${referenceKey}`;
    })
    .sort()
    .join("|");
}

export async function loadPrincipalPoliciesForAccessPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
): Promise<VerifiedPrincipalPolicy[]> {
  try {
    return await loadPrincipalPoliciesForContainerPaths(executor, paths);
  } catch (error) {
    if (error instanceof PrincipalPolicyProjectionError) {
      throw new ContainerWriterProjectionError(error.message, error.status);
    }
    throw error;
  }
}

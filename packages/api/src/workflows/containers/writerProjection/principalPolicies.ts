import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyAuthorization,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  loadPrincipalPoliciesForContainerPaths,
  PrincipalPolicyProjectionError,
} from "../../principals/principalPolicyProjection";
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

function verifiedPrincipalPolicyReferenceCacheKey(
  policy: PrincipalPolicyAuthorization,
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

function verifiedPrincipalPolicyStateReferenceCacheKey(
  state: PrincipalPolicyAuthorization["state"],
): string {
  return [
    state.principalType,
    state.principalId,
    state.version,
    state.keyEpoch,
    state.stateHash,
    state.keyFingerprint,
  ].join(":");
}

export function verifiedPrincipalPolicyReferenceCacheKeys(
  policy: PrincipalPolicyAuthorization,
): string[] {
  const referenceKeys = new Set([
    verifiedPrincipalPolicyReferenceCacheKey(policy),
  ]);

  const history =
    "retainedHistory" in policy ? policy.retainedHistory : policy.history;
  for (const entry of history ?? []) {
    referenceKeys.add(
      verifiedPrincipalPolicyStateReferenceCacheKey(entry.state),
    );
  }

  return [...referenceKeys].sort();
}

export function principalPolicyCacheKey(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly principalPolicies: readonly PrincipalPolicyAuthorization[];
}): string {
  const policyKeys = new Set(
    input.principalPolicies.flatMap(verifiedPrincipalPolicyReferenceCacheKeys),
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
): Promise<PrincipalPolicyAuthorization[]> {
  try {
    return await loadPrincipalPoliciesForContainerPaths(executor, paths);
  } catch (error) {
    if (error instanceof PrincipalPolicyProjectionError) {
      throw new ContainerWriterProjectionError(error.message, error.status);
    }
    throw error;
  }
}

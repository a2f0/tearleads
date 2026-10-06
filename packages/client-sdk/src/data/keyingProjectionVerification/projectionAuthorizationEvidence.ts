import type { PrincipalPolicyAuthorization } from "@tearleads/crypto";
import {
  KeyingVerificationError,
  principalPolicyMatchesReference,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";
import { observeProjectionLifetime } from "./projectionLifetimes";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";
import { readAccessManifest } from "./readers";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

/** Locally planned successors may cite an already verified, uncommitted policy. */
async function resolveProjectionAuthorizationEvidence(input: {
  readonly bundles: readonly AccessManifestBundleWireResponse[];
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly evidence: readonly PrincipalPolicyAuthorization[];
  readonly organizationId: string;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<PrincipalPolicyAuthorization[]> {
  const references = input.bundles
    .flatMap(
      (bundle) =>
        readAccessManifest(bundle.manifest, "Projection manifest")
          .referencedPrincipalHeads,
    )
    .filter(
      (reference) =>
        !input.evidence.some((policy) =>
          principalPolicyMatchesReference({ policy, reference }),
        ),
    );
  const known = [...input.principalPolicyCache.values()];
  if (
    references.some(
      (reference) =>
        !known.some((policy) =>
          principalPolicyMatchesReference({ policy, reference }),
        ),
    )
  )
    throw new KeyingVerificationError(
      "missing_dependency",
      "Projection omits required principal policy evidence",
    );
  return [
    ...input.evidence,
    ...(await collectReferencedPrincipalPolicies({
      checkpointContext: input.checkpointContext,
      organizationId: input.organizationId,
      principalPolicyCache: input.principalPolicyCache,
      references,
      resolveUserKey: input.resolveUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    })),
  ];
}

export async function verifyProjectionAuthorizationEvidence(
  input: Omit<
    Parameters<typeof resolveProjectionAuthorizationEvidence>[0],
    "evidence"
  > & { readonly policyEvidence: ProjectionPolicyEvidenceResponse },
) {
  const sources = [
    input.policyEvidence.organization,
    ...input.policyEvidence.groups,
  ];
  const known = [...input.principalPolicyCache.values()];
  const references = input.bundles
    .flatMap(
      (bundle) =>
        readAccessManifest(bundle.manifest, "Projection manifest")
          .referencedPrincipalHeads,
    )
    .filter((reference) => {
      if (
        sources.some(
          (source) =>
            source &&
            source.head.principalType === reference.principalType &&
            source.head.principalId === reference.principalId &&
            source.head.version >= reference.version,
        )
      )
        return true;
      // Locally planned successors are verified below through the current-policy path.
      if (
        known.some((policy) =>
          principalPolicyMatchesReference({ policy, reference }),
        )
      )
        return false;
      throw new KeyingVerificationError(
        "missing_dependency",
        "Projection omits required principal policy evidence",
      );
    });
  const recovered = await verifyProjectionPolicyEvidence({
    evidence: input.policyEvidence,
    organizationId: input.organizationId,
    references,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  if (input.policyEvidence.organization)
    observeProjectionLifetime(input.checkpointContext, recovered.stillCurrent);
  input.checkpointContext.authorizationPolicies.push(...recovered.policies);
  return resolveProjectionAuthorizationEvidence({
    ...input,
    evidence: recovered.policies,
  });
}

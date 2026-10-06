import {
  KeyingVerificationError,
  principalPolicyMatchesReference,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import type { PrincipalPolicyCheckpointEvidence } from "../principals/principalPolicyEvidence";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";
import { readAccessManifest } from "./readers";
import type { PrincipalPolicyCache, ProjectionUserKeyResolver } from "./types";

/** Locally planned successors may cite an already verified, uncommitted policy. */
async function resolveProjectionAuthorizationEvidence(input: {
  readonly bundles: readonly AccessManifestBundleWireResponse[];
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly evidence: readonly PrincipalPolicyCheckpointEvidence[];
  readonly organizationId: string;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<PrincipalPolicyCheckpointEvidence[]> {
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
    })),
  ];
}

export async function verifyProjectionAuthorizationEvidence(
  input: Omit<
    Parameters<typeof resolveProjectionAuthorizationEvidence>[0],
    "evidence"
  > & { readonly policyEvidence: ProjectionPolicyEvidenceResponse },
) {
  return resolveProjectionAuthorizationEvidence({
    ...input,
    evidence: await verifyProjectionPolicyEvidence({
      evidence: input.policyEvidence,
      execSql: input.checkpointContext.execSql,
      organizationId: input.organizationId,
      resolveUserKey: input.resolveUserKey,
    }),
  });
}

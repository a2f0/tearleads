import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { ProjectionPolicyEvidenceResponse } from "@tearleads/validators/response";
import { ProjectionDependencyUnavailableError } from "./dependencyUnavailable";
import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
  type ResolvedProjectionPolicyHistory,
} from "./types";

/** Recover public authorization without admitting historical heads as current policy. */
export async function verifyProjectionPolicyEvidence(input: {
  readonly evidence: ProjectionPolicyEvidenceResponse;
  readonly organizationId: string;
  readonly references: readonly ReferencedPrincipalHead[];
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<ResolvedProjectionPolicyHistory> {
  const stillCurrent = () => input.stillCurrent?.() !== false;
  assertProjectionVerificationCurrent(stillCurrent);
  if (!input.evidence.organization) {
    if (
      input.evidence.groups.length ||
      input.evidence.organizationPayloads.length ||
      input.references.length
    )
      throw new KeyingVerificationError(
        "missing_dependency",
        "Projection omits required organization history",
      );
    return { policies: [], stillCurrent };
  }
  const resolve =
    input.warmReferencedPrincipalPolicies?.resolveProjectionHistory;
  if (!resolve)
    throw new ProjectionDependencyUnavailableError(
      "Private projection history recovery is unavailable",
    );
  const result = await resolve({ ...input, stillCurrent });
  assertProjectionVerificationCurrent(stillCurrent);
  assertProjectionVerificationCurrent(result.stillCurrent);
  return result;
}

import { KeyingVerificationError } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { PRINCIPAL_POLICY_REPAIR_HEAD_LIMIT } from "@tearleads/validators/util";
import { verifiedPrincipalPolicyContainsReference } from "../../data/keyingProjectionVerification/principalPolicyCache";
import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
  type ResolvedPrincipalPolicyEvidence,
} from "../../data/keyingProjectionVerification/types";

/** Recover advisory repair heads; the consuming mutation still admits its pins. */
export async function recoverPrincipalPolicyRepair(input: {
  readonly heads: readonly ReferencedPrincipalStateResponse[] | undefined;
  readonly organizationId: string;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<boolean> {
  // Keep the requested organization and lifetime stable across host callbacks.
  input = { ...input };
  const resolve = input.warmReferencedPrincipalPolicies?.resolveReference;
  if (!input.heads?.length || !resolve || input.stillCurrent?.() === false)
    return false;
  if (input.heads.length > PRINCIPAL_POLICY_REPAIR_HEAD_LIMIT)
    throw new RangeError("Principal policy repair head limit exceeded");
  const heads = input.heads.map((head) => ({ ...head }));
  const recoveryBatch = {};
  const recovered: ResolvedPrincipalPolicyEvidence[] = [];
  const assertCurrent = () => {
    assertProjectionVerificationCurrent(input.stillCurrent);
    for (const result of recovered)
      assertProjectionVerificationCurrent(result.stillCurrent);
  };
  for (const reference of heads) {
    assertCurrent();
    const result = await resolve({
      recoveryBatch,
      organizationId: input.organizationId,
      reference: { ...reference },
      stillCurrent: input.stillCurrent,
    });
    recovered.push(result);
    assertCurrent();
    if (
      result.organizationId !== input.organizationId ||
      !verifiedPrincipalPolicyContainsReference(result.policy, reference)
    )
      throw new KeyingVerificationError(
        "object_mismatch",
        "Recovered repair evidence does not contain the requested scoped head",
      );
  }
  return true;
}

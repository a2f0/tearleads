import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";

/** Privately authenticated historical citations selected for one authored head. */
export type CurrentPolicyReferenceResolver = (
  current: VerifiedPrincipalPolicyCurrent,
  references: readonly ReferencedPrincipalHead[],
) => Promise<VerifiedPrincipalPolicyCurrent>;

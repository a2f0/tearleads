import {
  KeyingVerificationError,
  type PrincipalPolicyHistoryVerifier,
} from "@tearleads/crypto";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import { PrincipalHistoryEvidenceUnavailableError } from "./principalHistoryRecoveryReferences";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

/** Reusable signatures remain conditional on their authenticated authority lineage. */
export async function validatePrincipalHistoryRecoveryAuthority(
  input: RecoverPrincipalPolicyHistoryOptions,
  verifier: PrincipalPolicyHistoryVerifier,
): Promise<void> {
  const reference = verifier.getExternalAuthorityReference();
  if (!reference) return;
  try {
    const authority = await input.loadExternalAuthority?.([reference]);
    if (
      !authority?.states.some(({ head }) =>
        principalHeadMatchesReference(head, reference),
      )
    )
      throw new KeyingVerificationError(
        "stale_predecessor",
        "Cached principal history has a different authority lineage",
      );
  } catch (error) {
    if (error instanceof KeyingVerificationError)
      throw new PrincipalHistoryEvidenceUnavailableError(error);
    throw error;
  }
}

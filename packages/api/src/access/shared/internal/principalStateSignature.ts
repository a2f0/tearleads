import {
  computePrincipalStateHash,
  throwPrincipalPolicyValidationError as rejectPrincipalPolicy,
  type SignedPrincipalState,
  verifySignedPrincipalStateResult,
} from "@tearleads/crypto";

/**
 * A header that cannot be encoded is a malformed request (400), not an
 * unauthorized signer (403): the signature was never checked, so reporting
 * `unauthorized_signer` would misattribute a shape defect to the key.
 */
export async function assertSignedPrincipalStateVerified(
  state: SignedPrincipalState,
  signingPublicKey: Uint8Array,
): Promise<void> {
  const verification = await verifySignedPrincipalStateResult(
    state,
    signingPublicKey,
  );
  if (verification.ok) {
    return;
  }
  if (verification.error.code === "invalid_shape") {
    rejectPrincipalPolicy(
      "invalid_shape",
      `Principal state is malformed: ${verification.error.message}`,
    );
  }
  rejectPrincipalPolicy(
    "unauthorized_signer",
    "Invalid principal state signature",
  );
}

export async function assertStoredPrincipalStateVerbatim(
  stored: SignedPrincipalState,
  submitted: SignedPrincipalState,
  expectedStateHash: string,
): Promise<void> {
  if (
    (await computePrincipalStateHash(stored)) !== expectedStateHash ||
    stored.signature !== submitted.signature
  ) {
    rejectPrincipalPolicy(
      "invalid_shape",
      "Stored principal state does not preserve the verified state verbatim",
    );
  }
}

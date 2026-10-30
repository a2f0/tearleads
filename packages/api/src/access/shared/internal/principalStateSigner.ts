import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type SignedPrincipalState,
  throwPrincipalPolicyValidationError,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { isCanonicalStoredUuid } from "./canonicalStoredUuid";
import { loadSignerRow } from "./signerRows";

export async function loadPrincipalStateSigner(
  state: SignedPrincipalState,
  executor: DatabaseSession,
): Promise<{ signingPublicKey: Uint8Array; userId: string }> {
  if (
    !isCanonicalStoredUuid(state.principalId) ||
    !isCanonicalStoredUuid(state.signerUserId)
  ) {
    throwPrincipalPolicyValidationError(
      "invalid_shape",
      "Principal state identities must be canonical UUIDs",
    );
  }
  const signer = await loadSignerRow(executor, state.signerUserId);

  if (!signer) {
    throwPrincipalPolicyValidationError(
      "unauthorized_signer",
      "Principal state signer user not found",
    );
  }

  if (signer.fingerprint !== state.signerUserKeyFingerprint) {
    throwPrincipalPolicyValidationError(
      "unauthorized_signer",
      "Principal state signer fingerprint mismatch",
    );
  }

  return {
    signingPublicKey: base64ToBytes(signer.signingPublicKey),
    userId: state.signerUserId,
  };
}

import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { users } from "@symcrypt/api-shared/schema";
import {
  type SignedPrincipalState,
  throwPrincipalPolicyValidationError,
} from "@symcrypt/crypto";
import { base64ToBytes } from "@symcrypt/encoding";
import { eq } from "drizzle-orm";

export async function loadPrincipalStateSigner(
  state: SignedPrincipalState,
  executor: DatabaseSession,
): Promise<{ signingPublicKey: Uint8Array; userId: string }> {
  const [signer] = await executor
    .select({
      id: users.id,
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, state.signerUserId))
    .limit(1);

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
    userId: signer.id,
  };
}

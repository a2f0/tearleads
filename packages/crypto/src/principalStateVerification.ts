import { base64ToBytes } from "@tearleads/encoding";
import {
  KeyingVerificationError,
  type KeyingVerificationResult,
} from "./keying/verificationError";
import {
  encodeUnsignedPrincipalState,
  normalizeUnsignedPrincipalState,
  toUnsignedPrincipalState,
} from "./principalState";
import type {
  SignedPrincipalState,
  UnsignedPrincipalState,
} from "./principalStateTypes";
import { verify } from "./signing/verify";

function signatureMismatch(): KeyingVerificationResult<UnsignedPrincipalState> {
  return {
    ok: false,
    error: new KeyingVerificationError(
      "signature_mismatch",
      "Principal state signature verification failed",
    ),
  };
}

function decodeSignature(signature: string): Uint8Array | null {
  try {
    return base64ToBytes(signature);
  } catch {
    return null;
  }
}

/**
 * Distinguishes a header that cannot be encoded (`invalid_shape`: a field is
 * missing, malformed, or a non-canonical timestamp) from one that encodes but
 * was not signed by `publicKey` (`signature_mismatch`, which also covers a
 * signature that is not valid base64). Servers report the two differently:
 * the first is a malformed request, the second an unauthorized signer.
 */
export async function verifySignedPrincipalStateResult(
  state: SignedPrincipalState,
  publicKey: Uint8Array,
): Promise<KeyingVerificationResult<UnsignedPrincipalState>> {
  let normalizedState: UnsignedPrincipalState;
  try {
    normalizedState = await normalizeUnsignedPrincipalState(
      toUnsignedPrincipalState(state),
    );
  } catch (error) {
    return {
      ok: false,
      error: new KeyingVerificationError(
        "invalid_shape",
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  const signature = decodeSignature(state.signature);
  if (
    !signature ||
    !verify(signature, encodeUnsignedPrincipalState(normalizedState), publicKey)
  ) {
    return signatureMismatch();
  }
  return { ok: true, value: normalizedState };
}

export async function verifySignedPrincipalState(
  state: SignedPrincipalState,
  publicKey: Uint8Array,
): Promise<boolean> {
  return (await verifySignedPrincipalStateResult(state, publicKey)).ok;
}
